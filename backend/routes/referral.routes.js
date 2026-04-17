import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { getReferralEconomics, loadReferralReserveState } from '../services/referral-reserve.service.js';

function createEmptyResponse() {
    return {
        settings: {
            referral_enabled: false,
            referral_reward_percent: 20,
            referral_welcome_text: ''
        },
        summary: {
            partners: 0,
            leads: 0,
            paidReferrals: 0,
            earnedRub: 0,
            earnedTon: 0,
            earnedUsdt: 0,
            outstandingRub: 0,
            outstandingTon: 0,
            outstandingUsdt: 0,
            paidOutRub: 0,
            paidOutTon: 0,
            paidOutUsdt: 0
        },
        topPartners: [],
        pendingPayouts: [],
        recentEvents: [],
        support: {
            referralTables: true,
            referralSettings: true
        },
        reserve: null,
        economics: getReferralEconomics()
    };
}

export default function referralRoutes(supabase) {
    const router = express.Router();

    function normalizeCurrencyAmount(currency, amount) {
        const decimals = currency === 'RUB' ? 2 : 6;
        return Number(Number(amount || 0).toFixed(decimals));
    }

    async function markReferralPayout(ownerId, tgUserId, currency, amount, note, payoutRequestId = null) {
        const normalizedCurrency = String(currency || '').toUpperCase();
        const amountNumber = Number(amount || 0);

        if (!tgUserId) {
            return { error: 'Не передан Telegram ID партнера', status: 400 };
        }

        if (!['RUB', 'TON', 'USDT'].includes(normalizedCurrency)) {
            return { error: 'Выплату можно отметить только в RUB, TON или USDT', status: 400 };
        }

        if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
            return { error: 'Сумма выплаты должна быть больше нуля', status: 400 };
        }

        const { data: profile, error: profileError } = await supabase
            .from('referral_profiles')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('tg_user_id', String(tgUserId))
            .maybeSingle();

        if (profileError) {
            if ((profileError.message || '').includes('referral_profiles')) {
                return { error: 'SQL под рефералку не применен до конца. Выплаты пока некуда писать.', status: 400 };
            }
            throw profileError;
        }

        if (!profile) {
            return { error: 'Партнер не найден', status: 404 };
        }

        const balanceField = normalizedCurrency === 'RUB'
            ? 'balance_rub'
            : normalizedCurrency === 'TON'
                ? 'balance_ton'
                : 'balance_usdt';
        const currentBalance = Number(profile[balanceField] || 0);
        const normalizedAmount = normalizeCurrencyAmount(normalizedCurrency, amountNumber);
        let activePayoutRequest = null;

        if (normalizedCurrency === 'TON') {
            let requestQuery = supabase
                .from('referral_partner_payouts')
                .select('*')
                .eq('owner_id', ownerId)
                .eq('tg_user_id', String(tgUserId))
                .in('status', ['requested', 'queued'])
                .order('requested_at', { ascending: false })
                .limit(1);

            if (payoutRequestId) {
                requestQuery = supabase
                    .from('referral_partner_payouts')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .eq('tg_user_id', String(tgUserId))
                    .eq('id', payoutRequestId)
                    .in('status', ['requested', 'queued'])
                    .limit(1);
            }

            const { data: requestRows, error: requestError } = await requestQuery;
            if (requestError && !(requestError.message || '').includes('referral_partner_payouts')) {
                throw requestError;
            }
            activePayoutRequest = requestRows?.[0] || null;

            if (payoutRequestId && !activePayoutRequest) {
                return { error: 'Активная заявка на выплату не найдена или уже закрыта', status: 404 };
            }

            if (activePayoutRequest) {
                const requestedAmount = normalizeCurrencyAmount('TON', activePayoutRequest.amount_ton);
                if (requestedAmount !== normalizedAmount) {
                    return {
                        error: `У партнера есть активная заявка на ${requestedAmount} TON. Закрывай ровно эту сумму, чтобы не сломать учет.`,
                        status: 400
                    };
                }
            }
        }

        if (normalizedAmount > currentBalance) {
            return {
                error: `Нельзя списать ${normalizedAmount} ${normalizedCurrency}, на балансе только ${currentBalance}`,
                status: 400
            };
        }

        const nextBalance = normalizeCurrencyAmount(normalizedCurrency, currentBalance - normalizedAmount);

        const { error: updateError } = await supabase
            .from('referral_profiles')
            .update({ [balanceField]: nextBalance })
            .eq('id', profile.id);

        if (updateError) throw updateError;

        const { error: eventError } = await supabase
            .from('referral_events')
            .insert({
                owner_id: ownerId,
                referrer_tg_user_id: String(tgUserId),
                referred_tg_user_id: null,
                invoice_id: null,
                tariff_id: null,
                event_type: 'payout_marked',
                status: 'completed',
                reward_amount: normalizedAmount,
                reward_currency: normalizedCurrency,
                payload: {
                    note: note || null,
                    balance_before: currentBalance,
                    balance_after: nextBalance,
                    payout_request_id: activePayoutRequest?.id || null
                }
            });

        if (eventError) {
            if ((eventError.message || '').includes('referral_events')) {
                return { error: 'SQL под журнал выплат не применен до конца. Сначала добей базу.', status: 400 };
            }
            throw eventError;
        }

        if (activePayoutRequest) {
            const { error: requestUpdateError } = await supabase
                .from('referral_partner_payouts')
                .update({
                    status: 'sent',
                    sent_at: new Date().toISOString(),
                    failure_reason: null,
                    payload: {
                        ...(activePayoutRequest.payload || {}),
                        settled_by_admin: true,
                        settled_note: note || null,
                        balance_before: currentBalance,
                        balance_after: nextBalance
                    }
                })
                .eq('id', activePayoutRequest.id)
                .in('status', ['requested', 'queued']);

            if (requestUpdateError) throw requestUpdateError;
        }

        return {
            success: true,
            tg_user_id: String(tgUserId),
            currency: normalizedCurrency,
            amount: normalizedAmount,
            balance_after: nextBalance,
            payout_request_id: activePayoutRequest?.id || null
        };
    }

    router.get('/', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const payload = createEmptyResponse();

        try {
            payload.reserve = await loadReferralReserveState(supabase, ownerId, { ensure: true });
            payload.economics = payload.reserve?.economics || getReferralEconomics();

            const [settingsResp, profilesResp, attributionsResp, eventsResp, payoutMethodsResp, payoutsResp] = await Promise.all([
                supabase
                    .from('payment_settings')
                    .select('referral_enabled, referral_reward_percent, referral_welcome_text, referral_client_discount_percent')
                    .eq('owner_id', ownerId)
                    .maybeSingle(),
                supabase
                    .from('referral_profiles')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('referral_attributions')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(300),
                supabase
                    .from('referral_events')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(300),
                supabase
                    .from('referral_partner_payout_methods')
                    .select('*')
                    .eq('owner_id', ownerId),
                supabase
                    .from('referral_partner_payouts')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .order('requested_at', { ascending: false })
                    .limit(300)
            ]);

            if (settingsResp.error) {
                if ((settingsResp.error.message || '').includes('referral_')) {
                    payload.support.referralSettings = false;
                } else {
                    throw settingsResp.error;
                }
            }

            if (profilesResp.error || attributionsResp.error || eventsResp.error || payoutMethodsResp.error || payoutsResp.error) {
                const joinedError = [
                    profilesResp.error?.message || '',
                    attributionsResp.error?.message || '',
                    eventsResp.error?.message || '',
                    payoutMethodsResp.error?.message || '',
                    payoutsResp.error?.message || ''
                ].join(' ');

                if (
                    joinedError.includes('referral_profiles') ||
                    joinedError.includes('referral_attributions') ||
                    joinedError.includes('referral_events') ||
                    joinedError.includes('referral_partner_payout')
                ) {
                    payload.support.referralTables = false;
                    return res.json(payload);
                }

                throw profilesResp.error || attributionsResp.error || eventsResp.error || payoutMethodsResp.error || payoutsResp.error;
            }

            payload.settings = {
                referral_enabled: settingsResp.data?.referral_enabled ?? false,
                referral_reward_percent: Number(settingsResp.data?.referral_reward_percent ?? 20),
                referral_client_discount_percent: Number(settingsResp.data?.referral_client_discount_percent ?? payload.economics.clientDiscountPercent),
                referral_welcome_text: settingsResp.data?.referral_welcome_text || ''
            };

            const profiles = profilesResp.data || [];
            const attributions = attributionsResp.data || [];
            const events = eventsResp.data || [];
            const payoutMethods = payoutMethodsResp.data || [];
            const payouts = payoutsResp.data || [];
            const completedRewards = events.filter(event => event.event_type === 'reward_granted' && event.status === 'completed');

            const eventsByReferrer = new Map();
            for (const event of events) {
                const key = String(event.referrer_tg_user_id);
                const bucket = eventsByReferrer.get(key) || [];
                bucket.push(event);
                eventsByReferrer.set(key, bucket);
            }

            const payoutMethodByReferrer = new Map();
            for (const method of payoutMethods) {
                payoutMethodByReferrer.set(String(method.tg_user_id), method);
            }

            const pendingPayoutByReferrer = new Map();
            const latestPayoutByReferrer = new Map();
            for (const payout of payouts) {
                const key = String(payout.tg_user_id);
                if (!latestPayoutByReferrer.has(key)) {
                    latestPayoutByReferrer.set(key, payout);
                }
                if (['requested', 'queued'].includes(String(payout.status))) {
                    const current = pendingPayoutByReferrer.get(key);
                    pendingPayoutByReferrer.set(key, {
                        id: current?.id || payout.id,
                        count: Number(current?.count || 0) + 1,
                        amount_ton: Number(current?.amount_ton || 0) + Number(payout.amount_ton || 0),
                        status: current?.status || payout.status,
                        ton_wallet: current?.ton_wallet || payout.ton_wallet,
                        requested_at: current?.requested_at || payout.requested_at
                    });
                }
            }

            const allPartnerRows = profiles.map(profile => {
                const profileEvents = eventsByReferrer.get(String(profile.tg_user_id)) || [];
                const payoutMethod = payoutMethodByReferrer.get(String(profile.tg_user_id)) || null;
                const pendingPayout = pendingPayoutByReferrer.get(String(profile.tg_user_id)) || null;
                const latestPayout = latestPayoutByReferrer.get(String(profile.tg_user_id)) || null;
                const paidReferrals = profileEvents.filter(event => event.event_type === 'reward_granted').length;

                const earnedRub = profileEvents
                    .filter(event => event.reward_currency === 'RUB' && event.status === 'completed')
                    .reduce((sum, event) => sum + Number(event.reward_amount || 0), 0);

                const earnedTon = profileEvents
                    .filter(event => event.reward_currency === 'TON' && event.status === 'completed')
                    .reduce((sum, event) => sum + Number(event.reward_amount || 0), 0);

                const earnedUsdt = profileEvents
                    .filter(event => event.reward_currency === 'USDT' && event.status === 'completed')
                    .reduce((sum, event) => sum + Number(event.reward_amount || 0), 0);

                const totalEarnedRub = Number(profile.total_earned_rub || 0);
                const totalEarnedTon = Number(profile.total_earned_ton || 0);
                const totalEarnedUsdt = Number(profile.total_earned_usdt || 0);
                const balanceRub = Number(profile.balance_rub || 0);
                const balanceTon = Number(profile.balance_ton || 0);
                const balanceUsdt = Number(profile.balance_usdt || 0);

                return {
                    tg_user_id: String(profile.tg_user_id),
                    username: profile.username || null,
                    display_name: profile.display_name || null,
                    referral_code: profile.referral_code,
                    balance_rub: balanceRub,
                    balance_ton: balanceTon,
                    balance_usdt: balanceUsdt,
                    total_earned_rub: totalEarnedRub,
                    total_earned_ton: totalEarnedTon,
                    total_earned_usdt: totalEarnedUsdt,
                    paid_out_rub: Math.max(0, totalEarnedRub - balanceRub),
                    paid_out_ton: Math.max(0, totalEarnedTon - balanceTon),
                    paid_out_usdt: Math.max(0, totalEarnedUsdt - balanceUsdt),
                    total_referrals: paidReferrals,
                    earnedRub,
                    earnedTon,
                    earnedUsdt,
                    payout_wallet: payoutMethod?.ton_wallet || null,
                    payout_wallet_status: payoutMethod?.status || null,
                    pending_payout_id: pendingPayout?.id || null,
                    pending_payout_ton: pendingPayout ? Number(pendingPayout.amount_ton.toFixed(6)) : 0,
                    pending_payout_status: pendingPayout?.status || null,
                    pending_payout_count: pendingPayout?.count || 0,
                    pending_payout_wallet: pendingPayout?.ton_wallet || null,
                    pending_payout_requested_at: pendingPayout?.requested_at || null,
                    latest_payout_status: latestPayout?.status || null,
                    latest_payout_requested_at: latestPayout?.requested_at || null
                };
            });

            const topPartners = [...allPartnerRows].sort((a, b) => {
                const bPending = Number(b.pending_payout_ton || 0) > 0 ? 1 : 0;
                const aPending = Number(a.pending_payout_ton || 0) > 0 ? 1 : 0;
                if (bPending !== aPending) return bPending - aPending;
                const bTotal = b.earnedRub + b.earnedTon + b.earnedUsdt;
                const aTotal = a.earnedRub + a.earnedTon + a.earnedUsdt;
                return bTotal - aTotal;
            });

            payload.pendingPayouts = topPartners.filter(row => Number(row.pending_payout_ton || 0) > 0);

            payload.summary = {
                partners: profiles.length,
                leads: attributions.length,
                paidReferrals: completedRewards.length,
                earnedRub: completedRewards.filter(event => event.reward_currency === 'RUB').reduce((sum, event) => sum + Number(event.reward_amount || 0), 0),
                earnedTon: completedRewards.filter(event => event.reward_currency === 'TON').reduce((sum, event) => sum + Number(event.reward_amount || 0), 0),
                earnedUsdt: completedRewards.filter(event => event.reward_currency === 'USDT').reduce((sum, event) => sum + Number(event.reward_amount || 0), 0),
                outstandingRub: profiles.reduce((sum, profile) => sum + Number(profile.balance_rub || 0), 0),
                outstandingTon: profiles.reduce((sum, profile) => sum + Number(profile.balance_ton || 0), 0),
                outstandingUsdt: profiles.reduce((sum, profile) => sum + Number(profile.balance_usdt || 0), 0),
                paidOutRub: profiles.reduce((sum, profile) => sum + Math.max(0, Number(profile.total_earned_rub || 0) - Number(profile.balance_rub || 0)), 0),
                paidOutTon: profiles.reduce((sum, profile) => sum + Math.max(0, Number(profile.total_earned_ton || 0) - Number(profile.balance_ton || 0)), 0),
                paidOutUsdt: profiles.reduce((sum, profile) => sum + Math.max(0, Number(profile.total_earned_usdt || 0) - Number(profile.balance_usdt || 0)), 0)
            };

            payload.topPartners = topPartners;
            payload.recentEvents = events.slice(0, 50);

            res.json(payload);
        } catch (error) {
            console.error('Ошибка referral dashboard:', error);
            res.status(500).json({ error: 'Ошибка загрузки рефералки' });
        }
    });

    router.post('/settings', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const {
            referral_enabled,
            referral_reward_percent,
            referral_welcome_text,
            referral_client_discount_percent
        } = req.body;

        try {
            const reserve = await loadReferralReserveState(supabase, ownerId, { ensure: true });
            if (referral_enabled && !reserve.canEnableReferrals) {
                return res.status(400).json({
                    error: reserve.reason || 'Сначала пополни партнерский резерв, потом включай партнерку.',
                    reserve
                });
            }

            const economics = getReferralEconomics();
            let { error } = await supabase
                .from('payment_settings')
                .upsert({
                    owner_id: ownerId,
                    referral_enabled: !!referral_enabled,
                    referral_reward_percent: Number(referral_reward_percent || 0),
                    referral_client_discount_percent: Number(referral_client_discount_percent || economics.clientDiscountPercent),
                    referral_welcome_text: referral_welcome_text || null
                }, { onConflict: 'owner_id' });

            if (error && (error.message || '').includes('referral_')) {
                return res.status(400).json({ error: 'Сначала примени SQL для рефералки, потом уже настраивай этот экран.' });
            }

            if (error) throw error;
            res.json({ success: true });
        } catch (error) {
            console.error('Ошибка сохранения referral settings:', error);
            res.status(500).json({ error: 'Ошибка сохранения настроек рефералки' });
        }
    });

    router.post('/payout', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const { tg_user_id, currency, amount, note, payout_request_id } = req.body;

        try {
            const result = await markReferralPayout(ownerId, tg_user_id, currency, amount, note, payout_request_id);
            if (result.error) {
                return res.status(result.status || 400).json({ error: result.error });
            }
            res.json(result);
        } catch (error) {
            console.error('Ошибка payout по рефералке:', error);
            res.status(500).json({ error: 'Ошибка отметки выплаты партнеру' });
        }
    });

    router.post('/payout-batch', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const { payouts, note } = req.body;

        if (!Array.isArray(payouts) || payouts.length === 0) {
            return res.status(400).json({ error: 'Не передали список выплат' });
        }

        try {
            let updated = 0;
            const errors = [];

            for (const payout of payouts) {
                const result = await markReferralPayout(
                    ownerId,
                    payout?.tg_user_id,
                    payout?.currency,
                    payout?.amount,
                    payout?.note || note || null
                );

                if (result.error) {
                    errors.push({
                        tg_user_id: String(payout?.tg_user_id || ''),
                        currency: String(payout?.currency || '').toUpperCase(),
                        error: result.error
                    });
                    continue;
                }

                updated += 1;
            }

            res.json({
                success: true,
                requested: payouts.length,
                updated,
                errors
            });
        } catch (error) {
            console.error('Ошибка batch payout по рефералке:', error);
            res.status(500).json({ error: 'Ошибка пачечной выплаты по рефералке' });
        }
    });

    return router;
}
