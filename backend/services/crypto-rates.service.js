import axios from 'axios';

const DEFAULT_PROVIDER = 'coingecko';
const DEFAULT_COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
const DEFAULT_TON_COINGECKO_ID = 'the-open-network';
const DEFAULT_RATE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function normalizeCurrency(value) {
    const currency = String(value || '').trim().toUpperCase();
    if (currency === 'USD') return 'USDT';
    return currency;
}

function numberOrNull(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getCoinGeckoApiBase() {
    return String(process.env.COINGECKO_API_BASE || DEFAULT_COINGECKO_API_BASE).replace(/\/$/, '');
}

function getCoinGeckoHeaders() {
    const apiKey = String(process.env.COINGECKO_API_KEY || '').trim();
    if (!apiKey) return {};

    const headerName = String(process.env.COINGECKO_API_KEY_HEADER || 'x-cg-demo-api-key').trim();
    return { [headerName]: apiKey };
}

function getRateMaxAgeMs() {
    const parsed = Number(process.env.CRYPTO_RATE_MAX_AGE_MS || DEFAULT_RATE_MAX_AGE_MS);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RATE_MAX_AGE_MS;
}

export async function fetchTonExchangeRates() {
    const apiBase = getCoinGeckoApiBase();
    const tonId = String(process.env.COINGECKO_TON_ID || DEFAULT_TON_COINGECKO_ID).trim();
    const { data } = await axios.get(`${apiBase}/simple/price`, {
        params: {
            ids: tonId,
            vs_currencies: 'rub,usd',
            include_last_updated_at: true,
            precision: 'full'
        },
        headers: getCoinGeckoHeaders(),
        timeout: 15_000
    });

    const row = data?.[tonId];
    const rubRate = numberOrNull(row?.rub);
    const usdRate = numberOrNull(row?.usd);
    const fetchedAt = row?.last_updated_at
        ? new Date(Number(row.last_updated_at) * 1000).toISOString()
        : new Date().toISOString();

    const rates = [];
    if (rubRate) {
        rates.push({
            base_currency: 'TON',
            quote_currency: 'RUB',
            rate: rubRate,
            provider: DEFAULT_PROVIDER,
            fetched_at: fetchedAt,
            payload: { source: 'simple/price', coin_id: tonId, quote: 'rub', raw: row }
        });
    }

    if (usdRate) {
        rates.push({
            base_currency: 'TON',
            quote_currency: 'USDT',
            rate: usdRate,
            provider: DEFAULT_PROVIDER,
            fetched_at: fetchedAt,
            payload: { source: 'simple/price', coin_id: tonId, quote: 'usd', usdt_priced_as_usd: true, raw: row }
        });
    }

    if (rates.length === 0) {
        throw new Error('CoinGecko did not return TON/RUB or TON/USD rates');
    }

    return rates;
}

export async function refreshTonExchangeRates(supabase) {
    const rates = await fetchTonExchangeRates();
    const { data, error } = await supabase
        .from('crypto_exchange_rates')
        .insert(rates)
        .select('*');

    if (error) throw error;
    return data || [];
}

export async function getLatestTonExchangeRate(supabase, quoteCurrency, options = {}) {
    const normalizedQuote = normalizeCurrency(quoteCurrency);
    if (normalizedQuote === 'TON') {
        return {
            id: null,
            base_currency: 'TON',
            quote_currency: 'TON',
            rate: 1,
            provider: 'native',
            fetched_at: new Date().toISOString()
        };
    }

    const maxAgeMs = options.maxAgeMs || getRateMaxAgeMs();
    const minFetchedAt = new Date(Date.now() - maxAgeMs).toISOString();

    const { data, error } = await supabase
        .from('crypto_exchange_rates')
        .select('*')
        .eq('base_currency', 'TON')
        .eq('quote_currency', normalizedQuote)
        .gte('fetched_at', minFetchedAt)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    if (data) return data;

    await refreshTonExchangeRates(supabase);

    const { data: refreshed, error: refreshedError } = await supabase
        .from('crypto_exchange_rates')
        .select('*')
        .eq('base_currency', 'TON')
        .eq('quote_currency', normalizedQuote)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (refreshedError) throw refreshedError;
    return refreshed || null;
}

export async function convertAmountToTon(supabase, amount, currency, options = {}) {
    const normalizedCurrency = normalizeCurrency(currency);
    const amountNumber = Number(amount || 0);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return null;

    if (normalizedCurrency === 'TON') {
        return {
            amountTon: Number(amountNumber.toFixed(options.precision || 6)),
            rate: {
                id: null,
                base_currency: 'TON',
                quote_currency: 'TON',
                rate: 1,
                provider: 'native',
                fetched_at: new Date().toISOString()
            }
        };
    }

    const rate = await getLatestTonExchangeRate(supabase, normalizedCurrency, options);
    if (!rate?.rate) return null;

    return {
        amountTon: Number((amountNumber / Number(rate.rate)).toFixed(options.precision || 6)),
        rate
    };
}
