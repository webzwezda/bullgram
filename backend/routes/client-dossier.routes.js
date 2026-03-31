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

            const [subscriptionsResp, invoicesResp, invitesResp, eventsResp, basesResp, membersResp, referralProfileResp, referralAttributionResp, referralEventsAsReferrerResp, referralEventsAsReferredResp] = await Promise.all([
                channelIds.length > 0
                    ? supabase
                        .from('subscriptions')
                        .select('id, tg_user_id, channel_id, status, expires_at, last_join_request_at, last_join_approved_at, last_access_event, access_note, created_at')
                        .eq('tg_user_id', tgUserId)
                        .in('channel_id', channelIds)
                        .order('created_at', { ascending: false })
                    : Promise.resolve({ data: [], error: null }),
                supabase
                    .from('invoices')
                    .select('id, tg_user_id, amount, currency, status, created_at, paid_at, tariffs(id, title, owner_id, channel_id, is_trial, trial_label)')
                    .eq('tg_user_id', tgUserId)
                    .order('created_at', { ascending: false })
                    .limit(100),
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

            const subscriptions = (subscriptionsResp.data || []).map(subscription => ({
                ...subscription,
                channel_title: channelMap.get(subscription.channel_id)?.title || 'Неизвестный канал',
                tg_chat_id: channelMap.get(subscription.channel_id)?.tg_chat_id || null
            }));

            const invoices = (invoicesResp.data || [])
                .filter(invoice => invoice.tariffs?.owner_id === ownerId)
                .map(invoice => ({
                    ...invoice,
                    channel_id: invoice.tariffs?.channel_id || null,
                    channel_title: channelMap.get(invoice.tariffs?.channel_id)?.title || invoice.tariffs?.title || 'Неизвестный канал'
                }));

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
            const latestInviteByInvoice = latestBy(invitesResp.data || [], row => row.invoice_id, 'issued_at');
            const latestAccessEventByInvoice = latestBy(eventsResp.data || [], row => row.invoice_id);
            const latestInvoiceByChannel = latestBy(invoices, row => row.channel_id);

            const invites = (invitesResp.data || []).map(invite => ({
                ...invite,
                channel_title: channelMap.get(invite.channel_id)?.title || 'Неизвестный канал'
            }));

            const accessEvents = (eventsResp.data || []).map(event => ({
                ...event,
                channel_title: channelMap.get(event.channel_id)?.title || 'Неизвестный канал'
            }));

            const ordersView = invoices.map(invoice => {
                const latestInvoiceForChannel = latestInvoiceByChannel.get(invoice.channel_id) || null;
                const subscription = latestInvoiceForChannel?.id === invoice.id
                    ? (subscriptions.find(sub => String(sub.channel_id) === String(invoice.channel_id)) || null)
                    : null;
                const paymentEvent = latestPaymentByInvoice.get(invoice.id) || null;
                const invite = latestInviteByInvoice.get(invoice.id) || null;
                const accessEvent = latestAccessEventByInvoice.get(invoice.id) || null;

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
                    access_invite_status: invite?.status || null,
                    last_access_event: accessEvent?.event_type || subscription?.last_access_event || null,
                    joined: !!subscription?.last_join_approved_at
                };
            });

            const baseMap = new Map((basesResp.data || []).map(base => [base.id, base]));
            const baseMemberships = (membersResp.data || []).map(member => ({
                ...member,
                base_name: baseMap.get(member.base_id)?.name || 'Неизвестная база'
            }));

            const latestInvoice = invoices[0] || null;
            const latestSubscription = subscriptions[0] || null;
            const latestAccessEvent = (eventsResp.data || [])[0] || null;
            const latestBaseMembership = baseMemberships[0] || null;
            const referralProfile = referralProfileResp.data || null;
            const referralAttribution = referralAttributionResp.data || null;
            const referralEventsAsReferrer = referralEventsAsReferrerResp.data || [];
            const referralEventsAsReferred = referralEventsAsReferredResp.data || [];

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
                activeSubscriptions: subscriptions.filter(sub => sub.status === 'active').length,
                expiredSubscriptions: subscriptions.filter(sub => sub.status === 'expired').length,
                joinedChannels: subscriptions.filter(sub => !!sub.last_join_approved_at).length,
                pendingJoins: subscriptions.filter(sub => sub.status === 'active' && !sub.last_join_approved_at).length,
                baseMemberships: baseMemberships.length,
                latestInvoiceStatus: latestInvoice?.status || null,
                latestChannelTitle: latestSubscription?.channel_title || latestInvoice?.channel_title || null,
                latestAccessEvent: latestAccessEvent?.event_type || latestSubscription?.last_access_event || null,
                paymentStatus: latestBaseMembership?.payment_status || null,
                referralRole,
                referralCode: referralProfile?.referral_code || null,
                referralBalanceRub: Number(referralProfile?.balance_rub || 0),
                referralBalanceTon: Number(referralProfile?.balance_ton || 0),
                referralBalanceUsdt: Number(referralProfile?.balance_usdt || 0),
                referredBy: referralAttribution?.referrer_tg_user_id || null,
                referralConversions: referralEventsAsReferrer.filter(event => event.event_type === 'reward_granted' && event.status === 'completed').length
            };

            res.json({
                success: true,
                summary,
                subscriptions,
                orders: ordersView,
                invites,
                accessEvents,
                paymentEvents,
                baseMemberships,
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
