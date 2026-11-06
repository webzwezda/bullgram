import { randomUUID } from 'crypto';
import QRCode from 'qrcode';
import { getReferralEconomics } from '../../services/referral-reserve.service.js';

export function normalizeCurrencyAmount(currency, amount) {
    // Новые RUB-выплаты заблокированы (продукт живёт на TON/USDT), точность единa — 6 знаков; легаси-RUB-балансы тут не пишутся
    return Number(Number(amount || 0).toFixed(6));
}

function buildReferralPayoutMemo(payoutRequestId) {
    return `brp_${String(payoutRequestId || '').replace(/-/g, '').slice(0, 24)}`;
}

export function buildReserveRefundMemo(reserveAccountId) {
    const reservePart = String(reserveAccountId || '').replace(/-/g, '').slice(0, 12);
    const requestPart = randomUUID().replace(/-/g, '').slice(0, 12);
    return `brr_${reservePart}_${requestPart}`;
}

export function normalizeTonWallet(value) {
    return String(value || '').trim();
}

export function looksLikeTonWallet(value) {
    const wallet = normalizeTonWallet(value);
    if (/^[UEk]Q[A-Za-z0-9_-]{46}$/.test(wallet)) return true;
    if (/^[0-9-]+:[a-fA-F0-9]{64}$/.test(wallet)) return true;
    return false;
}

function buildTonTransferUri(wallet, amountTon, memo) {
    const normalizedWallet = String(wallet || '').trim();
    const normalizedAmount = normalizeCurrencyAmount('TON', amountTon);
    const normalizedMemo = String(memo || '').trim();
    if (!normalizedWallet || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
        return null;
    }

    const nanoTon = Math.round(normalizedAmount * 1_000_000_000);
    const params = new URLSearchParams({
        amount: String(nanoTon)
    });
    if (normalizedMemo) {
        params.set('text', normalizedMemo);
    }

    return `ton://transfer/${normalizedWallet}?${params.toString()}`;
}

function buildTrustWalletTonUri(wallet, amountTon, memo) {
    const normalizedWallet = String(wallet || '').trim();
    if (!normalizedWallet) return null;

    const params = new URLSearchParams({
        asset: 'c607',
        address: normalizedWallet
    });

    const normalizedAmount = normalizeCurrencyAmount('TON', amountTon);
    if (Number.isFinite(normalizedAmount) && normalizedAmount > 0) {
        params.set('amount', String(normalizedAmount));
    }

    const normalizedMemo = String(memo || '').trim();
    if (normalizedMemo) {
        params.set('memo', normalizedMemo);
    }

    return `https://link.trustwallet.com/send?${params.toString()}`;
}

export async function addPayoutPaymentPayload(row) {
    const wallet = row.pending_payout_wallet || row.payout_wallet || '';
    const amountTon = normalizeCurrencyAmount('TON', row.pending_payout_ton);
    const memo = buildReferralPayoutMemo(row.pending_payout_id);
    const uri = buildTonTransferUri(wallet, amountTon, memo);
    if (!uri) {
        return {
            ...row,
            pending_payout_memo: memo,
            ton_transfer_uri: null,
            ton_transfer_qr: null
        };
    }

    try {
        const qr = await QRCode.toDataURL(uri, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 220
        });
        return {
            ...row,
            pending_payout_memo: memo,
            ton_transfer_uri: uri,
            ton_transfer_qr: qr
        };
    } catch (error) {
        console.error('Ошибка генерации referral payout QR:', error.message || error);
        return {
            ...row,
            pending_payout_memo: memo,
            ton_transfer_uri: uri,
            ton_transfer_qr: null
        };
    }
}

async function buildTonTransferPayload(wallet, amountTon, memo) {
    const uri = buildTonTransferUri(wallet, amountTon, memo);
    if (!uri) return { uri: null, qr: null };

    try {
        const qr = await QRCode.toDataURL(uri, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 220
        });
        return { uri, qr };
    } catch (error) {
        console.error('Ошибка генерации TON transfer QR:', error.message || error);
        return { uri, qr: null };
    }
}

async function buildReserveDepositPaymentPayload(wallet, amountTon, memo) {
    const tonUri = buildTonTransferUri(wallet, amountTon, memo);
    const trustWalletUri = buildTrustWalletTonUri(wallet, amountTon, memo);

    async function toQr(uri, label) {
        if (!uri) return null;
        try {
            return await QRCode.toDataURL(uri, {
                errorCorrectionLevel: 'H',
                margin: 2,
                width: 260
            });
        } catch (error) {
            console.error(`Ошибка генерации referral deposit ${label} QR:`, error.message || error);
            return null;
        }
    }

    return {
        tonUri,
        tonQr: await toQr(tonUri, 'TON'),
        trustWalletUri,
        trustWalletQr: await toQr(trustWalletUri, 'Trust Wallet')
    };
}

export async function enrichReserveDepositPayload(reserve) {
    if (!reserve?.depositAddress || !reserve?.depositMemo) {
        return reserve;
    }

    const minimumDepositTon = normalizeCurrencyAmount('TON', reserve.minimumDepositTon || getReferralEconomics().minimumDepositTon || 100);
    const fundedReserveTon = normalizeCurrencyAmount('TON', reserve.fundedReserveTon ?? reserve.availableReserveTon ?? 0);
    const missingDepositTon = normalizeCurrencyAmount('TON', Math.max(0, minimumDepositTon - fundedReserveTon));
    const suggestedAmountTon = missingDepositTon > 0 ? missingDepositTon : minimumDepositTon;
    const payment = await buildReserveDepositPaymentPayload(
        reserve.depositAddress,
        suggestedAmountTon,
        reserve.depositMemo
    );

    return {
        ...reserve,
        depositSuggestedTon: suggestedAmountTon,
        depositTonUri: payment.tonUri,
        depositTonQr: payment.tonQr,
        depositTrustWalletUri: payment.trustWalletUri,
        depositTrustWalletQr: payment.trustWalletQr
    };
}

function buildReserveRefundSummary(account) {
    const payload = account?.payload || {};
    const refundRequest = payload.refund_request || {};
    const refundSent = payload.refund_sent || {};
    const autoSender = payload.refund_auto_sender || {};
    const refundCancelled = payload.refund_cancelled || {};

    const amountTon = normalizeCurrencyAmount('TON', refundSent.amount_ton || refundRequest.amount_ton || refundCancelled.amount_ton || 0);
    const chainTxHash = refundSent.chain_tx_hash || autoSender.confirmed_chain_tx_hash || autoSender.transfer_ref || null;
    const confirmedAt = refundSent.confirmed_at || autoSender.confirmed_at || null;
    const sentAt = refundSent.sent_at || autoSender.completed_at || null;
    const requestedAt = refundRequest.requested_at || null;
    const cancelledAt = refundCancelled.cancelled_at || null;
    const lastError = autoSender.last_error || null;
    const errorAt = autoSender.error_at || null;

    if (!amountTon && !requestedAt && !sentAt && !confirmedAt && !cancelledAt && !lastError) {
        return null;
    }

    const statusCandidates = [
        { status: 'requested', at: requestedAt },
        { status: 'cancelled', at: cancelledAt },
        { status: 'failed', at: errorAt },
        { status: 'sent', at: sentAt },
        { status: 'confirmed', at: confirmedAt }
    ].filter((candidate) => candidate.at);
    statusCandidates.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());

    const status = statusCandidates[0]?.status || (chainTxHash ? 'sent' : 'requested');

    return {
        status,
        amountTon,
        refundWallet: refundSent.refund_wallet || refundRequest.refund_wallet || null,
        refundMemo: refundSent.refund_memo || refundRequest.refund_memo || null,
        chainTxHash,
        transferRef: autoSender.transfer_ref || null,
        requestedAt,
        sentAt,
        confirmedAt,
        cancelledAt,
        errorAt,
        error: lastError
    };
}

export async function getReserveAccountByOwner(supabase, ownerId) {
    const { data, error } = await supabase
        .from('referral_reserve_accounts')
        .select('*')
        .eq('owner_id', ownerId)
        .maybeSingle();

    if (error) {
        if ((error.message || '').includes('referral_reserve_accounts')) {
            return null;
        }
        throw error;
    }

    return data || null;
}

export async function enrichReserveRefundPayload(supabase, ownerId, reserve) {
    if (!reserve?.id) {
        return reserve;
    }

    const account = await getReserveAccountByOwner(supabase, ownerId);
    const refundLast = buildReserveRefundSummary(account);

    if (reserve.status !== 'refund_requested') {
        return {
            ...reserve,
            refundLast
        };
    }

    const refundRequest = account?.payload?.refund_request || {};
    const refundWallet = normalizeTonWallet(refundRequest.refund_wallet);
    const refundMemo = refundRequest.refund_memo || null;
    const amountTon = normalizeCurrencyAmount('TON', refundRequest.amount_ton || reserve.refundRequestedTon);
    const transfer = refundWallet && refundMemo
        ? await buildTonTransferPayload(refundWallet, amountTon, refundMemo)
        : { uri: null, qr: null };

    return {
        ...reserve,
        refundLast,
        refundWallet: refundWallet || null,
        refundMemo,
        refundTransferUri: transfer.uri,
        refundTransferQr: transfer.qr
    };
}
