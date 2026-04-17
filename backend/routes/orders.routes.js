import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';

function latestBy(list = [], keyFn) {
    const map = new Map();
    for (const item of list) {
        const key = keyFn(item);
        if (!key) continue;

        const prev = map.get(key);
        if (!prev || new Date(item.created_at || item.issued_at || 0) > new Date(prev.created_at || prev.issued_at || 0)) {
            map.set(key, item);
        }
    }
    return map;
}

export default function ordersRoutes(supabase) {
    const router = express.Router();

    router.get('/', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;

            const { data: channels, error: channelsError } = await supabase
                .from('channels')
                .select('id, title')
                .eq('owner_id', ownerId);

            if (channelsError) throw channelsError;

            const channelIds = (channels || []).map(channel => channel.id);
            const channelMap = new Map((channels || []).map(channel => [channel.id, channel.title]));

            const invoicesResp = await supabase
                .from('invoices')
                .select('*, tariffs(id, title, owner_id, channel_id, is_trial, trial_label)')
                .order('created_at', { ascending: false })
                .limit(150);

            if (invoicesResp.error) throw invoicesResp.error;

            const invoices = (invoicesResp.data || []).filter(invoice =>
                invoice.tariffs && invoice.tariffs.owner_id === ownerId
            );

            const invoiceIds = invoices.map(invoice => invoice.id);
            const tgPairs = invoices.map(invoice => ({
                tg_user_id: String(invoice.tg_user_id),
                channel_id: invoice.tariffs.channel_id
            }));

            const [{ data: paymentEvents, error: paymentEventsError }, { data: accessInvites, error: accessInvitesError }, { data: accessEvents, error: accessEventsError }, { data: subscriptions, error: subscriptionsError }, { data: referralEvents, error: referralEventsError }] = await Promise.all([
                invoiceIds.length > 0
                    ? supabase
                        .from('payment_events')
                        .select('*')
                        .eq('owner_id', ownerId)
                        .in('invoice_id', invoiceIds)
                        .order('created_at', { ascending: false })
                    : Promise.resolve({ data: [], error: null }),
                invoiceIds.length > 0
                    ? supabase
                        .from('access_invites')
                        .select('*')
                        .eq('owner_id', ownerId)
                        .in('invoice_id', invoiceIds)
                        .order('issued_at', { ascending: false })
                    : Promise.resolve({ data: [], error: null }),
                invoiceIds.length > 0
                    ? supabase
                        .from('access_events')
                        .select('*')
                        .eq('owner_id', ownerId)
                        .in('invoice_id', invoiceIds)
                        .order('created_at', { ascending: false })
                    : Promise.resolve({ data: [], error: null }),
                channelIds.length > 0
                    ? supabase
                        .from('subscriptions')
                        .select('id, tg_user_id, channel_id, status, expires_at, last_join_approved_at, last_access_event')
                        .in('channel_id', channelIds)
                        .order('created_at', { ascending: false })
                    : Promise.resolve({ data: [], error: null }),
                invoiceIds.length > 0
                    ? supabase
                        .from('referral_events')
                        .select('id, invoice_id, referrer_tg_user_id, event_type, status, reward_amount, reward_currency, reward_ton_amount, client_discount_percent, client_discount_original_amount, sale_original_amount, sale_original_currency, reserve_coverage_status, created_at')
                        .eq('owner_id', ownerId)
                        .in('invoice_id', invoiceIds)
                        .order('created_at', { ascending: false })
                    : Promise.resolve({ data: [], error: null })
            ]);

            if (paymentEventsError && !(paymentEventsError.message || '').includes('payment_events')) throw paymentEventsError;
            if (accessInvitesError && !(accessInvitesError.message || '').includes('access_invites')) throw accessInvitesError;
            if (accessEventsError && !(accessEventsError.message || '').includes('access_events')) throw accessEventsError;
            if (subscriptionsError) throw subscriptionsError;
            if (referralEventsError && !(referralEventsError.message || '').includes('referral_events')) throw referralEventsError;

            const latestPaymentEventByInvoice = latestBy(paymentEvents || [], item => item.invoice_id);
            const invoiceCreatedEventByInvoice = latestBy(
                (paymentEvents || []).filter(item => item.event_type === 'invoice_created'),
                item => item.invoice_id
            );
            const latestInviteByInvoice = latestBy(accessInvites || [], item => item.invoice_id);
            const latestAccessEventByInvoice = latestBy(accessEvents || [], item => item.invoice_id);
            const referralRewardByInvoice = latestBy(
                (referralEvents || []).filter(item => item.event_type === 'reward_granted'),
                item => item.invoice_id
            );
            const subscriptionMap = new Map((subscriptions || []).map(sub => [`${sub.tg_user_id}:${sub.channel_id}`, sub]));

            const rows = invoices.map(invoice => {
                const channelId = invoice.tariffs.channel_id;
                const subKey = `${invoice.tg_user_id}:${channelId}`;
                const subscription = subscriptionMap.get(subKey) || null;
                const paymentEvent = latestPaymentEventByInvoice.get(invoice.id) || null;
                const invoiceCreatedEvent = invoiceCreatedEventByInvoice.get(invoice.id) || null;
                const invite = latestInviteByInvoice.get(invoice.id) || null;
                const accessEvent = latestAccessEventByInvoice.get(invoice.id) || null;
                const referralReward = referralRewardByInvoice.get(invoice.id) || null;
                const invoicePayload = invoiceCreatedEvent?.payload || {};
                const referralDiscountPercent = Number(invoicePayload.referral_discount_percent || referralReward?.client_discount_percent || 0);
                const referralDiscountAmount = Number(invoicePayload.referral_discount_amount || referralReward?.client_discount_original_amount || 0);
                const referralOriginalAmount = Number(invoicePayload.original_amount || referralReward?.sale_original_amount || 0);
                let problemReason = 'Все выглядит ровно';

                if (invoice.status === 'awaiting_receipt') {
                    problemReason = 'Клиент нажал “я оплатил”, но чек еще не загружен';
                } else if (invoice.status === 'wait_admin') {
                    problemReason = 'Чек загружен, но админ еще не подтвердил';
                } else if (invoice.status === 'rejected') {
                    problemReason = 'Оплата отклонена вручную';
                } else if (invoice.status === 'paid' && invite?.status === 'issued' && !subscription?.last_join_approved_at) {
                    problemReason = 'Оплата есть, ссылка выдана, но человек не дошел до группы';
                } else if (invoice.status === 'paid' && invite?.status === 'declined') {
                    problemReason = 'Человек постучался, но заявка была отклонена';
                } else if (invoice.status === 'paid' && !invite && !accessEvent) {
                    problemReason = 'Оплата есть, но по доступу вообще нет движения';
                } else if (invoice.status === 'pending') {
                    problemReason = 'Счет создан, оплаты пока нет';
                }

                return {
                    id: invoice.id,
                    created_at: invoice.created_at,
                    tg_user_id: String(invoice.tg_user_id),
                    channel_id: channelId,
                    subscription_id: subscription?.id || null,
                    amount: invoice.amount,
                    currency: invoice.currency,
                    invoice_status: invoice.status,
                    tariff_title: invoice.tariffs?.title || 'Неизвестный тариф',
                    is_trial: !!invoice.tariffs?.is_trial,
                    trial_label: invoice.tariffs?.trial_label || null,
                    channel_title: channelMap.get(channelId) || 'Неизвестный канал',
                    payment_event_type: paymentEvent?.event_type || null,
                    payment_event_status: paymentEvent?.status || null,
                    referral_discount_percent: referralDiscountPercent,
                    referral_discount_amount: referralDiscountAmount,
                    referral_original_amount: referralOriginalAmount,
                    referral_code: invoicePayload.referral_code || null,
                    referral_reward_status: referralReward?.status || null,
                    referral_reward_ton: referralReward ? Number(referralReward.reward_ton_amount || referralReward.reward_amount || 0) : 0,
                    referral_reward_currency: referralReward?.reward_currency || null,
                    referral_referrer_tg_user_id: referralReward?.referrer_tg_user_id || null,
                    referral_reserve_coverage_status: referralReward?.reserve_coverage_status || null,
                    access_invite_status: invite?.status || null,
                    last_access_event: accessEvent?.event_type || subscription?.last_access_event || null,
                    subscription_status: subscription?.status || null,
                    joined: !!subscription?.last_join_approved_at,
                    expires_at: subscription?.expires_at || null,
                    problem_reason: problemReason
                };
            });

            const summary = {
                totalOrders: rows.length,
                paidOrders: rows.filter(row => row.invoice_status === 'paid').length,
                trialOrders: rows.filter(row => row.is_trial).length,
                referralOrders: rows.filter(row => Number(row.referral_discount_percent || 0) > 0 || Number(row.referral_reward_ton || 0) > 0).length,
                accessPending: rows.filter(row => row.invoice_status === 'paid' && !row.joined).length,
                brokenOrders: rows.filter(row =>
                    row.invoice_status === 'paid' &&
                    !row.access_invite_status &&
                    !row.last_access_event
                ).length
            };

            res.json({
                success: true,
                summary,
                orders: rows,
                channels: channels || []
            });
        } catch (error) {
            console.error('Ошибка orders:', error);
            res.status(500).json({ error: 'Ошибка загрузки заказов' });
        }
    });

    return router;
}
