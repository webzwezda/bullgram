// Активное истечение pending-покупок shop. Без этой джобы строки остаются
// status='pending' до первого write-запроса: лот дольше положенного числится
// забронированным, а у покупателя висит «ждёт оплату».
const DEFAULT_INTERVAL_MS = 60 * 1000;
const DEFAULT_TTL_MINUTES = 30;

function envNumber(name, fallback, min) {
    const parsed = Number(process.env[name] || fallback);
    if (!Number.isFinite(parsed)) return fallback;
    if (min && parsed < min) return fallback;
    return parsed;
}

export function startShopPurchaseExpiry(supabase) {
    const intervalMs = envNumber('SHOP_PENDING_EXPIRY_CHECK_MS', DEFAULT_INTERVAL_MS, 10 * 1000);
    const ttlMinutes = envNumber('SHOP_PENDING_PURCHASE_TTL_MINUTES', DEFAULT_TTL_MINUTES, 1);

    const runExpiry = async () => {
        const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000).toISOString();
        try {
            const { data, error } = await supabase
                .from('shop_purchases')
                .update({ status: 'expired', updated_at: new Date().toISOString() })
                .eq('status', 'pending')
                .lt('created_at', cutoff)
                .select('id');
            if (error) throw error;
            const count = Array.isArray(data) ? data.length : 0;
            if (count > 0) {
                console.log(`[ShopPurchaseExpiry] expired ${count} pending purchase(s) older than ${ttlMinutes} min`);
            }
        } catch (err) {
            console.error('[ShopPurchaseExpiry] failed:', err.message || err);
        }
    };

    console.log('[ShopPurchaseExpiry] started', { interval_ms: intervalMs, ttl_minutes: ttlMinutes });
    runExpiry();
    setInterval(runExpiry, intervalMs);
}

