const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 90;

function envNumber(name, fallback, min) {
    const parsed = Number(process.env[name] || fallback);
    if (!Number.isFinite(parsed)) return fallback;
    if (min && parsed < min) return fallback;
    return parsed;
}

export function startPublicInvoicesCleanup(supabase) {
    const intervalMs = envNumber('PUBLIC_INVOICES_CLEANUP_INTERVAL_MS', DEFAULT_INTERVAL_MS, 60 * 1000);
    const retentionDays = envNumber('PUBLIC_INVOICES_RETENTION_DAYS', DEFAULT_RETENTION_DAYS, 1);

    const runCleanup = async () => {
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
        try {
            const { data, error } = await supabase
                .from('public_invoices')
                .delete()
                .lt('created_at', cutoff)
                .select('id');
            if (error) throw error;
            const count = Array.isArray(data) ? data.length : 0;
            if (count > 0) {
                console.log(`[PublicInvoicesCleanup] deleted ${count} record(s) older than ${retentionDays} days`);
            }
        } catch (err) {
            console.error('[PublicInvoicesCleanup] failed:', err.message || err);
        }
    };

    console.log('[PublicInvoicesCleanup] started', { interval_ms: intervalMs, retention_days: retentionDays });
    runCleanup();
    setInterval(runCleanup, intervalMs);
}
