import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';

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
        recentEvents: [],
        support: {
            referralTables: true,
            referralSettings: true
        }
    };
}

export default function referralRoutes(supabase) {
    const router = express.Router();

    async function markReferralPayout(ownerId, tgUserId, currency, amount, note) {
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
        const normalizedAmount = normalizedCurrency === 'RUB'
            ? Number(amountNumber.toFixed(2))
            : Number(amountNumber.toFixed(4));

        if (normalizedAmount > currentBalance) {
            return {
                error: `Нельзя списать ${normalizedAmount} ${normalizedCurrency}, на балансе только ${currentBalance}`,
                status: 400
            };
        }

        const nextBalance = Number((currentBalance - normalizedAmount).toFixed(normalizedCurrency === 'RUB' ? 2 : 4));

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
                    balance_after: nextBalance
                }
            });

        if (eventError) {
            if ((eventError.message || '').includes('referral_events')) {
                return { error: 'SQL под журнал выплат не применен до конца. Сначала добей базу.', status: 400 };
            }
            throw eventError;
        }

        return {
            success: true,
            tg_user_id: String(tgUserId),
            currency: normalizedCurrency,
            amount: normalizedAmount,
            balance_after: nextBalance
        };
    }

    router.get('/', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const payload = createEmptyResponse();

        try {
            const [settingsResp, profilesResp, attributionsResp, eventsResp] = await Promise.all([
                supabase
                    .from('payment_settings')
                    .select('referral_enabled, referral_reward_percent, referral_welcome_text')
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
                    .limit(300)
            ]);

            if (settingsResp.error) {
                if ((settingsResp.error.message || '').includes('referral_')) {
                    payload.support.referralSettings = false;
                } else {
                    throw settingsResp.error;
                }
            }

            if (profilesResp.error || attributionsResp.error || eventsResp.error) {
                const joinedError = [
                    profilesResp.error?.message || '',
                    attributionsResp.error?.message || '',
                    eventsResp.error?.message || ''
                ].join(' ');

                if (joinedError.includes('referral_profiles') || joinedError.includes('referral_attributions') || joinedError.includes('referral_events')) {
                    payload.support.referralTables = false;
                    return res.json(payload);
                }

                throw profilesResp.error || attributionsResp.error || eventsResp.error;
            }

            payload.settings = {
                referral_enabled: settingsResp.data?.referral_enabled ?? false,
                referral_reward_percent: Number(settingsResp.data?.referral_reward_percent ?? 20),
                referral_welcome_text: settingsResp.data?.referral_welcome_text || ''
            };

            const profiles = profilesResp.data || [];
            const attributions = attributionsResp.data || [];
            const events = eventsResp.data || [];
            const completedRewards = events.filter(event => event.event_type === 'reward_granted' && event.status === 'completed');

            const eventsByReferrer = new Map();
            for (const event of events) {
                const key = String(event.referrer_tg_user_id);
                const bucket = eventsByReferrer.get(key) || [];
                bucket.push(event);
                eventsByReferrer.set(key, bucket);
            }

            const topPartners = profiles.map(profile => {
                const profileEvents = eventsByReferrer.get(String(profile.tg_user_id)) || [];
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
                    earnedUsdt
                };
            }).sort((a, b) => {
                const bTotal = b.earnedRub + b.earnedTon + b.earnedUsdt;
                const aTotal = a.earnedRub + a.earnedTon + a.earnedUsdt;
                return bTotal - aTotal;
            }).slice(0, 20);

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
            referral_welcome_text
        } = req.body;

        try {
            let { error } = await supabase
                .from('payment_settings')
                .upsert({
                    owner_id: ownerId,
                    referral_enabled: !!referral_enabled,
                    referral_reward_percent: Number(referral_reward_percent || 0),
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
        const { tg_user_id, currency, amount, note } = req.body;

        try {
            const result = await markReferralPayout(ownerId, tg_user_id, currency, amount, note);
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
