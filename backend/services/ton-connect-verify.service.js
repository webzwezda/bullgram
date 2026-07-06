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

async function fetchRecentTransactions({ merchantWallet, tonapiBase }) {
    const url = `${tonapiBase}/v2/blockchain/accounts/${merchantWallet}/transactions?limit=30`;
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
                const txMemo = extractMemo(tx);
                if (txMemo !== expectedMemo) continue;

                const txValue = extractValueNano(tx);
                if (txValue < expectedNano) continue;

                if (expectedSender) {
                    const txSender = extractSender(tx);
                    if (txSender && txSender !== expectedSender) continue;
                }

                return {
                    ok: true,
                    txHash: String(tx.hash || tx.transaction_id?.hash || ''),
                    matchedAmountNano: txValue.toString(),
                    matchedSender: extractSender(tx),
                    attempt
                };
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
