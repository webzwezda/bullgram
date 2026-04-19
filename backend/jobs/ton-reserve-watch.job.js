import axios from 'axios';
import {
    normalizeReferralDepositMemo,
    reconcileReferralReserveAccount,
    recordReferralReserveDeposit
} from '../services/referral-reserve.service.js';
import { OfficialBotService } from '../services/official-bot.service.js';

const DEFAULT_TONCENTER_API_BASE = 'https://toncenter.com/api/v2';
const DEFAULT_TONAPI_API_BASE = 'https://tonapi.io/v2';
const DEFAULT_POLL_INTERVAL_MS = 2 * 60 * 1000;
const DEFAULT_TX_LIMIT = 50;
const DEFAULT_MAX_PAGES = 20;
const MIN_POLL_INTERVAL_MS = 60 * 1000;

function envFlag(name) {
    return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function envNumber(name, fallback, options = {}) {
    const parsed = Number(process.env[name] || fallback);
    if (!Number.isFinite(parsed)) return fallback;
    if (options.min && parsed < options.min) return fallback;
    if (options.max && parsed > options.max) return options.max;
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

function extractDepositMemo(comment) {
    const match = String(comment || '').match(/\bbr_[a-z0-9_-]{6,64}\b/i);
    return match ? normalizeReferralDepositMemo(match[0]) : '';
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

function normalizeTonAddress(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value !== 'object') return null;
    return value.address || value.user_friendly || value.raw_form || null;
}

function getTransactionCursor(tx) {
    const hash = tx?.transaction_id?.hash || tx?.transactionId?.hash;
    const lt = tx?.transaction_id?.lt || tx?.transactionId?.lt || tx?.lt;
    if (!hash || !lt) return null;
    return { lt, hash };
}

function parseToncenterDeposit(tx) {
    const inMsg = tx?.in_msg || tx?.inMsg || tx?.inMessage;
    if (!inMsg) return null;

    const amountTon = nanoToTon(inMsg.value || inMsg.amount || inMsg.value_nanotons);
    if (amountTon <= 0) return null;

    const comment = getNestedText(inMsg);
    const depositMemo = extractDepositMemo(comment);
    if (!depositMemo) return null;

    const chainTxHash = getTransactionHash(tx);
    if (!chainTxHash) return null;

    return {
        amountTon,
        chainTxHash,
        depositMemo,
        comment,
        source: normalizeTonAddress(inMsg.source || inMsg.src),
        createdAt: tx.utime ? new Date(Number(tx.utime) * 1000).toISOString() : null
    };
}

async function fetchToncenterTransactionPage(depositAddress, cursor = null) {
    const apiBase = normalizeBaseUrl(process.env.TON_RESERVE_API_BASE);
    const apiKey = String(process.env.TON_RESERVE_API_KEY || '').trim();
    const limit = envNumber('TON_RESERVE_TX_LIMIT', DEFAULT_TX_LIMIT, { min: 1, max: 100 });
    const headers = apiKey ? { 'X-API-Key': apiKey } : {};
    const params = {
        address: depositAddress,
        limit,
        archival: true
    };

    if (cursor?.lt && cursor?.hash) {
        params.lt = cursor.lt;
        params.hash = cursor.hash;
    }

    const { data } = await axios.get(`${apiBase}/getTransactions`, {
        params,
        headers,
        timeout: envNumber('TON_RESERVE_API_TIMEOUT_MS', 15_000, { min: 1_000 })
    });

    if (data?.ok === false) {
        throw new Error(data.error || 'TON Center getTransactions failed');
    }

    return Array.isArray(data?.result) ? data.result : [];
}

async function fetchToncenterTransactions(depositAddress) {
    const limit = envNumber('TON_RESERVE_TX_LIMIT', DEFAULT_TX_LIMIT, { min: 1, max: 100 });
    const maxPages = envNumber('TON_RESERVE_MAX_PAGES', DEFAULT_MAX_PAGES, { min: 1, max: 100 });
    const transactions = [];
    const seenHashes = new Set();
    let cursor = null;
    let saturated = false;

    for (let page = 0; page < maxPages; page += 1) {
        const pageTransactions = await fetchToncenterTransactionPage(depositAddress, cursor);
        if (pageTransactions.length === 0) break;

        for (const tx of pageTransactions) {
            const txHash = getTransactionHash(tx);
            if (txHash && seenHashes.has(txHash)) continue;
            if (txHash) seenHashes.add(txHash);
            transactions.push(tx);
        }

        saturated = pageTransactions.length >= limit;
        if (!saturated) break;

        const nextCursor = getTransactionCursor(pageTransactions[pageTransactions.length - 1]);
        if (!nextCursor || (cursor?.lt === nextCursor.lt && cursor?.hash === nextCursor.hash)) break;
        cursor = nextCursor;
    }

    if (saturated && transactions.length >= limit * maxPages) {
        console.warn('[TonReserveWatch] transaction page limit reached; increase TON_RESERVE_MAX_PAGES or check wallet volume');
    }

    return transactions;
}

async function fetchTonapiTransactions(depositAddress) {
    const apiBase = normalizeBaseUrl(process.env.TONAPI_API_BASE || DEFAULT_TONAPI_API_BASE);
    const apiKey = String(process.env.TONAPI_KEY || process.env.TON_RESERVE_TONAPI_KEY || '').trim();
    const limit = envNumber('TON_RESERVE_TX_LIMIT', DEFAULT_TX_LIMIT, { min: 1, max: 100 });
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const { data } = await axios.get(`${apiBase}/blockchain/accounts/${encodeURIComponent(depositAddress)}/transactions`, {
        params: { limit },
        headers,
        timeout: envNumber('TON_RESERVE_API_TIMEOUT_MS', 15_000, { min: 1_000 })
    });

    return Array.isArray(data?.transactions) ? data.transactions : [];
}

async function fetchReserveTransactions(depositAddress) {
    try {
        return await fetchToncenterTransactions(depositAddress);
    } catch (error) {
        console.warn('[TonReserveWatch] toncenter failed, falling back to tonapi:', error.message || error);
        return fetchTonapiTransactions(depositAddress);
    }
}

async function loadReserveAccountsByMemo(supabase) {
    const { data, error } = await supabase
        .from('referral_reserve_accounts')
        .select('*')
        .not('deposit_memo', 'is', null);

    if (error) throw error;

    const accountsByMemo = new Map();
    for (const account of data || []) {
        const memo = normalizeReferralDepositMemo(account.deposit_memo);
        if (!memo) continue;
        if (accountsByMemo.has(memo)) {
            throw new Error(`Duplicate referral reserve deposit memo: ${memo}`);
        }
        accountsByMemo.set(memo, account);
    }

    return accountsByMemo;
}

async function splitDepositsByLedgerStatus(supabase, deposits) {
    const hashes = deposits.map(deposit => deposit.chainTxHash).filter(Boolean);
    if (hashes.length === 0) return { newDeposits: [], knownDeposits: [] };

    const { data, error } = await supabase
        .from('referral_reserve_ledger')
        .select('chain_tx_hash')
        .in('chain_tx_hash', hashes);

    if (error) throw error;

    const knownHashes = new Set((data || []).map(row => String(row.chain_tx_hash)));
    return deposits.reduce((acc, deposit) => {
        if (knownHashes.has(deposit.chainTxHash)) {
            acc.knownDeposits.push(deposit);
        } else {
            acc.newDeposits.push(deposit);
        }
        return acc;
    }, { newDeposits: [], knownDeposits: [] });
}

export function startTonReserveWatch(supabase) {
    if (!envFlag('TON_RESERVE_WATCH_ENABLED')) {
        console.log('[TonReserveWatch] disabled by TON_RESERVE_WATCH_ENABLED flag');
        return;
    }

    const depositAddress = String(process.env.TON_RESERVE_DEPOSIT_ADDRESS || '').trim();
    if (!depositAddress) {
        console.log('[TonReserveWatch] disabled: TON_RESERVE_DEPOSIT_ADDRESS is empty');
        return;
    }

    const pollIntervalMs = envNumber('TON_RESERVE_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS, {
        min: MIN_POLL_INTERVAL_MS
    });
    const officialBotService = new OfficialBotService(supabase);
    let running = false;

    const runOnce = async () => {
        if (running) return;
        running = true;

        try {
            const reserveAccountsByMemo = await loadReserveAccountsByMemo(supabase);
            if (reserveAccountsByMemo.size === 0) return;

            const transactions = await fetchReserveTransactions(depositAddress);
            const parsedDeposits = transactions
                .map(parseToncenterDeposit)
                .filter(Boolean)
                .reverse();
            const { newDeposits, knownDeposits } = await splitDepositsByLedgerStatus(supabase, parsedDeposits);
            const reconciledKnownMemos = new Set();

            for (const deposit of knownDeposits) {
                if (reconciledKnownMemos.has(deposit.depositMemo)) continue;

                const reserveAccount = reserveAccountsByMemo.get(deposit.depositMemo);
                if (!reserveAccount) continue;

                reconciledKnownMemos.add(deposit.depositMemo);
                await reconcileReferralReserveAccount(supabase, reserveAccount, { depositAddress });
            }

            for (const deposit of newDeposits) {
                const reserveAccount = reserveAccountsByMemo.get(deposit.depositMemo);
                if (!reserveAccount) continue;

                const result = await recordReferralReserveDeposit(supabase, reserveAccount, {
                    amountTon: deposit.amountTon,
                    chainTxHash: deposit.chainTxHash,
                    depositAddress,
                    createdAt: deposit.createdAt,
                    payload: {
                        provider: 'toncenter',
                        source: deposit.source,
                        comment: deposit.comment,
                        deposit_memo: deposit.depositMemo,
                        chain_created_at: deposit.createdAt
                    }
                });

                if (result.recorded) {
                    console.log('[TonReserveWatch] deposit confirmed', {
                        owner_id: reserveAccount.owner_id,
                        amount_ton: result.amountTon,
                        lock_created: result.lockCreated
                    });

                    officialBotService.notifyReferralReserveDeposit(reserveAccount.owner_id, result).catch((notifyError) => {
                        console.error('[TonReserveWatch] deposit notification failed:', notifyError.message || notifyError);
                    });
                }
            }
        } catch (error) {
            console.error('[TonReserveWatch] poll failed:', error.message || error);
        } finally {
            running = false;
        }
    };

    console.log('[TonReserveWatch] started', {
        interval_ms: pollIntervalMs,
        provider: 'toncenter'
    });

    runOnce();
    setInterval(runOnce, pollIntervalMs);
}
