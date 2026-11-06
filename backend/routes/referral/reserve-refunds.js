import {
    loadReferralReserveState,
    reconcileReferralReserveAccount
} from '../../services/referral-reserve.service.js';
import {
    normalizeCurrencyAmount,
    buildReserveRefundMemo,
    normalizeTonWallet,
    looksLikeTonWallet,
    getReserveAccountByOwner
} from './ton-payloads.js';
import { ACTIVE_PAYOUT_REQUEST_STATUSES } from './payout-ops.js';

async function getPaymentTonWallet(supabase, ownerId) {
    const { data, error } = await supabase
        .from('payment_settings')
        .select('ton_wallet')
        .eq('owner_id', ownerId)
        .maybeSingle();

    if (error) {
        if ((error.message || '').includes('payment_settings')) return null;
        throw error;
    }

    return normalizeTonWallet(data?.ton_wallet || '');
}

export async function requestReserveRefund(supabase, officialBotService, ownerId, note = null, refundWallet = null) {
    const normalizedRefundWallet = normalizeTonWallet(refundWallet) || await getPaymentTonWallet(supabase, ownerId);
    if (!looksLikeTonWallet(normalizedRefundWallet)) {
        return { error: 'В app/payments нужен TON-кошелек для возврата депозита.', status: 400 };
    }

    const reserve = await loadReferralReserveState(supabase, ownerId, { ensure: true });
    if (!reserve.supported || !reserve.id) {
        return { error: 'Резерв еще не создан.', status: 400 };
    }

    if (!reserve.canRequestRefund) {
        return { error: 'Депозит еще в локе. Возврат доступен только после 30 дней.', status: 400 };
    }

    if (['refund_requested', 'refund_completed'].includes(reserve.status)) {
        return { error: 'Возврат уже запрошен или завершен.', status: 400 };
    }

    const amountTon = normalizeCurrencyAmount('TON', reserve.refundableTon);
    const networkFeeTon = normalizeCurrencyAmount('TON', reserve.refundNetworkFeeTon || 0);
    if (!Number.isFinite(amountTon) || amountTon <= 0) {
        return { error: 'Свободного резерва для возврата нет после комиссии сети.', status: 400 };
    }

    const account = await getReserveAccountByOwner(supabase, ownerId);
    if (!account) {
        return { error: 'Резерв не найден.', status: 404 };
    }

    const now = new Date().toISOString();
    const refundMemo = buildReserveRefundMemo(reserve.id);
    const { error: ledgerError } = await supabase
        .from('referral_reserve_ledger')
        .insert({
            owner_id: ownerId,
            reserve_account_id: reserve.id,
            entry_type: 'admin_refund_requested',
            amount_ton: amountTon,
            direction: 'debit',
            payload: {
                note: note || null,
                refund_wallet: normalizedRefundWallet,
                refund_memo: refundMemo,
                requested_at: now,
                gross_refundable_ton: reserve.grossRefundableTon,
                network_fee_ton: networkFeeTon,
                available_reserve_ton: reserve.availableReserveTon,
                reserved_obligations_ton: reserve.reservedObligationsTon,
                admin_debt_ton: reserve.adminDebtTon
            }
        });

    if (ledgerError) throw ledgerError;

    if (networkFeeTon > 0) {
        const { error: feeLedgerError } = await supabase
            .from('referral_reserve_ledger')
            .insert({
                owner_id: ownerId,
                reserve_account_id: reserve.id,
                entry_type: 'network_fee_reserved',
                amount_ton: networkFeeTon,
                direction: 'debit',
                payload: {
                    source: 'admin_refund_requested',
                    refund_memo: refundMemo,
                    requested_at: now
                }
            });

        if (feeLedgerError) throw feeLedgerError;
    }

    const nextPayload = {
        ...(account.payload || {}),
        refund_request: {
            amount_ton: amountTon,
            refund_wallet: normalizedRefundWallet,
            refund_memo: refundMemo,
            gross_refundable_ton: reserve.grossRefundableTon,
            network_fee_ton: networkFeeTon,
            note: note || null,
            requested_at: now
        }
    };

    const { data: updatedAccount, error: updateError } = await supabase
        .from('referral_reserve_accounts')
        .update({
            status: 'refund_requested',
            payload: nextPayload,
            updated_at: now
        })
        .eq('id', reserve.id)
        .eq('owner_id', ownerId)
        .select('*')
        .single();

    if (updateError) throw updateError;

    officialBotService.notifyReferralReserveRefund(ownerId, { amountTon }, 'requested').catch((notifyError) => {
        console.error('Ошибка уведомления о referral reserve refund request:', notifyError.message || notifyError);
    });

    return {
        success: true,
        amount_ton: amountTon,
        reserve: {
            ...reserve,
            status: updatedAccount.status,
            statusLabel: 'Возврат запрошен',
            canAcceptNewPartners: false,
            refundableTon: 0,
            refundRequestedTon: amountTon,
            refundNetworkFeeTon: networkFeeTon,
            refundWallet: normalizedRefundWallet,
            refundMemo
        }
    };
}

export async function cancelReserveRefund(supabase, ownerId, note = null) {
    const reserve = await loadReferralReserveState(supabase, ownerId, { ensure: true });
    if (!reserve.supported || !reserve.id) {
        return { error: 'Резерв еще не создан.', status: 400 };
    }

    if (reserve.status !== 'refund_requested') {
        return { error: 'Активной заявки на возврат нет.', status: 400 };
    }

    const amountTon = normalizeCurrencyAmount('TON', reserve.refundRequestedTon);
    if (!Number.isFinite(amountTon) || amountTon <= 0) {
        return { error: 'Сумма заявки на возврат не найдена.', status: 400 };
    }

    const account = await getReserveAccountByOwner(supabase, ownerId);
    if (!account) {
        return { error: 'Резерв не найден.', status: 404 };
    }

    const now = new Date().toISOString();
    const refundRequest = account.payload?.refund_request || {};
    const networkFeeTon = normalizeCurrencyAmount('TON', refundRequest.network_fee_ton || 0);
    const { error: ledgerError } = await supabase
        .from('referral_reserve_ledger')
        .insert({
            owner_id: ownerId,
            reserve_account_id: reserve.id,
            entry_type: 'admin_refund_cancelled',
            amount_ton: amountTon,
            direction: 'credit',
            payload: {
                note: note || null,
                cancelled_at: now,
                previous_refund_request: refundRequest
            }
        });

    if (ledgerError) throw ledgerError;

    if (networkFeeTon > 0) {
        const { error: feeLedgerError } = await supabase
            .from('referral_reserve_ledger')
            .insert({
                owner_id: ownerId,
                reserve_account_id: reserve.id,
                entry_type: 'network_fee_reserved',
                amount_ton: networkFeeTon,
                direction: 'credit',
                payload: {
                    source: 'admin_refund_cancelled',
                    cancelled_at: now,
                    previous_refund_request: refundRequest
                }
            });

        if (feeLedgerError) throw feeLedgerError;
    }

    const nextPayload = {
        ...(account.payload || {}),
        refund_request: null,
        refund_cancelled: {
            amount_ton: amountTon,
            cancelled_at: now,
            note: note || null,
            previous_refund_request: refundRequest
        }
    };

    const synced = await reconcileReferralReserveAccount(supabase, {
        ...account,
        status: 'deposit_required',
        payload: nextPayload
    });

    const { data: updatedAccount, error: updateError } = await supabase
        .from('referral_reserve_accounts')
        .update({
            status: synced.reserveAccount.status,
            payload: nextPayload,
            available_reserve_ton: synced.reserveAccount.available_reserve_ton,
            reserved_obligations_ton: synced.reserveAccount.reserved_obligations_ton,
            admin_debt_ton: synced.reserveAccount.admin_debt_ton,
            updated_at: now
        })
        .eq('id', reserve.id)
        .eq('owner_id', ownerId)
        .select('*')
        .single();

    if (updateError) throw updateError;

    return {
        success: true,
        amount_ton: amountTon,
        reserve: updatedAccount
    };
}

export async function markReserveRefundSent(supabase, officialBotService, ownerId, amount, chainTxHash, note = null) {
    const normalizedChainTxHash = String(chainTxHash || '').trim();
    const amountTon = normalizeCurrencyAmount('TON', amount);

    if (!normalizedChainTxHash) {
        return { error: 'Нужен tx hash возврата.', status: 400 };
    }

    if (normalizedChainTxHash.length > 256) {
        return { error: 'tx hash слишком длинный.', status: 400 };
    }

    if (!Number.isFinite(amountTon) || amountTon <= 0) {
        return { error: 'Сумма возврата должна быть больше нуля.', status: 400 };
    }

    const reserve = await loadReferralReserveState(supabase, ownerId, { ensure: true });
    if (reserve.status !== 'refund_requested') {
        return { error: 'Сначала нужно запросить возврат.', status: 400 };
    }

    const requestedTon = normalizeCurrencyAmount('TON', reserve.refundRequestedTon);
    if (!requestedTon || amountTon !== requestedTon) {
        return { error: `Закрывай ровно запрошенную сумму: ${requestedTon} TON.`, status: 400 };
    }

    const account = await getReserveAccountByOwner(supabase, ownerId);
    if (!account) {
        return { error: 'Резерв не найден.', status: 404 };
    }

    const now = new Date().toISOString();
    const { error: ledgerError } = await supabase
        .from('referral_reserve_ledger')
        .insert({
            owner_id: ownerId,
            reserve_account_id: reserve.id,
            entry_type: 'admin_refund_sent',
            amount_ton: amountTon,
            direction: 'debit',
            chain_tx_hash: normalizedChainTxHash,
            payload: {
                note: note || null,
                sent_at: now,
                requested_amount_ton: requestedTon
            }
        });

    if (ledgerError) {
        if (ledgerError.code === '23505' || (ledgerError.message || '').includes('duplicate key')) {
            return { error: 'Этот tx hash уже есть в reserve ledger.', status: 409 };
        }
        throw ledgerError;
    }

    const nextPayload = {
        ...(account.payload || {}),
        refund_sent: {
            amount_ton: amountTon,
            refund_wallet: account.payload?.refund_request?.refund_wallet || null,
            refund_memo: account.payload?.refund_request?.refund_memo || null,
            chain_tx_hash: normalizedChainTxHash,
            note: note || null,
            sent_at: now
        }
    };

    const synced = await reconcileReferralReserveAccount(supabase, {
        ...account,
        status: 'refund_completed',
        payload: nextPayload
    });

    const { data: updatedAccount, error: updateError } = await supabase
        .from('referral_reserve_accounts')
        .update({
            status: 'refund_completed',
            payload: nextPayload,
            available_reserve_ton: synced.reserveAccount.available_reserve_ton,
            reserved_obligations_ton: synced.reserveAccount.reserved_obligations_ton,
            admin_debt_ton: synced.reserveAccount.admin_debt_ton,
            updated_at: now
        })
        .eq('id', reserve.id)
        .eq('owner_id', ownerId)
        .select('*')
        .single();

    if (updateError) throw updateError;

    officialBotService.notifyReferralReserveRefund(
        ownerId,
        { amountTon, chainTxHash: normalizedChainTxHash },
        'sent'
    ).catch((notifyError) => {
        console.error('Ошибка уведомления о referral reserve refund sent:', notifyError.message || notifyError);
    });

    return {
        success: true,
        amount_ton: amountTon,
        chain_tx_hash: normalizedChainTxHash,
        reserve: updatedAccount
    };
}

export async function updateReferralPayoutRequestStatus(supabase, officialBotService, ownerId, payoutRequestId, nextStatus, note = null) {
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
