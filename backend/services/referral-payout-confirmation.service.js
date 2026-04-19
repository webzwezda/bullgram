import axios from 'axios';
import { Address } from '@ton/core';

const DEFAULT_TONCENTER_API_BASE = 'https://toncenter.com/api/v2';
const DEFAULT_TONAPI_API_BASE = 'https://tonapi.io/v2';

function envNumber(name, fallback, options = {}) {
    const parsed = Number(process.env[name] || fallback);
    if (!Number.isFinite(parsed)) return fallback;
    if (options.min !== undefined && parsed < options.min) return fallback;
    if (options.max !== undefined && parsed > options.max) return options.max;
    return parsed;
}

function normalizeBaseUrl(value, fallback = DEFAULT_TONCENTER_API_BASE) {
    return String(value || fallback).replace(/\/$/, '');
}

function nanoToTon(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Number((numeric / 1_000_000_000).toFixed(9));
}

function normalizeAddress(value) {
    const raw = typeof value === 'object' && value
        ? value.address || value.user_friendly || value.raw_form || ''
        : value;
    const normalized = String(raw || '').trim();
    if (!normalized) return '';
    try {
        return Address.parse(normalized).toRawString();
    } catch {
        return normalized;
    }
}

function getNestedText(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value !== 'object') return '';

    const candidates = [
        value.text,
        value.comment,
        value.message,
        value.value?.text,
        value.decoded?.text,
        value.decoded_body?.text,
        value.decoded_body?.comment,
        value.decodedBody?.text,
        value.decodedBody?.comment,
        value.msg_data?.text,
        value.msgData?.text
    ];

    return candidates.map(item => getNestedText(item)).find(Boolean) || '';
}

function getTransactionHash(tx) {
    const hash = tx?.transaction_id?.hash || tx?.transactionId?.hash || tx?.hash || tx?.tx_hash || tx?.txHash;
    const lt = tx?.transaction_id?.lt || tx?.transactionId?.lt || tx?.lt;
    const normalizedHash = normalizeChainHash(hash);
    if (normalizedHash && lt) return `${lt}:${normalizedHash}`;
    return normalizedHash || '';
}

function normalizeChainHash(hash) {
    const raw = String(hash || '').trim();
    if (!raw) return '';
    if (/^[a-f0-9]{64}$/i.test(raw)) {
        return Buffer.from(raw, 'hex').toString('base64');
    }
    return raw;
}

function getTransactionCursor(tx) {
    const hash = tx?.transaction_id?.hash || tx?.transactionId?.hash;
    const lt = tx?.transaction_id?.lt || tx?.transactionId?.lt || tx?.lt;
    if (!hash || !lt) return null;
    return { lt, hash };
}

function getOutMessages(tx) {
    const candidates = [
        tx?.out_msgs,
        tx?.outMsgs,
        tx?.out_messages,
        tx?.outMessages
    ];
    return candidates.find(Array.isArray) || [];
}

function parseOutgoingMemoTransaction(tx) {
    const chainTxHash = getTransactionHash(tx);
    if (!chainTxHash) return [];
    const seqno = Number(tx?.in_msg?.decoded_body?.seqno ?? tx?.inMsg?.decoded_body?.seqno ?? tx?.inMessage?.decoded_body?.seqno);

    return getOutMessages(tx).map((message) => ({
        chainTxHash,
        seqno: Number.isFinite(seqno) ? seqno : null,
        amountTon: nanoToTon(message?.value || message?.amount || message?.value_nanotons),
        destination: normalizeAddress(message?.destination || message?.dst || message?.to),
        comment: getNestedText(message),
        createdAt: tx.utime ? new Date(Number(tx.utime) * 1000).toISOString() : null
    })).filter(item => item.comment);
}

async function fetchToncenterTransactionPage(walletAddress, cursor = null) {
    const apiBase = normalizeBaseUrl(process.env.TON_RESERVE_API_BASE || process.env.TON_PAYOUT_CONFIRMATION_API_BASE);
    const apiKey = String(process.env.TON_RESERVE_API_KEY || '').trim();
    const headers = apiKey ? { 'X-API-Key': apiKey } : {};
    const params = {
        address: walletAddress,
        limit: envNumber('TON_PAYOUT_CONFIRMATION_TX_LIMIT', 50, { min: 1, max: 100 }),
        archival: true
    };

    if (cursor?.lt && cursor?.hash) {
        params.lt = cursor.lt;
        params.hash = cursor.hash;
    }

    const { data } = await axios.get(`${apiBase}/getTransactions`, {
        params,
        headers,
        timeout: envNumber('TON_PAYOUT_CONFIRMATION_TIMEOUT_MS', 15_000, { min: 1_000 })
    });

    if (data?.ok === false) {
        throw new Error(data.error || 'TON Center getTransactions failed');
    }

    return Array.isArray(data?.result) ? data.result : [];
}

async function fetchToncenterWalletTransactions(walletAddress) {
    const maxPages = envNumber('TON_PAYOUT_CONFIRMATION_MAX_PAGES', 5, { min: 1, max: 50 });
    const transactions = [];
    const seenHashes = new Set();
    let cursor = null;

    for (let page = 0; page < maxPages; page += 1) {
        const pageTransactions = await fetchToncenterTransactionPage(walletAddress, cursor);
        if (pageTransactions.length === 0) break;

        for (const tx of pageTransactions) {
            const txHash = getTransactionHash(tx);
            if (txHash && seenHashes.has(txHash)) continue;
            if (txHash) seenHashes.add(txHash);
            transactions.push(tx);
        }

        const nextCursor = getTransactionCursor(pageTransactions[pageTransactions.length - 1]);
        if (!nextCursor || (cursor?.lt === nextCursor.lt && cursor?.hash === nextCursor.hash)) break;
        cursor = nextCursor;
    }

    return transactions;
}

async function fetchTonapiWalletTransactions(walletAddress) {
    const apiBase = normalizeBaseUrl(process.env.TONAPI_API_BASE || DEFAULT_TONAPI_API_BASE, DEFAULT_TONAPI_API_BASE);
    const apiKey = String(process.env.TONAPI_KEY || process.env.TON_RESERVE_TONAPI_KEY || '').trim();
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const limit = envNumber('TON_PAYOUT_CONFIRMATION_TX_LIMIT', 50, { min: 1, max: 100 });
    const { data } = await axios.get(`${apiBase}/blockchain/accounts/${encodeURIComponent(walletAddress)}/transactions`, {
        params: { limit },
        headers,
        timeout: envNumber('TON_PAYOUT_CONFIRMATION_TIMEOUT_MS', 15_000, { min: 1_000 })
    });

    return Array.isArray(data?.transactions) ? data.transactions : [];
}

async function fetchWalletTransactions(walletAddress) {
    try {
        return await fetchTonapiWalletTransactions(walletAddress);
    } catch (error) {
        console.warn('[ReferralPayoutConfirmation] tonapi failed, falling back to toncenter:', error.message || error);
        return fetchToncenterWalletTransactions(walletAddress);
    }
}

function amountMatches(actualTon, expectedTon) {
    if (!(expectedTon > 0) || !(actualTon > 0)) return true;
    const tolerance = envNumber('TON_PAYOUT_CONFIRMATION_AMOUNT_TOLERANCE_TON', 0.001, { min: 0, max: 0.1 });
    return Math.abs(actualTon - expectedTon) <= tolerance;
}

function getAutoSenderMeta(payout) {
    const autoSender = payout?.payload?.auto_sender || {};
    const transferRef = String(autoSender.transfer_ref || payout?.chain_tx_hash || '').trim();
    const transferRefParts = transferRef.startsWith('ton:') ? transferRef.split(':') : [];
    return {
        autoSender,
        transferRef,
        walletAddress: normalizeAddress(autoSender.wallet_address || transferRefParts[1] || process.env.TON_RESERVE_DEPOSIT_ADDRESS),
        memo: String(autoSender.memo || '').trim(),
        seqno: Number.isFinite(Number(autoSender.seqno ?? transferRefParts[2]))
            ? Number(autoSender.seqno ?? transferRefParts[2])
            : null
    };
}

function findConfirmationForPayout(payout, walletMessages) {
    const { memo } = getAutoSenderMeta(payout);
    if (!memo) return null;

    const expectedAmountTon = Number(payout.amount_ton || 0);
    const expectedWallet = normalizeAddress(payout.ton_wallet);

    return walletMessages.find((message) => {
        if (!String(message.comment || '').includes(memo)) return false;
        if (meta.seqno !== null && message.seqno !== meta.seqno) return false;
        if (expectedWallet && message.destination && message.destination !== expectedWallet) return false;
        if (!amountMatches(message.amountTon, expectedAmountTon)) return false;
        return true;
    }) || null;
}

function getAutoRefundMeta(entry) {
    const payload = entry?.payload || {};
    const transferRef = String(payload.transfer_ref || entry?.chain_tx_hash || '').trim();
    const transferRefParts = transferRef.startsWith('ton:') ? transferRef.split(':') : [];
    return {
        payload,
        transferRef,
        walletAddress: normalizeAddress(payload.wallet_address || transferRefParts[1] || process.env.TON_RESERVE_DEPOSIT_ADDRESS),
        memo: String(payload.refund_memo || '').trim(),
        refundWallet: normalizeAddress(payload.refund_wallet),
        seqno: Number.isFinite(Number(payload.seqno ?? transferRefParts[2]))
            ? Number(payload.seqno ?? transferRefParts[2])
            : null
    };
}

function findConfirmationForRefund(entry, walletMessages) {
    const meta = getAutoRefundMeta(entry);
    if (!meta.memo) return null;

    const expectedAmountTon = Number(entry.amount_ton || 0);

    return walletMessages.find((message) => {
        if (!String(message.comment || '').includes(meta.memo)) return false;
        if (meta.seqno !== null && message.seqno !== meta.seqno) return false;
        if (meta.refundWallet && message.destination && message.destination !== meta.refundWallet) return false;
        if (!amountMatches(message.amountTon, expectedAmountTon)) return false;
        return true;
    }) || null;
}

async function loadPendingAutoPayoutConfirmations(supabase) {
    const { data, error } = await supabase
        .from('referral_partner_payouts')
        .select('*')
        .eq('status', 'sent')
        .like('chain_tx_hash', 'ton:%')
        .order('sent_at', { ascending: true })
        .limit(envNumber('TON_PAYOUT_CONFIRMATION_BATCH_LIMIT', 50, { min: 1, max: 200 }));

    if (error) {
        if ((error.message || '').includes('referral_partner_payouts')) return [];
        throw error;
    }

    return data || [];
}

async function loadPendingAutoRefundConfirmations(supabase) {
    const { data, error } = await supabase
        .from('referral_reserve_ledger')
        .select('*')
        .eq('entry_type', 'admin_refund_sent')
        .like('chain_tx_hash', 'ton:%')
        .order('created_at', { ascending: true })
        .limit(envNumber('TON_PAYOUT_CONFIRMATION_BATCH_LIMIT', 50, { min: 1, max: 200 }));

    if (error) {
        if ((error.message || '').includes('referral_reserve_ledger')) return [];
        throw error;
    }

    return data || [];
}

async function confirmAutoPayouts(supabase, payouts) {
    if (payouts.length === 0) return { checked: 0, confirmed: 0 };

    const payoutsByWallet = new Map();
    for (const payout of payouts) {
        const meta = getAutoSenderMeta(payout);
        if (!meta.walletAddress || !meta.memo) continue;
        const bucket = payoutsByWallet.get(meta.walletAddress) || [];
        bucket.push({ payout, meta });
        payoutsByWallet.set(meta.walletAddress, bucket);
    }

    let checked = 0;
    let confirmed = 0;

    for (const [walletAddress, bucket] of payoutsByWallet.entries()) {
        const transactions = await fetchWalletTransactions(walletAddress);
        const walletMessages = transactions.flatMap(parseOutgoingMemoTransaction);

        for (const { payout, meta } of bucket) {
            checked += 1;
            const confirmation = findConfirmationForPayout(payout, walletMessages);
            if (!confirmation) continue;

            const confirmedAt = confirmation.createdAt || new Date().toISOString();
            const nextPayload = {
                ...(payout.payload || {}),
                auto_sender: {
                    ...(payout.payload?.auto_sender || {}),
                    confirmed_at: confirmedAt,
                    confirmed_chain_tx_hash: confirmation.chainTxHash,
                    confirmation_amount_ton: confirmation.amountTon,
                    confirmation_destination: confirmation.destination,
                    transfer_ref: meta.transferRef
                }
            };

            const { data: updatedRows, error: updateError } = await supabase
                .from('referral_partner_payouts')
                .update({
                    chain_tx_hash: confirmation.chainTxHash,
                    payload: nextPayload
                })
                .eq('id', payout.id)
                .eq('chain_tx_hash', payout.chain_tx_hash)
                .select('id')
                .limit(1);

            if (updateError) throw updateError;
            if (!updatedRows?.length) continue;

            confirmed += 1;

            await supabase
                .from('referral_reserve_ledger')
                .update({
                    chain_tx_hash: confirmation.chainTxHash,
                    payload: {
                        payout_request_id: payout.id,
                        tg_user_id: String(payout.tg_user_id),
                        ton_wallet: payout.ton_wallet,
                        source: 'automatic_payout_sender',
                        transfer_ref: meta.transferRef,
                        confirmed_at: confirmedAt
                    }
                })
                .eq('related_payout_id', payout.id)
                .eq('chain_tx_hash', payout.chain_tx_hash);
        }
    }

    return { checked, confirmed };
}

async function confirmAutoRefunds(supabase, entries) {
    if (entries.length === 0) return { checked: 0, confirmed: 0 };

    const refundsByWallet = new Map();
    for (const entry of entries) {
        const meta = getAutoRefundMeta(entry);
        if (!meta.walletAddress || !meta.memo) continue;
        const bucket = refundsByWallet.get(meta.walletAddress) || [];
        bucket.push({ entry, meta });
        refundsByWallet.set(meta.walletAddress, bucket);
    }

    let checked = 0;
    let confirmed = 0;

    for (const [walletAddress, bucket] of refundsByWallet.entries()) {
        const transactions = await fetchWalletTransactions(walletAddress);
        const walletMessages = transactions.flatMap(parseOutgoingMemoTransaction);

        for (const { entry, meta } of bucket) {
            checked += 1;
            const confirmation = findConfirmationForRefund(entry, walletMessages);
            if (!confirmation) continue;

            const confirmedAt = confirmation.createdAt || new Date().toISOString();
            const nextPayload = {
                ...(entry.payload || {}),
                confirmed_at: confirmedAt,
                confirmed_chain_tx_hash: confirmation.chainTxHash,
                confirmation_amount_ton: confirmation.amountTon,
                confirmation_destination: confirmation.destination,
                transfer_ref: meta.transferRef
            };

            const { data: updatedRows, error: updateError } = await supabase
                .from('referral_reserve_ledger')
                .update({
                    chain_tx_hash: confirmation.chainTxHash,
                    payload: nextPayload
                })
                .eq('id', entry.id)
                .eq('chain_tx_hash', entry.chain_tx_hash)
                .select('id')
                .limit(1);

            if (updateError) throw updateError;
            if (!updatedRows?.length) continue;

            confirmed += 1;

            const { data: account, error: accountError } = await supabase
                .from('referral_reserve_accounts')
                .select('id,payload')
                .eq('id', entry.reserve_account_id)
                .maybeSingle();

            if (accountError) throw accountError;
            if (!account) continue;

            const { error: accountUpdateError } = await supabase
                .from('referral_reserve_accounts')
                .update({
                    payload: {
                        ...(account.payload || {}),
                        refund_sent: {
                            ...(account.payload?.refund_sent || {}),
                            chain_tx_hash: confirmation.chainTxHash,
                            confirmed_at: confirmedAt
                        },
                        refund_auto_sender: {
                            ...(account.payload?.refund_auto_sender || {}),
                            confirmed_at: confirmedAt,
                            confirmed_chain_tx_hash: confirmation.chainTxHash,
                            confirmation_amount_ton: confirmation.amountTon,
                            confirmation_destination: confirmation.destination,
                            transfer_ref: meta.transferRef
                        }
                    },
                    updated_at: new Date().toISOString()
                })
                .eq('id', account.id);

            if (accountUpdateError) throw accountUpdateError;
        }
    }

    return { checked, confirmed };
}

export async function processReferralPayoutConfirmations(supabase) {
    const payouts = await loadPendingAutoPayoutConfirmations(supabase);
    const refunds = await loadPendingAutoRefundConfirmations(supabase);
    const payoutResult = await confirmAutoPayouts(supabase, payouts);
    const refundResult = await confirmAutoRefunds(supabase, refunds);

    return {
        checked: payoutResult.checked + refundResult.checked,
        confirmed: payoutResult.confirmed + refundResult.confirmed,
        payoutChecked: payoutResult.checked,
        payoutConfirmed: payoutResult.confirmed,
        refundChecked: refundResult.checked,
        refundConfirmed: refundResult.confirmed
    };
}
