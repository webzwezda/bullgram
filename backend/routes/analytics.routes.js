import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';

function buildTrialMap(invoices = [], channelIds = []) {
    const latestTrialMap = new Map();

    for (const invoice of invoices || []) {
        if (!invoice.tariffs || !channelIds.includes(invoice.tariffs.channel_id)) continue;

        const key = `${invoice.tg_user_id}:${invoice.tariffs.channel_id}`;
        if (latestTrialMap.has(key)) continue;

        latestTrialMap.set(key, {
            is_trial: !!invoice.tariffs.is_trial,
            trial_label: invoice.tariffs.trial_label || null
        });
    }

    return latestTrialMap;
}

export default function (supabase) {
    const router = express.Router();

    router.get('/', authenticateUser, async (req, res) => {
        try {
            const userId = req.user.id;

            // 1. Получаем список каналов этого пользователя (чтобы считать только его данные)
            const { data: channels, error: channelsError } = await supabase
                .from('channels')
                .select('id')
                .eq('owner_id', userId);
                
            if (channelsError) throw channelsError;
            const channelIds = channels ? channels.map(c => c.id) : [];

            // 2. Считаем активных подписчиков
            let activeSubscribers = 0;
            if (channelIds.length > 0) {
                const { count, error: subError } = await supabase
                    .from('subscriptions')
                    .select('*', { count: 'exact', head: true })
                    .in('channel_id', channelIds)
                    .eq('status', 'active');
                    
                if (!subError) activeSubscribers = count || 0;
            }

            // 3. Вычисляем выручку, конверсию и воронку неоплат
            const { data: invoices, error: invError } = await supabase
                .from('invoices')
                .select('*, tariffs(channel_id, title, is_trial, trial_label)')
                .order('created_at', { ascending: false });

            let revenueTON = 0;
            let revenueRUB = 0;
            let paidInvoicesCount = 0;
            let pendingInvoicesCount = 0;
            let trialPendingInvoicesCount = 0;
            let awaitingReceiptCount = 0;
            let remindedInvoicesCount = 0;
            let freshInvoicesCount = 0;
            let queuedInvoicesCount = 0;
            let staleInvoicesCount = 0;
            let mrrRUB = 0;
            let mrrTON = 0;
            let recentInvoices = [];
            let recentPendingInvoices = [];

            if (invoices && !invError) {
                // Оставляем только те счета, которые относятся к каналам нашего админа
                const myInvoices = invoices.filter(inv => 
                    inv.tariffs && channelIds.includes(inv.tariffs.channel_id)
                );

                myInvoices.forEach(inv => {
                    if (inv.status === 'paid') {
                        paidInvoicesCount++;
                        if (inv.currency === 'TON') revenueTON += Number(inv.amount);
                        if (inv.currency === 'RUB' || inv.currency === 'STARS') revenueRUB += Number(inv.amount);
                        return;
                    }

                    if (inv.status === 'pending' || inv.status === 'awaiting_receipt') {
                        pendingInvoicesCount++;
                        if (inv.tariffs?.is_trial) {
                            trialPendingInvoicesCount++;
                        }
                    }

                    if (inv.status === 'awaiting_receipt') {
                        awaitingReceiptCount++;
                    }

                    if (inv.reminded) {
                        remindedInvoicesCount++;
                    }

                    const createdAt = new Date(inv.created_at);
                    const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
                    if (ageHours < 2) {
                        freshInvoicesCount++;
                    } else if (ageHours <= 3 && !inv.reminded) {
                        queuedInvoicesCount++;
                    } else if (!inv.reminded) {
                        staleInvoicesCount++;
                    }
                });

                // Берем 5 последних успешных оплат для ленты "Последние транзакции"
                recentInvoices = myInvoices
                    .filter(inv => inv.status === 'paid')
                    .slice(0, 5)
                    .map(inv => ({
                        id: inv.id,
                        amount: inv.amount,
                        currency: inv.currency,
                        date: inv.created_at,
                        tariff_title: inv.tariffs ? inv.tariffs.title : 'Неизвестно',
                        tg_user_id: inv.tg_user_id,
                        is_trial: !!inv.tariffs?.is_trial,
                        trial_label: inv.tariffs?.trial_label || null
                    }));

                recentPendingInvoices = myInvoices
                    .filter(inv => inv.status === 'pending' || inv.status === 'awaiting_receipt')
                    .slice(0, 10)
                    .map(inv => ({
                        id: inv.id,
                        amount: inv.amount,
                        currency: inv.currency,
                        date: inv.created_at,
                        tariff_title: inv.tariffs ? inv.tariffs.title : 'Неизвестно',
                        tg_user_id: inv.tg_user_id,
                        status: inv.status,
                        reminded: !!inv.reminded,
                        is_trial: !!inv.tariffs?.is_trial,
                        trial_label: inv.tariffs?.trial_label || null
                    }));

                const monthAgo = new Date();
                monthAgo.setDate(monthAgo.getDate() - 30);

                myInvoices
                    .filter(inv => inv.status === 'paid' && new Date(inv.created_at) >= monthAgo)
                    .forEach(inv => {
                        if (inv.currency === 'TON') mrrTON += Number(inv.amount);
                        if (inv.currency === 'RUB' || inv.currency === 'STARS') mrrRUB += Number(inv.amount);
                    });
            }

            const [{ data: subscriptions, error: subsError }, { data: accessEvents, error: accessError }, { data: paymentEvents, error: paymentEventsError }] = await Promise.all([
                channelIds.length > 0
                    ? supabase
                        .from('subscriptions')
                        .select('id, tg_user_id, channel_id, status, expires_at, created_at, last_join_approved_at')
                        .in('channel_id', channelIds)
                    : Promise.resolve({ data: [], error: null }),
                channelIds.length > 0
                    ? supabase
                        .from('access_events')
                        .select('id, channel_id, event_type, created_at')
                        .eq('owner_id', userId)
                    : Promise.resolve({ data: [], error: null }),
                supabase
                    .from('payment_events')
                    .select('id, event_type, created_at')
                    .eq('owner_id', userId)
            ]);

            if (subsError) throw subsError;
            if (accessError) throw accessError;
            if (paymentEventsError && !(paymentEventsError.message || '').includes('payment_events')) throw paymentEventsError;

            const now = Date.now();
            const monthAgoTs = now - (30 * 24 * 60 * 60 * 1000);
            const trialSoonTs = now + (48 * 60 * 60 * 1000);
            const recentSubscriptions = (subscriptions || []).filter(sub => new Date(sub.created_at).getTime() >= monthAgoTs);
            const recentExpirations = (subscriptions || []).filter(sub =>
                sub.status === 'expired' &&
                sub.expires_at &&
                new Date(sub.expires_at).getTime() >= monthAgoTs
            );
            const latestTrialMap = buildTrialMap(
                (invoices || []).filter(inv => inv.status === 'paid'),
                channelIds
            );

            const joinApprovedCount = (accessEvents || []).filter(event => event.event_type === 'join_approved').length;
            const inviteIssuedCount = (accessEvents || []).filter(event => event.event_type === 'invite_issued').length;

            const paidNotJoinedCount = (subscriptions || []).filter(sub => sub.status === 'active' && !sub.last_join_approved_at).length;
            const expiredButStillInsideCount = (subscriptions || []).filter(sub => sub.status === 'expired' && sub.last_join_approved_at).length;
            const trialActiveCount = (subscriptions || []).filter(sub => {
                const latest = latestTrialMap.get(`${sub.tg_user_id}:${sub.channel_id}`);
                return sub.status === 'active' && !!latest?.is_trial;
            }).length;
            const trialExpiringCount = (subscriptions || []).filter(sub => {
                const latest = latestTrialMap.get(`${sub.tg_user_id}:${sub.channel_id}`);
                if (sub.status !== 'active' || !latest?.is_trial || !sub.expires_at) return false;
                const expiresAtTs = new Date(sub.expires_at).getTime();
                return expiresAtTs >= now && expiresAtTs <= trialSoonTs;
            }).length;
            const joinConversion = inviteIssuedCount > 0 ? Math.round((joinApprovedCount / inviteIssuedCount) * 100) : 0;
            const churnRate = recentSubscriptions.length > 0
                ? Math.round((recentExpirations.length / recentSubscriptions.length) * 100)
                : 0;
            const autoConfirmedPayments = (paymentEvents || []).filter(event => event.event_type === 'invoice_completed').length;
            const manualConfirmedPayments = (paymentEvents || []).filter(event =>
                event.event_type === 'admin_approved' || event.event_type === 'ton_manual_confirmed'
            ).length;

            // Считаем конверсию из неоплаченного счета в оплаченный
            const totalMyInvoices = paidInvoicesCount + pendingInvoicesCount;
            const conversion = totalMyInvoices > 0 ? Math.round((paidInvoicesCount / totalMyInvoices) * 100) : 0;

            res.json({
                success: true,
                activeSubscribers,
                revenueTON,
                revenueRUB,
                mrrTON,
                mrrRUB,
                conversion,
                churnRate,
                joinConversion,
                autoConfirmedPayments,
                manualConfirmedPayments,
                totalInvoices: totalMyInvoices,
                paidInvoicesCount,
                pendingInvoicesCount,
                trialPendingInvoicesCount,
                awaitingReceiptCount,
                remindedInvoicesCount,
                freshInvoicesCount,
                queuedInvoicesCount,
                staleInvoicesCount,
                paidNotJoinedCount,
                expiredButStillInsideCount,
                trialActiveCount,
                trialExpiringCount,
                recentInvoices,
                recentPendingInvoices
            });

        } catch (error) {
            console.error('Ошибка в аналитике:', error);
            res.status(500).json({ error: 'Ошибка при загрузке аналитики' });
        }
    });

    return router;
}
