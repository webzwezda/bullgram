import {
    activateNormalForOrder,
    recordBillingEvent
} from '../services/bullrun-billing.service.js';

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const MIN_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_LIMIT = 50;
const DEFAULT_GRACE_PERIOD_MS = 2 * 60_000;

function isRetryEnabled() {
    return String(process.env.BILLING_ACTIVATION_RECOVERY_ENABLED || 'true')
        .trim().toLowerCase() !== 'false';
}

function envNumber(name, fallback, options = {}) {
    const parsed = Number(process.env[name] || fallback);
    if (!Number.isFinite(parsed)) return fallback;
    if (options.min && parsed < options.min) return fallback;
    if (options.max && parsed > options.max) return options.max;
    return parsed;
}

function getIntervalMs() {
    return envNumber('BILLING_ACTIVATION_RECOVERY_INTERVAL_MS', DEFAULT_INTERVAL_MS, { min: MIN_INTERVAL_MS });
}

function getBatchLimit() {
    return envNumber('BILLING_ACTIVATION_RECOVERY_BATCH_LIMIT', DEFAULT_BATCH_LIMIT, { min: 1, max: 500 });
}

function getGracePeriodMs() {
    return envNumber('BILLING_ACTIVATION_RECOVERY_GRACE_MS', DEFAULT_GRACE_PERIOD_MS, { min: 0 });
}

async function loadProfilesByOwnerIds(supabase, ownerIds) {
    if (ownerIds.length === 0) return new Map();
    const { data, error } = await supabase
        .from('profiles')
        .select('id, product_tier')
        .in('id', ownerIds);
    if (error) throw error;
    return new Map((data || []).map((p) => [p.id, String(p.product_tier || '').toLowerCase()]));
}

async function loadOrdersNeedingActivation(supabase) {
    const cutoff = new Date(Date.now() - getGracePeriodMs()).toISOString();
    const { data, error } = await supabase
        .from('billing_orders')
        .select('id, owner_id, plan_code, amount_rub, currency, duration_days, provider, provider_invoice_id, paid_at, payload')
        .eq('status', 'paid')
        .lt('paid_at', cutoff)
        .order('paid_at', { ascending: false })
        .limit(getBatchLimit());
    if (error) throw error;
    if (!data || data.length === 0) return [];

    const ownerIds = [...new Set(data.map((o) => o.owner_id))];
    const tierByOwner = await loadProfilesByOwnerIds(supabase, ownerIds);

    return data.filter((o) => {
        const tier = tierByOwner.get(o.owner_id) || 'trial';
        return tier !== 'normal' && tier !== 'pro';
    });
}

export function startBillingActivationRecovery(supabase) {
    if (!isRetryEnabled()) {
        console.log('[BillingRecovery] disabled by BILLING_ACTIVATION_RECOVERY_ENABLED flag');
        return;
    }

    const intervalMs = getIntervalMs();
    let running = false;

    const runOnce = async () => {
        if (running) return;
        running = true;
        try {
            const orders = await loadOrdersNeedingActivation(supabase);
            if (orders.length === 0) return;

            console.log(`[BillingRecovery] found ${orders.length} paid order(s) needing activation`);
            for (const order of orders) {
                try {
                    await activateNormalForOrder(supabase, order);
                    await recordBillingEvent(supabase, {
                        billing_order_id: order.id,
                        owner_id: order.owner_id,
                        event_type: 'activation_recovered',
                        provider: order.provider || 'ton_connect',
                        provider_invoice_id: order.provider_invoice_id || null,
                        amount_rub: Number(order.amount_rub || 0),
                        payload: {
                            recovered_at: new Date().toISOString(),
                            original_paid_at: order.paid_at
                        }
                    });
                    console.log(`[BillingRecovery] re-activated order ${order.id} for user ${order.owner_id}`);
                } catch (err) {
                    console.error(`[BillingRecovery] failed to activate order ${order.id}:`, err.message || err);
                }
            }
        } catch (err) {
            console.error('[BillingRecovery] poll failed:', err.message || err);
        } finally {
            running = false;
        }
    };

    console.log('[BillingRecovery] started', {
        interval_ms: intervalMs,
        batch_limit: getBatchLimit(),
        grace_ms: getGracePeriodMs()
    });
    runOnce();
    setInterval(runOnce, intervalMs);
}
