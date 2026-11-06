import {
    loadReferralReserveState,
    reconcileReferralReserveAccount
} from '../../services/referral-reserve.service.js';
import { normalizeCurrencyAmount } from './ton-payloads.js';

export const ACTIVE_PAYOUT_REQUEST_STATUSES = ['requested', 'queued', 'sending'];

async function restoreReferralBalance(supabase, profileId, balanceField, expectedBalance, restoreBalance) {
    const { error } = await supabase
        .from('referral_profiles')
        .update({ [balanceField]: restoreBalance })
        .eq('id', profileId)
        .eq(balanceField, expectedBalance);

    return error;
}

async function recordReferralNetworkFee(supabase, ownerId, payoutRequest, networkFeeTon, chainTxHash = null) {
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
        bullgram_fee_accrued_ton: reserve.bullgramFeeTon,
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

export async function markReferralPayout(supabase, officialBotService, ownerId, tgUserId, currency, amount, note, payoutRequestId = null, payoutMeta = {}) {
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

    if (!['TON', 'USDT'].includes(normalizedCurrency)) {
        return { error: 'Выплату можно отметить только в TON или USDT', status: 400 };
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

    // Новые RUB-выплаты заблокированы; balance_rub остаётся только для чтения легаси-балансов на дашборде
    const balanceField = normalizedCurrency === 'TON' ? 'balance_ton' : 'balance_usdt';
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
            const rollbackError = await restoreReferralBalance(supabase, profile.id, balanceField, nextBalance, currentBalance);
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
        const rollbackError = await restoreReferralBalance(supabase, profile.id, balanceField, nextBalance, currentBalance);
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
            networkFeeRecord = await recordReferralNetworkFee(supabase, ownerId, activePayoutRequest, effectiveNetworkFeeTon, effectiveChainTxHash);
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
