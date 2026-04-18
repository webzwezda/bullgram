import axios from 'axios';

const DEFAULT_TONCENTER_API_BASE = 'https://toncenter.com/api/v2';

function envNumber(name, fallback, options = {}) {
    const parsed = Number(process.env[name] || fallback);
    if (!Number.isFinite(parsed)) return fallback;
    if (options.min !== undefined && parsed < options.min) return fallback;
    if (options.max !== undefined && parsed > options.max) return options.max;
    return parsed;
}

function normalizeBaseUrl(value) {
    return String(value || DEFAULT_TONCENTER_API_BASE).replace(/\/$/, '');
}

function nanoToTon(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Number((numeric / 1_000_000_000).toFixed(9));
}

function normalizeAddress(value) {
    return String(value || '').trim();
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
    if (hash && lt) return `${lt}:${hash}`;
    return hash ? String(hash) : '';
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

    return getOutMessages(tx).map((message) => ({
        chainTxHash,
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

async function fetchWalletTransactions(walletAddress) {
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

function getAutoSenderMeta(payout) {
    const autoSender = payout?.payload?.auto_sender || {};
    const transferRef = String(autoSender.transfer_ref || payout?.chain_tx_hash || '').trim();
    const transferRefParts = transferRef.startsWith('ton:') ? transferRef.split(':') : [];
    return {
        autoSender,
        transferRef,
        walletAddress: normalizeAddress(autoSender.wallet_address || transferRefParts[1] || process.env.TON_RESERVE_DEPOSIT_ADDRESS),
        memo: String(autoSender.memo || '').trim()
    };
}

function findConfirmationForPayout(payout, walletMessages) {
    const { memo } = getAutoSenderMeta(payout);
    if (!memo) return null;

    const expectedAmountTon = Number(payout.amount_ton || 0);
    const expectedWallet = normalizeAddress(payout.ton_wallet);

    return walletMessages.find((message) => {
        if (!String(message.comment || '').includes(memo)) return false;
        if (expectedWallet && message.destination && message.destination !== expectedWallet) return false;
        if (expectedAmountTon > 0 && message.amountTon > 0 && Math.abs(message.amountTon - expectedAmountTon) > 0.000001) return false;
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

export async function processReferralPayoutConfirmations(supabase) {
    const payouts = await loadPendingAutoPayoutConfirmations(supabase);
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
