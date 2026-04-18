import { OfficialBotService } from './official-bot.service.js';
import { loadReferralReserveState, reconcileReferralReserveAccount } from './referral-reserve.service.js';
import { getTonReserveSenderConfig, sendTonFromReserve } from './ton-reserve-sender.service.js';

const REFUND_SENDER_FLAG = 'REFERRAL_REFUND_SENDER_ENABLED';

function normalizeTonAmount(value) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Number(parsed.toFixed(6));
}

async function getReserveAccountByOwner(supabase, ownerId) {
    const { data, error } = await supabase
        .from('referral_reserve_accounts')
        .select('*')
        .eq('owner_id', ownerId)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

async function leaveRefundWithError(supabase, account, error, meta = {}) {
    await supabase
        .from('referral_reserve_accounts')
        .update({
            payload: {
                ...(account.payload || {}),
                refund_auto_sender: {
                    ...(account.payload?.refund_auto_sender || {}),
                    ...meta,
                    last_error: String(error?.message || error || 'automatic refund sender error').slice(0, 500),
                    error_at: new Date().toISOString()
                }
            },
            updated_at: new Date().toISOString()
        })
        .eq('id', account.id)
        .eq('status', 'refund_requested');
}

export async function sendReferralReserveRefund(supabase, ownerId, options = {}) {
    const config = getTonReserveSenderConfig(REFUND_SENDER_FLAG);
    if (!config.enabled) {
        return { error: 'Автоматический refund sender выключен.', status: 400 };
    }

    const officialBotService = new OfficialBotService(supabase);
    const reserve = await loadReferralReserveState(supabase, ownerId, { ensure: true });
    if (reserve.status !== 'refund_requested') {
        return { error: 'Сначала нужно запросить возврат.', status: 400 };
    }

    const account = await getReserveAccountByOwner(supabase, ownerId);
    if (!account) return { error: 'Резерв не найден.', status: 404 };

    const refundRequest = account.payload?.refund_request || {};
    const refundWallet = String(refundRequest.refund_wallet || '').trim();
    const refundMemo = String(refundRequest.refund_memo || '').trim();
    const amountTon = normalizeTonAmount(refundRequest.amount_ton || reserve.refundRequestedTon);

    if (!refundWallet) return { error: 'В запросе возврата нет TON-кошелька.', status: 400 };
    if (!refundMemo) return { error: 'В запросе возврата нет memo.', status: 400 };
    if (amountTon <= 0) return { error: 'Сумма возврата должна быть больше нуля.', status: 400 };

    const requestedTon = normalizeTonAmount(reserve.refundRequestedTon);
    if (requestedTon !== amountTon) {
        return { error: `Запрошенная сумма изменилась. Ожидаю ${requestedTon} TON.`, status: 409 };
    }

    const now = new Date().toISOString();
    const sendingPayload = {
        ...(account.payload || {}),
        refund_auto_sender: {
            requested_by: options.requestedBy || 'admin',
            started_at: now,
            refund_wallet: refundWallet,
            refund_memo: refundMemo,
            amount_ton: amountTon
        }
    };

    const { data: sendingRows, error: sendingError } = await supabase
        .from('referral_reserve_accounts')
        .update({
            payload: sendingPayload,
            updated_at: now
        })
        .eq('id', account.id)
        .eq('owner_id', ownerId)
        .eq('status', 'refund_requested')
        .select('*')
        .limit(1);

    if (sendingError) throw sendingError;
    const sendingAccount = sendingRows?.[0] || null;
    if (!sendingAccount) {
        return { error: 'Статус возврата изменился. Обнови экран.', status: 409 };
    }

    let transfer;
    try {
        transfer = await sendTonFromReserve({
            to: refundWallet,
            amountTon,
            comment: refundMemo,
            enabledFlagName: REFUND_SENDER_FLAG
        });
    } catch (error) {
        await leaveRefundWithError(supabase, sendingAccount, error, { refund_memo: refundMemo });
        throw error;
    }

    const { error: ledgerError } = await supabase
        .from('referral_reserve_ledger')
        .insert({
            owner_id: ownerId,
            reserve_account_id: account.id,
            entry_type: 'admin_refund_sent',
            amount_ton: amountTon,
            direction: 'debit',
            chain_tx_hash: transfer.transferRef,
            payload: {
                automatic_sender: true,
                refund_wallet: refundWallet,
                refund_memo: refundMemo,
                transfer_ref: transfer.transferRef,
                wallet_address: transfer.walletAddress,
                seqno: transfer.seqno,
                sent_at: transfer.sentAt,
                requested_by: options.requestedBy || 'admin'
            }
        });

    if (ledgerError) {
        await leaveRefundWithError(supabase, sendingAccount, ledgerError, transfer);
        throw ledgerError;
    }

    const nextPayload = {
        ...(sendingAccount.payload || {}),
        refund_sent: {
            amount_ton: amountTon,
            refund_wallet: refundWallet,
            refund_memo: refundMemo,
            chain_tx_hash: transfer.transferRef,
            automatic_sender: true,
            sent_at: transfer.sentAt
        },
        refund_auto_sender: {
            ...(sendingAccount.payload?.refund_auto_sender || {}),
            completed_at: new Date().toISOString(),
            wallet_address: transfer.walletAddress,
            seqno: transfer.seqno,
            transfer_ref: transfer.transferRef
        }
    };

    const synced = await reconcileReferralReserveAccount(supabase, {
        ...sendingAccount,
        status: 'refund_completed',
        payload: nextPayload
    });

    const { data: updatedRows, error: updateError } = await supabase
        .from('referral_reserve_accounts')
        .update({
            status: 'refund_completed',
            payload: nextPayload,
            available_reserve_ton: synced.reserveAccount.available_reserve_ton,
            reserved_obligations_ton: synced.reserveAccount.reserved_obligations_ton,
            admin_debt_ton: synced.reserveAccount.admin_debt_ton,
            updated_at: new Date().toISOString()
        })
        .eq('id', reserve.id)
        .eq('owner_id', ownerId)
        .select('*')
        .limit(1);

    if (updateError) throw updateError;

    officialBotService.notifyReferralReserveRefund(
        ownerId,
        { amountTon, chainTxHash: transfer.transferRef },
        'sent'
    ).catch((notifyError) => {
        console.error('Ошибка уведомления auto reserve refund sent:', notifyError.message || notifyError);
    });

    return {
        success: true,
        amount_ton: amountTon,
        chain_tx_hash: transfer.transferRef,
        reserve: updatedRows?.[0] || synced.reserveAccount
    };
}

export function getReferralRefundSenderConfig() {
    return getTonReserveSenderConfig(REFUND_SENDER_FLAG);
}
