import { OfficialBotService } from '../services/official-bot.service.js';

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const MIN_INTERVAL_MS = 2 * 60 * 1000;
const DEFAULT_BATCH_LIMIT = 100;

function isRetryEnabled() {
    return String(process.env.REFERRAL_SETTLEMENT_RETRY_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function envNumber(name, fallback, options = {}) {
    const parsed = Number(process.env[name] || fallback);
    if (!Number.isFinite(parsed)) return fallback;
    if (options.min && parsed < options.min) return fallback;
    if (options.max && parsed > options.max) return options.max;
    return parsed;
}

function getIntervalMs() {
    return envNumber('REFERRAL_SETTLEMENT_RETRY_INTERVAL_MS', DEFAULT_INTERVAL_MS, { min: MIN_INTERVAL_MS });
}

function getBatchLimit() {
    return envNumber('REFERRAL_SETTLEMENT_RETRY_BATCH_LIMIT', DEFAULT_BATCH_LIMIT, { min: 1, max: 500 });
}

async function loadPaidInvoiceForAttribution(supabase, attribution) {
    let query = supabase
        .from('invoices')
        .select(`
            id,
            tg_user_id,
            amount,
            currency,
            status,
            paid_at,
            created_at,
            tariff_id,
            channel_id,
            tariffs!inner(id, title, price, currency, owner_id, channel_id, is_trial, trial_label)
        `)
        .eq('status', 'paid')
        .eq('tg_user_id', String(attribution.referred_tg_user_id))
        .eq('tariffs.owner_id', attribution.owner_id)
        .gte('paid_at', attribution.created_at)
        .order('paid_at', { ascending: true })
        .limit(1);

    if (attribution.expires_at) {
        query = query.lte('paid_at', attribution.expires_at);
    }

    const { data, error } = await query;
    if (error) throw error;

    return data?.[0] || null;
}

export function startReferralSettlementRetry(supabase, getBotFunction) {
    if (!isRetryEnabled()) {
        console.log('[ReferralSettlementRetry] disabled by REFERRAL_SETTLEMENT_RETRY_ENABLED flag');
        return;
    }

    const intervalMs = getIntervalMs();
    const batchLimit = getBatchLimit();
    const officialBotService = new OfficialBotService(supabase);
    let running = false;

    const runOnce = async () => {
        if (running) return;
        running = true;

        try {
            const { data: attributions, error } = await supabase
                .from('referral_attributions')
                .select('id, owner_id, referrer_tg_user_id, referred_tg_user_id, created_at, expires_at, converted_at, paid_invoice_id, discount_eligible')
                .is('converted_at', null)
                .not('referred_tg_user_id', 'is', null)
                .order('created_at', { ascending: true })
                .limit(batchLimit);

            if (error) throw error;
            if (!attributions?.length) return;

            let settled = 0;
            for (const attribution of attributions) {
                try {
                    if (attribution.discount_eligible === false) continue;

                    const invoice = await loadPaidInvoiceForAttribution(supabase, attribution);
                    if (!invoice?.tariffs) continue;

                    const result = await officialBotService.processReferralReward(
                        null,
                        invoice,
                        invoice.tariffs,
                        attribution.owner_id
                    );

                    if (result) settled += 1;
                } catch (settlementError) {
                    console.error('[ReferralSettlementRetry] attribution failed:', {
                        attribution_id: attribution.id,
                        error: settlementError.message || settlementError
                    });
                }
            }

            if (settled > 0) {
                console.log('[ReferralSettlementRetry] settled rewards', { settled });
            }
        } catch (error) {
            if ((error.message || '').includes('referral_attributions')) return;
            console.error('[ReferralSettlementRetry] job failed:', error.message || error);
        } finally {
            running = false;
        }
    };

    console.log('[ReferralSettlementRetry] started', {
        interval_ms: intervalMs,
        batch_limit: batchLimit
    });

    runOnce();
    setInterval(runOnce, intervalMs);
}
