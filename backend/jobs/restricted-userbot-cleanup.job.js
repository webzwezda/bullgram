import { purgeRestrictedUserbotAccount } from '../utils/restricted-userbot-ops.js';

const DEFAULT_RESTRICTED_USERBOT_TTL_HOURS = 72;
const DEFAULT_RESTRICTED_USERBOT_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

function restrictedUserbotCleanupEnabled() {
    return String(process.env.RESTRICTED_USERBOT_AUTO_DELETE_ENABLED || '').trim().toLowerCase() !== 'false';
}

function getRestrictedUserbotTtlHours() {
    const raw = Number(process.env.RESTRICTED_USERBOT_DELETE_AFTER_HOURS || DEFAULT_RESTRICTED_USERBOT_TTL_HOURS);
    if (!Number.isFinite(raw) || raw <= 0) {
        return DEFAULT_RESTRICTED_USERBOT_TTL_HOURS;
    }
    return raw;
}

function getCleanupIntervalMs() {
    const raw = Number(process.env.RESTRICTED_USERBOT_CLEANUP_INTERVAL_MS || DEFAULT_RESTRICTED_USERBOT_CLEANUP_INTERVAL_MS);
    if (!Number.isFinite(raw) || raw < 60 * 1000) {
        return DEFAULT_RESTRICTED_USERBOT_CLEANUP_INTERVAL_MS;
    }
    return raw;
}

export const startRestrictedUserbotCleanup = (supabase) => {
    if (!restrictedUserbotCleanupEnabled()) {
        console.log('[RestrictedUserbotCleanup] disabled by RESTRICTED_USERBOT_AUTO_DELETE_ENABLED flag');
        return;
    }

    const intervalMs = getCleanupIntervalMs();
    const ttlHours = getRestrictedUserbotTtlHours();

    const runCleanup = async () => {
        const cutoffIso = new Date(Date.now() - ttlHours * 60 * 60 * 1000).toISOString();

        try {
            const { data: accounts, error } = await supabase
                .from('tg_accounts')
                .select('id, owner_id, tg_username, tg_account_id, proxy_id, runtime_status, runtime_error')
                .eq('account_type', 'userbot')
                .eq('runtime_status', 'restricted');

            if (error) throw error;
            if (!accounts?.length) return;

            for (const account of accounts) {
                const { data: latestRestriction, error: restrictionError } = await supabase
                    .from('telegram_error_events')
                    .select('id, happened_at, restriction_kind, error_message')
                    .eq('owner_id', account.owner_id)
                    .eq('userbot_id', account.id)
                    .eq('is_restriction', true)
                    .in('restriction_kind', ['account_flagged', 'account_restricted', 'session_revoked'])
                    .order('happened_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (restrictionError) throw restrictionError;
                if (!latestRestriction?.happened_at) continue;
                if (String(latestRestriction.happened_at) > cutoffIso) continue;

                await purgeRestrictedUserbotAccount(supabase, account.owner_id, account, {
                    reason: latestRestriction.error_message || latestRestriction.restriction_kind || 'restricted_ttl_expired'
                });
            }
        } catch (error) {
            console.error('[RestrictedUserbotCleanup] job failed:', error);
        }
    };

    console.log('[RestrictedUserbotCleanup] started', {
        interval_ms: intervalMs,
        ttl_hours: ttlHours
    });

    runCleanup();
    setInterval(runCleanup, intervalMs);
};
