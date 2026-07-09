import { OfficialBotService } from '../services/official-bot.service.js';
import {
    fetchRecentTransactions,
    matchInvoice
} from '../services/ton-connect-verify.service.js';

const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_MS = 10_000;
const TON_NANO = 1_000_000_000n;

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

function tonToNano(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0n;
    return BigInt(Math.round(numeric * Number(TON_NANO)));
}

function groupBy(list, keyFn) {
    const map = new Map();
    for (const item of list) {
        const key = keyFn(item);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
    }
    return map;
}

async function loadPendingInvoices(supabase) {
    const { data, error } = await supabase
        .from('invoices')
        .select('id, tg_user_id, amount, currency, memo, status, created_at, expires_at, tariff_id')
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

async function loadTariffsByIds(supabase, ids) {
    if (ids.length === 0) return new Map();
    const { data, error } = await supabase
        .from('tariffs')
        .select('id, owner_id, bot_id')
        .in('id', ids);

    if (error) throw error;
    return new Map((data || []).map((t) => [t.id, t]));
}

async function loadSellerWallets(supabase, ownerIds) {
    if (ownerIds.length === 0) return new Map();
    const { data, error } = await supabase
        .from('payment_settings')
        .select('owner_id, ton_wallet')
        .in('owner_id', ownerIds);

    if (error) throw error;
    return new Map((data || []).map((row) => [row.owner_id, row.ton_wallet || '']));
}

async function claimInvoicePaid(supabase, invoice, txHash) {
    const { data, error } = await supabase
        .from('invoices')
        .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            verified_at: new Date().toISOString(),
            tx_hash: txHash || null
        })
        .eq('id', invoice.id)
        .eq('status', 'pending')
        .select()
        .maybeSingle();

    if (error) throw error;
    return data;
}

async function markExpiredInvoices(supabase) {
    try {
        const { data, error } = await supabase
            .from('invoices')
            .update({ status: 'expired' })
            .eq('status', 'pending')
            .lt('expires_at', new Date().toISOString())
            .select('id');
        if (error) {
            console.error('[InvoiceAutoDetect] expired cleanup error:', error.message);
            return;
        }
        const count = Array.isArray(data) ? data.length : 0;
        if (count > 0) {
            console.log(`[InvoiceAutoDetect] marked ${count} invoice(s) as expired`);
        }
    } catch (err) {
        console.error('[InvoiceAutoDetect] expired cleanup failed:', err.message || err);
    }
}

export function startInvoiceAutoDetect(supabase, getBotById) {
    if (!envFlag('INVOICE_AUTODETECT_ENABLED')) {
        console.log('[InvoiceAutoDetect] disabled by INVOICE_AUTODETECT_ENABLED flag');
        return;
    }

    const intervalMs = envNumber('INVOICE_AUTODETECT_INTERVAL_MS', DEFAULT_INTERVAL_MS, {
        min: MIN_INTERVAL_MS
    });
    const officialBotService = new OfficialBotService(supabase);
    const tonapiBase = String(process.env.TONCONNECT_TONAPI_BASE || 'https://tonapi.io').replace(/\/$/, '');
    let running = false;

    const runOnce = async () => {
        if (running) return;
        running = true;

        try {
            const pendingInvoices = await loadPendingInvoices(supabase);
            await markExpiredInvoices(supabase);
            if (pendingInvoices.length === 0) return;

            const tariffIds = [...new Set(pendingInvoices.map((i) => i.tariff_id).filter(Boolean))];
            const tariffsById = await loadTariffsByIds(supabase, tariffIds);

            // Only TON-currency invoices are matchable via tonapi. Skip others silently.
            const tonInvoices = pendingInvoices.filter((inv) => {
                const tariff = tariffsById.get(inv.tariff_id);
                if (!tariff?.owner_id) return false;
                return String(inv.currency || '').toUpperCase() === 'TON';
            });
            if (tonInvoices.length === 0) return;

            const ownerIds = [...new Set(tonInvoices.map((inv) => tariffsById.get(inv.tariff_id).owner_id))];
            const walletsByOwner = await loadSellerWallets(supabase, ownerIds);

            // Group invoices by merchant wallet, then make one tonapi call per wallet.
            const byWallet = new Map();
            for (const inv of tonInvoices) {
                const ownerId = tariffsById.get(inv.tariff_id).owner_id;
                const wallet = walletsByOwner.get(ownerId);
                if (!wallet) continue;
                if (!byWallet.has(wallet)) byWallet.set(wallet, []);
                byWallet.get(wallet).push(inv);
            }

            for (const [wallet, invoices] of byWallet) {
                let transactions;
                try {
                    transactions = await fetchRecentTransactions({ merchantWallet: wallet, tonapiBase });
                } catch (err) {
                    console.error(`[InvoiceAutoDetect] tonapi fetch failed for ${wallet}:`, err.message || err);
                    continue;
                }

                for (const invoice of invoices) {
                    const expectedNano = tonToNano(invoice.amount);
                    if (expectedNano <= 0n) continue;

                    const matched = transactions
                        .map((tx) => matchInvoice({
                            tx,
                            expectedMemo: invoice.memo,
                            expectedNanoTon: expectedNano
                        }))
                        .find(Boolean);

                    if (!matched) continue;

                    const claimed = await claimInvoicePaid(supabase, invoice, matched.txHash);
                    if (!claimed) {
                        // Someone else (verify endpoint or admin) already activated this invoice.
                        continue;
                    }

                    const bot = typeof getBotById === 'function' ? getBotById(tariffsById.get(invoice.tariff_id).bot_id) : null;
                    if (!bot) {
                        console.warn(`[InvoiceAutoDetect] bot not running for invoice ${invoice.id} (bot_id=${tariffsById.get(invoice.tariff_id).bot_id}); subscription activation deferred`);
                        continue;
                    }

                    try {
                        await officialBotService.activateSubscription(bot, claimed);
                        console.log(`[InvoiceAutoDetect] invoice ${invoice.id} auto-activated, tx=${matched.txHash}`);
                    } catch (err) {
                        console.error(`[InvoiceAutoDetect] activateSubscription failed for ${invoice.id}:`, err.message || err);
                    }
                }
            }
        } catch (error) {
            console.error('[InvoiceAutoDetect] poll failed:', error.message || error);
        } finally {
            running = false;
        }
    };

    console.log('[InvoiceAutoDetect] started', { interval_ms: intervalMs });
    runOnce();
    setInterval(runOnce, intervalMs);
}
