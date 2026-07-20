const DEFAULT_TONAPI_BASE = 'https://tonapi.io';
const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_INTERVAL_MS = 3000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAddress(value) {
    return String(value || '').trim();
}

function extractMemo(tx) {
    const inMsg = tx?.in_msg || {};
    return String(inMsg.decoded_comment?.text ?? inMsg.decoded_body?.text ?? '').trim();
}

function extractSender(tx) {
    return String(tx?.in_msg?.sender?.address || '').trim();
}

function extractValueNano(tx) {
    return BigInt(tx?.in_msg?.value || 0);
}

export async function fetchRecentTransactions({ merchantWallet, tonapiBase, limit = 30 }) {
    const url = `${tonapiBase}/v2/blockchain/accounts/${merchantWallet}/transactions?limit=${limit}`;
    const headers = {};
    const apiKey = process.env.TONAPI_KEY || process.env.TONCONNECT_TONAPI_KEY;
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`TonAPI ${response.status}: ${await response.text().catch(() => '')}`);
    }
    const data = await response.json();
    return Array.isArray(data?.transactions) ? data.transactions : [];
}

export function matchInvoice({ tx, expectedMemo, expectedNanoTon, expectedSender = null }) {
    const txMemo = extractMemo(tx);
    if (txMemo !== expectedMemo) return null;

    const txValue = extractValueNano(tx);
    if (txValue < expectedNanoTon) return null;

    if (expectedSender) {
        const txSender = extractSender(tx);
        if (txSender && txSender !== expectedSender) return null;
    }

    return {
        txHash: String(tx.hash || tx.transaction_id?.hash || ''),
        matchedAmountNano: txValue.toString(),
        matchedSender: extractSender(tx)
    };
}

export async function verifyTonConnectPayment({
    merchantWallet,
    memo,
    expectedNanoTon,
    senderWallet = null,
    maxAttempts = null,
    intervalMs = null
}) {
    const tonapiBase = String(process.env.TONCONNECT_TONAPI_BASE || DEFAULT_TONAPI_BASE).replace(/\/$/, '');
    const attemptsLimit = Number(maxAttempts || process.env.TONCONNECT_VERIFY_MAX_ATTEMPTS || DEFAULT_MAX_ATTEMPTS);
    const interval = Number(intervalMs || process.env.TONCONNECT_VERIFY_INTERVAL_MS || DEFAULT_INTERVAL_MS);

    const merchant = normalizeAddress(merchantWallet);
    const expectedMemo = String(memo || '').trim();
    const expectedNano = BigInt(expectedNanoTon || 0);
    const expectedSender = senderWallet ? normalizeAddress(senderWallet) : null;

    if (!merchant) throw new Error('merchantWallet is required');
    if (!expectedMemo) throw new Error('memo is required');
    if (expectedNano <= 0n) throw new Error('expectedNanoTon must be positive');

    for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
        try {
            const transactions = await fetchRecentTransactions({ merchantWallet: merchant, tonapiBase });
            for (const tx of transactions) {
                const match = matchInvoice({ tx, expectedMemo, expectedNanoTon: expectedNano, expectedSender });
                if (match) {
                    return { ok: true, ...match, attempt };
                }
            }
        } catch (error) {
            console.error(`[TonConnectVerify] attempt ${attempt}/${attemptsLimit} error:`, error.message);
        }

        if (attempt < attemptsLimit) {
            await sleep(interval);
        }
    }

    return { ok: false, attempt: attemptsLimit };
}

export async function verifyPaymentOnce({ merchantWallet, memo, expectedNanoTon, senderWallet = null }) {
    return verifyTonConnectPayment({
        merchantWallet,
        memo,
        expectedNanoTon,
        senderWallet,
        maxAttempts: 1,
        intervalMs: 0
    });
}
