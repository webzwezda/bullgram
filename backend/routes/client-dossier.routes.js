import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';

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

export default function clientDossierRoutes(supabase) {
    const router = express.Router();

    router.get('/:tgUserId', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const tgUserId = String(req.params.tgUserId || '').trim();

            if (!tgUserId) {
                return res.status(400).json({ error: 'Не передан Telegram ID' });
            }

            const { data: channels, error: channelsError } = await supabase
                .from('channels')
                .select('id, title, tg_chat_id, bot_id')
                .eq('owner_id', ownerId)
                .order('created_at', { ascending: false });

            if (channelsError) throw channelsError;

            const channelIds = (channels || []).map(channel => channel.id);
            const channelMap = new Map((channels || []).map(channel => [channel.id, channel]));

            const { data: tariffs, error: tariffsError } = await supabase
                .from('tariffs')
                .select('id, title, owner_id, channel_id, is_trial, trial_label')
                .eq('owner_id', ownerId)
                .order('created_at', { ascending: false });

            if (tariffsError) throw tariffsError;

            const tariffIds = (tariffs || []).map(tariff => tariff.id);
            const tariffMap = new Map((tariffs || []).map(tariff => [tariff.id, tariff]));

            const [subscriptionsResp, invoicesResp, invitesResp, eventsResp, basesResp, membersResp, referralProfileResp, referralAttributionResp, referralEventsAsReferrerResp, referralEventsAsReferredResp, reconciliationResolutionsResp] = await Promise.all([
                channelIds.length > 0
                    ? supabase
                        .from('subscriptions')
                        .select('id, tg_user_id, channel_id, status, expires_at, last_join_request_at, last_join_approved_at, last_access_event, access_note, created_at')
                        .eq('tg_user_id', tgUserId)
                        .in('channel_id', channelIds)
                        .order('created_at', { ascending: false })
                    : Promise.resolve({ data: [], error: null }),
                tariffIds.length > 0
                    ? supabase
                        .from('invoices')
                        .select('id, tg_user_id, tariff_id, amount, currency, status, created_at, paid_at')
                        .in('tariff_id', tariffIds)
                        .eq('tg_user_id', tgUserId)
                        .order('created_at', { ascending: false })
                        .limit(100)
                    : Promise.resolve({ data: [], error: null }),
                supabase
                    .from('access_invites')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .eq('tg_user_id', tgUserId)
                    .order('issued_at', { ascending: false })
                    .limit(100),
                supabase
                    .from('access_events')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .eq('tg_user_id', tgUserId)
                    .order('created_at', { ascending: false })
                    .limit(150),
                supabase
                    .from('customer_bases')
                    .select('id, name')
                    .eq('owner_id', ownerId),
                supabase
                    .from('customer_base_members')
                    .select('id, base_id, tg_user_id, display_name, username, present_now, channels_count, coverage_status, payment_status, present_channel_titles, missing_channel_titles, updated_at')
                    .eq('owner_id', ownerId)
                    .eq('tg_user_id', tgUserId)
                    .order('updated_at', { ascending: false })
                ,
                supabase
                    .from('referral_profiles')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .eq('tg_user_id', tgUserId)
                    .maybeSingle(),
                supabase
                    .from('referral_attributions')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .eq('referred_tg_user_id', tgUserId)
                    .maybeSingle(),
                supabase
                    .from('referral_events')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .eq('referrer_tg_user_id', tgUserId)
                    .order('created_at', { ascending: false })
                    .limit(50),
                supabase
                    .from('referral_events')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .eq('referred_tg_user_id', tgUserId)
                    .order('created_at', { ascending: false })
                    .limit(50)
                ,
                supabase
                    .from('customer_reconciliation_resolutions')
                    .select('id, source_id, tg_user_id, resolution_type, note, created_at, updated_at')
                    .eq('owner_id', ownerId)
                    .eq('tg_user_id', tgUserId)
                    .order('updated_at', { ascending: false })
                    .limit(50)
            ]);

            if (subscriptionsResp.error) throw subscriptionsResp.error;
            if (invoicesResp.error) throw invoicesResp.error;
            if (invitesResp.error && !(invitesResp.error.message || '').includes('access_invites')) throw invitesResp.error;
            if (eventsResp.error && !(eventsResp.error.message || '').includes('access_events')) throw eventsResp.error;
            if (basesResp.error && !(basesResp.error.message || '').includes('customer_bases')) throw basesResp.error;
            if (membersResp.error && !(membersResp.error.message || '').includes('customer_base_members')) throw membersResp.error;
            if (referralProfileResp.error && !(referralProfileResp.error.message || '').includes('referral_profiles')) throw referralProfileResp.error;
            if (referralAttributionResp.error && !(referralAttributionResp.error.message || '').includes('referral_attributions')) throw referralAttributionResp.error;
            if (referralEventsAsReferrerResp.error && !(referralEventsAsReferrerResp.error.message || '').includes('referral_events')) throw referralEventsAsReferrerResp.error;
            if (referralEventsAsReferredResp.error && !(referralEventsAsReferredResp.error.message || '').includes('referral_events')) throw referralEventsAsReferredResp.error;
            if (reconciliationResolutionsResp.error && !(reconciliationResolutionsResp.error.message || '').includes('customer_reconciliation_resolutions')) throw reconciliationResolutionsResp.error;

            const reconciliationSourceIds = Array.from(new Set((reconciliationResolutionsResp.data || []).map((row) => row.source_id).filter(Boolean)));
            const reconciliationSourcesResp = reconciliationSourceIds.length > 0
                ? await supabase
                    .from('customer_reconciliation_sources')
                    .select('id, title_snapshot, username_snapshot, chat_id, role')
                    .eq('owner_id', ownerId)
                    .in('id', reconciliationSourceIds)
                : { data: [], error: null };

            if (reconciliationSourcesResp.error && !(reconciliationSourcesResp.error.message || '').includes('customer_reconciliation_sources')) {
                throw reconciliationSourcesResp.error;
            }

            const subscriptions = (subscriptionsResp.data || []).map(subscription => ({
                ...subscription,
                channel_title: channelMap.get(subscription.channel_id)?.title || 'Неизвестный канал',
                tg_chat_id: channelMap.get(subscription.channel_id)?.tg_chat_id || null
            }));

            const invoices = (invoicesResp.data || []).map(invoice => {
                const tariff = tariffMap.get(invoice.tariff_id) || null;
                return {
                    ...invoice,
                    tariffs: tariff,
                    channel_id: tariff?.channel_id || null,
                    channel_title: channelMap.get(tariff?.channel_id)?.title || tariff?.title || 'Неизвестный канал'
                };
            });

            const invoiceIds = invoices.map(invoice => invoice.id);
            const [paymentEventsResp] = await Promise.all([
                invoiceIds.length > 0
                    ? supabase
                        .from('payment_events')
                        .select('*')
                        .eq('owner_id', ownerId)
                        .in('invoice_id', invoiceIds)
                        .order('created_at', { ascending: false })
                    : Promise.resolve({ data: [], error: null })
            ]);

            if (paymentEventsResp.error && !(paymentEventsResp.error.message || '').includes('payment_events')) {
                throw paymentEventsResp.error;
            }

            const paymentEvents = paymentEventsResp.data || [];
            const latestPaymentByInvoice = latestBy(paymentEvents, row => row.invoice_id);
            const invoiceCreatedByInvoice = latestBy(
                paymentEvents.filter(row => row.event_type === 'invoice_created'),
                row => row.invoice_id
            );
            const latestInviteByInvoice = latestBy(invitesResp.data || [], row => row.invoice_id, 'issued_at');
            const latestAccessEventByInvoice = latestBy(eventsResp.data || [], row => row.invoice_id);
            const latestAccessEventBySubscription = latestBy(
                (eventsResp.data || []).filter(row => row.subscription_id),
                row => row.subscription_id
            );
            const latestInvoiceByChannel = latestBy(invoices, row => row.channel_id);
            const referralProfile = referralProfileResp.data || null;
            const referralAttribution = referralAttributionResp.data || null;
            const referralEventsAsReferrer = referralEventsAsReferrerResp.data || [];
            const referralEventsAsReferred = referralEventsAsReferredResp.data || [];
            const referralRewardByInvoice = latestBy(
                referralEventsAsReferred.filter(event => event.event_type === 'reward_granted'),
                event => event.invoice_id
            );

            const invites = (invitesResp.data || []).map(invite => {
                const accessSource = detectAccessSource(invite?.meta?.event_source, invite?.meta || {}, null);
                return {
                    ...invite,
                    channel_title: channelMap.get(invite.channel_id)?.title || 'Неизвестный канал',
                    access_source: accessSource.key,
                    access_source_label: accessSource.label
                };
            });

            const accessEvents = (eventsResp.data || []).map(event => {
                const accessSource = detectAccessSource(event.event_source, event.payload, null);
                return {
                    ...event,
                    channel_title: channelMap.get(event.channel_id)?.title || 'Неизвестный канал',
                    access_source: accessSource.key,
                    access_source_label: accessSource.label
                };
            });

            const subscriptionsWithSource = subscriptions.map((subscription) => {
                const accessEvent = latestAccessEventBySubscription.get(subscription.id) || null;
                const accessSource = detectAccessSource(accessEvent?.event_source, accessEvent?.payload, subscription.access_note);
                return {
                    ...subscription,
                    access_source: accessSource.key,
                    access_source_label: accessSource.label,
                    removed_by_admin: accessSource.key === 'manual_admin_removed' && subscription.last_access_event === 'kicked'
                };
            });

            const ordersView = invoices.map(invoice => {
                const latestInvoiceForChannel = latestInvoiceByChannel.get(invoice.channel_id) || null;
                const subscription = latestInvoiceForChannel?.id === invoice.id
                    ? (subscriptions.find(sub => String(sub.channel_id) === String(invoice.channel_id)) || null)
                    : null;
                const paymentEvent = latestPaymentByInvoice.get(invoice.id) || null;
                const invoiceCreatedEvent = invoiceCreatedByInvoice.get(invoice.id) || null;
                const invite = latestInviteByInvoice.get(invoice.id) || null;
                const accessEvent = latestAccessEventByInvoice.get(invoice.id) || null;
                const referralReward = referralRewardByInvoice.get(invoice.id) || null;
                const accessSource = detectAccessSource(accessEvent?.event_source, accessEvent?.payload, subscription?.access_note);
                const invoicePayload = invoiceCreatedEvent?.payload || {};
                const referralDiscountPercent = Number(invoicePayload.referral_discount_percent || referralReward?.client_discount_percent || 0);
                const referralDiscountAmount = Number(invoicePayload.referral_discount_amount || referralReward?.client_discount_original_amount || 0);
                const referralOriginalAmount = Number(invoicePayload.original_amount || referralReward?.sale_original_amount || 0);

                return {
                    invoice_id: invoice.id,
                    created_at: invoice.created_at,
                    paid_at: invoice.paid_at || null,
                    amount: invoice.amount,
                    currency: invoice.currency,
                    invoice_status: invoice.status,
                    channel_id: invoice.channel_id,
                    channel_title: invoice.channel_title,
                    tariff_title: invoice.tariffs?.title || 'Неизвестный тариф',
                    is_trial: !!invoice.tariffs?.is_trial,
                    trial_label: invoice.tariffs?.trial_label || null,
                    payment_event_type: paymentEvent?.event_type || null,
                    referral_discount_percent: referralDiscountPercent,
                    referral_discount_amount: referralDiscountAmount,
                    referral_original_amount: referralOriginalAmount,
                    referral_code: invoicePayload.referral_code || referralAttribution?.referral_code || null,
                    referral_referrer_tg_user_id: referralReward?.referrer_tg_user_id || referralAttribution?.referrer_tg_user_id || null,
                    referral_reward_status: referralReward?.status || null,
                    referral_reward_ton: referralReward ? Number(referralReward.reward_ton_amount || referralReward.reward_amount || 0) : 0,
                    referral_reserve_coverage_status: referralReward?.reserve_coverage_status || null,
                    access_invite_status: invite?.status || null,
                    last_access_event: accessEvent?.event_type || subscription?.last_access_event || null,
                    access_source: accessSource.key,
                    access_source_label: accessSource.label,
                    joined: !!subscription?.last_join_approved_at
                };
            });

            const baseMap = new Map((basesResp.data || []).map(base => [base.id, base]));
            const reconciliationSourceMap = new Map((reconciliationSourcesResp.data || []).map((row) => [row.id, row]));
            const baseMemberships = (membersResp.data || []).map(member => ({
                ...member,
                base_name: baseMap.get(member.base_id)?.name || 'Неизвестная база'
            }));
            const reconciliationResolutions = (reconciliationResolutionsResp.data || []).map((row) => {
                const source = reconciliationSourceMap.get(row.source_id) || null;
                return {
                    ...row,
                    source_title: source?.title_snapshot || source?.username_snapshot || source?.chat_id || 'Источник уже пропал',
                    source_role: source?.role || null
                };
            });

            const latestInvoice = invoices[0] || null;
            const latestSubscription = subscriptionsWithSource[0] || null;
            const latestAccessEvent = accessEvents[0] || null;
            const latestBaseMembership = baseMemberships[0] || null;

            let referralRole = 'none';
            if (referralProfile && referralAttribution) referralRole = 'both';
            else if (referralProfile) referralRole = 'partner';
            else if (referralAttribution) referralRole = 'referred';

            const summary = {
                tg_user_id: tgUserId,
                display_name: latestBaseMembership?.display_name || null,
                username: latestBaseMembership?.username || null,
                totalOrders: ordersView.length,
                paidOrders: ordersView.filter(order => order.invoice_status === 'paid').length,
                activeSubscriptions: subscriptionsWithSource.filter(sub => sub.status === 'active').length,
                expiredSubscriptions: subscriptionsWithSource.filter(sub => sub.status === 'expired').length,
                manualAdminRemovedSubscriptions: subscriptionsWithSource.filter(sub => sub.removed_by_admin).length,
                joinedChannels: subscriptionsWithSource.filter(sub => !!sub.last_join_approved_at).length,
                pendingJoins: subscriptionsWithSource.filter(sub => sub.status === 'active' && !sub.last_join_approved_at).length,
                baseMemberships: baseMemberships.length,
                reconciliationResolutions: reconciliationResolutions.length,
                latestInvoiceStatus: latestInvoice?.status || null,
                latestChannelTitle: latestSubscription?.channel_title || latestInvoice?.channel_title || null,
                latestAccessEvent: latestAccessEvent?.event_type || latestSubscription?.last_access_event || null,
                latestAccessSource: latestAccessEvent?.access_source || latestSubscription?.access_source || null,
                latestAccessSourceLabel: latestAccessEvent?.access_source_label || latestSubscription?.access_source_label || null,
                paymentStatus: latestBaseMembership?.payment_status || null,
                referralRole,
                referralCode: referralProfile?.referral_code || null,
                referralBalanceRub: Number(referralProfile?.balance_rub || 0),
                referralBalanceTon: Number(referralProfile?.balance_ton || 0),
                referralBalanceUsdt: Number(referralProfile?.balance_usdt || 0),
                referredBy: referralAttribution?.referrer_tg_user_id || null,
                referralCodeFromAttribution: referralAttribution?.referral_code || null,
                referralAttributionExpiresAt: referralAttribution?.expires_at || null,
                referralDiscountEligible: referralAttribution?.discount_eligible ?? null,
                referralRewardPercentSnapshot: referralAttribution?.reward_percent_snapshot ?? null,
                referralClientDiscountPercentSnapshot: referralAttribution?.client_discount_percent_snapshot ?? null,
                referralConversions: referralEventsAsReferrer.filter(event => event.event_type === 'reward_granted' && event.status === 'completed').length
            };

            res.json({
                success: true,
                summary,
                subscriptions: subscriptionsWithSource,
                orders: ordersView,
                invites,
                accessEvents,
                paymentEvents,
                baseMemberships,
                reconciliationResolutions,
                referralProfile,
                referralAttribution,
                referralEventsAsReferrer,
                referralEventsAsReferred
            });
        } catch (error) {
            console.error('Ошибка client dossier:', error);
            res.status(500).json({ error: 'Ошибка загрузки досье клиента' });
        }
    });

    return router;
}
