import { processReferralPayoutConfirmations } from '../services/referral-payout-confirmation.service.js';

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;

function envFlagDefaultTrue(name) {
    return String(process.env[name] || 'true').trim().toLowerCase() !== 'false';
}

function envNumber(name, fallback, options = {}) {
    const parsed = Number(process.env[name] || fallback);
    if (!Number.isFinite(parsed)) return fallback;
    if (options.min !== undefined && parsed < options.min) return fallback;
    if (options.max !== undefined && parsed > options.max) return options.max;
    return parsed;
}

export function startReferralPayoutConfirmation(supabase) {
    if (!envFlagDefaultTrue('REFERRAL_PAYOUT_CONFIRMATION_ENABLED')) {
        console.log('[ReferralPayoutConfirmation] disabled by REFERRAL_PAYOUT_CONFIRMATION_ENABLED flag');
        return;
    }

    const intervalMs = envNumber('REFERRAL_PAYOUT_CONFIRMATION_INTERVAL_MS', DEFAULT_INTERVAL_MS, {
        min: MIN_INTERVAL_MS
    });
    let running = false;

    const runOnce = async () => {
        if (running) return;
        running = true;

        try {
            const result = await processReferralPayoutConfirmations(supabase);
            if (result.checked > 0 || result.confirmed > 0) {
                console.log('[ReferralPayoutConfirmation] checked', result);
            }
        } catch (error) {
            console.error('[ReferralPayoutConfirmation] failed:', error.message || error);
        } finally {
            running = false;
        }
    };

    runOnce();
    setInterval(runOnce, intervalMs);
    console.log('[ReferralPayoutConfirmation] started', {
        interval_ms: intervalMs
    });
}
