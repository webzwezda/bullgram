import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { OfficialBotService } from '../services/official-bot.service.js';
import { UserbotService } from '../services/userbot.service.js';
import { getBotById } from './official-bot.routes.js';
import {
    discoverCustomerReconciliationSources,
    isCustomerReconciliationError,
    listCustomerReconciliationContour,
    scanCustomerReconciliationSource,
    patchCustomerReconciliationSource,
    upsertCustomerReconciliationSources,
    RECONCILIATION_LARGE_SOURCE_MEMBER_COUNT
} from '../services/customer-reconciliation.service.js';

function latestBy(list = [], keyFn, dateField = 'created_at') {
    const map = new Map();

    for (const item of list) {
        const key = keyFn(item);
        if (!key) continue;

        const prev = map.get(key);
        const itemDate = new Date(item?.[dateField] || item?.issued_at || 0).getTime();
        const prevDate = new Date(prev?.[dateField] || prev?.issued_at || 0).getTime();

        if (!prev || itemDate >= prevDate) {
            map.set(key, item);
        }
    }

    return map;
}

function emptyListResult() {
    return Promise.resolve({ data: [], error: null });
}

function getAbandonedStatus(invoice) {
    const createdAt = new Date(invoice.created_at).getTime();
    const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);

    if (invoice.status === 'awaiting_receipt') return 'awaiting_receipt';
    if (invoice.reminded) return 'reminded';
    if (ageHours < 2) return 'fresh';
    if (ageHours < 24) return 'queued';
    return 'stale';
}

function buildPersonDisplayName(profile = {}) {
    const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
    if (fullName) return fullName;
    if (profile.display_name) return String(profile.display_name).trim();
    return null;
}

function buildFunnelPersonProfile(event = {}) {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    const first_name = payload.first_name || null;
    const last_name = payload.last_name || null;
    const display_name = payload.display_name || null;
    const username = payload.username || null;

    return {
        first_name,
        last_name,
        display_name: buildPersonDisplayName({ first_name, last_name, display_name }),
        username
    };
}

function normalizeUuidLike(value) {
    const raw = String(value || '').trim();
    return raw || null;
}

function buildCandidateMatchingOption({ state, label, tab, targetLabel = null, targetId = null }) {
    return {
        state,
        label,
        tab,
        target_label: targetLabel,
        target_id: targetId
    };
}

function normalizeBooleanFlag(value) {
    if (typeof value === 'boolean') return value;
    const raw = String(value || '').trim().toLowerCase();
    return ['true', '1', 'yes', 'y'].includes(raw);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const RECONCILIATION_MATCHING_TABS = new Set([
    'started',
    'viewed',
    'abandoned',
    'customers-active',
    'customers-expired',
    'removed-admin',
    'access'
]);

const RECONCILIATION_SYNC_PRE_DELAY_MS = 4000;
const RECONCILIATION_SYNC_PRE_DELAY_JITTER_MS = 3000;
const RECONCILIATION_SYNC_COOLDOWN_MS = 15 * 60 * 1000;

function buildSyncPreDelayMs() {
    return RECONCILIATION_SYNC_PRE_DELAY_MS + Math.floor(Math.random() * RECONCILIATION_SYNC_PRE_DELAY_JITTER_MS);
}

function detectAccessSource(eventSource = null, payload = {}, accessNote = '') {
    const source = String(eventSource || '').trim().toLowerCase();
    const note = String(accessNote || '').toLowerCase();
    const eventPayload = payload && typeof payload === 'object' ? payload : {};
    const payloadSource = String(eventPayload.source || '').trim().toLowerCase();

    if (
        source === 'customers_manual_admin_removed'
        || source === 'customers_manual_action'
        || eventPayload.removal_kind === 'manual_admin_removed'
        || (source === 'manual_batch' && payloadSource === 'customers')
        || note.includes('удален админом вручную из customers')
    ) {
        return { key: 'manual_admin_removed', label: 'Удален админом вручную' };
    }

    if (
        source === 'customers_direct_access'
        || eventPayload.issued_via === 'customers_direct_access'
        || note.includes('доступ выдан вручную из customers')
    ) {
        return { key: 'customers_direct_access', label: 'Выдан вручную из Customers' };
    }

    if (
        source === 'customers_candidate_import'
        || eventPayload.imported_via === 'reconciliation_candidates'
        || note.includes('reconciliation candidates')
    ) {
        return { key: 'customers_candidate_import', label: 'Перенесен вручную из кандидатов' };
    }

    if (source === 'gift_code' || source === 'admin_gift' || eventPayload.gift_code_id || eventPayload.gift_code || note.includes('подарочному коду')) {
        return { key: 'gift_code', label: 'Подарочный код' };
    }

    if (source === 'official_bot' || source === 'manual_ton' || source === 'manual_rub' || note.includes('join request')) {
        return { key: 'payment', label: 'Оплата' };
    }

    return { key: 'unknown', label: null };
}

function isManualAdminRemoval(eventSource = null, payload = {}, accessNote = '') {
    return detectAccessSource(eventSource, payload, accessNote).key === 'manual_admin_removed';
}

async function buildReconciliationCandidatesSnapshot(supabase, ownerId, selectedBotId = null) {
    const contour = await listCustomerReconciliationContour(supabase, ownerId, selectedBotId);
    const activeSources = (contour.contour?.sources || []).filter((source) => (
        source.is_active
        && source.role !== 'ignored'
        && source.already_bound_channel_id
        && (!selectedBotId || String(source.bot_id || '') === String(selectedBotId))
    ));

    if (!activeSources.length) {
        return {
            summary: {
                total: 0,
                free_rider: 0,
                unpaid_lead: 0,
                expired_paid_inside: 0,
                no_payment_history: 0
            },
            candidates: []
        };
    }

    const channelIds = Array.from(new Set(activeSources.map((source) => source.already_bound_channel_id).filter(Boolean)));
    const sourceByChannelId = new Map();
    for (const source of activeSources) {
        const channelId = String(source.already_bound_channel_id);
        if (!sourceByChannelId.has(channelId)) sourceByChannelId.set(channelId, []);
        sourceByChannelId.get(channelId).push(source);
    }

    const [
        baseLinksResp,
        basesResp,
        baseMembersResp,
        tariffsResp,
        subscriptionsResp
    ] = await Promise.all([
        supabase
            .from('customer_base_channels')
            .select('base_id, channel_id')
            .in('channel_id', channelIds),
        supabase
            .from('customer_bases')
            .select('id, name, description')
            .eq('owner_id', ownerId),
        supabase
            .from('customer_base_members')
            .select('base_id, tg_user_id, username, display_name, first_name, last_name, is_bot, present_now, last_seen_at, source_channel_ids, channels_count')
            .eq('owner_id', ownerId)
            .eq('present_now', true),
        supabase
            .from('tariffs')
            .select('id, title, channel_id')
            .eq('owner_id', ownerId)
            .in('channel_id', channelIds),
        supabase
            .from('subscriptions')
            .select('id, tg_user_id, tg_username, channel_id, status, expires_at, created_at')
            .in('channel_id', channelIds)
    ]);

    if (baseLinksResp.error && !(baseLinksResp.error.message || '').includes('customer_base_channels')) throw baseLinksResp.error;
    if (basesResp.error && !(basesResp.error.message || '').includes('customer_bases')) throw basesResp.error;
    if (baseMembersResp.error && !(baseMembersResp.error.message || '').includes('customer_base_members')) throw baseMembersResp.error;
    if (tariffsResp.error) throw tariffsResp.error;
    if (subscriptionsResp.error) throw subscriptionsResp.error;

    const linkedBaseIds = Array.from(new Set((baseLinksResp.data || []).map((row) => row.base_id).filter(Boolean)));
    const tariffIds = (tariffsResp.data || []).map((row) => row.id);

    const invoicesResp = tariffIds.length > 0
        ? await supabase
            .from('invoices')
            .select('tg_user_id, tariff_id, status, created_at, paid_at')
            .in('tariff_id', tariffIds)
            .order('created_at', { ascending: false })
            .limit(5000)
        : { data: [], error: null };

    if (invoicesResp.error) throw invoicesResp.error;

    const candidateUserIds = Array.from(new Set((baseMembersResp.data || [])
        .filter((member) => member?.tg_user_id)
        .map((member) => String(member.tg_user_id))));
    const activeBotIds = Array.from(new Set(activeSources.map((source) => String(source.bot_id || '')).filter(Boolean)));

    const [funnelEventsResp, accessEventsResp] = candidateUserIds.length > 0
        ? await Promise.all([
            (() => {
                let query = supabase
                    .from('customer_funnel_events')
                    .select('tg_user_id, bot_id, event_type, created_at')
                    .eq('owner_id', ownerId)
                    .in('tg_user_id', candidateUserIds)
                    .order('created_at', { ascending: false })
                    .limit(3000);

                if (activeBotIds.length > 0) {
                    query = query.in('bot_id', activeBotIds);
                }
                return query;
            })(),
            supabase
                .from('access_events')
                .select('tg_user_id, channel_id, event_type, event_source, payload, created_at')
                .eq('owner_id', ownerId)
                .in('tg_user_id', candidateUserIds)
                .in('channel_id', channelIds)
                .order('created_at', { ascending: false })
                .limit(3000)
        ])
        : [{ data: [], error: null }, { data: [], error: null }];
    const resolutionsResp = candidateUserIds.length > 0
        ? await supabase
            .from('customer_reconciliation_resolutions')
            .select('source_id, tg_user_id, resolution_type, note')
            .eq('owner_id', ownerId)
            .in('tg_user_id', candidateUserIds)
        : { data: [], error: null };

    if (funnelEventsResp.error && !(funnelEventsResp.error.message || '').includes('customer_funnel_events')) throw funnelEventsResp.error;
    if (accessEventsResp.error && !(accessEventsResp.error.message || '').includes('access_events')) throw accessEventsResp.error;
    if (resolutionsResp.error && !(resolutionsResp.error.message || '').includes('customer_reconciliation_resolutions')) throw resolutionsResp.error;

    const basesById = new Map((basesResp.data || []).map((base) => [String(base.id), base]));
    const linkedBaseIdsSet = new Set(linkedBaseIds.map(String));
    const nowIso = new Date().toISOString();
    const latestFunnelByUser = latestBy(
        funnelEventsResp.data || [],
        (event) => String(event.tg_user_id)
    );
    const latestAccessByUserChannel = latestBy(
        accessEventsResp.data || [],
        (event) => `${event.tg_user_id}:${event.channel_id}`
    );

    const subscriptionStatsByUser = new Map();
    for (const subscription of subscriptionsResp.data || []) {
        const tgUserId = String(subscription.tg_user_id);
        if (!subscriptionStatsByUser.has(tgUserId)) {
            subscriptionStatsByUser.set(tgUserId, {
                active_subscription_count: 0,
                expired_subscription_count: 0
            });
        }

        const stats = subscriptionStatsByUser.get(tgUserId);
        const isActive = subscription.status === 'active' && (!subscription.expires_at || subscription.expires_at >= nowIso);
        if (isActive) stats.active_subscription_count += 1;
        else stats.expired_subscription_count += 1;
    }

    const tariffToChannelId = new Map((tariffsResp.data || []).map((tariff) => [String(tariff.id), String(tariff.channel_id)]));
    const invoiceStatsByUser = new Map();
    for (const invoice of invoicesResp.data || []) {
        const tgUserId = String(invoice.tg_user_id);
        if (!invoiceStatsByUser.has(tgUserId)) {
            invoiceStatsByUser.set(tgUserId, {
                has_any_paid_invoice: false,
                has_pending_invoice: false,
                last_paid_at: null,
                channel_ids: new Set()
            });
        }

        const stats = invoiceStatsByUser.get(tgUserId);
        const channelId = tariffToChannelId.get(String(invoice.tariff_id));
        if (channelId) stats.channel_ids.add(channelId);

        if (invoice.status === 'paid') {
            stats.has_any_paid_invoice = true;
            const paidAt = invoice.paid_at || invoice.created_at || null;
            if (!stats.last_paid_at || new Date(paidAt || 0) > new Date(stats.last_paid_at || 0)) {
                stats.last_paid_at = paidAt;
            }
        }

        if (['pending', 'awaiting_receipt', 'wait_admin'].includes(invoice.status)) {
            stats.has_pending_invoice = true;
        }
    }

    const seen = new Set();
    const candidates = [];
    const resolutionsByKey = new Map(
        (resolutionsResp.data || []).map((row) => [`${row.source_id}:${row.tg_user_id}`, row])
    );

    for (const member of baseMembersResp.data || []) {
        if (member.is_bot || !member.tg_user_id) continue;
        if (!linkedBaseIdsSet.has(String(member.base_id))) continue;

        const sourceChannelIds = Array.isArray(member.source_channel_ids) ? member.source_channel_ids.map(String) : [];
        const matchingChannelIds = sourceChannelIds.filter((channelId) => sourceByChannelId.has(String(channelId)));
        if (!matchingChannelIds.length) continue;

        const subscriptionStats = subscriptionStatsByUser.get(String(member.tg_user_id)) || {
            active_subscription_count: 0,
            expired_subscription_count: 0
        };
        const invoiceStats = invoiceStatsByUser.get(String(member.tg_user_id)) || {
            has_any_paid_invoice: false,
            has_pending_invoice: false,
            last_paid_at: null
        };

        for (const channelId of matchingChannelIds) {
            for (const source of sourceByChannelId.get(String(channelId)) || []) {
                let paymentStatus = 'no_payment_history';
                if (subscriptionStats.active_subscription_count > 0) paymentStatus = 'active_paid';
                else if (invoiceStats.has_any_paid_invoice) paymentStatus = 'expired_paid';
                else if (invoiceStats.has_pending_invoice) paymentStatus = 'unpaid_lead';

                if (member.present_now && source.role === 'private_paid_group' && subscriptionStats.active_subscription_count === 0) {
                    paymentStatus = invoiceStats.has_any_paid_invoice ? 'expired_paid_inside' : 'free_rider';
                }

                if (paymentStatus === 'active_paid') continue;

                const key = `${source.id}:${member.tg_user_id}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const resolution = resolutionsByKey.get(key) || null;
                if (resolution?.resolution_type === 'ignore_candidate' || resolution?.resolution_type === 'linked_accounted') {
                    continue;
                }

                const latestFunnel = latestFunnelByUser.get(String(member.tg_user_id)) || null;
                const latestAccess = latestAccessByUserChannel.get(`${member.tg_user_id}:${channelId}`) || null;
                const accessSource = latestAccess
                    ? detectAccessSource(latestAccess.event_source, latestAccess.payload, '')
                    : { key: 'unknown', label: null };
                const matchingOptions = [];
                const sourceChannelTitle = source.already_bound_channel_title || source.title_snapshot || null;
                const sourceBotTargetLabel = source.bot_username ? `@${source.bot_username}` : sourceChannelTitle;

                if (accessSource.key === 'manual_admin_removed') {
                    matchingOptions.push(buildCandidateMatchingOption({
                        state: 'removed_admin',
                        label: 'Уже был в учтенном контуре и удален админом',
                        tab: 'removed-admin',
                        targetLabel: sourceChannelTitle,
                        targetId: source.already_bound_channel_id || null
                    }));
                }

                if (paymentStatus === 'expired_paid_inside' || paymentStatus === 'expired_paid') {
                    matchingOptions.push(buildCandidateMatchingOption({
                        state: 'paid_history',
                        label: 'Уже есть история оплат и доступа',
                        tab: 'customers-expired',
                        targetLabel: sourceChannelTitle,
                        targetId: source.already_bound_channel_id || null
                    }));
                }

                if (paymentStatus === 'unpaid_lead') {
                    matchingOptions.push(buildCandidateMatchingOption({
                        state: 'invoice_pending',
                        label: 'Уже создавал счет в Bullgram',
                        tab: 'abandoned',
                        targetLabel: sourceChannelTitle,
                        targetId: source.already_bound_channel_id || null
                    }));
                }

                if (latestFunnel?.event_type === 'bot_started') {
                    matchingOptions.push(buildCandidateMatchingOption({
                        state: 'started',
                        label: 'Уже нажимал /start',
                        tab: 'started',
                        targetLabel: sourceBotTargetLabel,
                        targetId: source.bot_id || source.already_bound_channel_id || null
                    }));
                } else if (latestFunnel?.event_type) {
                    matchingOptions.push(buildCandidateMatchingOption({
                        state: 'funnel_known',
                        label: 'Уже светился в воронке Bullgram',
                        tab: 'viewed',
                        targetLabel: sourceBotTargetLabel,
                        targetId: source.bot_id || source.already_bound_channel_id || null
                    }));
                }

                let matchingState = 'group_only';
                let matchingLabel = 'Пока только в группах';
                let matchingTab = null;
                let matchingTargetLabel = null;
                let matchingTargetId = null;

                if (matchingOptions.length > 0) {
                    const primaryMatch = matchingOptions[0];
                    matchingState = primaryMatch.state;
                    matchingLabel = primaryMatch.label;
                    matchingTab = primaryMatch.tab;
                    matchingTargetLabel = primaryMatch.target_label;
                    matchingTargetId = primaryMatch.target_id;
                }

                candidates.push({
                    id: key,
                    source_id: source.id,
                    source_role: source.role,
                    source_title: source.title_snapshot || source.already_bound_channel_title || source.chat_id,
                    source_chat_id: String(source.chat_id),
                    source_username: source.username_snapshot || null,
                    source_channel_id: source.already_bound_channel_id || null,
                    source_channel_title: source.already_bound_channel_title || source.title_snapshot || null,
                    tg_user_id: String(member.tg_user_id),
                    tg_username: member.username || null,
                    display_name: member.display_name || null,
                    first_name: member.first_name || null,
                    last_name: member.last_name || null,
                    base_id: member.base_id,
                    base_name: basesById.get(String(member.base_id))?.name || null,
                    present_now: !!member.present_now,
                    channels_count: member.channels_count || 0,
                    payment_status: paymentStatus,
                    last_paid_at: invoiceStats.last_paid_at || null,
                    has_pending_invoice: !!invoiceStats.has_pending_invoice,
                    active_subscription_count: subscriptionStats.active_subscription_count,
                    expired_subscription_count: subscriptionStats.expired_subscription_count,
                    last_seen_at: member.last_seen_at || null,
                    channel_id: source.already_bound_channel_id || null,
                    matching_state: matchingState,
                    matching_label: matchingLabel,
                    matching_tab: matchingTab,
                    matching_target_label: matchingTargetLabel,
                    matching_target_id: matchingTargetId,
                    matching_options: matchingOptions,
                    matching_options_count: matchingOptions.length,
                    matching_is_ambiguous: matchingOptions.length > 1,
                    resolution_type: resolution?.resolution_type || null
                });
            }
        }
    }

    const priorityMap = {
        free_rider: 100,
        expired_paid_inside: 90,
        unpaid_lead: 80,
        expired_paid: 70,
        no_payment_history: 60
    };

    candidates.sort((left, right) => {
        const delta = (priorityMap[right.payment_status] || 0) - (priorityMap[left.payment_status] || 0);
        if (delta !== 0) return delta;
        return new Date(right.last_seen_at || 0).getTime() - new Date(left.last_seen_at || 0).getTime();
    });

    const summary = candidates.reduce((acc, row) => {
        acc.total += 1;
        acc[row.payment_status] = (acc[row.payment_status] || 0) + 1;
        return acc;
    }, {
        total: 0,
        free_rider: 0,
        unpaid_lead: 0,
        expired_paid_inside: 0,
        no_payment_history: 0
    });

    return { summary, candidates };
}

function requireProjectAdmin(req, res) {
    if (req.profile?.role !== 'admin') {
        res.status(403).json({ error: 'Демо-данные может создавать только админ проекта' });
        return false;
    }

    return true;
}

function makeDemoSeedId(value) {
    const raw = String(value || '').trim();
    if (raw) {
        if (!/^[a-zA-Z0-9_-]{3,64}$/.test(raw)) {
            return null;
        }

        return raw;
    }

    return `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hoursAgo(hours) {
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function deleteByJsonMarker(query, column, seedId) {
    const { error } = await query.filter(`${column}->>demo_seed_id`, 'eq', seedId);
    if (error) throw error;
}

async function cleanupCustomerDemoSeed(supabase, ownerId, seedId) {
    const tariffPrefix = `[DEMO ${seedId}]%`;
    const invoiceMemoPrefix = `demo_${seedId}_%`;

    const { data: demoChannels, error: channelsLookupError } = await supabase
        .from('channels')
        .select('id')
        .eq('owner_id', ownerId)
        .like('title', tariffPrefix);
    if (channelsLookupError) throw channelsLookupError;

    const { data: demoTariffs, error: tariffsLookupError } = await supabase
        .from('tariffs')
        .select('id')
        .eq('owner_id', ownerId)
        .like('title', tariffPrefix);
    if (tariffsLookupError) throw tariffsLookupError;

    const { data: demoBases, error: basesLookupError } = await supabase
        .from('customer_bases')
        .select('id')
        .eq('owner_id', ownerId)
        .eq('description', `demo_seed_id=${seedId}`);
    if (basesLookupError && !(basesLookupError.message || '').includes('customer_bases')) throw basesLookupError;

    const channelIds = (demoChannels || []).map(row => row.id);
    const tariffIds = (demoTariffs || []).map(row => row.id);
    const baseIds = (demoBases || []).map(row => row.id);

    await deleteByJsonMarker(
        supabase.from('customer_funnel_events').delete().eq('owner_id', ownerId),
        'payload',
        seedId
    );
    await deleteByJsonMarker(
        supabase.from('access_events').delete().eq('owner_id', ownerId),
        'payload',
        seedId
    );
    await deleteByJsonMarker(
        supabase.from('payment_events').delete().eq('owner_id', ownerId),
        'payload',
        seedId
    );
    await deleteByJsonMarker(
        supabase.from('referral_events').delete().eq('owner_id', ownerId),
        'payload',
        seedId
    );
    await deleteByJsonMarker(
        supabase.from('access_invites').delete().eq('owner_id', ownerId),
        'meta',
        seedId
    );

    if (baseIds.length > 0) {
        const { error } = await supabase
            .from('customer_base_members')
            .delete()
            .eq('owner_id', ownerId)
            .in('base_id', baseIds);
        if (error) throw error;
    }

    if (channelIds.length > 0) {
        const { error } = await supabase
            .from('subscriptions')
            .delete()
            .in('channel_id', channelIds)
            .ilike('access_note', `%demo_seed_id=${seedId}%`);
        if (error) throw error;
    }

    const { error: invoiceDeleteError } = await supabase
        .from('invoices')
        .delete()
        .like('memo', invoiceMemoPrefix);
    if (invoiceDeleteError) throw invoiceDeleteError;

    if (baseIds.length > 0) {
        const { error } = await supabase
            .from('customer_bases')
            .delete()
            .eq('owner_id', ownerId)
            .in('id', baseIds);
        if (error) throw error;
    }

    if (tariffIds.length > 0) {
        const { error } = await supabase
            .from('tariffs')
            .delete()
            .eq('owner_id', ownerId)
            .in('id', tariffIds);
        if (error) throw error;
    }

    if (channelIds.length > 0) {
        const { error } = await supabase
            .from('channels')
            .delete()
            .eq('owner_id', ownerId)
            .in('id', channelIds);
        if (error) throw error;
    }
}

export default function customersRoutes(supabase) {
    const router = express.Router();
    const officialBotService = new OfficialBotService(supabase);
    const userbotService = new UserbotService(
        supabase,
        process.env.TG_API_ID,
        process.env.TG_API_HASH
    );

    function handleContourError(error, res) {
        if (isCustomerReconciliationError(error)) {
            return res.status(error.statusCode || 400).json({ error: error.message });
        }

        console.error('Ошибка reconciliation contour:', error);
        return res.status(500).json({ error: 'Ошибка reconciliation contour' });
    }

    router.get('/reconciliation-sources', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const botId = String(req.query.bot_id || '').trim() || null;
            const result = await listCustomerReconciliationContour(supabase, ownerId, botId);
            res.json({ success: true, ...result });
        } catch (error) {
            return handleContourError(error, res);
        }
    });

    router.post('/reconciliation-sources/discover', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const userbotId = String(req.body?.userbot_id || '').trim();

            if (!userbotId) {
                return res.status(400).json({ error: 'Не передан userbot_id для discovery.' });
            }

            const result = await discoverCustomerReconciliationSources(supabase, ownerId, userbotId);
            res.json({ success: true, ...result });
        } catch (error) {
            return handleContourError(error, res);
        }
    });

    router.post('/reconciliation-sources', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const result = await upsertCustomerReconciliationSources(supabase, ownerId, req.body || {});
            res.json({ success: true, ...result });
        } catch (error) {
            return handleContourError(error, res);
        }
    });

    router.patch('/reconciliation-sources/:id', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const result = await patchCustomerReconciliationSource(
                supabase,
                ownerId,
                req.params.id,
                req.body || {}
            );
            res.json({ success: true, ...result });
        } catch (error) {
            return handleContourError(error, res);
        }
    });

    router.post('/reconciliation-sources/:id/scan', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const result = await scanCustomerReconciliationSource(
                supabase,
                ownerId,
                req.params.id
            );
            res.json({ success: true, ...result });
        } catch (error) {
            return handleContourError(error, res);
        }
    });

    router.post('/reconciliation-sources/:id/sync-members', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const sourceId = String(req.params.id || '').trim();
            const confirmLargeSource = normalizeBooleanFlag(req.body?.confirm_large_source);
            if (!sourceId) {
                return res.status(400).json({ error: 'Не передан источник для sync участников' });
            }

            const contour = await listCustomerReconciliationContour(supabase, ownerId);
            const source = (contour.contour?.sources || []).find((item) => String(item.id) === sourceId);
            if (!source) {
                return res.status(404).json({ error: 'Источник contour не найден' });
            }

            if (!source.is_active || source.role === 'ignored') {
                return res.status(409).json({ error: 'Этот источник выключен и не участвует в contour' });
            }

            if (!source.already_bound_channel_id) {
                return res.status(409).json({ error: 'Источник не привязан к channels, синк участников пока некуда писать' });
            }

            if (source.cooldown_until && new Date(source.cooldown_until).getTime() > Date.now()) {
                return res.status(409).json({ error: 'Источник сейчас на паузе после прошлого Telegram-действия. Подожди и повтори sync позже.' });
            }

            const memberCountSnapshot = Number(source.member_count_snapshot ?? 0);
            const isLargeSource = Number.isInteger(memberCountSnapshot) && memberCountSnapshot >= RECONCILIATION_LARGE_SOURCE_MEMBER_COUNT;
            if (isLargeSource && !confirmLargeSource) {
                return res.status(409).json({
                    error: `Источник выглядит большим: около ${memberCountSnapshot} участников. Для такого источника нужен отдельный подтвержденный sync.`,
                    requires_confirmation: true,
                    large_source_threshold: RECONCILIATION_LARGE_SOURCE_MEMBER_COUNT,
                    member_count_snapshot: memberCountSnapshot,
                    source_id: source.id
                });
            }

            const { data: baseLinks, error: baseLinksError } = await supabase
                .from('customer_base_channels')
                .select('base_id')
                .eq('channel_id', source.already_bound_channel_id);
            if (baseLinksError && !(baseLinksError.message || '').includes('customer_base_channels')) throw baseLinksError;

            const baseIds = Array.from(new Set((baseLinks || []).map((row) => row.base_id).filter(Boolean)));
            if (!baseIds.length) {
                return res.status(409).json({ error: 'Для этого источника нет связанной customer base. Сначала привяжи канал к базе.' });
            }

            const { data: bases, error: basesError } = await supabase
                .from('customer_bases')
                .select('id, name')
                .eq('owner_id', ownerId)
                .in('id', baseIds);
            if (basesError && !(basesError.message || '').includes('customer_bases')) throw basesError;

            const { data: channel, error: channelError } = await supabase
                .from('channels')
                .select('id, title, tg_chat_id')
                .eq('id', source.already_bound_channel_id)
                .eq('owner_id', ownerId)
                .single();
            if (channelError || !channel) {
                return res.status(404).json({ error: 'Привязанный канал не найден' });
            }

            // Reuse the contour service validation path instead of ad-hoc userbot lookup.
            await discoverCustomerReconciliationSources(supabase, ownerId, source.userbot_id);

            const { data: userbotRows, error: userbotError } = await supabase
                .from('tg_accounts')
                .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
                .eq('owner_id', ownerId)
                .eq('account_type', 'userbot')
                .eq('id', source.userbot_id)
                .limit(1);
            if (userbotError || !userbotRows?.[0]) {
                return res.status(404).json({ error: 'Юзербот для sync не найден' });
            }

            const client = await userbotService.createAuthorizedClient(userbotRows[0], 1);
            const scannedAt = new Date().toISOString();
            const syncPreDelayMs = buildSyncPreDelayMs();

            try {
                await sleep(syncPreDelayMs);
                const participants = await client.getParticipants(channel.tg_chat_id, { limit: 5000 });
                const participantMap = new Map();
                for (const participant of participants || []) {
                    const tgUserId = String(participant.id);
                    participantMap.set(tgUserId, {
                        tg_user_id: tgUserId,
                        username: participant.username || null,
                        first_name: participant.firstName || null,
                        last_name: participant.lastName || null,
                        display_name: participant.username
                            ? `@${participant.username}`
                            : [participant.firstName, participant.lastName].filter(Boolean).join(' ').trim() || `ID ${tgUserId}`,
                        is_bot: !!participant.bot
                    });
                }

                let syncedMembers = 0;

                for (const base of bases || []) {
                    const { data: existingMembers, error: existingError } = await supabase
                        .from('customer_base_members')
                        .select('id, owner_id, base_id, tg_user_id, username, first_name, last_name, display_name, is_bot, source_channel_ids, channels_count, present_now, last_seen_at')
                        .eq('owner_id', ownerId)
                        .eq('base_id', base.id);
                    if (existingError && !(existingError.message || '').includes('customer_base_members')) throw existingError;

                    const existingByUserId = new Map((existingMembers || []).map((row) => [String(row.tg_user_id), row]));
                    const upsertRows = [];
                    const staleRows = [];

                    for (const [tgUserId, participant] of participantMap.entries()) {
                        const existing = existingByUserId.get(tgUserId) || null;
                        const sourceChannelIds = Array.isArray(existing?.source_channel_ids) ? existing.source_channel_ids.map(String) : [];
                        if (!sourceChannelIds.includes(String(channel.id))) sourceChannelIds.push(String(channel.id));

                        upsertRows.push({
                            owner_id: ownerId,
                            base_id: base.id,
                            tg_user_id: tgUserId,
                            username: participant.username,
                            first_name: participant.first_name,
                            last_name: participant.last_name,
                            display_name: participant.display_name,
                            is_bot: participant.is_bot,
                            source_channel_ids: sourceChannelIds,
                            channels_count: sourceChannelIds.length,
                            present_now: true,
                            last_seen_at: scannedAt,
                            updated_at: scannedAt
                        });
                    }

                    for (const existing of existingMembers || []) {
                        const tgUserId = String(existing.tg_user_id);
                        if (participantMap.has(tgUserId)) continue;

                        const currentSourceChannelIds = Array.isArray(existing.source_channel_ids) ? existing.source_channel_ids.map(String) : [];
                        if (!currentSourceChannelIds.includes(String(channel.id))) continue;

                        const nextSourceChannelIds = currentSourceChannelIds.filter((id) => String(id) !== String(channel.id));
                        staleRows.push({
                            ...existing,
                            source_channel_ids: nextSourceChannelIds,
                            channels_count: nextSourceChannelIds.length,
                            present_now: nextSourceChannelIds.length > 0,
                            updated_at: scannedAt
                        });
                    }

                    if (upsertRows.length > 0) {
                        const { error } = await supabase
                            .from('customer_base_members')
                            .upsert(upsertRows, { onConflict: 'base_id,tg_user_id' });
                        if (error) throw error;
                    }

                    for (const stale of staleRows) {
                        const { error } = await supabase
                            .from('customer_base_members')
                            .update({
                                source_channel_ids: stale.source_channel_ids,
                                channels_count: stale.channels_count,
                                present_now: stale.present_now,
                                updated_at: stale.updated_at
                            })
                            .eq('owner_id', ownerId)
                            .eq('base_id', base.id)
                            .eq('tg_user_id', stale.tg_user_id);
                        if (error) throw error;
                    }

                    await supabase
                        .from('customer_bases')
                        .update({ updated_at: scannedAt })
                        .eq('id', base.id)
                        .eq('owner_id', ownerId);

                    syncedMembers += participantMap.size;
                }

                await supabase
                    .from('customer_reconciliation_sources')
                    .update({
                        last_scan_at: scannedAt,
                        last_scan_status: 'success',
                        last_scan_error: null,
                        next_scan_after: new Date(Date.now() + RECONCILIATION_SYNC_COOLDOWN_MS).toISOString(),
                        cooldown_until: new Date(Date.now() + RECONCILIATION_SYNC_COOLDOWN_MS).toISOString(),
                        updated_at: scannedAt
                    })
                    .eq('id', source.id)
                    .eq('owner_id', ownerId);

                res.json({
                    success: true,
                    source_id: source.id,
                    base_count: (bases || []).length,
                    scanned_channel_title: channel.title || source.title_snapshot || null,
                    synced_members: participantMap.size,
                    sync_pre_delay_ms: syncPreDelayMs,
                    cooldown_until: new Date(Date.now() + RECONCILIATION_SYNC_COOLDOWN_MS).toISOString()
                });
            } finally {
                await client.disconnect().catch(() => {});
            }
        } catch (error) {
            console.error('Ошибка manual contour member sync:', error);
            res.status(500).json({ error: 'Не удалось синкнуть участников по этому источнику' });
        }
    });

    router.get('/reconciliation-candidates', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const selectedBotId = normalizeUuidLike(req.query.bot_id);
            const { summary, candidates } = await buildReconciliationCandidatesSnapshot(supabase, ownerId, selectedBotId);

            const recentResolutionsResp = await supabase
                .from('customer_reconciliation_resolutions')
                .select('id, source_id, tg_user_id, resolution_type, note, created_at, updated_at')
                .eq('owner_id', ownerId)
                .order('updated_at', { ascending: false })
                .limit(12);

            if (recentResolutionsResp.error && !(recentResolutionsResp.error.message || '').includes('customer_reconciliation_resolutions')) {
                throw recentResolutionsResp.error;
            }

            const resolutionSourceIds = Array.from(new Set((recentResolutionsResp.data || []).map((row) => row.source_id).filter(Boolean)));
            const resolutionSourcesResp = resolutionSourceIds.length > 0
                ? await supabase
                    .from('customer_reconciliation_sources')
                    .select('id, title_snapshot, username_snapshot, chat_id, role, bot_id')
                    .eq('owner_id', ownerId)
                    .in('id', resolutionSourceIds)
                : { data: [], error: null };

            if (resolutionSourcesResp.error && !(resolutionSourcesResp.error.message || '').includes('customer_reconciliation_sources')) {
                throw resolutionSourcesResp.error;
            }

            const resolutionSourceMap = new Map((resolutionSourcesResp.data || []).map((row) => [String(row.id), row]));
            const recentResolutions = (recentResolutionsResp.data || [])
                .filter((row) => {
                    if (!selectedBotId) return true;
                    const source = resolutionSourceMap.get(String(row.source_id)) || null;
                    return source && String(source.bot_id || '') === String(selectedBotId);
                })
                .map((row) => {
                    const source = resolutionSourceMap.get(String(row.source_id)) || null;
                    return {
                        ...row,
                        source_title: source?.title_snapshot || source?.username_snapshot || source?.chat_id || 'Источник уже пропал',
                        source_role: source?.role || null
                    };
                });

            res.json({
                success: true,
                updatedAt: new Date().toISOString(),
                summary,
                candidates,
                recent_resolutions: recentResolutions
            });
        } catch (error) {
            console.error('Ошибка reconciliation candidates:', error);
            res.status(500).json({ error: 'Не удалось собрать reconciliation candidates' });
        }
    });

    router.post('/reconciliation-candidates/import', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const sourceId = normalizeUuidLike(req.body?.source_id);
            const tgUserId = String(req.body?.tg_user_id || '').trim();
            const channelId = normalizeUuidLike(req.body?.channel_id);
            const durationRaw = String(req.body?.duration_days || 'forever').trim().toLowerCase();

            if (!sourceId) {
                return res.status(400).json({ error: 'Не передан source_id кандидата' });
            }

            if (!tgUserId) {
                return res.status(400).json({ error: 'Не передан Telegram ID кандидата' });
            }

            if (!channelId) {
                return res.status(400).json({ error: 'Не передан канал для переноса в учтенную базу' });
            }

            const durationDays = durationRaw === 'forever' ? 0 : Number(durationRaw || 0);
            if (!(durationRaw === 'forever' || Number.isFinite(durationDays))) {
                return res.status(400).json({ error: 'Некорректный срок доступа' });
            }

            const { candidates } = await buildReconciliationCandidatesSnapshot(supabase, ownerId);
            const candidate = candidates.find((row) => (
                String(row.source_id) === String(sourceId)
                && String(row.tg_user_id) === tgUserId
            ));

            if (!candidate) {
                return res.status(409).json({ error: 'Кандидат уже не актуален или не найден в текущем reconciliation view' });
            }

            if (!(candidate.source_role === 'private_paid_group' && candidate.present_now)) {
                return res.status(409).json({ error: 'Перенос в учтенную базу разрешен только для кандидата, который уже сидит в закрытой группе' });
            }

            if (candidate.channel_id && String(candidate.channel_id) !== String(channelId)) {
                return res.status(409).json({ error: 'Канал не совпадает с текущим источником кандидата' });
            }

            const { data: channel, error: channelError } = await supabase
                .from('channels')
                .select('id, owner_id, title')
                .eq('id', channelId)
                .eq('owner_id', ownerId)
                .single();

            if (channelError || !channel) {
                return res.status(404).json({ error: 'Канал не найден или не принадлежит тебе' });
            }

            const { subscriptionId, expiresAt } = await officialBotService.upsertSubscriptionForChannel(
                tgUserId,
                channel.id,
                durationDays
            );

            if (subscriptionId) {
                await supabase
                    .from('subscriptions')
                    .update({
                        last_access_event: 'candidate_imported',
                        access_note: 'перенесен в учтенную базу из reconciliation candidates'
                    })
                    .eq('id', subscriptionId);
            }

            await officialBotService.logAccessEvent({
                ownerId,
                channelId: channel.id,
                subscriptionId,
                tgUserId,
                eventType: 'candidate_imported',
                eventSource: 'customers_candidate_import',
                payload: {
                    imported_via: 'reconciliation_candidates',
                    duration_days: durationRaw === 'forever' ? 'forever' : Number(durationDays),
                    channel_title: channel.title || null
                }
            });

            return res.json({
                success: true,
                tg_user_id: tgUserId,
                channel_id: channel.id,
                channel_title: channel.title || null,
                subscription_id: subscriptionId,
                expires_at: expiresAt,
                imported: true
            });
        } catch (error) {
            console.error('Ошибка переноса reconciliation candidate в учтенную базу:', error);
            res.status(500).json({ error: 'Не удалось перенести кандидата в учтенную базу' });
        }
    });

    router.post('/reconciliation-candidates/resolve', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const sourceId = normalizeUuidLike(req.body?.source_id);
            const tgUserId = String(req.body?.tg_user_id || '').trim();
            const resolutionType = String(req.body?.resolution_type || '').trim().toLowerCase();
            const rawNote = String(req.body?.note || '').trim();
            const linkedTab = String(req.body?.linked_tab || '').trim().toLowerCase();
            const linkedTargetLabel = String(req.body?.linked_target_label || '').trim();
            const linkedTargetId = String(req.body?.linked_target_id || '').trim();

            if (!sourceId) {
                return res.status(400).json({ error: 'Не передан source_id кандидата' });
            }

            if (!tgUserId) {
                return res.status(400).json({ error: 'Не передан Telegram ID кандидата' });
            }

            if (!['ignore_candidate', 'linked_accounted'].includes(resolutionType)) {
                return res.status(400).json({ error: 'Передан неизвестный resolution_type' });
            }

            if (linkedTab && !RECONCILIATION_MATCHING_TABS.has(linkedTab)) {
                return res.status(400).json({ error: 'Передан неизвестный linked_tab' });
            }

            const { data: source, error: sourceError } = await supabase
                .from('customer_reconciliation_sources')
                .select('id, owner_id')
                .eq('id', sourceId)
                .eq('owner_id', ownerId)
                .single();

            if (sourceError || !source) {
                return res.status(404).json({ error: 'Источник кандидата не найден' });
            }

            const { candidates } = await buildReconciliationCandidatesSnapshot(supabase, ownerId);
            const candidate = candidates.find((row) => (
                String(row.source_id) === String(sourceId)
                && String(row.tg_user_id) === tgUserId
            ));

            if (!candidate) {
                return res.status(409).json({ error: 'Кандидат уже не актуален или не найден в текущем reconciliation view' });
            }

            if (resolutionType === 'linked_accounted' && !candidate.matching_tab) {
                return res.status(409).json({ error: 'Для этого кандидата сейчас нет подтвержденного сегмента, с которым его можно связать' });
            }

            const noteParts = [];
            if (resolutionType === 'linked_accounted' && linkedTab) {
                noteParts.push(`linked_tab:${linkedTab}`);
            }
            if (resolutionType === 'linked_accounted' && linkedTargetId) {
                noteParts.push(`linked_target_id:${linkedTargetId}`);
            }
            if (resolutionType === 'linked_accounted' && linkedTargetLabel) {
                noteParts.push(`linked_target_label:${linkedTargetLabel}`);
            }
            if (rawNote) {
                noteParts.push(rawNote);
            }
            const note = noteParts.length ? noteParts.join(' | ') : null;

            const { error } = await supabase
                .from('customer_reconciliation_resolutions')
                .upsert({
                    owner_id: ownerId,
                    source_id: source.id,
                    tg_user_id: tgUserId,
                    resolution_type: resolutionType,
                    note
                }, { onConflict: 'owner_id,source_id,tg_user_id' });

            if (error) throw error;

            res.json({
                success: true,
                source_id: source.id,
                tg_user_id: tgUserId,
                resolution_type: resolutionType
            });
        } catch (error) {
            console.error('Ошибка reconciliation candidate resolution:', error);
            res.status(500).json({ error: 'Не удалось сохранить решение по кандидату' });
        }
    });

    router.delete('/reconciliation-candidates/resolve', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const sourceId = normalizeUuidLike(req.body?.source_id || req.query?.source_id);
            const tgUserId = String(req.body?.tg_user_id || req.query?.tg_user_id || '').trim();

            if (!sourceId) {
                return res.status(400).json({ error: 'Не передан source_id кандидата' });
            }

            if (!tgUserId) {
                return res.status(400).json({ error: 'Не передан Telegram ID кандидата' });
            }

            const { error } = await supabase
                .from('customer_reconciliation_resolutions')
                .delete()
                .eq('owner_id', ownerId)
                .eq('source_id', sourceId)
                .eq('tg_user_id', tgUserId);

            if (error) throw error;

            res.json({
                success: true,
                source_id: sourceId,
                tg_user_id: tgUserId,
                restored: true
            });
        } catch (error) {
            console.error('Ошибка отмены reconciliation candidate resolution:', error);
            res.status(500).json({ error: 'Не удалось вернуть кандидата в нижнюю таблицу' });
        }
    });

    router.post('/direct-access', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const tgUserId = String(req.body?.tg_user_id || '').trim();
            const channelId = normalizeUuidLike(req.body?.channel_id);
            const durationRaw = String(req.body?.duration_days || '').trim().toLowerCase();

            if (!tgUserId) {
                return res.status(400).json({ error: 'Не передан Telegram ID' });
            }

            if (!channelId) {
                return res.status(400).json({ error: 'Не передан канал для выдачи доступа' });
            }

            const durationDays = durationRaw === 'forever' ? 0 : Number(durationRaw || 0);
            if (!(durationRaw === 'forever' || Number.isFinite(durationDays))) {
                return res.status(400).json({ error: 'Некорректный срок доступа' });
            }

            const { data: channel, error: channelError } = await supabase
                .from('channels')
                .select('id, owner_id, title, tg_chat_id, bot_id, chat_type')
                .eq('id', channelId)
                .eq('owner_id', ownerId)
                .single();

            if (channelError || !channel) {
                return res.status(404).json({ error: 'Канал не найден' });
            }

            if (!channel.bot_id) {
                return res.status(400).json({ error: 'У канала не привязан официальный бот' });
            }

            const bot = getBotById(channel.bot_id);
            if (!bot) {
                return res.status(409).json({ error: 'Официальный бот не запущен. Перезапусти его в BotFather.' });
            }

            const result = await officialBotService.issueDirectChannelAccess({
                bot,
                ownerId,
                targetTgUserId: tgUserId,
                channel,
                durationDays,
                eventSource: 'customers_direct_access',
                accessNote: durationRaw === 'forever'
                    ? 'Доступ выдан вручную из Customers навсегда'
                    : `Доступ выдан вручную из Customers на ${durationDays} дней`,
                payload: {
                    source: 'customers',
                    issued_via: 'customers_direct_access',
                    duration_days: durationRaw === 'forever' ? 'forever' : durationDays
                }
            });

            if (result?.error) {
                return res.status(400).json({ error: result.error });
            }

            let dmSent = false;
            let dmError = null;
            try {
                const durationText = durationRaw === 'forever' ? 'Навсегда' : `${durationDays} дней`;
                const lines = [
                    'Тебе выдали доступ в Bullgram.',
                    '',
                    `Канал: ${channel.title || 'закрытый канал'}`,
                    `Срок: ${durationText}`
                ];

                if (result.expiresAt) {
                    lines.push(`До: ${new Date(result.expiresAt).toLocaleDateString('ru-RU')}`);
                }

                lines.push('', 'Ссылка на вход:', result.inviteLink, '', 'Ссылка работает через запрос на вступление и закреплена за твоим аккаунтом.');

                await bot.telegram.sendMessage(tgUserId, lines.join('\n'), {
                    disable_web_page_preview: true
                });
                dmSent = true;
            } catch (error) {
                dmError = error.message || 'Не удалось отправить ЛС';
            }

            res.json({
                success: true,
                subscription_id: result.subscriptionId || null,
                invite_link: result.inviteLink || null,
                channel_id: channel.id,
                channel_title: channel.title || null,
                expires_at: result.expiresAt || null,
                dm_sent: dmSent,
                dm_error: dmError
            });
        } catch (error) {
            console.error('Ошибка direct access из Customers:', error);
            res.status(500).json({ error: 'Не получилось выдать доступ из Customers' });
        }
    });

    router.post('/demo-seed', authenticateUser, async (req, res) => {
        if (!requireProjectAdmin(req, res)) return;

        const seedId = makeDemoSeedId(req.body?.seedId);
        if (!seedId) {
            return res.status(400).json({ error: 'seedId должен быть 3-64 символа: буквы, цифры, _ или -' });
        }

        const ownerId = req.user.id;
        const demoTg = {
            viewed: 900000000001,
            pending: 900000000002,
            receipt: 900000000003,
            joined: 900000000004,
            noJoin: 900000000005,
            expiredInside: 900000000006,
            referralBuyer: 900000000007,
            referralPartner: 900000000099
        };
        const demoProfiles = {
            viewed: { username: 'ivan_petrov', first_name: 'Иван', last_name: 'Петров', display_name: 'Иван Петров' },
            joined: { username: 'anna_sokolova', first_name: 'Анна', last_name: 'Соколова', display_name: 'Анна Соколова' },
            noJoin: { username: 'maxim_orlov', first_name: 'Максим', last_name: 'Орлов', display_name: 'Максим Орлов' },
            expiredInside: { username: 'elena_vasileva', first_name: 'Елена', last_name: 'Васильева', display_name: 'Елена Васильева' },
            referralBuyer: { username: 'dmitry_kuznetsov', first_name: 'Дмитрий', last_name: 'Кузнецов', display_name: 'Дмитрий Кузнецов' }
        };

        try {
            await cleanupCustomerDemoSeed(supabase, ownerId, seedId);

            const marker = { demo_seed_id: seedId };
            const { data: channel, error: channelError } = await supabase
                .from('channels')
                .insert({
                    owner_id: ownerId,
                    tg_chat_id: -9000000000000 - Math.floor(Math.random() * 1000000),
                    title: `[DEMO ${seedId}] Канал клиентов`,
                    chat_type: 'channel'
                })
                .select('id, title, tg_chat_id')
                .single();
            if (channelError) throw channelError;

            const { data: base, error: baseError } = await supabase
                .from('customer_bases')
                .insert({
                    owner_id: ownerId,
                    name: `[DEMO ${seedId}] База клиентов`,
                    description: `demo_seed_id=${seedId}`
                })
                .select('id, name')
                .single();
            if (baseError) throw baseError;

            const { data: tariffs, error: tariffsError } = await supabase
                .from('tariffs')
                .insert([
                    {
                        owner_id: ownerId,
                        channel_id: channel.id,
                        title: `[DEMO ${seedId}] Normal`,
                        price: 10,
                        currency: 'TON',
                        duration_days: 30,
                        is_active: true
                    },
                    {
                        owner_id: ownerId,
                        channel_id: channel.id,
                        title: `[DEMO ${seedId}] Пробник`,
                        price: 1,
                        currency: 'TON',
                        duration_days: 3,
                        is_active: true,
                        is_trial: true,
                        trial_label: 'Пробник'
                    },
                    {
                        owner_id: ownerId,
                        channel_id: channel.id,
                        title: `[DEMO ${seedId}] Партнерский`,
                        price: 20,
                        currency: 'TON',
                        duration_days: 30,
                        is_active: true
                    }
                ])
                .select('id, title, price, currency, is_trial, trial_label');
            if (tariffsError) throw tariffsError;

            const normalTariff = tariffs.find(tariff => tariff.title.endsWith('Normal'));
            const trialTariff = tariffs.find(tariff => tariff.is_trial);
            const referralTariff = tariffs.find(tariff => tariff.title.endsWith('Партнерский'));

            const { data: invoices, error: invoicesError } = await supabase
                .from('invoices')
                .insert([
                    {
                        tg_user_id: demoTg.pending,
                        tariff_id: normalTariff.id,
                        channel_id: channel.id,
                        amount: 10,
                        currency: 'TON',
                        memo: `demo_${seedId}_pending`,
                        status: 'pending',
                        created_at: hoursAgo(0.5)
                    },
                    {
                        tg_user_id: demoTg.receipt,
                        tariff_id: normalTariff.id,
                        channel_id: channel.id,
                        amount: 10,
                        currency: 'TON',
                        memo: `demo_${seedId}_receipt`,
                        status: 'awaiting_receipt',
                        created_at: hoursAgo(4)
                    },
                    {
                        tg_user_id: demoTg.joined,
                        tariff_id: normalTariff.id,
                        channel_id: channel.id,
                        amount: 10,
                        currency: 'TON',
                        memo: `demo_${seedId}_joined`,
                        status: 'paid',
                        created_at: hoursAgo(28),
                        paid_at: hoursAgo(27)
                    },
                    {
                        tg_user_id: demoTg.noJoin,
                        tariff_id: normalTariff.id,
                        channel_id: channel.id,
                        amount: 10,
                        currency: 'TON',
                        memo: `demo_${seedId}_no_join`,
                        status: 'paid',
                        created_at: hoursAgo(18),
                        paid_at: hoursAgo(17)
                    },
                    {
                        tg_user_id: demoTg.referralBuyer,
                        tariff_id: referralTariff.id,
                        channel_id: channel.id,
                        amount: 18,
                        currency: 'TON',
                        memo: `demo_${seedId}_referral`,
                        status: 'paid',
                        created_at: hoursAgo(8),
                        paid_at: hoursAgo(7)
                    }
                ])
                .select('*');
            if (invoicesError) throw invoicesError;

            const invoiceByMemo = new Map(invoices.map(invoice => [invoice.memo, invoice]));
            const joinedInvoice = invoiceByMemo.get(`demo_${seedId}_joined`);
            const noJoinInvoice = invoiceByMemo.get(`demo_${seedId}_no_join`);
            const referralInvoice = invoiceByMemo.get(`demo_${seedId}_referral`);

            const { data: subscriptions, error: subscriptionsError } = await supabase
                .from('subscriptions')
                .insert([
                    {
                        channel_id: channel.id,
                        tg_user_id: demoTg.joined,
                        tg_username: demoProfiles.joined.username,
                        status: 'active',
                        expires_at: hoursAgo(-20 * 24),
                        last_join_approved_at: hoursAgo(26),
                        last_access_event: 'join_approved',
                        access_note: `demo_seed_id=${seedId}; paid_and_joined`
                    },
                    {
                        channel_id: channel.id,
                        tg_user_id: demoTg.noJoin,
                        tg_username: demoProfiles.noJoin.username,
                        status: 'active',
                        expires_at: hoursAgo(-20 * 24),
                        last_access_event: 'invite_issued',
                        access_note: `demo_seed_id=${seedId}; join_not_confirmed`
                    },
                    {
                        channel_id: channel.id,
                        tg_user_id: demoTg.expiredInside,
                        tg_username: demoProfiles.expiredInside.username,
                        status: 'expired',
                        expires_at: hoursAgo(12),
                        last_join_approved_at: hoursAgo(35 * 24),
                        last_access_event: 'join_approved',
                        access_note: `demo_seed_id=${seedId}; expired_but_present`
                    },
                    {
                        channel_id: channel.id,
                        tg_user_id: demoTg.referralBuyer,
                        tg_username: demoProfiles.referralBuyer.username,
                        status: 'active',
                        expires_at: hoursAgo(-20 * 24),
                        last_join_approved_at: hoursAgo(6),
                        last_access_event: 'join_approved',
                        access_note: `demo_seed_id=${seedId}; referral_order`
                    }
                ])
                .select('id, tg_user_id');
            if (subscriptionsError) throw subscriptionsError;

            const subscriptionByTg = new Map(subscriptions.map(sub => [String(sub.tg_user_id), sub]));

            const inviteRows = [
                {
                    owner_id: ownerId,
                    channel_id: channel.id,
                    tariff_id: normalTariff.id,
                    invoice_id: joinedInvoice.id,
                    subscription_id: subscriptionByTg.get(String(demoTg.joined))?.id || null,
                    tg_user_id: String(demoTg.joined),
                    invite_link: `https://t.me/+demo-${seedId}-joined`,
                    invite_name: `[DEMO ${seedId}] joined`,
                    status: 'used',
                    issued_at: hoursAgo(27),
                    used_at: hoursAgo(26),
                    expires_at: hoursAgo(-24),
                    meta: marker
                },
                {
                    owner_id: ownerId,
                    channel_id: channel.id,
                    tariff_id: normalTariff.id,
                    invoice_id: noJoinInvoice.id,
                    subscription_id: subscriptionByTg.get(String(demoTg.noJoin))?.id || null,
                    tg_user_id: String(demoTg.noJoin),
                    invite_link: `https://t.me/+demo-${seedId}-no-join`,
                    invite_name: `[DEMO ${seedId}] no join`,
                    status: 'issued',
                    issued_at: hoursAgo(17),
                    expires_at: hoursAgo(-24),
                    meta: marker
                },
                {
                    owner_id: ownerId,
                    channel_id: channel.id,
                    tariff_id: referralTariff.id,
                    invoice_id: referralInvoice.id,
                    subscription_id: subscriptionByTg.get(String(demoTg.referralBuyer))?.id || null,
                    tg_user_id: String(demoTg.referralBuyer),
                    invite_link: `https://t.me/+demo-${seedId}-referral`,
                    invite_name: `[DEMO ${seedId}] referral`,
                    status: 'used',
                    issued_at: hoursAgo(7),
                    used_at: hoursAgo(6),
                    expires_at: hoursAgo(-24),
                    meta: marker
                }
            ];
            const { error: invitesError } = await supabase.from('access_invites').insert(inviteRows);
            if (invitesError) throw invitesError;

            const accessRows = [
                {
                    owner_id: ownerId,
                    channel_id: channel.id,
                    subscription_id: subscriptionByTg.get(String(demoTg.joined))?.id || null,
                    invoice_id: joinedInvoice.id,
                    tg_user_id: String(demoTg.joined),
                    event_type: 'join_approved',
                    event_source: 'demo_seed',
                    payload: marker,
                    created_at: hoursAgo(26)
                },
                {
                    owner_id: ownerId,
                    channel_id: channel.id,
                    subscription_id: subscriptionByTg.get(String(demoTg.noJoin))?.id || null,
                    invoice_id: noJoinInvoice.id,
                    tg_user_id: String(demoTg.noJoin),
                    event_type: 'invite_issued',
                    event_source: 'demo_seed',
                    payload: marker,
                    created_at: hoursAgo(17)
                },
                {
                    owner_id: ownerId,
                    channel_id: channel.id,
                    subscription_id: subscriptionByTg.get(String(demoTg.referralBuyer))?.id || null,
                    invoice_id: referralInvoice.id,
                    tg_user_id: String(demoTg.referralBuyer),
                    event_type: 'join_approved',
                    event_source: 'demo_seed',
                    payload: marker,
                    created_at: hoursAgo(6)
                }
            ];
            const { error: accessEventsError } = await supabase.from('access_events').insert(accessRows);
            if (accessEventsError) throw accessEventsError;

            const baseMemberRows = [
                [demoTg.viewed, demoProfiles.viewed, true],
                [demoTg.joined, demoProfiles.joined, true],
                [demoTg.noJoin, demoProfiles.noJoin, false],
                [demoTg.expiredInside, demoProfiles.expiredInside, true],
                [demoTg.referralBuyer, demoProfiles.referralBuyer, true]
            ].map(([tgUserId, profile, presentNow]) => ({
                owner_id: ownerId,
                base_id: base.id,
                tg_user_id: String(tgUserId),
                username: profile.username,
                display_name: profile.display_name,
                first_name: profile.first_name,
                last_name: profile.last_name,
                is_bot: false,
                source_channel_ids: [channel.id],
                channels_count: 1,
                present_now: presentNow,
                last_seen_at: hoursAgo(1)
            }));
            const { error: baseMembersError } = await supabase.from('customer_base_members').insert(baseMemberRows);
            if (baseMembersError) throw baseMembersError;

            const { error: funnelError } = await supabase.from('customer_funnel_events').insert([
                {
                    owner_id: ownerId,
                    tg_user_id: String(demoTg.viewed),
                    tariff_id: trialTariff.id,
                    event_type: 'tariff_list_opened',
                    source: 'demo_seed',
                    session_key: `demo:${seedId}:${demoTg.viewed}:list`,
                    payload: { ...marker, label: 'opened_list', ...demoProfiles.viewed },
                    created_at: hoursAgo(2)
                },
                {
                    owner_id: ownerId,
                    tg_user_id: String(demoTg.viewed),
                    tariff_id: normalTariff.id,
                    event_type: 'tariff_card_opened',
                    source: 'demo_seed',
                    session_key: `demo:${seedId}:${demoTg.viewed}:card`,
                    payload: { ...marker, label: 'opened_card', ...demoProfiles.viewed },
                    created_at: hoursAgo(1.5)
                },
                {
                    owner_id: ownerId,
                    tg_user_id: String(demoTg.viewed),
                    tariff_id: normalTariff.id,
                    event_type: 'payment_method_selected',
                    source: 'demo_seed',
                    session_key: `demo:${seedId}:${demoTg.viewed}:method`,
                    payload: { ...marker, label: 'selected_method', ...demoProfiles.viewed },
                    created_at: hoursAgo(1)
                }
            ]);
            if (funnelError) throw funnelError;

            const paymentRows = invoices.map(invoice => ({
                owner_id: ownerId,
                invoice_id: invoice.id,
                provider: 'demo',
                external_payment_id: `demo:${seedId}:${invoice.id}`,
                event_type: invoice.status === 'paid' ? 'payment_confirmed' : 'invoice_created',
                status: invoice.status,
                payload: {
                    ...marker,
                    original_amount: invoice.memo === `demo_${seedId}_referral` ? 20 : Number(invoice.amount),
                    referral_code: invoice.memo === `demo_${seedId}_referral` ? `demo-ref-${seedId}` : null,
                    referral_discount_percent: invoice.memo === `demo_${seedId}_referral` ? 10 : 0,
                    referral_discount_amount: invoice.memo === `demo_${seedId}_referral` ? 2 : 0
                },
                created_at: invoice.status === 'paid' ? invoice.paid_at : invoice.created_at
            }));
            const { error: paymentEventsError } = await supabase.from('payment_events').insert(paymentRows);
            if (paymentEventsError) throw paymentEventsError;

            const { error: referralError } = await supabase.from('referral_events').insert({
                owner_id: ownerId,
                referrer_tg_user_id: String(demoTg.referralPartner),
                referred_tg_user_id: String(demoTg.referralBuyer),
                invoice_id: referralInvoice.id,
                tariff_id: referralTariff.id,
                event_type: 'reward_granted',
                status: 'completed',
                reward_amount: 4,
                reward_currency: 'TON',
                reward_ton_amount: 4,
                client_discount_percent: 10,
                client_discount_original_amount: 2,
                sale_original_amount: 20,
                sale_original_currency: 'TON',
                reserve_coverage_status: 'covered',
                payload: marker
            });
            if (referralError) throw referralError;

            res.json({
                success: true,
                seedId,
                created: {
                    channels: 1,
                    tariffs: tariffs.length,
                    invoices: invoices.length,
                    subscriptions: subscriptions.length,
                    accessInvites: inviteRows.length,
                    accessEvents: accessRows.length,
                    baseMembers: baseMemberRows.length,
                    funnelEvents: 3,
                    paymentEvents: paymentRows.length,
                    referralEvents: 1
                },
                tgUserIds: demoTg
            });
        } catch (error) {
            console.error('Ошибка создания demo customers seed:', error);
            res.status(500).json({ error: 'Не удалось создать демо-данные клиентов' });
        }
    });

    router.delete('/demo-seed/:seedId', authenticateUser, async (req, res) => {
        if (!requireProjectAdmin(req, res)) return;

        const seedId = makeDemoSeedId(req.params.seedId);
        if (!seedId) {
            return res.status(400).json({ error: 'Некорректный seedId' });
        }

        try {
            await cleanupCustomerDemoSeed(supabase, req.user.id, seedId);
            res.json({ success: true, seedId });
        } catch (error) {
            console.error('Ошибка удаления demo customers seed:', error);
            res.status(500).json({ error: 'Не удалось удалить демо-данные клиентов' });
        }
    });

    router.get('/workbench', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const selectedBotId = normalizeUuidLike(req.query.bot_id);

            const [
                botsResp,
                channelsResp,
                tariffsResp,
                basesResp,
                baseMembersResp,
                funnelResp
            ] = await Promise.all([
                supabase
                    .from('tg_accounts')
                    .select('id, tg_username, tg_account_id, bot_role, runtime_status, created_at')
                    .eq('owner_id', ownerId)
                    .eq('account_type', 'bot')
                    .order('created_at', { ascending: false }),
                supabase
                    .from('channels')
                    .select('id, title, tg_chat_id, bot_id')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('tariffs')
                    .select('id, title, owner_id, channel_id, is_trial, trial_label')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('customer_bases')
                    .select('id, name, description, contour_id, created_at, updated_at')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('customer_base_members')
                    .select('base_id, tg_user_id, username, display_name, first_name, last_name, last_seen_at, present_now, is_bot, source_channel_ids')
                    .eq('owner_id', ownerId),
                supabase
                    .from('customer_funnel_events')
                    .select('id, owner_id, bot_id, tg_user_id, tariff_id, event_type, source, referral_code, session_key, payload, created_at')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(150)
            ]);

            if (botsResp.error) throw botsResp.error;
            if (channelsResp.error) throw channelsResp.error;
            if (tariffsResp.error) throw tariffsResp.error;
            if (basesResp.error && !(basesResp.error.message || '').includes('customer_bases')) throw basesResp.error;
            if (baseMembersResp.error && !(baseMembersResp.error.message || '').includes('customer_base_members')) throw baseMembersResp.error;

            const allBots = botsResp.data || [];
            const allChannels = channelsResp.data || [];
            const allTariffs = tariffsResp.data || [];
            const allFunnelEvents = funnelResp.error ? [] : (funnelResp.data || []);

            const orphanBotIds = new Set([
                ...allChannels.map(channel => channel.bot_id).filter(Boolean),
                ...allFunnelEvents.map(event => event.bot_id).filter(Boolean)
            ]);
            for (const bot of allBots) {
                orphanBotIds.delete(bot.id);
            }

            const botOptions = [
                ...allBots.map(bot => ({
                    id: bot.id,
                    label: bot.tg_username ? `@${bot.tg_username}` : `ID ${bot.tg_account_id || bot.id}`,
                    tg_username: bot.tg_username || null,
                    tg_account_id: bot.tg_account_id || null,
                    bot_role: bot.bot_role || 'sales',
                    status: 'active',
                    runtime_status: bot.runtime_status || null
                })),
                ...Array.from(orphanBotIds).map(botId => ({
                    id: botId,
                    label: `Удаленный бот ${String(botId).slice(0, 8)}`,
                    tg_username: null,
                    tg_account_id: null,
                    bot_role: 'sales',
                    status: 'deleted',
                    runtime_status: 'deleted'
                }))
            ];

            const channels = selectedBotId
                ? allChannels.filter(channel => String(channel.bot_id || '') === selectedBotId)
                : allChannels;
            const channelIds = channels.map(channel => channel.id);
            const tariffs = allTariffs.filter(tariff => channelIds.includes(tariff.channel_id));
            const tariffIds = tariffs.map(tariff => tariff.id);
            const channelMap = new Map(channels.map(channel => [channel.id, channel]));
            const tariffMap = new Map(tariffs.map(tariff => [tariff.id, tariff]));

            const [
                invoicesResp,
                subscriptionsResp,
                invitesResp,
                accessEventsResp,
                paymentEventsResp,
                referralEventsResp
            ] = await Promise.all([
                tariffIds.length > 0
                    ? supabase
                        .from('invoices')
                        .select('*')
                        .in('tariff_id', tariffIds)
                        .order('created_at', { ascending: false })
                        .limit(250)
                    : emptyListResult(),
                channelIds.length > 0
                    ? supabase
                        .from('subscriptions')
                        .select('id, tg_user_id, tg_username, channel_id, status, expires_at, last_join_request_at, last_join_approved_at, last_access_event, access_note, created_at')
                        .in('channel_id', channelIds)
                        .order('created_at', { ascending: false })
                        .limit(1000)
                    : emptyListResult(),
                supabase
                    .from('access_invites')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .order('issued_at', { ascending: false })
                    .limit(150),
                supabase
                    .from('access_events')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(250),
                supabase
                    .from('payment_events')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(300),
                supabase
                    .from('referral_events')
                    .select('id, invoice_id, referrer_tg_user_id, referred_tg_user_id, event_type, status, reward_amount, reward_currency, reward_ton_amount, client_discount_percent, client_discount_original_amount, sale_original_amount, sale_original_currency, reserve_coverage_status, created_at')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(200)
            ]);

            if (invoicesResp.error) throw invoicesResp.error;
            if (subscriptionsResp.error) throw subscriptionsResp.error;
            if (invitesResp.error && !(invitesResp.error.message || '').includes('access_invites')) throw invitesResp.error;
            if (accessEventsResp.error && !(accessEventsResp.error.message || '').includes('access_events')) throw accessEventsResp.error;
            if (paymentEventsResp.error && !(paymentEventsResp.error.message || '').includes('payment_events')) throw paymentEventsResp.error;
            if (referralEventsResp.error && !(referralEventsResp.error.message || '').includes('referral_events')) throw referralEventsResp.error;

            const invoices = invoicesResp.data || [];
            const subscriptions = subscriptionsResp.data || [];
            const invites = invitesResp.data || [];
            const accessEvents = accessEventsResp.data || [];
            const paymentEvents = paymentEventsResp.data || [];
            const referralEvents = referralEventsResp.data || [];
            const baseMembers = baseMembersResp.data || [];
            const filteredBaseMembers = selectedBotId
                ? baseMembers.filter(member => {
                    const sourceChannelIds = Array.isArray(member.source_channel_ids) ? member.source_channel_ids : [];
                    return sourceChannelIds.some(cid => channelIds.includes(cid));
                })
                : baseMembers;

            const presentByUserChannel = new Set();
            for (const member of filteredBaseMembers) {
                if (!member.present_now || !member.tg_user_id) continue;
                const sourceChannelIds = Array.isArray(member.source_channel_ids) ? member.source_channel_ids : [];
                for (const channelId of sourceChannelIds) {
                    if (channelId) {
                        presentByUserChannel.add(`${member.tg_user_id}:${channelId}`);
                    }
                }
            }

            const latestPaymentByInvoice = latestBy(paymentEvents, event => event.invoice_id);
            const invoiceCreatedByInvoice = latestBy(
                paymentEvents.filter(event => event.event_type === 'invoice_created'),
                event => event.invoice_id
            );
            const latestInviteByInvoice = latestBy(invites, invite => invite.invoice_id, 'issued_at');
            const latestAccessEventByInvoice = latestBy(accessEvents, event => event.invoice_id);
            const latestAccessEventBySubscription = latestBy(
                accessEvents.filter(event => event.subscription_id),
                event => event.subscription_id
            );
            const referralRewardByInvoice = latestBy(
                referralEvents.filter(event => event.event_type === 'reward_granted'),
                event => event.invoice_id
            );
            const subscriptionByUserChannel = latestBy(
                subscriptions,
                sub => `${sub.tg_user_id}:${sub.channel_id}`
            );
            const latestBaseProfileByUser = latestBy(
                filteredBaseMembers.filter(member => member.tg_user_id),
                member => String(member.tg_user_id),
                'last_seen_at'
            );
            const latestFunnelProfileByUser = latestBy(
                allFunnelEvents.filter(event => event.tg_user_id),
                event => String(event.tg_user_id)
            );

            function getPersonProfile(tgUserId, fallbackUsername = null) {
                const baseProfile = latestBaseProfileByUser.get(String(tgUserId)) || null;
                const funnelProfile = buildFunnelPersonProfile(latestFunnelProfileByUser.get(String(tgUserId)) || null);
                const displayName = buildPersonDisplayName({
                    first_name: baseProfile?.first_name || funnelProfile.first_name,
                    last_name: baseProfile?.last_name || funnelProfile.last_name,
                    display_name: baseProfile?.display_name || funnelProfile.display_name
                });

                return {
                    tg_username: fallbackUsername || baseProfile?.username || funnelProfile.username || null,
                    display_name: displayName,
                    first_name: baseProfile?.first_name || funnelProfile.first_name || null,
                    last_name: baseProfile?.last_name || funnelProfile.last_name || null
                };
            }

            const recentOrders = invoices.map(invoice => {
                const tariff = tariffMap.get(invoice.tariff_id) || null;
                const channel = channelMap.get(tariff?.channel_id) || null;
                const subscription = subscriptionByUserChannel.get(`${invoice.tg_user_id}:${tariff?.channel_id}`) || null;
                const paymentEvent = latestPaymentByInvoice.get(invoice.id) || null;
                const invoiceCreatedEvent = invoiceCreatedByInvoice.get(invoice.id) || null;
                const invite = latestInviteByInvoice.get(invoice.id) || null;
                const accessEvent = latestAccessEventByInvoice.get(invoice.id) || null;
                const referralReward = referralRewardByInvoice.get(invoice.id) || null;
                const accessSource = detectAccessSource(accessEvent?.event_source, accessEvent?.payload, subscription?.access_note);
                const invoicePayload = invoiceCreatedEvent?.payload || {};
                const referralDiscountPercent = Number(invoicePayload.referral_discount_percent || referralReward?.client_discount_percent || 0);
                const presenceConfirmed = presentByUserChannel.has(`${invoice.tg_user_id}:${tariff?.channel_id}`);
                const joined = !!subscription?.last_join_approved_at || presenceConfirmed;
                const person = getPersonProfile(invoice.tg_user_id, subscription?.tg_username || null);

                let problemReason = 'Все выглядит ровно';
                if (invoice.status === 'awaiting_receipt') problemReason = 'Клиент нажал “я оплатил”, но чек еще не загружен';
                else if (invoice.status === 'wait_admin') problemReason = 'Чек загружен, но админ еще не подтвердил';
                else if (invoice.status === 'rejected') problemReason = 'Оплата отклонена вручную';
                else if (invoice.status === 'paid' && invite?.status === 'issued' && !joined) problemReason = 'Оплата есть, ссылка выдана, но Telegram-вход не подтвержден';
                else if (invoice.status === 'paid' && !invite && !accessEvent) problemReason = 'Оплата есть, но по доступу нет движения';
                else if (invoice.status === 'pending') problemReason = 'Счет создан, оплаты пока нет';

                return {
                    id: invoice.id,
                    created_at: invoice.created_at,
                    tg_user_id: String(invoice.tg_user_id),
                    tg_username: person.tg_username,
                    display_name: person.display_name,
                    first_name: person.first_name,
                    last_name: person.last_name,
                    channel_id: tariff?.channel_id || null,
                    subscription_id: subscription?.id || null,
                    amount: invoice.amount,
                    currency: invoice.currency,
                    invoice_status: invoice.status,
                    tariff_title: tariff?.title || 'Неизвестный тариф',
                    tariff_id: invoice.tariff_id,
                    is_trial: !!tariff?.is_trial,
                    trial_label: tariff?.trial_label || null,
                    channel_title: channel?.title || 'Неизвестный канал',
                    payment_event_type: paymentEvent?.event_type || null,
                    payment_event_status: paymentEvent?.status || null,
                    referral_discount_percent: referralDiscountPercent,
                    referral_discount_amount: Number(invoicePayload.referral_discount_amount || referralReward?.client_discount_original_amount || 0),
                    referral_original_amount: Number(invoicePayload.original_amount || referralReward?.sale_original_amount || 0),
                    referral_code: invoicePayload.referral_code || null,
                    referral_reward_status: referralReward?.status || null,
                    referral_reward_ton: referralReward ? Number(referralReward.reward_ton_amount || referralReward.reward_amount || 0) : 0,
                    referral_reward_currency: referralReward?.reward_currency || null,
                    referral_referrer_tg_user_id: referralReward?.referrer_tg_user_id || null,
                    referral_reserve_coverage_status: referralReward?.reserve_coverage_status || null,
                    access_invite_status: invite?.status || null,
                    last_access_event: accessEvent?.event_type || subscription?.last_access_event || null,
                    access_source: accessSource.key,
                    access_source_label: accessSource.label,
                    subscription_status: subscription?.status || null,
                    joined,
                    presence_confirmed: presenceConfirmed,
                    expires_at: subscription?.expires_at || null,
                    problem_reason: problemReason
                };
            });

            const enrichedSubscriptions = subscriptions.map(sub => {
                const person = getPersonProfile(sub.tg_user_id, sub.tg_username || null);
                const accessEvent = latestAccessEventBySubscription.get(sub.id) || null;
                const accessSource = detectAccessSource(accessEvent?.event_source, accessEvent?.payload, sub.access_note);
                const presenceConfirmed = presentByUserChannel.has(`${sub.tg_user_id}:${sub.channel_id}`);

                return {
                    ...sub,
                    tg_username: person.tg_username,
                    display_name: person.display_name,
                    first_name: person.first_name,
                    last_name: person.last_name,
                    access_source: accessSource.key,
                    access_source_label: accessSource.label,
                    in_group: !!sub.last_join_approved_at || presenceConfirmed,
                    presence_confirmed: presenceConfirmed,
                    channel_title: channelMap.get(sub.channel_id)?.title || 'Неизвестный канал',
                    removed_by_admin: isManualAdminRemoval(accessEvent?.event_source, accessEvent?.payload, sub.access_note)
                };
            });

            const manualAdminRemovedCustomers = enrichedSubscriptions
                .filter(sub => sub.removed_by_admin && sub.last_access_event === 'kicked')
                .map(sub => ({
                    ...sub,
                    admin_action_label: 'Удален админом'
                }));

            const activeCustomers = enrichedSubscriptions
                .filter(sub => sub.status === 'active' && !sub.removed_by_admin);

            const expiredCustomers = enrichedSubscriptions
                .filter(sub => sub.status === 'expired' && !sub.removed_by_admin);

            const inGroupLeaks = enrichedSubscriptions
                .filter(sub => {
                    if (sub.status !== 'expired') return false;
                    if (sub.removed_by_admin) return false;
                    if (sub.last_access_event === 'kicked') return false;
                    return sub.in_group;
                });

            const needsAccessCheck = enrichedSubscriptions
                .filter(sub => sub.status === 'active' && !sub.removed_by_admin && !sub.last_join_approved_at && !sub.presence_confirmed);

            const abandonedInvoices = recentOrders
                .filter(order => order.invoice_status === 'pending' || order.invoice_status === 'awaiting_receipt')
                .map(order => ({
                    ...order,
                    abandoned_status: getAbandonedStatus(order),
                    status: order.invoice_status,
                    tariffs: {
                        id: order.tariff_id,
                        title: order.tariff_title,
                        is_trial: order.is_trial,
                        trial_label: order.trial_label
                    }
                }));

            const scopedFunnelEvents = selectedBotId
                ? allFunnelEvents.filter(event => String(event.bot_id || '') === selectedBotId)
                : allFunnelEvents;

            const viewedEvents = scopedFunnelEvents.map(event => ({
                    ...event,
                    tariff_title: tariffMap.get(event.tariff_id)?.title || null,
                    channel_id: tariffMap.get(event.tariff_id)?.channel_id || null,
                    channel_title: channelMap.get(tariffMap.get(event.tariff_id)?.channel_id)?.title || null
                }));

            const viewedTariffs = viewedEvents.filter(event =>
                ['tariff_list_opened', 'tariff_card_opened', 'payment_method_selected'].includes(event.event_type) &&
                !invoices.some(invoice => {
                    if (String(invoice.tg_user_id) !== String(event.tg_user_id)) return false;
                    if (event.tariff_id && String(invoice.tariff_id) !== String(event.tariff_id)) return false;
                    return new Date(invoice.created_at).getTime() >= new Date(event.created_at).getTime();
                })
            ).map(event => {
                const person = getPersonProfile(event.tg_user_id, null);
                return {
                    ...event,
                    tg_username: person.tg_username,
                    display_name: person.display_name,
                    first_name: person.first_name,
                    last_name: person.last_name
                };
            });

            const startedContacts = viewedEvents
                .filter(event => event.event_type === 'bot_started')
                .reduce((acc, event) => {
                    const existing = acc.get(String(event.tg_user_id));
                    const eventTime = new Date(event.created_at || 0).getTime();
                    const existingTime = new Date(existing?.created_at || 0).getTime();
                    if (!existing || eventTime < existingTime) {
                        const person = getPersonProfile(event.tg_user_id, null);
                        acc.set(String(event.tg_user_id), {
                            ...event,
                            tg_username: person.tg_username,
                            display_name: person.display_name,
                            first_name: person.first_name,
                            last_name: person.last_name,
                            status: 'Нажал /start',
                            reason: event.payload?.start_payload ? `Payload: ${event.payload.start_payload}` : 'Первое касание с ботом'
                        });
                    }
                    return acc;
                }, new Map());

            const baseStatsById = new Map();
            for (const member of filteredBaseMembers) {
                if (!baseStatsById.has(member.base_id)) {
                    baseStatsById.set(member.base_id, { total: 0, humans: 0, bots: 0, present: 0 });
                }
                const stats = baseStatsById.get(member.base_id);
                stats.total += 1;
                if (member.is_bot) stats.bots += 1;
                else stats.humans += 1;
                if (member.present_now) stats.present += 1;
            }

            const bases = (basesResp.data || [])
                .filter(base => !selectedBotId || String(base.contour_id || '') === selectedBotId)
                .map(base => ({
                    ...base,
                    stats: baseStatsById.get(base.id) || { total: 0, humans: 0, bots: 0, present: 0 }
                }));

            const segments = {
                startedContacts: Array.from(startedContacts.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
                viewedTariffs,
                abandonedInvoices,
                activeCustomers,
                expiredCustomers,
                manualAdminRemovedCustomers,
                removedByAdmin: manualAdminRemovedCustomers,
                inGroupLeaks,
                needsAccessCheck,
                recentOrders,
                bases
            };

            res.json({
                success: true,
                updatedAt: new Date().toISOString(),
                selectedBotId,
                bots: botOptions,
                summary: {
                    startedContacts: startedContacts.size,
                    viewedTariffs: viewedTariffs.length,
                    abandonedInvoices: abandonedInvoices.length,
                    activeCustomers: activeCustomers.length,
                    expiredCustomers: expiredCustomers.length,
                    manualAdminRemovedCustomers: manualAdminRemovedCustomers.length,
                    removedByAdmin: manualAdminRemovedCustomers.length,
                    inGroupLeaks: inGroupLeaks.length,
                    needsAccessCheck: needsAccessCheck.length,
                    recentOrders: recentOrders.length,
                    bases: bases.length
                },
                segments,
                channels
            });
        } catch (error) {
            console.error('Ошибка customers workbench:', error);
            res.status(500).json({ error: 'Ошибка загрузки клиентов' });
        }
    });

    return router;
}
