import { Api } from 'telegram';
import { UserbotService } from './userbot.service.js';
import { ChatAdminRightsService } from './chat-admin-rights.service.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';
import { upsertPeerCacheBatch } from '../utils/peer-cache.js';
import { classifyTelegramError } from '../utils/telegram-error-events.js';
import { withTimeout } from '../shared/utils.js';

const ACTIVE_STATUSES = new Set(['pending', 'scanning', 'joining', 'recomputing']);
const PREPARABLE_AUDIENCE_TYPES = new Set(['channel_audience_members', 'client_base_members', 'manual_list']);

const runningPreparations = new Set();

export class PreparationError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

function envFlag(name) {
    return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function joinsPerHour() {
    const value = Number(process.env.USERBOT_JOIN_PER_HOUR);
    return Number.isFinite(value) && value > 0 ? value : 4;
}

function joinSleepMs() {
    const value = Number(process.env.USERBOT_JOIN_SLEEP_MS);
    return Number.isFinite(value) && value >= 5000 ? value : 45000;
}

function parseFloodWaitSeconds(error) {
    const raw = String(error?.errorMessage || error?.message || error?.description || '');
    const match = raw.match(/FLOOD_WAIT_(\d+)/i) || raw.match(/RETRY AFTER (\d+)/i);
    return match ? Number(match[1]) : null;
}

function chunk(list, size) {
    const result = [];
    for (let i = 0; i < (list || []).length; i += size) {
        result.push(list.slice(i, i + size));
    }
    return result;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function jitter(baseMs) {
    return Math.round(baseMs * (0.85 + Math.random() * 0.3));
}

function isAutoJoinEnabled() {
    return envFlag('USERBOT_AUTO_JOIN_ENABLED');
}

function isAutoAdminEnabled() {
    return envFlag('USERBOT_AUTO_ADMIN_ENABLED');
}

function normalizeExternalTargets(rawList = []) {
    const seen = new Set();
    const targets = [];
    for (const raw of rawList || []) {
        const value = String(raw || '').trim();
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ raw: value, kind: 'unknown', chat_id: null, title: null, status: 'pending', error: null });
    }
    return targets;
}

function touchpoint(via, userbotId, options = {}) {
    return {
        userbot_id: userbotId,
        via,
        chat_id: options.chatId || null,
        confirmed: via !== 'shared_chat'
    };
}

export class BroadcastPreparationService {
    constructor(supabase) {
        this.supabase = supabase;
        this.userbotService = new UserbotService(
            supabase,
            process.env.TG_API_ID,
            process.env.TG_API_HASH
        );
    }

    async loadMembers(ownerId, payload = {}) {
        const audienceType = String(payload.audience_type || '').trim();
        const baseFilter = payload.base_filter || 'all_members';

        if (audienceType === 'manual_list') {
            const manualMemberMap = new Map((payload.manual_members || [])
                .filter(member => member?.tg_user_id)
                .map(member => [String(member.tg_user_id), member]));
            const uniqueIds = Array.from(new Set((payload.manual_tg_user_ids || []).map(v => String(v)).filter(Boolean)));
            return uniqueIds.map(tgUserId => ({
                tg_user_id: tgUserId,
                username: manualMemberMap.get(tgUserId)?.username || null,
                display_name: manualMemberMap.get(tgUserId)?.display_name || manualMemberMap.get(tgUserId)?.username || null,
                source_channel_ids: []
            }));
        }

        if (audienceType === 'channel_audience_members') {
            if (!payload.base_id) throw new PreparationError(400, 'Не выбрана база аудитории');
            const { data: members, error } = await this.supabase
                .from('channel_audience_members')
                .select('tg_user_id, username, display_name, present_now, channels_count, is_bot, dm_blocked, source_channel_ids')
                .eq('owner_id', ownerId)
                .eq('base_id', payload.base_id)
                .eq('is_bot', false)
                .order('channels_count', { ascending: false });
            if (error) throw error;

            return (members || [])
                .filter(member => !member.dm_blocked)
                .filter(member => {
                    if (baseFilter === 'present_only') return !!member.present_now;
                    if (baseFilter === 'missing_only') return !member.present_now;
                    if (baseFilter === 'partial_only') return Number(member.channels_count || 0) > 0 && !!member.present_now;
                    if (baseFilter === 'multi_channel_only') return Number(member.channels_count || 0) >= 2;
                    return true;
                })
                .map(member => ({
                    tg_user_id: String(member.tg_user_id),
                    username: member.username || null,
                    display_name: member.display_name || member.username || null,
                    source_channel_ids: Array.isArray(member.source_channel_ids) ? member.source_channel_ids : []
                }));
        }

        if (audienceType === 'client_base_members') {
            if (!payload.base_id) throw new PreparationError(400, 'Не выбрана база клиентов');
            const { data: members, error } = await this.supabase
                .from('client_base_members')
                .select('tg_user_id, username, display_name')
                .eq('owner_id', ownerId)
                .eq('base_id', payload.base_id);
            if (error) throw error;

            // Обогащаем coverage из аудитории: source_channel_ids нужны для shared_chat touchpoints
            const tgIds = (members || []).map(member => String(member.tg_user_id));
            const audienceRows = [];
            for (const part of chunk(tgIds, 500)) {
                const { data } = await this.supabase
                    .from('channel_audience_members')
                    .select('tg_user_id, source_channel_ids, dm_blocked')
                    .eq('owner_id', ownerId)
                    .in('tg_user_id', part);
                if (data) audienceRows.push(...data);
            }
            const audienceMap = new Map(audienceRows.map(row => [String(row.tg_user_id), row]));

            return (members || [])
                .filter(member => !audienceMap.get(String(member.tg_user_id))?.dm_blocked)
                .map(member => {
                    const audience = audienceMap.get(String(member.tg_user_id));
                    return {
                        tg_user_id: String(member.tg_user_id),
                        username: member.username || null,
                        display_name: member.display_name || member.username || null,
                        source_channel_ids: audience && Array.isArray(audience.source_channel_ids)
                            ? audience.source_channel_ids
                            : []
                    };
                });
        }

        throw new PreparationError(400, 'Подготовка поддерживается для баз аудитории, баз клиентов и ручной выборки');
    }

    async loadPoolUserbots(ownerId, userbotIds = []) {
        const requested = (userbotIds || []).map(id => String(id)).filter(Boolean);
        if (requested.length === 0) throw new PreparationError(400, 'Выбери хотя бы одного юзербота в пул');

        const reservedUserbotIds = await loadReservedUserbotIds(this.supabase, ownerId);
        const { data: userbots, error } = await this.supabase
            .from('tg_accounts')
            .select('*, proxies(host, port, username, password, is_working)')
            .eq('owner_id', ownerId)
            .eq('account_type', 'userbot');
        if (error) throw error;

        const pool = (userbots || []).filter(userbot =>
            requested.includes(String(userbot.id)) &&
            !reservedUserbotIds.has(String(userbot.id)) &&
            userbot.runtime_status !== 'pending_activation' &&
            !(userbot.proxy_id && userbot.proxies?.is_working === false)
        );

        if (pool.length === 0) {
            throw new PreparationError(400, 'Среди выбранных юзерботов нет operable (safe-mode и сдохшие прокси исключены)');
        }
        return pool;
    }

    async createPreparation(ownerId, payload = {}) {
        const audienceType = String(payload.audience_type || '').trim();
        if (!PREPARABLE_AUDIENCE_TYPES.has(audienceType)) {
            throw new PreparationError(400, 'Подготовка поддерживается для баз аудитории, баз клиентов и ручной выборки');
        }

        const members = await this.loadMembers(ownerId, payload);
        if (members.length === 0) {
            throw new PreparationError(400, 'В этой аудитории нет людей для подготовки');
        }

        const pool = await this.loadPoolUserbots(ownerId, payload.userbot_ids);

        const { data: preparation, error } = await this.supabase
            .from('broadcast_preparations')
            .insert({
                owner_id: ownerId,
                audience_type: audienceType,
                channel_id: payload.channel_id || null,
                base_id: payload.base_id || null,
                manual_tg_user_ids: payload.manual_tg_user_ids || [],
                base_filter: payload.base_filter || 'all_members',
                userbot_ids: pool.map(userbot => userbot.id),
                external_targets: normalizeExternalTargets(payload.external_targets),
                status: 'pending',
                phase_detail: {
                    scan: { done: 0, total: pool.length },
                    joins: { done: 0, total: 0 },
                    errors: []
                }
            })
            .select()
            .single();
        if (error) throw error;

        const itemRows = members.map(member => ({
            preparation_id: preparation.id,
            tg_user_id: member.tg_user_id,
            username: member.username,
            display_name: member.display_name
        }));
        for (const part of chunk(itemRows, 500)) {
            const { error: itemsError } = await this.supabase
                .from('broadcast_preparation_items')
                .insert(part);
            if (itemsError) throw itemsError;
        }

        // source_channel_ids живёт вне items — храним в контексте запуска через повторную загрузку
        await this.kick(preparation.id);
        return { id: preparation.id, status: 'pending', members: members.length, userbots: pool.length };
    }

    kick(preparationId) {
        if (runningPreparations.has(preparationId)) return;
        runningPreparations.add(preparationId);
        this.runPreparation(preparationId)
            .catch(error => {
                console.error(`[broadcast-preparation] run ${preparationId} failed:`, error?.message || error);
            })
            .finally(() => runningPreparations.delete(preparationId));
    }

    async resumeStuckPreparations() {
        const threshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const { data: stuck } = await this.supabase
            .from('broadcast_preparations')
            .select('id')
            .in('status', ['pending', 'scanning', 'joining', 'recomputing'])
            .lt('updated_at', threshold);
        for (const row of stuck || []) {
            this.kick(row.id);
        }
        if (stuck?.length) {
            console.log(`[broadcast-preparation] resumed ${stuck.length} stuck preparation(s)`);
        }
    }

    async getPreparationRow(ownerId, preparationId) {
        const query = this.supabase
            .from('broadcast_preparations')
            .select('*')
            .eq('id', preparationId);
        const request = ownerId ? query.eq('owner_id', ownerId) : query;
        const { data } = await request.maybeSingle();
        return data || null;
    }

    async runPreparation(preparationId) {
        let preparation = await this.getPreparationRow(null, preparationId);
        if (!preparation || !ACTIVE_STATUSES.has(preparation.status)) return;

        try {
            if (preparation.status === 'pending' || preparation.status === 'scanning') {
                await this.phaseScan(preparation);
                preparation = await this.getPreparationRow(null, preparationId);
            }

            if (!preparation || !ACTIVE_STATUSES.has(preparation.status)) return;

            if (preparation.status === 'joining') {
                await this.phaseJoin(preparation);
                preparation = await this.getPreparationRow(null, preparationId);
            }

            if (!preparation || !ACTIVE_STATUSES.has(preparation.status)) return;

            await this.phaseRecompute(preparation);
        } catch (error) {
            console.error(`[broadcast-preparation] ${preparationId} failed:`, error?.message || error);
            await this.supabase
                .from('broadcast_preparations')
                .update({ status: 'failed', error: String(error?.message || error).slice(0, 500), updated_at: new Date().toISOString() })
                .eq('id', preparationId);
        }
    }

    async updatePhaseDetail(preparationId, patch) {
        const { data: row } = await this.supabase
            .from('broadcast_preparations')
            .select('phase_detail')
            .eq('id', preparationId)
            .single();
        const current = row?.phase_detail || {};
        const errors = [...(current.errors || []), ...(patch.errors || [])].slice(-30);
        await this.supabase
            .from('broadcast_preparations')
            .update({
                phase_detail: { ...current, ...patch, errors },
                updated_at: new Date().toISOString()
            })
            .eq('id', preparationId);
    }

    async setStatus(preparationId, status, extra = {}) {
        await this.supabase
            .from('broadcast_preparations')
            .update({ status, ...extra, updated_at: new Date().toISOString() })
            .eq('id', preparationId);
    }

    async loadItems(preparationId) {
        const rows = [];
        let from = 0;
        while (true) {
            const { data } = await this.supabase
                .from('broadcast_preparation_items')
                .select('id, tg_user_id, username, display_name, reachable_by, status')
                .eq('preparation_id', preparationId)
                .order('id', { ascending: true })
                .range(from, from + 999);
            if (!data || data.length === 0) break;
            rows.push(...data);
            if (data.length < 1000) break;
            from += 1000;
        }
        return rows;
    }

    async loadMemberSourceChannels(ownerId, preparation) {
        // Возвращает Map<tg_user_id, string[] channel_uuid> по актуальной аудитории
        const audienceType = preparation.audience_type;
        const map = new Map();

        const fillByTgIds = async (tgIds) => {
            for (const part of chunk(tgIds, 500)) {
                const { data } = await this.supabase
                    .from('channel_audience_members')
                    .select('tg_user_id, source_channel_ids')
                    .eq('owner_id', ownerId)
                    .in('tg_user_id', part);
                for (const row of data || []) {
                    map.set(String(row.tg_user_id), Array.isArray(row.source_channel_ids) ? row.source_channel_ids : []);
                }
            }
        };

        if (audienceType === 'channel_audience_members') {
            const { data } = await this.supabase
                .from('channel_audience_members')
                .select('tg_user_id, source_channel_ids')
                .eq('owner_id', ownerId)
                .eq('base_id', preparation.base_id)
                .eq('is_bot', false);
            for (const row of data || []) {
                map.set(String(row.tg_user_id), Array.isArray(row.source_channel_ids) ? row.source_channel_ids : []);
            }
        } else if (audienceType === 'client_base_members') {
            const { data: members } = await this.supabase
                .from('client_base_members')
                .select('tg_user_id')
                .eq('owner_id', ownerId)
                .eq('base_id', preparation.base_id);
            await fillByTgIds((members || []).map(member => String(member.tg_user_id)));
        } else if (audienceType === 'manual_list') {
            await fillByTgIds((preparation.manual_tg_user_ids || []).map(String));
        }

        return map;
    }

    async loadOwnerChannels(ownerId) {
        const { data, error } = await this.supabase
            .from('channels')
            .select('id, title, tg_chat_id, username, visibility')
            .eq('owner_id', ownerId)
            .not('tg_chat_id', 'is', null);
        if (error) throw error;
        return data || [];
    }

    async scanUserbotDialogs(userbot) {
        const client = await this.userbotService.createAuthorizedClient(userbot);
        try {
            const dialogs = await withTimeout(client.getDialogs({ limit: 300 }), 120_000, 'Скан диалогов');
            const dialogUserIds = new Set();
            const chatIds = new Set();
            const peerCacheEntries = [];

            for (const dialog of dialogs || []) {
                const entity = dialog?.entity;
                if (!entity) continue;

                if (entity.className === 'User') {
                    const tgUserId = String(entity.id);
                    dialogUserIds.add(tgUserId);
                    if (entity.accessHash != null) {
                        peerCacheEntries.push({
                            owner_id: userbot.owner_id,
                            userbot_id: userbot.id,
                            tg_user_id: tgUserId,
                            access_hash: entity.accessHash.toString(),
                            username: entity.username || null,
                            source: 'dialogs'
                        });
                    }
                } else if (entity.className === 'Channel' || entity.className === 'Chat' ||
                    entity.className === 'ChannelForbidden' || entity.className === 'ChatForbidden') {
                    if (dialog.id != null) chatIds.add(String(dialog.id));
                }
            }

            await upsertPeerCacheBatch(this.supabase, peerCacheEntries);
            return { dialogUserIds, chatIds };
        } finally {
            await client.disconnect();
        }
    }

    async loadPeerCacheForPool(userbotIds, memberIds) {
        const peerCache = [];
        for (const userbotId of userbotIds) {
            for (const part of chunk(memberIds, 500)) {
                const { data } = await this.supabase
                    .from('userbot_peer_cache')
                    .select('userbot_id, tg_user_id, access_hash')
                    .eq('userbot_id', String(userbotId))
                    .in('tg_user_id', part)
                    .not('access_hash', 'is', null);
                if (data) peerCache.push(...data);
            }
        }
        return peerCache;
    }

    async phaseScan(preparation) {
        const ownerId = preparation.owner_id;
        await this.setStatus(preparation.id, 'scanning');
        const pool = await this.loadPoolUserbots(ownerId, preparation.userbot_ids);

        const scanResults = new Map(); // userbot_id -> {dialogUserIds, chatIds}
        let done = 0;
        for (const userbot of pool) {
            try {
                scanResults.set(userbot.id, await this.scanUserbotDialogs(userbot));
            } catch (error) {
                await this.updatePhaseDetail(preparation.id, {
                    scan: { done, total: pool.length },
                    errors: [`Скан диалогов @${userbot.tg_username || userbot.id}: ${String(error?.message || error).slice(0, 200)}`]
                });
            }
            done += 1;
            await this.updatePhaseDetail(preparation.id, { scan: { done, total: pool.length } });
        }

        if (scanResults.size === 0) {
            throw new PreparationError(400, 'Ни один юзербот из пула не отдал диалоги');
        }

        // peer cache + пересечение
        const items = await this.loadItems(preparation.id);
        const memberIds = items.map(item => item.tg_user_id);
        const memberSet = new Set(memberIds);
        const peerCacheRows = await this.loadPeerCacheForPool([...scanResults.keys()], memberIds);
        const peerCacheSet = new Set(peerCacheRows.map(row => `${row.userbot_id}:${row.tg_user_id}`));

        const sourceChannelMap = await this.loadMemberSourceChannels(ownerId, preparation);
        const ownerChannels = await this.loadOwnerChannels(ownerId);
        const channelByUuid = new Map(ownerChannels.map(channel => [String(channel.id), channel]));

        // tg_chat_id -> список каналов (для touchpoints)
        const memberChatIds = new Map(); // tg_user_id -> Set<marked tg_chat_id>
        for (const [tgUserId, channelUuids] of sourceChannelMap.entries()) {
            if (!memberSet.has(tgUserId)) continue;
            const chatIdSet = new Set();
            for (const channelUuid of channelUuids || []) {
                const channel = channelByUuid.get(String(channelUuid));
                if (channel?.tg_chat_id) chatIdSet.add(String(channel.tg_chat_id));
            }
            if (chatIdSet.size > 0) memberChatIds.set(tgUserId, chatIdSet);
        }

        const updates = [];
        for (const item of items) {
            const touchpoints = [];
            for (const [userbotId, scan] of scanResults.entries()) {
                if (scan.dialogUserIds.has(item.tg_user_id)) {
                    touchpoints.push(touchpoint('dialog', userbotId));
                    continue;
                }
                if (peerCacheSet.has(`${userbotId}:${item.tg_user_id}`)) {
                    touchpoints.push(touchpoint('access_hash', userbotId));
                    continue;
                }
                const chats = memberChatIds.get(item.tg_user_id);
                if (chats) {
                    for (const chatId of chats) {
                        if (scan.chatIds.has(chatId)) {
                            touchpoints.push(touchpoint('shared_chat', userbotId, { chatId }));
                            break;
                        }
                    }
                }
            }
            updates.push({
                preparation_id: preparation.id,
                tg_user_id: item.tg_user_id,
                reachable_by: touchpoints,
                status: touchpoints.length > 0 ? 'reachable' : 'unreachable'
            });
        }

        for (const part of chunk(updates, 500)) {
            await this.supabase
                .from('broadcast_preparation_items')
                .upsert(part, { onConflict: 'preparation_id,tg_user_id' });
        }

        const hasJoinWork = isAutoJoinEnabled();
        await this.setStatus(preparation.id, hasJoinWork ? 'joining' : 'recomputing');
        if (!hasJoinWork) {
            await this.updatePhaseDetail(preparation.id, {
                note: 'USERBOT_AUTO_JOIN_ENABLED выключен — вступления пропущены, только скан'
            });
        }
        return hasJoinWork;
    }

    async countRecentJoins(userbotId) {
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { count, error } = await this.supabase
            .from('userbot_join_log')
            .select('id', { count: 'exact', head: true })
            .eq('userbot_id', String(userbotId))
            .gte('created_at', since);
        if (error) return Infinity;
        return count || 0;
    }

    async buildJoinTargets(preparation) {
        const targets = [];

        for (const external of preparation.external_targets || []) {
            if (external.status !== 'pending') continue;
            targets.push({ raw: external.raw, scope: 'external', index: (preparation.external_targets || []).indexOf(external) });
        }

        if (preparation.audience_type === 'channel_audience_members' && preparation.base_id) {
            const { data: links } = await this.supabase
                .from('channel_audience_channels')
                .select('channel_id, channels(id, title, tg_chat_id, username)')
                .eq('base_id', preparation.base_id);
            for (const link of links || []) {
                const channel = link.channels;
                if (!channel) continue;
                if (!channel.username) {
                    await this.updatePhaseDetail(preparation.id, {
                        errors: [`«${channel.title}» — приватный канал без ссылки-инвайта, юзерботу не вступить. Добавь группу вручную по ссылке.`]
                    });
                    continue;
                }
                targets.push({
                    raw: `https://t.me/${channel.username}`,
                    scope: 'owner',
                    chat_id: channel.tg_chat_id ? String(channel.tg_chat_id) : null,
                    title: channel.title
                });
            }
        } else if (preparation.audience_type === 'client_base_members' || preparation.audience_type === 'manual_list') {
            // вступаем в каналы-источники получателей: где человек замечен в аудиториях, там и ищем общий чат
            const sourceMap = await this.loadMemberSourceChannels(preparation.owner_id, preparation);
            const neededIds = new Set();
            for (const list of sourceMap.values()) {
                for (const id of list || []) neededIds.add(String(id));
            }
            if (neededIds.size > 0) {
                const { data: channels } = await this.supabase
                    .from('channels')
                    .select('id, title, tg_chat_id, username')
                    .eq('owner_id', preparation.owner_id)
                    .in('id', [...neededIds]);
                for (const channel of channels || []) {
                    if (!channel.username) {
                        await this.updatePhaseDetail(preparation.id, {
                            errors: [`«${channel.title}» — приватный канал без ссылки-инвайта, юзерботу не вступить. Добавь группу вручную по ссылке.`]
                        });
                        continue;
                    }
                    targets.push({
                        raw: `https://t.me/${channel.username}`,
                        scope: 'owner',
                        chat_id: channel.tg_chat_id ? String(channel.tg_chat_id) : null,
                        title: channel.title
                    });
                }
            }
        }

        return targets;
    }

    // CHAT_ADMIN_REQUIRED: пытаемся выдать юзерботу админ-права — сначала через официального бота, потом через юзербота-админа из пула
    async tryGrantAdminRights(preparation, pool, userbot, chatId, rawLink) {
        if (!isAutoAdminEnabled()) return false;
        try {
            const rights = new ChatAdminRightsService(this.supabase);

            let tgUserId = String(userbot.tg_account_id || '').trim();
            if (!tgUserId || tgUserId === 'null') {
                const client = await this.userbotService.createAuthorizedClient(userbot);
                try {
                    tgUserId = String((await client.getMe()).id);
                } finally {
                    await client.disconnect();
                }
            }

            const bot = await rights.findPromoterBot(preparation.owner_id, chatId);
            if (bot) {
                const promoted = await rights.grantAdminViaBot(bot.bot, chatId, tgUserId);
                if (promoted.ok) {
                    await this.updatePhaseDetail(preparation.id, {
                        note: `${rawLink}: админ-права выданы ботом @${bot.bot.tg_username || 'official'} — сканируем участников.`
                    });
                    return true;
                }
                await this.updatePhaseDetail(preparation.id, {
                    errors: [`${rawLink}: бот @${bot.bot.tg_username || 'official'} не смог выдать права (${promoted.description}) — пробуем юзербота-админа.`]
                });
            }

            const candidates = (pool || []).filter(candidate => String(candidate.id) !== String(userbot.id));
            const viaUserbot = await rights.findPromoterUserbot(this.userbotService, candidates, rawLink, chatId, tgUserId);
            if (viaUserbot) {
                await this.updatePhaseDetail(preparation.id, {
                    note: `${rawLink}: админ-права выданы юзерботом @${viaUserbot.userbot.tg_username || viaUserbot.userbot.id} — сканируем участников.`
                });
                return true;
            }

            await this.updatePhaseDetail(preparation.id, {
                errors: [`${rawLink}: выдать админ-права некому — ни официальный бот, ни юзерботы пула не админы этого чата. Выдай права руками и нажми «Проверить снова».`]
            });
            return false;
        } catch (error) {
            console.error(`[broadcast-preparation] auto-admin ${rawLink} failed:`, error?.message || error);
            return false;
        }
    }

    async scanChatParticipants(userbot, chatId, accessHash = null) {
        const client = await this.userbotService.createAuthorizedClient(userbot);
        try {
            // сырой положительный id канала свежий клиент не разрезолвит (PeerUser) — ходим через access_hash из вступления
            const entity = accessHash
                ? new Api.InputPeerChannel({
                    channelId: String(chatId).replace(/^-100/, ''),
                    accessHash: String(accessHash)
                })
                : chatId;
            const participants = await withTimeout(client.getParticipants(entity, { limit: 5000 }), 120_000, 'Скан участников группы');
            await upsertPeerCacheBatch(this.supabase, (participants || [])
                .filter(participant => participant?.accessHash != null)
                .map(participant => ({
                    owner_id: userbot.owner_id,
                    userbot_id: userbot.id,
                    tg_user_id: String(participant.id),
                    access_hash: participant.accessHash.toString(),
                    username: participant.username || null,
                    source: 'get_participants'
                })));
            return new Set((participants || []).map(participant => String(participant.id)));
        } finally {
            await client.disconnect();
        }
    }

    async applyConfirmedTouchpoints(preparationId, userbotId, confirmedUserIds, via, chatId) {
        if (!confirmedUserIds || confirmedUserIds.size === 0) return;
        const items = await this.loadItems(preparationId);
        const updates = [];
        for (const item of items) {
            if (!confirmedUserIds.has(item.tg_user_id)) continue;
            const existing = Array.isArray(item.reachable_by) ? item.reachable_by : [];
            const already = existing.some(tp => tp.userbot_id === userbotId && tp.confirmed);
            if (already) continue;
            updates.push({
                preparation_id: preparationId,
                tg_user_id: item.tg_user_id,
                reachable_by: [...existing.filter(tp => !(tp.userbot_id === userbotId && !tp.confirmed)), touchpoint(via, userbotId, { chatId })],
                status: 'reachable'
            });
        }
        for (const part of chunk(updates, 500)) {
            await this.supabase
                .from('broadcast_preparation_items')
                .upsert(part, { onConflict: 'preparation_id,tg_user_id' });
        }
    }

    async phaseJoin(preparation) {
        const ownerId = preparation.owner_id;
        await this.setStatus(preparation.id, 'joining');

        const pool = await this.loadPoolUserbots(ownerId, preparation.userbot_ids);
        const targets = await this.buildJoinTargets(preparation);
        const externalTargets = preparation.external_targets || [];

        const pausedUntil = new Map(); // userbot_id -> ts
        const joinStates = new Map(); // `${scope}:${raw}:${userbot_id}` -> 'done' | 'failed'
        let joinsDone = 0;
        const totalOps = targets.length * pool.length;

        let rounds = 0;
        while (rounds < 200) {
            const current = await this.getPreparationRow(null, preparation.id);
            if (!current || current.status !== 'joining') return;

            let progressed = false;
            let allDone = true;

            for (const target of targets) {
                if (target.raw == null && target.scope === 'owner') {
                    continue; // приватный канал без юзернейма — обработаем отдельно ниже
                }
                for (const userbot of pool) {
                    const key = `${target.scope}:${target.raw}:${userbot.id}`;
                    if (joinStates.get(key) === 'done' || joinStates.get(key) === 'failed') continue;
                    allDone = false;

                    const pauseTs = pausedUntil.get(userbot.id) || 0;
                    if (Date.now() < pauseTs) continue;
                    if ((await this.countRecentJoins(userbot.id)) >= joinsPerHour()) continue;

                    try {
                        const joined = await this.userbotService.joinChatByInvite(userbot, { inviteLink: target.raw });
                        joinStates.set(key, 'done');
                        joinsDone += 1;
                        progressed = true;
                        await this.supabase.from('userbot_join_log').insert({ userbot_id: userbot.id, target: target.raw });

                        const chatId = joined?.chat_id ? String(joined.chat_id) : target.chat_id;
                        const accessHash = joined?.access_hash || null;
                        if (chatId) {
                            try {
                                const confirmed = await this.scanChatParticipants(userbot, chatId, accessHash);
                                await this.applyConfirmedTouchpoints(preparation.id, userbot.id, confirmed, 'access_hash', chatId);
                            } catch (scanError) {
                                const scanMessage = String(scanError?.message || scanError);
                                if (scanMessage.toUpperCase().includes('CHAT_ADMIN_REQUIRED') && chatId) {
                                    const granted = await this.tryGrantAdminRights(preparation, pool, userbot, chatId, target.raw);
                                    if (granted) {
                                        try {
                                            const confirmed = await this.scanChatParticipants(userbot, chatId, accessHash);
                                            await this.applyConfirmedTouchpoints(preparation.id, userbot.id, confirmed, 'access_hash', chatId);
                                        } catch (retryError) {
                                            await this.updatePhaseDetail(preparation.id, {
                                                errors: [`Повторный скан участников ${target.raw}: ${String(retryError?.message || retryError).slice(0, 200)}`]
                                            });
                                        }
                                    } else {
                                        await this.updatePhaseDetail(preparation.id, {
                                            errors: [`Скан участников ${target.raw}: Telegram отдаёт список участников канала только админам. Сделай юзербота админом этого канала и нажми «Проверить снова» — точка касания сейчас считается по общему чату.`]
                                        });
                                    }
                                } else {
                                    await this.updatePhaseDetail(preparation.id, {
                                        errors: [`Скан участников ${target.raw}: ${scanMessage.slice(0, 200)}`]
                                    });
                                }
                            }
                        }

                        if (target.scope === 'external' && target.index != null) {
                            const nextExternals = [...externalTargets];
                            nextExternals[target.index] = {
                                ...nextExternals[target.index],
                                kind: joined?.kind || 'unknown',
                                chat_id: chatId,
                                title: joined?.title || null,
                                status: 'joined'
                            };
                            await this.supabase
                                .from('broadcast_preparations')
                                .update({ external_targets: nextExternals, updated_at: new Date().toISOString() })
                                .eq('id', preparation.id);
                        }
                    } catch (error) {
                        const message = String(error?.message || error?.errorMessage || error);
                        const classification = classifyTelegramError(error);
                        const floodSeconds = parseFloodWaitSeconds(error);

                        if (message.toUpperCase().includes('USER_ALREADY_PARTICIPANT')) {
                            joinStates.set(key, 'done');
                            progressed = true;
                            continue;
                        }
                        if (floodSeconds) {
                            pausedUntil.set(userbot.id, Date.now() + Math.min(floodSeconds, 3600) * 1000 + 30_000);
                            await this.updatePhaseDetail(preparation.id, {
                                joins: { done: joinsDone, total: totalOps },
                                errors: [`Flood wait @${userbot.tg_username || userbot.id}: пауза ${floodSeconds}с на ${target.raw}`]
                            });
                            continue;
                        }
                        joinStates.set(key, 'failed');
                        progressed = true;
                        await this.updatePhaseDetail(preparation.id, {
                            joins: { done: joinsDone, total: totalOps },
                            errors: [`Вступление ${target.raw} через @${userbot.tg_username || userbot.id}: ${message.slice(0, 200)}`]
                        });
                        if (classification.restriction_kind === 'account_flagged' || classification.restriction_kind === 'session_revoked') {
                            pausedUntil.set(userbot.id, Date.now() + 24 * 60 * 60 * 1000);
                        }
                        if (target.scope === 'external' && target.index != null) {
                            const nextExternals = [...externalTargets];
                            nextExternals[target.index] = {
                                ...nextExternals[target.index],
                                status: 'failed',
                                error: message.slice(0, 300)
                            };
                            await this.supabase
                                .from('broadcast_preparations')
                                .update({ external_targets: nextExternals, updated_at: new Date().toISOString() })
                                .eq('id', preparation.id);
                        }
                    }

                    await this.updatePhaseDetail(preparation.id, { joins: { done: joinsDone, total: totalOps } });
                    await sleep(jitter(joinSleepMs()));
                }
            }

            if (allDone) break;

            const stillPending = Array.from(joinStates.entries()).filter(([, state]) => state !== 'done' && state !== 'failed').length;
            const deferredKeys = targets.length * pool.length - Array.from(joinStates.values()).filter(state => state === 'done' || state === 'failed').length;
            if (!progressed && deferredKeys > 0) {
                const minPause = Math.min(...Array.from(pausedUntil.values()).filter(ts => ts > Date.now()).concat(Date.now() + 10 * 60 * 1000));
                const waitMs = Math.min(Math.max(minPause - Date.now(), 30_000), 10 * 60 * 1000);
                await this.updatePhaseDetail(preparation.id, {
                    joins: { done: joinsDone, total: totalOps },
                    note: `Ждём квоту на вступления (${stillPending || deferredKeys} осталось) — пауза ${Math.round(waitMs / 60000)} мин`
                });
                await sleep(waitMs);
            } else if (!progressed) {
                break;
            }

            rounds += 1;
        }

        await this.setStatus(preparation.id, 'recomputing');
    }

    async phaseRecompute(preparation) {
        const items = await this.loadItems(preparation.id);
        const perUserbot = new Map();

        let confirmed = 0;
        let probable = 0;
        let unreachable = 0;

        for (const item of items) {
            const touchpoints = Array.isArray(item.reachable_by) ? item.reachable_by : [];
            const isReachable = touchpoints.length > 0;
            const isConfirmed = touchpoints.some(tp => tp.confirmed);

            if (isConfirmed) confirmed += 1;
            else if (isReachable) probable += 1;
            else unreachable += 1;

            for (const tp of touchpoints) {
                const key = String(tp.userbot_id);
                perUserbot.set(key, (perUserbot.get(key) || 0) + 1);
            }
        }

        const total = items.length;
        const coverage = total > 0 ? Math.round(((confirmed + probable) / total) * 100) : 0;

        await this.supabase
            .from('broadcast_preparations')
            .update({
                status: 'ready',
                stats: {
                    total,
                    confirmed,
                    probable,
                    unreachable,
                    coverage_pct: coverage,
                    per_userbot: Object.fromEntries(perUserbot)
                },
                updated_at: new Date().toISOString()
            })
            .eq('id', preparation.id)
            .eq('status', 'recomputing');
    }

    async getStatus(ownerId, preparationId) {
        const preparation = await this.getPreparationRow(ownerId, preparationId);
        if (!preparation) throw new PreparationError(404, 'Подготовка не найдена');
        return preparation;
    }

    async listMembers(ownerId, preparationId, { filter, limit = 50, offset = 0 } = {}) {
        const preparation = await this.getPreparationRow(ownerId, preparationId);
        if (!preparation) throw new PreparationError(404, 'Подготовка не найдена');

        let query = this.supabase
            .from('broadcast_preparation_items')
            .select('tg_user_id, username, display_name, reachable_by, status, last_error', { count: 'exact' })
            .eq('preparation_id', preparationId)
            .order('status', { ascending: true })
            .range(offset, offset + limit - 1);
        if (filter === 'unreachable') query = query.eq('status', 'unreachable');
        if (filter === 'reachable') query = query.eq('status', 'reachable');

        const { data, count } = await query;
        return { members: data || [], total: count || 0 };
    }

    async addJoinTargets(ownerId, preparationId, rawTargets = []) {
        const preparation = await this.getPreparationRow(ownerId, preparationId);
        if (!preparation) throw new PreparationError(404, 'Подготовка не найдена');
        if (!['ready', 'failed'].includes(preparation.status)) {
            throw new PreparationError(400, 'Добавлять группы можно только к завершённой подготовке');
        }

        const fresh = normalizeExternalTargets(rawTargets);
        if (fresh.length === 0) throw new PreparationError(400, 'Список групп пуст');

        await this.supabase
            .from('broadcast_preparations')
            .update({
                external_targets: [...(preparation.external_targets || []), ...fresh],
                status: 'joining',
                updated_at: new Date().toISOString()
            })
            .eq('id', preparationId);

        this.kick(preparationId);
        return { status: 'joining', added: fresh.length };
    }

    async recheck(ownerId, preparationId) {
        const preparation = await this.getPreparationRow(ownerId, preparationId);
        if (!preparation) throw new PreparationError(404, 'Подготовка не найдена');
        if (!['ready', 'failed'].includes(preparation.status)) {
            throw new PreparationError(400, 'Перепроверка доступна только для завершённой подготовки');
        }

        await this.setStatus(preparationId, 'scanning');
        this.kick(preparationId);
        return { status: 'scanning' };
    }

    async cancel(ownerId, preparationId) {
        const preparation = await this.getPreparationRow(ownerId, preparationId);
        if (!preparation) throw new PreparationError(404, 'Подготовка не найдена');
        if (!ACTIVE_STATUSES.has(preparation.status)) {
            throw new PreparationError(400, 'Эта подготовка уже не активна');
        }
        await this.setStatus(preparationId, 'cancelled');
        return { status: 'cancelled' };
    }
}
