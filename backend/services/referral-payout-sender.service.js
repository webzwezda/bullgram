import { OfficialBotService } from './official-bot.service.js';
import { reconcileReferralReserveAccount, loadReferralReserveState } from './referral-reserve.service.js';
import { getTonReserveSenderConfig, sendTonFromReserve } from './ton-reserve-sender.service.js';

const ACTIVE_PAYOUT_STATUSES = ['requested', 'queued', 'sending'];
const DEFAULT_MAX_AUTO_PAYOUT_TON = 25;

function envNumber(name, fallback, options = {}) {
    const parsed = Number(process.env[name] || fallback);
    if (!Number.isFinite(parsed)) return fallback;
    if (options.min !== undefined && parsed < options.min) return fallback;
    if (options.max !== undefined && parsed > options.max) return options.max;
    return parsed;
}

function normalizeTonAmount(value) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Number(parsed.toFixed(6));
}

function buildPayoutMemo(payoutRequest) {
    return `brp_${String(payoutRequest?.id || '').replace(/-/g, '').slice(0, 24)}`;
}

export function getReferralPayoutSenderSafetyConfig() {
    return {
        maxAutoPayoutTon: normalizeTonAmount(
            envNumber('REFERRAL_PAYOUT_SENDER_MAX_AMOUNT_TON', DEFAULT_MAX_AUTO_PAYOUT_TON, { min: 0.000001 })
        )
    };
}

async function recordNetworkFee(supabase, ownerId, payoutRequest, networkFeeTon, transferRef) {
    const feeTon = normalizeTonAmount(networkFeeTon);
    if (!payoutRequest?.id || feeTon <= 0) return null;

    const reserve = await loadReferralReserveState(supabase, ownerId, { ensure: false });
    if (!reserve?.id) return null;

    const { error: ledgerError } = await supabase
        .from('referral_reserve_ledger')
        .insert({
            owner_id: ownerId,
            reserve_account_id: reserve.id,
            entry_type: 'network_fee_reserved',
            amount_ton: feeTon,
            direction: 'debit',
            related_payout_id: payoutRequest.id,
            chain_tx_hash: transferRef || null,
            payload: {
                payout_request_id: payoutRequest.id,
                tg_user_id: String(payoutRequest.tg_user_id),
                ton_wallet: payoutRequest.ton_wallet,
                source: 'automatic_payout_sender'
            }
        });

    if (ledgerError) throw ledgerError;

    const synced = await reconcileReferralReserveAccount(supabase, {
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
        reserveAccount: synced.reserveAccount,
        previousStatus: synced.previousStatus,
        statusChanged: synced.statusChanged
    };
}

async function leavePayoutInSendingWithError(supabase, payoutRequest, error, meta = {}) {
    await supabase
        .from('referral_partner_payouts')
        .update({
            failure_reason: String(error?.message || error || 'automatic sender error').slice(0, 500),
            payload: {
                ...(payoutRequest.payload || {}),
                auto_sender: {
                    ...(payoutRequest.payload?.auto_sender || {}),
                    ...meta,
                    last_error: String(error?.message || error || 'automatic sender error').slice(0, 500),
                    error_at: new Date().toISOString()
                }
            }
        })
        .eq('id', payoutRequest.id)
        .eq('status', 'sending');
}

export async function sendReferralPayoutRequest(supabase, ownerId, payoutRequestId, options = {}) {
    const officialBotService = new OfficialBotService(supabase);
    const config = getTonReserveSenderConfig();
    if (!config.enabled) {
        return { error: 'Автоматический sender выключен.', status: 400 };
    }

    if (!payoutRequestId) {
        return { error: 'Не передан ID заявки на выплату.', status: 400 };
    }

    const { data: request, error: requestError } = await supabase
        .from('referral_partner_payouts')
        .select('*')
        .eq('id', payoutRequestId)
        .eq('owner_id', ownerId)
        .maybeSingle();

    if (requestError) throw requestError;
    if (!request) return { error: 'Заявка на выплату не найдена.', status: 404 };
    if (!ACTIVE_PAYOUT_STATUSES.includes(String(request.status))) {
        return { error: `Заявка уже в статусе ${request.status}.`, status: 400 };
    }
    if (!request.ton_wallet) {
        return { error: 'У заявки нет TON-кошелька.', status: 400 };
    }

    const amountTon = normalizeTonAmount(request.amount_ton);
    if (amountTon <= 0) return { error: 'Сумма выплаты должна быть больше нуля.', status: 400 };

    const { maxAutoPayoutTon } = getReferralPayoutSenderSafetyConfig();
    if (maxAutoPayoutTon > 0 && amountTon > maxAutoPayoutTon) {
        return {
            error: `Автоматическая выплата ограничена ${maxAutoPayoutTon} TON за одну заявку. Выплати вручную или измени REFERRAL_PAYOUT_SENDER_MAX_AMOUNT_TON.`,
            status: 400
        };
    }

    const { data: profile, error: profileError } = await supabase
        .from('referral_profiles')
        .select('*')
        .eq('owner_id', ownerId)
        .eq('tg_user_id', String(request.tg_user_id))
        .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) return { error: 'Партнер не найден.', status: 404 };

    const currentBalanceTon = normalizeTonAmount(profile.balance_ton);
    if (amountTon > currentBalanceTon) {
        return { error: `На балансе партнера только ${currentBalanceTon} TON.`, status: 400 };
    }

    const memo = buildPayoutMemo(request);
    const now = new Date().toISOString();
    const { data: sendingRows, error: sendingError } = await supabase
        .from('referral_partner_payouts')
        .update({
            status: 'sending',
            failure_reason: null,
            payload: {
                ...(request.payload || {}),
                auto_sender: {
                    requested_by: options.requestedBy || 'job',
                    memo,
                    started_at: now,
                    status_before: request.status
                }
            }
        })
        .eq('id', request.id)
        .eq('owner_id', ownerId)
        .in('status', ACTIVE_PAYOUT_STATUSES)
        .select('*')
        .limit(1);

    if (sendingError) throw sendingError;
    const sendingRequest = sendingRows?.[0] || null;
    if (!sendingRequest) {
        return { error: 'Статус заявки изменился. Обнови очередь выплат.', status: 409 };
    }

    let transfer;
    try {
        transfer = await sendTonFromReserve({
            to: request.ton_wallet,
            amountTon,
            comment: memo
        });
    } catch (error) {
        await leavePayoutInSendingWithError(supabase, sendingRequest, error, { memo });
        throw error;
    }

    const nextBalanceTon = normalizeTonAmount(currentBalanceTon - amountTon);
    const { data: balanceRows, error: balanceError } = await supabase
        .from('referral_profiles')
        .update({ balance_ton: nextBalanceTon })
        .eq('id', profile.id)
        .eq('balance_ton', currentBalanceTon)
        .select('id')
        .limit(1);

    if (balanceError) {
        await leavePayoutInSendingWithError(supabase, sendingRequest, balanceError, transfer);
        throw balanceError;
    }
    if (!balanceRows?.length) {
        const error = new Error('Баланс партнера изменился после отправки TON. Нужна ручная сверка.');
        await leavePayoutInSendingWithError(supabase, sendingRequest, error, transfer);
        return { error: error.message, status: 409, transfer };
    }

    const networkFeeTon = normalizeTonAmount(transfer.estimatedNetworkFeeTon);
    const { data: sentRows, error: sentError } = await supabase
        .from('referral_partner_payouts')
        .update({
            status: 'sent',
            sent_at: transfer.sentAt,
            failed_at: null,
            failure_reason: null,
            chain_tx_hash: transfer.transferRef,
            network_fee_ton: networkFeeTon,
            payload: {
                ...(sendingRequest.payload || {}),
                auto_sender: {
                    ...(sendingRequest.payload?.auto_sender || {}),
                    completed_at: new Date().toISOString(),
                    wallet_address: transfer.walletAddress,
                    seqno: transfer.seqno,
                    memo,
                    transfer_ref: transfer.transferRef
                }
            }
        })
        .eq('id', request.id)
        .eq('owner_id', ownerId)
        .eq('status', 'sending')
        .select('*')
        .limit(1);

    if (sentError) {
        await leavePayoutInSendingWithError(supabase, sendingRequest, sentError, transfer);
        throw sentError;
    }
    if (!sentRows?.length) {
        const error = new Error('TON отправлен, но статус заявки не закрылся. Нужна ручная сверка.');
        await leavePayoutInSendingWithError(supabase, sendingRequest, error, transfer);
        return { error: error.message, status: 409, transfer };
    }

    const sentRequest = sentRows[0];
    const { error: eventError } = await supabase
        .from('referral_events')
        .insert({
            owner_id: ownerId,
            referrer_tg_user_id: String(request.tg_user_id),
            referred_tg_user_id: null,
            invoice_id: null,
            tariff_id: null,
            event_type: 'payout_marked',
            status: 'completed',
            reward_amount: amountTon,
            reward_currency: 'TON',
            network_fee_ton_amount: networkFeeTon,
            payload: {
                payout_request_id: request.id,
                automatic_sender: true,
                balance_before: currentBalanceTon,
                balance_after: nextBalanceTon,
                chain_tx_hash: transfer.transferRef,
                network_fee_ton: networkFeeTon,
                memo,
                wallet_address: transfer.walletAddress,
                seqno: transfer.seqno
            }
        });

    if (eventError && !(eventError.message || '').includes('referral_events')) {
        console.error('Ошибка записи referral auto payout event:', eventError);
    }

    try {
        const networkFeeRecord = await recordNetworkFee(supabase, ownerId, sentRequest, networkFeeTon, transfer.transferRef);
        if (networkFeeRecord?.statusChanged) {
            officialBotService.notifyReferralReserveStatus(
                ownerId,
                networkFeeRecord.reserveAccount,
                networkFeeRecord.previousStatus
            ).catch((notifyError) => {
                console.error('Ошибка уведомления reserve status после auto payout:', notifyError.message || notifyError);
            });
        }
    } catch (error) {
        console.error('Ошибка записи network fee после auto payout:', error);
    }

    officialBotService.notifyReferralPayoutStatus(ownerId, sentRequest, 'sent', {
        chainTxHash: transfer.transferRef,
        networkFeeTon,
        note: 'Автоматическая TON-выплата'
    }).catch((notifyError) => {
        console.error('Ошибка уведомления auto payout sent:', notifyError.message || notifyError);
    });

    return {
        success: true,
        payout_request_id: request.id,
        tg_user_id: String(request.tg_user_id),
        amount_ton: amountTon,
        chain_tx_hash: transfer.transferRef,
        network_fee_ton: networkFeeTon,
        balance_after: nextBalanceTon
    };
}

export async function processReferralPayoutSenderBatch(supabase, options = {}) {
    const config = getTonReserveSenderConfig();
    if (!config.enabled) return { skipped: true, reason: 'disabled' };

    const { maxAutoPayoutTon } = getReferralPayoutSenderSafetyConfig();
    const limit = Number(options.limit || process.env.REFERRAL_PAYOUT_SENDER_BATCH_LIMIT || 5);
    let requestQuery = supabase
        .from('referral_partner_payouts')
        .select('id, owner_id, amount_ton')
        .in('status', ['requested', 'queued'])
        .order('requested_at', { ascending: true });

    if (maxAutoPayoutTon > 0) {
        requestQuery = requestQuery.lte('amount_ton', maxAutoPayoutTon);
    }

    const { data: requests, error } = await requestQuery.limit(Number.isFinite(limit) && limit > 0 ? limit : 5);

    if (error) throw error;

    const results = [];
    for (const request of requests || []) {
        try {
            const result = await sendReferralPayoutRequest(supabase, request.owner_id, request.id, {
                requestedBy: 'job'
            });
            results.push({ id: request.id, ...result });
        } catch (error) {
            console.error('[ReferralPayoutSender] payout send failed:', request.id, error.message || error);
            results.push({ id: request.id, success: false, error: error.message || String(error) });
        }
    }

    return {
        processed: results.length,
        results
    };
}
