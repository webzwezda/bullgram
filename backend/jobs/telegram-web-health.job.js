// Periodic health-check for the Telegram Web MTProto bridge.
//
// Scans telegram_web_audit for recent bridge_error events. When the
// error count in the rolling window exceeds threshold, logs a structured
// warning that ops can grep + react to. Does NOT auto-disable the feature
// — that's a human decision. The job's job is to surface the signal.
//
// Trigger: every TELEGRAM_WEB_HEALTH_INTERVAL_MS (default 5 min).
// Window:  TELEGRAM_WEB_HEALTH_WINDOW_MS (default 5 min, same as interval).

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_ERROR_THRESHOLD = 1;

function getIntervalMs() {
    const raw = Number(process.env.TELEGRAM_WEB_HEALTH_INTERVAL_MS || DEFAULT_INTERVAL_MS);
    if (!Number.isFinite(raw) || raw < 60 * 1000) return DEFAULT_INTERVAL_MS;
    return raw;
}

function getWindowMs() {
    const raw = Number(process.env.TELEGRAM_WEB_HEALTH_WINDOW_MS || DEFAULT_WINDOW_MS);
    if (!Number.isFinite(raw) || raw < 60 * 1000) return DEFAULT_WINDOW_MS;
    return raw;
}

function getThreshold() {
    const raw = Number(process.env.TELEGRAM_WEB_HEALTH_ERROR_THRESHOLD || DEFAULT_ERROR_THRESHOLD);
    if (!Number.isFinite(raw) || raw < 1) return DEFAULT_ERROR_THRESHOLD;
    return raw;
}

export const startTelegramWebHealth = (supabase) => {
    if (String(process.env.TELEGRAM_WEB_ENABLED || '').trim().toLowerCase() !== 'true') {
        console.log('[TelegramWebHealth] feature disabled, skipping health job');
        return null;
    }

    const intervalMs = getIntervalMs();
    const windowMs = getWindowMs();
    const threshold = getThreshold();

    const runCheck = async () => {
        const since = new Date(Date.now() - windowMs).toISOString();
        try {
            const { data, error } = await supabase
                .from('telegram_web_audit')
                .select('id, admin_id, userbot_id, action, error_code, error_message, created_at')
                .eq('action', 'bridge_error')
                .gte('created_at', since)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('[TelegramWebHealth] query failed:', error.message);
                return;
            }

            const errors = data || [];
            if (errors.length >= threshold) {
                // Structured log so ops dashboards can grep + alert.
                console.warn('[TelegramWebHealth] elevated error rate', JSON.stringify({
                    window_ms: windowMs,
                    threshold,
                    error_count: errors.length,
                    sample: errors.slice(0, 3).map((e) => ({
                        userbot_id: e.userbot_id,
                        error_code: e.error_code,
                        error_message: e.error_message,
                        created_at: e.created_at
                    }))
                }));
            } else if (errors.length > 0) {
                console.log(`[TelegramWebHealth] ${errors.length} bridge error(s) in last ${Math.round(windowMs / 1000)}s (under threshold ${threshold})`);
            }
        } catch (err) {
            console.error('[TelegramWebHealth] check crashed:', err.message);
        }
    };

    const timer = setInterval(runCheck, intervalMs);
    if (timer.unref) timer.unref();
    // Don't fire immediately on boot — let the first interval tick.
    console.log(`[TelegramWebHealth] started: interval=${Math.round(intervalMs / 1000)}s window=${Math.round(windowMs / 1000)}s threshold=${threshold}`);
    return timer;
};
