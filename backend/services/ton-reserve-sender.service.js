import fs from 'fs/promises';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { Address } from '@ton/core';
import { internal, toNano, TonClient, WalletContractV4 } from '@ton/ton';

const DEFAULT_ENDPOINT = 'https://toncenter.com/api/v2/jsonRPC';
const DEFAULT_WALLET_SECRET_FILE = '/root/bullrun-ton-reserve/reserve-wallet.json';

function envFlag(name) {
    return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitError(error) {
    const status = error?.response?.status || error?.status;
    const message = String(error?.message || error?.response?.data?.result || '').toLowerCase();
    return status === 429 || message.includes('rate') || message.includes('too many requests');
}

async function withTonRpcRetry(operation, label) {
    const attempts = Math.max(1, Math.floor(envNumber('TON_RESERVE_SENDER_RETRY_COUNT', 4, { min: 1, max: 8 })));
    const baseDelayMs = envNumber('TON_RESERVE_SENDER_RETRY_DELAY_MS', 3_000, { min: 250, max: 30_000 });

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            if (!isRateLimitError(error) || attempt >= attempts) {
                if (isRateLimitError(error)) {
                    throw new Error(`TON provider rate limit while ${label}. Try again in a minute or configure TON_RESERVE_API_KEY.`);
                }
                throw error;
            }

            await sleep(baseDelayMs * attempt);
        }
    }

    throw new Error(`TON provider request failed while ${label}`);
}

function normalizeMnemonic(value) {
    if (Array.isArray(value)) {
        return value.map(item => String(item || '').trim()).filter(Boolean);
    }

    return String(value || '')
        .trim()
        .split(/\s+/)
        .map(item => item.trim())
        .filter(Boolean);
}

async function loadReserveWalletSecret() {
    const secretFile = String(process.env.TON_RESERVE_WALLET_SECRET_FILE || DEFAULT_WALLET_SECRET_FILE).trim();
    const raw = await fs.readFile(secretFile, 'utf8');
    const parsed = JSON.parse(raw);
    const mnemonic = normalizeMnemonic(parsed.mnemonic || parsed.words || parsed.seed_phrase || parsed.seedPhrase);

    if (mnemonic.length < 12) {
        throw new Error('TON reserve wallet mnemonic is missing or invalid');
    }

    return { mnemonic, secretFile };
}

async function openReserveWallet() {
    const { mnemonic } = await loadReserveWalletSecret();
    const keyPair = await mnemonicToPrivateKey(mnemonic);
    const endpoint = String(process.env.TON_RESERVE_SENDER_ENDPOINT || process.env.TON_RESERVE_JSONRPC_ENDPOINT || DEFAULT_ENDPOINT).trim();
    const apiKey = String(process.env.TON_RESERVE_API_KEY || '').trim();
    const client = new TonClient({
        endpoint,
        apiKey: apiKey || undefined,
        timeout: envNumber('TON_RESERVE_SENDER_TIMEOUT_MS', 20_000, { min: 1_000 })
    });
    const wallet = WalletContractV4.create({
        workchain: 0,
        publicKey: keyPair.publicKey
    });
    const contract = client.open(wallet);

    return {
        client,
        contract,
        keyPair,
        walletAddress: wallet.address.toString({ bounceable: false })
    };
}

export function getTonReserveSenderConfig(enabledFlagName = 'REFERRAL_PAYOUT_SENDER_ENABLED', overrides = {}) {
    return {
        enabled: envFlag(enabledFlagName),
        enabledFlagName,
        endpoint: String(process.env.TON_RESERVE_SENDER_ENDPOINT || process.env.TON_RESERVE_JSONRPC_ENDPOINT || DEFAULT_ENDPOINT).trim(),
        walletSecretFile: String(process.env.TON_RESERVE_WALLET_SECRET_FILE || DEFAULT_WALLET_SECRET_FILE).trim(),
        estimatedNetworkFeeTon: overrides.estimatedNetworkFeeTon ?? envNumber('REFERRAL_PAYOUT_SENDER_NETWORK_FEE_TON', 0.05, { min: 0 }),
        minWalletBalanceTon: overrides.minWalletBalanceTon ?? envNumber('TON_RESERVE_SENDER_MIN_WALLET_BALANCE_TON', 0.2, { min: 0 })
    };
}

export async function sendTonFromReserve({
    to,
    amountTon,
    comment = '',
    enabledFlagName = 'REFERRAL_PAYOUT_SENDER_ENABLED',
    minWalletBalanceTon = undefined,
    estimatedNetworkFeeTon = undefined
}) {
    const config = getTonReserveSenderConfig(enabledFlagName, {
        minWalletBalanceTon,
        estimatedNetworkFeeTon
    });
    if (!config.enabled) {
        throw new Error(`TON reserve sender is disabled by ${config.enabledFlagName}`);
    }

    const normalizedAmountTon = normalizeTonAmount(amountTon);
    if (normalizedAmountTon <= 0) {
        throw new Error('TON transfer amount must be greater than zero');
    }

    const destination = Address.parse(String(to || '').trim());
    const { contract, keyPair, walletAddress } = await openReserveWallet();
    const walletBalanceNano = await withTonRpcRetry(
        () => contract.getBalance(),
        'reading reserve wallet balance'
    );
    const transferNano = toNano(String(normalizedAmountTon));
    const minBalanceNano = toNano(String(config.minWalletBalanceTon));

    if (walletBalanceNano < transferNano + minBalanceNano) {
        throw new Error('TON reserve wallet balance is not enough for payout and safety buffer');
    }

    const seqno = await withTonRpcRetry(
        () => contract.getSeqno(),
        'reading reserve wallet seqno'
    );
    await withTonRpcRetry(
        () => contract.sendTransfer({
            seqno,
            secretKey: keyPair.secretKey,
            messages: [
                internal({
                    to: destination,
                    value: transferNano,
                    body: String(comment || ''),
                    bounce: false
                })
            ]
        }),
        'sending reserve transfer'
    );

    return {
        amountTon: normalizedAmountTon,
        to: destination.toString({ bounceable: false }),
        comment: String(comment || ''),
        walletAddress,
        seqno,
        transferRef: `ton:${walletAddress}:${seqno}`,
        estimatedNetworkFeeTon: config.estimatedNetworkFeeTon,
        sentAt: new Date().toISOString()
    };
}
