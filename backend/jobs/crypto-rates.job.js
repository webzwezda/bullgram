import { refreshTonExchangeRates } from '../services/crypto-rates.service.js';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const MIN_INTERVAL_MS = 10 * 60 * 1000;

function isCryptoRatesEnabled() {
    return String(process.env.CRYPTO_RATES_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function getIntervalMs() {
    const parsed = Number(process.env.CRYPTO_RATES_INTERVAL_MS || DEFAULT_INTERVAL_MS);
    return Number.isFinite(parsed) && parsed >= MIN_INTERVAL_MS ? parsed : DEFAULT_INTERVAL_MS;
}

export function startCryptoRatesRefresh(supabase) {
    if (!isCryptoRatesEnabled()) {
        console.log('[CryptoRates] disabled by CRYPTO_RATES_ENABLED flag');
        return;
    }

    const intervalMs = getIntervalMs();
    let running = false;

    const runOnce = async () => {
        if (running) return;
        running = true;

        try {
            const rows = await refreshTonExchangeRates(supabase);
            console.log('[CryptoRates] refreshed TON rates', {
                quotes: rows.map(row => row.quote_currency),
                provider: rows[0]?.provider || 'unknown'
            });
        } catch (error) {
            console.error('[CryptoRates] refresh failed:', error.message || error);
        } finally {
            running = false;
        }
    };

    console.log('[CryptoRates] started', { interval_ms: intervalMs });
    runOnce();
    setInterval(runOnce, intervalMs);
}
