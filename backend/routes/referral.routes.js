import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import {
    getReferralEconomics,
    loadReferralReserveState,
    reconcileReferralReserveAccount
} from '../services/referral-reserve.service.js';
import { OfficialBotService } from '../services/official-bot.service.js';

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
        leads: [],
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
    const ACTIVE_PAYOUT_REQUEST_STATUSES = ['requested', 'queued', 'sending'];
    const officialBotService = new OfficialBotService(supabase);

    function normalizeCurrencyAmount(currency, amount) {
        const decimals = currency === 'RUB' ? 2 : 6;
        return Number(Number(amount || 0).toFixed(decimals));
    }

    async function restoreReferralBalance(profileId, balanceField, expectedBalance, restoreBalance) {
        const { error } = await supabase
            .from('referral_profiles')
            .update({ [balanceField]: restoreBalance })
            .eq('id', profileId)
            .eq(balanceField, expectedBalance);

        return error;
    }

    async function recordReferralNetworkFee(ownerId, payoutRequest, networkFeeTon, chainTxHash = null) {
        const feeTon = normalizeCurrencyAmount('TON', networkFeeTon);
        if (!payoutRequest?.id || !Number.isFinite(feeTon) || feeTon <= 0) {
            return null;
        }

        const reserve = await loadReferralReserveState(supabase, ownerId, { ensure: false });
        if (!reserve?.id) {
            return null;
        }

        const { error: ledgerError } = await supabase
            .from('referral_reserve_ledger')
            .insert({
                owner_id: ownerId,
                reserve_account_id: reserve.id,
                entry_type: 'network_fee_reserved',
                amount_ton: feeTon,
                direction: 'debit',
                related_payout_id: payoutRequest.id,
                chain_tx_hash: chainTxHash || null,
                payload: {
                    payout_request_id: payoutRequest.id,
                    tg_user_id: String(payoutRequest.tg_user_id),
                    ton_wallet: payoutRequest.ton_wallet,
                    source: 'manual_payout_marked'
                }
            });

        if (ledgerError) throw ledgerError;

        const reconciled = await reconcileReferralReserveAccount(supabase, {
            id: reserve.id,
            owner_id: ownerId,
            deposit_address: reserve.depositAddress || null,
            minimum_deposit_ton: reserve.minimumDepositTon,
            total_deposited_ton: reserve.totalDepositedTon,
            available_reserve_ton: reserve.availableReserveTon,
            reserved_obligations_ton: reserve.reservedObligationsTon,
            admin_debt_ton: reserve.adminDebtTon,
            bullrun_fee_accrued_ton: reserve.bullrunFeeTon,
            network_fee_accrued_ton: reserve.networkFeeTon,
            locked_until: reserve.lockedUntil || null,
            last_deposit_at: reserve.lastDepositAt || null,
            status: reserve.status
        });

        return {
            feeTon,
            reserveAccountId: reserve.id,
            reserveAccount: reconciled.reserveAccount,
            previousStatus: reconciled.previousStatus,
            statusChanged: reconciled.statusChanged
        };
    }

    async function markReferralPayout(ownerId, tgUserId, currency, amount, note, payoutRequestId = null, payoutMeta = {}) {
        const normalizedCurrency = String(currency || '').toUpperCase();
        const amountNumber = Number(amount || 0);
        const hasChainTxHash = Object.prototype.hasOwnProperty.call(payoutMeta || {}, 'chain_tx_hash');
        const chainTxHash = hasChainTxHash ? String(payoutMeta.chain_tx_hash || '').trim() : '';
        const hasNetworkFeeTon = Object.prototype.hasOwnProperty.call(payoutMeta || {}, 'network_fee_ton')
            && payoutMeta.network_fee_ton !== null
            && payoutMeta.network_fee_ton !== '';
        const networkFeeTon = hasNetworkFeeTon ? normalizeCurrencyAmount('TON', payoutMeta.network_fee_ton) : 0;

        if (!tgUserId) {
            return { error: 'Не передан Telegram ID партнера', status: 400 };
        }

        if (!['RUB', 'TON', 'USDT'].includes(normalizedCurrency)) {
            return { error: 'Выплату можно отметить только в RUB, TON или USDT', status: 400 };
        }

        if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
            return { error: 'Сумма выплаты должна быть больше нуля', status: 400 };
        }

        if (chainTxHash && normalizedCurrency !== 'TON') {
            return { error: 'chain_tx_hash можно указывать только для TON-выплаты', status: 400 };
        }

        if (chainTxHash.length > 256) {
            return { error: 'chain_tx_hash слишком длинный', status: 400 };
        }

        if (hasNetworkFeeTon && normalizedCurrency !== 'TON') {
            return { error: 'network_fee_ton можно указывать только для TON-выплаты', status: 400 };
        }

        if (hasNetworkFeeTon && (!Number.isFinite(networkFeeTon) || networkFeeTon < 0)) {
            return { error: 'network_fee_ton должен быть числом не меньше нуля', status: 400 };
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
                .in('status', ACTIVE_PAYOUT_REQUEST_STATUSES)
                .order('requested_at', { ascending: false })
                .limit(1);

            if (payoutRequestId) {
                requestQuery = supabase
                    .from('referral_partner_payouts')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .eq('tg_user_id', String(tgUserId))
                    .eq('id', payoutRequestId)
                    .in('status', ACTIVE_PAYOUT_REQUEST_STATUSES)
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

            if ((chainTxHash || hasNetworkFeeTon) && !activePayoutRequest) {
                return { error: 'chain_tx_hash и network_fee_ton можно писать только при закрытии TON-заявки', status: 400 };
            }

            if (chainTxHash) {
                const { data: existingHashRows, error: hashError } = await supabase
                    .from('referral_partner_payouts')
                    .select('id')
                    .eq('chain_tx_hash', chainTxHash)
                    .limit(1);

                if (hashError && !(hashError.message || '').includes('referral_partner_payouts')) {
                    throw hashError;
                }

                const existingHash = existingHashRows?.[0] || null;
                if (existingHash && existingHash.id !== activePayoutRequest.id) {
                    return { error: 'Этот chain_tx_hash уже привязан к другой выплате', status: 409 };
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

        const { data: balanceUpdateRows, error: updateError } = await supabase
            .from('referral_profiles')
            .update({ [balanceField]: nextBalance })
            .eq('id', profile.id)
            .eq(balanceField, currentBalance)
            .select('id')
            .limit(1);

        if (updateError) throw updateError;

        if (!balanceUpdateRows?.length) {
            return { error: 'Баланс партнера изменился. Обнови экран и повтори выплату.', status: 409 };
        }

        const effectiveNetworkFeeTon = activePayoutRequest
            ? (hasNetworkFeeTon ? networkFeeTon : normalizeCurrencyAmount('TON', activePayoutRequest.network_fee_ton || 0))
            : 0;
        const effectiveChainTxHash = activePayoutRequest
            ? (chainTxHash || activePayoutRequest.chain_tx_hash || null)
            : null;
        const auditPayload = {
            note: note || null,
            balance_before: currentBalance,
            balance_after: nextBalance,
            payout_request_id: activePayoutRequest?.id || null,
            payout_request_status_before: activePayoutRequest?.status || null,
            payout_request_status_after: activePayoutRequest ? 'sent' : null,
            chain_tx_hash: effectiveChainTxHash,
            network_fee_ton: effectiveNetworkFeeTon,
            manual_payout_path: true
        };

        let updatedPayoutRequest = null;

        if (activePayoutRequest) {
            const { data: requestUpdateRows, error: requestUpdateError } = await supabase
                .from('referral_partner_payouts')
                .update({
                    status: 'sent',
                    sent_at: new Date().toISOString(),
                    failure_reason: null,
                    chain_tx_hash: effectiveChainTxHash,
                    network_fee_ton: effectiveNetworkFeeTon,
                    payload: {
                        ...(activePayoutRequest.payload || {}),
                        settled_by_admin: true,
                        settled_note: note || null,
                        balance_before: currentBalance,
                        balance_after: nextBalance,
                        chain_tx_hash: effectiveChainTxHash,
                        network_fee_ton: effectiveNetworkFeeTon,
                        previous_status: activePayoutRequest.status,
                        next_status: 'sent'
                    }
                })
                .eq('id', activePayoutRequest.id)
                .in('status', ACTIVE_PAYOUT_REQUEST_STATUSES)
                .select('id, status, chain_tx_hash, network_fee_ton')
                .limit(1);

            if (requestUpdateError || !requestUpdateRows?.length) {
                const rollbackError = await restoreReferralBalance(profile.id, balanceField, nextBalance, currentBalance);
                if (rollbackError) {
                    console.error('Ошибка отката баланса referral payout после request failure:', rollbackError);
                }
                if (requestUpdateError) throw requestUpdateError;
                return { error: 'Статус заявки изменился. Обнови экран и повтори выплату.', status: 409 };
            }

            updatedPayoutRequest = requestUpdateRows[0];
        }

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
                network_fee_ton_amount: normalizedCurrency === 'TON' ? effectiveNetworkFeeTon : null,
                payload: auditPayload
            });

        if (eventError) {
            const rollbackError = await restoreReferralBalance(profile.id, balanceField, nextBalance, currentBalance);
            if (rollbackError) {
                console.error('Ошибка отката баланса referral payout после event failure:', rollbackError);
            }
            if (activePayoutRequest && updatedPayoutRequest) {
                const { error: requestRollbackError } = await supabase
                    .from('referral_partner_payouts')
                    .update({
                        status: activePayoutRequest.status,
                        sent_at: activePayoutRequest.sent_at || null,
                        failure_reason: activePayoutRequest.failure_reason || null,
                        chain_tx_hash: activePayoutRequest.chain_tx_hash || null,
                        network_fee_ton: normalizeCurrencyAmount('TON', activePayoutRequest.network_fee_ton || 0),
                        payload: activePayoutRequest.payload || {}
                    })
                    .eq('id', activePayoutRequest.id)
                    .eq('status', 'sent');

                if (requestRollbackError) {
                    console.error('Ошибка отката referral payout request после event failure:', requestRollbackError);
                }
            }
            if ((eventError.message || '').includes('referral_events')) {
                return { error: 'SQL под журнал выплат не применен до конца. Сначала добей базу.', status: 400 };
            }
            throw eventError;
        }

        let networkFeeRecord = null;
        let networkFeeRecordError = null;
        if (activePayoutRequest && effectiveNetworkFeeTon > 0) {
            try {
                networkFeeRecord = await recordReferralNetworkFee(ownerId, activePayoutRequest, effectiveNetworkFeeTon, effectiveChainTxHash);
                if (networkFeeRecord?.statusChanged) {
                    officialBotService.notifyReferralReserveStatus(
                        ownerId,
                        networkFeeRecord.reserveAccount,
                        networkFeeRecord.previousStatus
                    ).catch((notifyError) => {
                        console.error('Ошибка уведомления о referral reserve status:', notifyError.message || notifyError);
                    });
                }
            } catch (error) {
                networkFeeRecordError = 'Комиссия сети сохранена в выплате, но не попала в reserve ledger. Нужно проверить вручную.';
                console.error('Ошибка записи network fee в referral reserve ledger:', error);
            }
        }

        if (activePayoutRequest) {
            officialBotService.notifyReferralPayoutStatus(
                ownerId,
                {
                    ...activePayoutRequest,
                    status: 'sent',
                    chain_tx_hash: effectiveChainTxHash,
                    network_fee_ton: effectiveNetworkFeeTon
                },
                'sent',
                {
                    chainTxHash: effectiveChainTxHash,
                    networkFeeTon: effectiveNetworkFeeTon,
                    note
                }
            ).catch((notifyError) => {
                console.error('Ошибка уведомления о referral payout sent:', notifyError.message || notifyError);
            });
        }

        return {
            success: true,
            tg_user_id: String(tgUserId),
            currency: normalizedCurrency,
            amount: normalizedAmount,
            balance_after: nextBalance,
            payout_request_id: activePayoutRequest?.id || null,
            chain_tx_hash: effectiveChainTxHash,
            network_fee_ton: effectiveNetworkFeeTon,
            network_fee_recorded: !!networkFeeRecord,
            warning: networkFeeRecordError
        };
    }

    async function updateReferralPayoutRequestStatus(ownerId, payoutRequestId, nextStatus, note = null) {
        const normalizedStatus = String(nextStatus || '').trim().toLowerCase();
        const allowedStatuses = new Set(['queued', 'sending', 'failed', 'cancelled']);

        if (!payoutRequestId) {
            return { error: 'Не передан ID заявки на выплату', status: 400 };
        }

        if (!allowedStatuses.has(normalizedStatus)) {
            return { error: 'Заявку можно перевести только в queued, sending, failed или cancelled. Sent закрывается через выплату.', status: 400 };
        }

        const { data: request, error: requestError } = await supabase
            .from('referral_partner_payouts')
            .select('*')
            .eq('id', payoutRequestId)
            .eq('owner_id', ownerId)
            .maybeSingle();

        if (requestError) {
            if ((requestError.message || '').includes('referral_partner_payouts')) {
                return { error: 'SQL под заявки на выплаты еще не применен.', status: 400 };
            }
            throw requestError;
        }

        if (!request) {
            return { error: 'Заявка на выплату не найдена', status: 404 };
        }

        if (!ACTIVE_PAYOUT_REQUEST_STATUSES.includes(String(request.status))) {
            return { error: `Заявка уже в статусе ${request.status}`, status: 400 };
        }

        const now = new Date().toISOString();
        const updatePayload = {
            status: normalizedStatus,
            failure_reason: normalizedStatus === 'failed' ? (note || 'Админ отметил ошибку выплаты') : null,
            payload: {
                ...(request.payload || {}),
                manual_status: normalizedStatus,
                manual_status_note: note || null,
                manual_status_updated_at: now
            }
        };

        if (normalizedStatus === 'failed') {
            updatePayload.failed_at = now;
        }

        const { data: statusUpdateRows, error: updateError } = await supabase
            .from('referral_partner_payouts')
            .update(updatePayload)
            .eq('id', request.id)
            .eq('owner_id', ownerId)
            .in('status', ACTIVE_PAYOUT_REQUEST_STATUSES)
            .select('id')
            .limit(1);

        if (updateError) throw updateError;

        if (!statusUpdateRows?.length) {
            return { error: 'Статус заявки изменился. Обнови экран и повтори действие.', status: 409 };
        }

        const { error: eventError } = await supabase
            .from('referral_events')
            .insert({
                owner_id: ownerId,
                referrer_tg_user_id: String(request.tg_user_id),
                referred_tg_user_id: null,
                invoice_id: null,
                tariff_id: null,
                event_type: `payout_request_${normalizedStatus}`,
                status: 'completed',
                reward_amount: Number(request.amount_ton || 0),
                reward_currency: 'TON',
                payload: {
                    payout_request_id: request.id,
                    previous_status: request.status,
                    next_status: normalizedStatus,
                    manual_lifecycle_event: true,
                    amount_ton: Number(request.amount_ton || 0),
                    network_fee_ton: Number(request.network_fee_ton || 0),
                    chain_tx_hash: request.chain_tx_hash || null,
                    ton_wallet: request.ton_wallet,
                    note: note || null
                }
            });

        if (eventError && !(eventError.message || '').includes('referral_events')) {
            throw eventError;
        }

        officialBotService.notifyReferralPayoutStatus(
            ownerId,
            { ...request, status: normalizedStatus },
            normalizedStatus,
            { note }
        ).catch((notifyError) => {
            console.error('Ошибка уведомления о referral payout status:', notifyError.message || notifyError);
        });

        return {
            success: true,
            payout_request_id: request.id,
            tg_user_id: String(request.tg_user_id),
            status: normalizedStatus
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
                    pending_payout_sent_at: pendingPayout?.sent_at || null,
                    pending_payout_chain_tx_hash: pendingPayout?.chain_tx_hash || null,
                    pending_payout_network_fee_ton: pendingPayout ? Number(pendingPayout.network_fee_ton.toFixed(6)) : 0,
                    latest_payout_status: latestPayout?.status || null,
                    latest_payout_requested_at: latestPayout?.requested_at || null,
                    latest_payout_sent_at: latestPayout?.sent_at || null,
                    latest_payout_chain_tx_hash: latestPayout?.chain_tx_hash || null,
                    latest_payout_network_fee_ton: latestPayout ? normalizeCurrencyAmount('TON', latestPayout.network_fee_ton || 0) : 0
                };
            });

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
        const { tg_user_id, currency, amount, note, payout_request_id, chain_tx_hash, network_fee_ton } = req.body;

        try {
            const result = await markReferralPayout(ownerId, tg_user_id, currency, amount, note, payout_request_id, {
                chain_tx_hash,
                network_fee_ton
            });
            if (result.error) {
                return res.status(result.status || 400).json({ error: result.error });
            }
            res.json(result);
        } catch (error) {
            console.error('Ошибка payout по рефералке:', error);
            res.status(500).json({ error: 'Ошибка отметки выплаты партнеру' });
        }
    });

    router.post('/payout-request-status', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const { payout_request_id, status, note, chain_tx_hash, network_fee_ton } = req.body;

        if (chain_tx_hash || network_fee_ton !== undefined) {
            return res.status(400).json({
                error: 'chain_tx_hash и network_fee_ton пишутся только через ручную отметку выплаты, не через смену статуса.'
            });
        }

        try {
            const result = await updateReferralPayoutRequestStatus(ownerId, payout_request_id, status, note);
            if (result.error) {
                return res.status(result.status || 400).json({ error: result.error });
            }
            res.json(result);
        } catch (error) {
            console.error('Ошибка статуса referral payout request:', error);
            res.status(500).json({ error: 'Ошибка обновления статуса заявки на выплату' });
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
                    payout?.note || note || null,
                    payout?.payout_request_id || null,
                    {
                        chain_tx_hash: payout?.chain_tx_hash,
                        network_fee_ton: payout?.network_fee_ton
                    }
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
