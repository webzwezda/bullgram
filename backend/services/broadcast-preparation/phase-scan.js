// Скан-фаза подготовки рассылки и общий kernel модуля: константы, класс
// PreparationError и чистые хелперы, которые делят фасад и phase-файлы.
// Выделено из broadcast-preparation.service.js при разрезке под pre-commit
// лимит: методы класса стали однострочными делегатами, инстанс сервиса
// передаётся первым аргументом (service).
import { upsertPeerCacheBatch } from '../../utils/peer-cache.js';
import { withTimeout } from '../../shared/utils.js';

export const ACTIVE_STATUSES = new Set(['pending', 'scanning', 'joining', 'recomputing']);

export const scanChatIdsCache = new Map(); // preparationId -> Map(userbotId, Set<chat_id из диалогов>)

export class PreparationError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

export function envFlag(name) {
    return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function isAutoJoinEnabled() {
    return envFlag('USERBOT_AUTO_JOIN_ENABLED');
}

export function normalizeExternalTargets(rawList = []) {
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

export function touchpoint(via, userbotId, options = {}) {
    return {
        userbot_id: userbotId,
        via,
        chat_id: options.chatId || null,
        confirmed: via !== 'shared_chat'
    };
}

export function chunk(list, size) {
    const result = [];
    for (let i = 0; i < (list || []).length; i += size) {
        result.push(list.slice(i, i + size));
    }
    return result;
}

export async function scanUserbotDialogs(service, userbot) {
    const client = await service.userbotService.createAuthorizedClient(userbot);
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

        await upsertPeerCacheBatch(service.supabase, peerCacheEntries);
        return { dialogUserIds, chatIds };
    } finally {
        await client.disconnect();
    }
}

export async function loadItems(service, preparationId) {
    const rows = [];
    let from = 0;
    while (true) {
        const { data } = await service.supabase
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

export async function loadMemberSourceChannels(service, ownerId, preparation) {
    // Возвращает Map<tg_user_id, string[] channel_uuid> по актуальной аудитории
    const audienceType = preparation.audience_type;
    const map = new Map();

    const fillByTgIds = async (tgIds) => {
        for (const part of chunk(tgIds, 500)) {
            const { data } = await service.supabase
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
        const { data } = await service.supabase
            .from('channel_audience_members')
            .select('tg_user_id, source_channel_ids')
            .eq('owner_id', ownerId)
            .eq('base_id', preparation.base_id)
            .eq('is_bot', false);
        for (const row of data || []) {
            map.set(String(row.tg_user_id), Array.isArray(row.source_channel_ids) ? row.source_channel_ids : []);
        }
    } else if (audienceType === 'client_base_members') {
        const { data: members } = await service.supabase
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

export async function loadOwnerChannels(service, ownerId) {
    const { data, error } = await service.supabase
        .from('channels')
        .select('id, title, tg_chat_id, username, visibility')
        .eq('owner_id', ownerId)
        .not('tg_chat_id', 'is', null);
    if (error) throw error;
    return data || [];
}

export async function loadPeerCacheForPool(service, userbotIds, memberIds) {
    const peerCache = [];
    for (const userbotId of userbotIds) {
        for (const part of chunk(memberIds, 500)) {
            const { data } = await service.supabase
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

export async function phaseScan(service, preparation) {
    const ownerId = preparation.owner_id;
    await service.setStatus(preparation.id, 'scanning');
    const pool = await service.loadPoolUserbots(ownerId, preparation.userbot_ids);

    const scanResults = new Map(); // userbot_id -> {dialogUserIds, chatIds}
    let done = 0;
    for (const userbot of pool) {
        try {
            scanResults.set(userbot.id, await service.scanUserbotDialogs(userbot));
        } catch (error) {
            await service.updatePhaseDetail(preparation.id, {
                scan: { done, total: pool.length },
                errors: [`Скан диалогов @${userbot.tg_username || userbot.id}: ${String(error?.message || error).slice(0, 200)}`]
            });
        }
        done += 1;
        await service.updatePhaseDetail(preparation.id, { scan: { done, total: pool.length } });
    }

    if (scanResults.size === 0) {
        throw new PreparationError(400, 'Ни один юзербот из пула не отдал диалоги');
    }

    const knownChats = new Map();
    for (const [userbotId, scan] of scanResults.entries()) {
        knownChats.set(String(userbotId), scan.chatIds);
    }
    scanChatIdsCache.set(preparation.id, knownChats);

    // Persist скана в phase_detail: in-memory кэш умирает вместе с процессом (рестарт
    // посреди подготовки / упавший скан), а phaseJoin не должен вступать вслепую без него.
    const persistedScan = {};
    for (const [userbotId, chatIds] of knownChats.entries()) {
        persistedScan[String(userbotId)] = [...chatIds].map(String);
    }
    await service.updatePhaseDetail(preparation.id, { scanned_chats: persistedScan });

    // peer cache + пересечение
    const items = await service.loadItems(preparation.id);
    const memberIds = items.map(item => item.tg_user_id);
    const memberSet = new Set(memberIds);
    const peerCacheRows = await service.loadPeerCacheForPool([...scanResults.keys()], memberIds);
    const peerCacheSet = new Set(peerCacheRows.map(row => `${row.userbot_id}:${row.tg_user_id}`));

    const sourceChannelMap = await service.loadMemberSourceChannels(ownerId, preparation);
    const ownerChannels = await service.loadOwnerChannels(ownerId);
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
        await service.supabase
            .from('broadcast_preparation_items')
            .upsert(part, { onConflict: 'preparation_id,tg_user_id' });
    }

    const hasJoinWork = isAutoJoinEnabled();
    await service.setStatus(preparation.id, hasJoinWork ? 'joining' : 'recomputing');
    if (!hasJoinWork) {
        await service.updatePhaseDetail(preparation.id, {
            note: 'USERBOT_AUTO_JOIN_ENABLED выключен — вступления пропущены, только скан'
        });
    }
    return hasJoinWork;
}
