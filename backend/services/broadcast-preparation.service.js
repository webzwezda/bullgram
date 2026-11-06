// Фасад подготовки рассылок: CRUD/lifecycle живут здесь, phase-логика и
// общие хелперы — в broadcast-preparation/* (разрезка под pre-commit лимит).
// Публичные имена модуля не менялись: PreparationError, toMarkedChatId,
// resolveMarkedChatId, recordPreparationJoin, BroadcastPreparationService.
import { UserbotService } from './userbot.service.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';
import {
    PreparationError,
    ACTIVE_STATUSES,
    normalizeExternalTargets,
    chunk,
    scanUserbotDialogs as scanUserbotDialogsImpl,
    loadItems as loadItemsImpl,
    loadMemberSourceChannels as loadMemberSourceChannelsImpl,
    loadOwnerChannels as loadOwnerChannelsImpl,
    loadPeerCacheForPool as loadPeerCacheForPoolImpl,
    phaseScan as phaseScanImpl
} from './broadcast-preparation/phase-scan.js';
import { phaseJoin as phaseJoinImpl } from './broadcast-preparation/phase-join.js';
import {
    countRecentJoins as countRecentJoinsImpl,
    buildJoinTargets as buildJoinTargetsImpl,
    tryGrantAdminRights as tryGrantAdminRightsImpl,
    scanChatParticipants as scanChatParticipantsImpl,
    applyConfirmedTouchpoints as applyConfirmedTouchpointsImpl,
    phaseRecompute as phaseRecomputeImpl,
    getStatus as getStatusImpl,
    listMembers as listMembersImpl,
    addJoinTargets as addJoinTargetsImpl,
    recheck as recheckImpl,
    cancel as cancelImpl
} from './broadcast-preparation/phase-recompute.js';

export { PreparationError };

// Чистые хелперы живут в broadcast-preparation/phase-join.js — фасад только
// реэкспортирует их (локальная привязка фасаду не нужна).
export { toMarkedChatId, resolveMarkedChatId, recordPreparationJoin } from './broadcast-preparation/phase-join.js';

const PREPARABLE_AUDIENCE_TYPES = new Set(['channel_audience_members', 'client_base_members', 'manual_list']);

const runningPreparations = new Set();

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
            const { data: row } = await this.supabase
                .from('broadcast_preparations')
                .select('phase_detail')
                .eq('id', preparationId)
                .maybeSingle();
            const current = row?.phase_detail || {};
            const adminHints = Array.isArray(current.admin_hints) ? [...new Set(current.admin_hints)] : [];
            await this.supabase
                .from('broadcast_preparations')
                .update({
                    status: 'failed',
                    error: String(error?.message || error).slice(0, 500),
                    phase_detail: { ...current, errors: [...new Set([...(current.errors || []), ...adminHints])].slice(-30), admin_hints: [] },
                    updated_at: new Date().toISOString()
                })
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
        // admin_hints не показываем в рантайме — всплывают в финале, только если есть недостижимые
        const adminHints = [...(current.admin_hints || []), ...(patch.admin_hints || [])].slice(-30);
        await this.supabase
            .from('broadcast_preparations')
            .update({
                phase_detail: { ...current, ...patch, errors, admin_hints: adminHints },
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

    // --- Скан-фаза и загрузчики: broadcast-preparation/phase-scan.js ---

    async scanUserbotDialogs(userbot) {
        return scanUserbotDialogsImpl(this, userbot);
    }

    async loadItems(preparationId) {
        return loadItemsImpl(this, preparationId);
    }

    async loadMemberSourceChannels(ownerId, preparation) {
        return loadMemberSourceChannelsImpl(this, ownerId, preparation);
    }

    async loadOwnerChannels(ownerId) {
        return loadOwnerChannelsImpl(this, ownerId);
    }

    async loadPeerCacheForPool(userbotIds, memberIds) {
        return loadPeerCacheForPoolImpl(this, userbotIds, memberIds);
    }

    async phaseScan(preparation) {
        return phaseScanImpl(this, preparation);
    }

    // --- Join-поддержка: broadcast-preparation/phase-recompute.js ---

    async countRecentJoins(userbotId) {
        return countRecentJoinsImpl(this, userbotId);
    }

    async buildJoinTargets(preparation) {
        return buildJoinTargetsImpl(this, preparation);
    }

    async tryGrantAdminRights(preparation, pool, userbot, chatId, rawLink) {
        return tryGrantAdminRightsImpl(this, preparation, pool, userbot, chatId, rawLink);
    }

    async scanChatParticipants(userbot, chatId, accessHash = null) {
        return scanChatParticipantsImpl(this, userbot, chatId, accessHash);
    }

    async applyConfirmedTouchpoints(preparationId, userbotId, confirmedUserIds, via, chatId) {
        return applyConfirmedTouchpointsImpl(this, preparationId, userbotId, confirmedUserIds, via, chatId);
    }

    // --- Join-фаза: broadcast-preparation/phase-join.js ---

    async phaseJoin(preparation) {
        return phaseJoinImpl(this, preparation);
    }

    // --- Recompute и публичные операции: broadcast-preparation/phase-recompute.js ---

    async phaseRecompute(preparation) {
        return phaseRecomputeImpl(this, preparation);
    }

    async getStatus(ownerId, preparationId) {
        return getStatusImpl(this, ownerId, preparationId);
    }

    async listMembers(ownerId, preparationId, opts = {}) {
        return listMembersImpl(this, ownerId, preparationId, opts);
    }

    async addJoinTargets(ownerId, preparationId, rawTargets = []) {
        return addJoinTargetsImpl(this, ownerId, preparationId, rawTargets);
    }

    async recheck(ownerId, preparationId) {
        return recheckImpl(this, ownerId, preparationId);
    }

    async cancel(ownerId, preparationId) {
        return cancelImpl(this, ownerId, preparationId);
    }
}
