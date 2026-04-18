import { processReferralPayoutSenderBatch } from '../services/referral-payout-sender.service.js';
import { getTonReserveSenderConfig } from '../services/ton-reserve-sender.service.js';

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 30_000;

function envNumber(name, fallback, options = {}) {
    const parsed = Number(process.env[name] || fallback);
    if (!Number.isFinite(parsed)) return fallback;
    if (options.min !== undefined && parsed < options.min) return fallback;
    if (options.max !== undefined && parsed > options.max) return options.max;
    return parsed;
}

export function startReferralPayoutSender(supabase) {
    const config = getTonReserveSenderConfig();
    if (!config.enabled) {
        console.log('[ReferralPayoutSender] disabled by REFERRAL_PAYOUT_SENDER_ENABLED flag');
        return;
    }

    const intervalMs = envNumber('REFERRAL_PAYOUT_SENDER_INTERVAL_MS', DEFAULT_INTERVAL_MS, {
        min: MIN_INTERVAL_MS
    });
    let running = false;

    const runOnce = async () => {
        if (running) return;
        running = true;

        try {
            const result = await processReferralPayoutSenderBatch(supabase);
            if (result.processed > 0) {
                console.log('[ReferralPayoutSender] processed', {
                    processed: result.processed
                });
            }
        } catch (error) {
            console.error('[ReferralPayoutSender] failed:', error.message || error);
        } finally {
            running = false;
        }
    };

    runOnce();
    setInterval(runOnce, intervalMs);
    console.log('[ReferralPayoutSender] started', {
        interval_ms: intervalMs,
        endpoint: config.endpoint,
        estimated_network_fee_ton: config.estimatedNetworkFeeTon
    });
}
