import { authenticateUser } from '../../middlewares/auth.middleware.js';
import {
    getReferralEconomics,
    loadReferralReserveState
} from '../../services/referral-reserve.service.js';
import {
    addPayoutPaymentPayload,
    enrichReserveDepositPayload,
    enrichReserveRefundPayload,
    normalizeCurrencyAmount,
    normalizeTonWallet
} from './ton-payloads.js';
import { ACTIVE_PAYOUT_REQUEST_STATUSES } from './payout-ops.js';
import { createEmptyResponse } from './create-empty-response.js';

export function registerOverviewRoute(router, { supabase }) {
    router.get('/', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const payload = createEmptyResponse();

        try {
            payload.reserve = await enrichReserveDepositPayload(
                await enrichReserveRefundPayload(
                    supabase,
                    ownerId,
                    await loadReferralReserveState(supabase, ownerId, { ensure: true })
                )
            );
            payload.economics = payload.reserve?.economics || getReferralEconomics();

            const [settingsResp, profilesResp, attributionsResp, eventsResp, payoutMethodsResp, payoutsResp] = await Promise.all([
                supabase
                    .from('payment_settings')
                    .select('referral_enabled, referral_reward_percent, referral_welcome_text, referral_client_discount_percent, ton_wallet, admin_tg_id')
                    .eq('owner_id', ownerId)
                    .maybeSingle(),
                supabase
                    .from('referral_profiles')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    // Полная пагинация справочников — отдельная задача, пока страховочный лимит.
                    .limit(500),
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
                    .eq('owner_id', ownerId)
                    // Полная пагинация справочников — отдельная задача, пока страховочный лимит.
                    .limit(500),
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
            payload.reserve = payload.reserve
                ? {
                    ...payload.reserve,
                    defaultRefundWallet: normalizeTonWallet(settingsResp.data?.ton_wallet || '') || null
                }
                : payload.reserve;

            const profiles = profilesResp.data || [];
            const attributions = attributionsResp.data || [];
            const events = eventsResp.data || [];
            const payoutMethods = payoutMethodsResp.data || [];
            const payouts = payoutsResp.data || [];
            const completedRewards = events.filter(event => event.event_type === 'reward_granted' && event.status === 'completed');
            const adminTgId = settingsResp.data?.admin_tg_id ? String(settingsResp.data.admin_tg_id) : '';

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
                if (ACTIVE_PAYOUT_REQUEST_STATUSES.includes(String(payout.status))) {
                    const current = pendingPayoutByReferrer.get(key);
                    const currentNetworkFeeTon = Number(current?.network_fee_ton || 0);
                    const payoutNetworkFeeTon = Number(payout.network_fee_ton || 0);
                    pendingPayoutByReferrer.set(key, {
                        id: current?.id || payout.id,
                        count: Number(current?.count || 0) + 1,
                        amount_ton: Number(current?.amount_ton || 0) + Number(payout.amount_ton || 0),
                        network_fee_ton: currentNetworkFeeTon + payoutNetworkFeeTon,
                        status: current?.status || payout.status,
                        ton_wallet: current?.ton_wallet || payout.ton_wallet,
                        chain_tx_hash: current?.chain_tx_hash || payout.chain_tx_hash || null,
                        requested_at: current?.requested_at || payout.requested_at,
                        sent_at: current?.sent_at || payout.sent_at || null
                    });
                }
            }

            const attributionsByReferrer = new Map();
            for (const attribution of attributions) {
                const key = String(attribution.referrer_tg_user_id);
                attributionsByReferrer.set(key, Number(attributionsByReferrer.get(key) || 0) + 1);
            }

            const allPartnerRows = profiles.map(profile => {
                const tgUserId = String(profile.tg_user_id);
                const profileEvents = eventsByReferrer.get(tgUserId) || [];
                const payoutMethod = payoutMethodByReferrer.get(tgUserId) || null;
                const pendingPayout = pendingPayoutByReferrer.get(tgUserId) || null;
                const latestPayout = latestPayoutByReferrer.get(tgUserId) || null;
                const attributedLeads = Number(attributionsByReferrer.get(tgUserId) || 0);
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
                const hasReferralHistory = (
                    attributedLeads > 0 ||
                    profileEvents.length > 0 ||
                    !!payoutMethod ||
                    !!latestPayout ||
                    totalEarnedRub > 0 ||
                    totalEarnedTon > 0 ||
                    totalEarnedUsdt > 0 ||
                    balanceRub > 0 ||
                    balanceTon > 0 ||
                    balanceUsdt > 0
                );

                return {
                    tg_user_id: tgUserId,
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
                    attributed_leads: attributedLeads,
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
                    pending_payout_sent_at: pendingPayout?.sent_at || null,
                    pending_payout_chain_tx_hash: pendingPayout?.chain_tx_hash || null,
                    pending_payout_network_fee_ton: pendingPayout ? Number(pendingPayout.network_fee_ton.toFixed(6)) : 0,
                    latest_payout_status: latestPayout?.status || null,
                    latest_payout_requested_at: latestPayout?.requested_at || null,
                    latest_payout_sent_at: latestPayout?.sent_at || null,
                    latest_payout_chain_tx_hash: latestPayout?.chain_tx_hash || null,
                    latest_payout_network_fee_ton: latestPayout ? normalizeCurrencyAmount('TON', latestPayout.network_fee_ton || 0) : 0,
                    hidden_self_profile: !!adminTgId && tgUserId === adminTgId && !hasReferralHistory
                };
            });

            const visiblePartnerRows = allPartnerRows.filter(partner => !partner.hidden_self_profile);

            const partnerByTgId = new Map(
                allPartnerRows.map(partner => [String(partner.tg_user_id), partner])
            );

            const rewardEventByInvoiceId = new Map();
            const rewardEventByReferredId = new Map();
            for (const event of completedRewards) {
                if (event.invoice_id && !rewardEventByInvoiceId.has(String(event.invoice_id))) {
                    rewardEventByInvoiceId.set(String(event.invoice_id), event);
                }
                if (event.referred_tg_user_id && !rewardEventByReferredId.has(String(event.referred_tg_user_id))) {
                    rewardEventByReferredId.set(String(event.referred_tg_user_id), event);
                }
            }

            payload.leads = attributions.map(attribution => {
                const partner = partnerByTgId.get(String(attribution.referrer_tg_user_id)) || null;
                const rewardEvent = attribution.paid_invoice_id
                    ? rewardEventByInvoiceId.get(String(attribution.paid_invoice_id))
                    : rewardEventByReferredId.get(String(attribution.referred_tg_user_id));
                const expiresAt = attribution.expires_at || null;
                const isExpired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
                const converted = !!(attribution.converted_at || attribution.paid_invoice_id);

                return {
                    id: attribution.id,
                    referred_tg_user_id: String(attribution.referred_tg_user_id),
                    referred_username: attribution.referred_username || null,
                    referred_display_name: attribution.referred_display_name || null,
                    referrer_tg_user_id: String(attribution.referrer_tg_user_id),
                    referrer_username: partner?.username || null,
                    referrer_display_name: partner?.display_name || null,
                    referral_code: attribution.referral_code || partner?.referral_code || null,
                    first_seen_at: attribution.first_seen_at || attribution.created_at || null,
                    last_seen_at: attribution.last_seen_at || null,
                    expires_at: expiresAt,
                    converted_at: attribution.converted_at || null,
                    paid_invoice_id: attribution.paid_invoice_id || null,
                    terms_status: attribution.terms_status || 'active',
                    discount_eligible: !!attribution.discount_eligible && !isExpired,
                    expired: isExpired,
                    converted,
                    reward_percent_snapshot: attribution.reward_percent_snapshot,
                    client_discount_percent_snapshot: attribution.client_discount_percent_snapshot,
                    reserve_status_snapshot: attribution.reserve_status_snapshot || null,
                    reward_status: rewardEvent?.status || null,
                    reward_amount: rewardEvent?.reward_amount || null,
                    reward_currency: rewardEvent?.reward_currency || null,
                    reward_ton_amount: rewardEvent?.reward_ton_amount || null,
                    reserve_coverage_status: rewardEvent?.reserve_coverage_status || null
                };
            });

            const topPartners = [...visiblePartnerRows].sort((a, b) => {
                const bPending = Number(b.pending_payout_ton || 0) > 0 ? 1 : 0;
                const aPending = Number(a.pending_payout_ton || 0) > 0 ? 1 : 0;
                if (bPending !== aPending) return bPending - aPending;
                const bTotal = b.earnedRub + b.earnedTon + b.earnedUsdt;
                const aTotal = a.earnedRub + a.earnedTon + a.earnedUsdt;
                return bTotal - aTotal;
            });

            payload.pendingPayouts = await Promise.all(
                topPartners
                    .filter(row => Number(row.pending_payout_ton || 0) > 0)
                    .map(addPayoutPaymentPayload)
            );

            payload.summary = {
                partners: visiblePartnerRows.length,
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
}
