/**
 * Чистые supabase-операции над кампанией рассылки — вынесены из broadcast-delivery.job.js
 * без изменения поведения (разрезка под pre-commit лимит 20KB). supabase передаётся
 * первым аргументом; тик-константа TICK_INTERVAL_MS остаётся в job-файле.
 */
import {
    planCampaignFinalization,
    isDeliverableCampaignStatus
} from '../../services/broadcast-delivery.service.js';

const STALE_HEARTBEAT_MS = 10 * 60_000;
const DELIVERY_PAGE_SIZE = 1000;

export async function claimNextCampaign(supabase) {
    // 1) Свежие queued — самые старые первыми
    const { data: queued, error: queuedError } = await supabase
        .from('broadcast_campaigns')
        .select('id, owner_id, message_text, status, meta')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1);
    if (queuedError) {
        console.error('[BroadcastDelivery] Ошибка выборки queued-кампаний:', queuedError.message);
        return null;
    }
    let candidate = queued?.[0] || null;

    // 2) Reaper: 'sending' с протухшим heartbeat — кампания пережила смерть процесса
    if (!candidate) {
        const { data: sending, error: sendingError } = await supabase
            .from('broadcast_campaigns')
            .select('id, owner_id, message_text, status, meta')
            .eq('status', 'sending')
            .order('created_at', { ascending: true })
            .limit(20);
        if (sendingError) {
            console.error('[BroadcastDelivery] Ошибка выборки sending-кампаний:', sendingError.message);
            return null;
        }
        const now = Date.now();
        candidate = (sending || []).find(campaign => {
            const heartbeatAt = campaign.meta?.delivery_heartbeat_at ? Date.parse(campaign.meta.delivery_heartbeat_at) : 0;
            return now - heartbeatAt > STALE_HEARTBEAT_MS;
        }) || null;
    }

    if (!candidate) return null;

    // Claim условным апдейтом: если 0 строк — кампанию забрал кто-то другой
    // или её успели отменить ('cancelled' не claim'аем), пропускаем
    const nowIso = new Date().toISOString();
    const claimedMeta = {
        ...(candidate.meta || {}),
        delivery_started_at: candidate.meta?.delivery_started_at || nowIso,
        delivery_heartbeat_at: nowIso
    };
    const { data: claimed, error: claimError } = await supabase
        .from('broadcast_campaigns')
        .update({ status: 'sending', meta: claimedMeta })
        .eq('id', candidate.id)
        .in('status', ['queued', 'sending'])
        .select('id');
    if (claimError) {
        console.error(`[BroadcastDelivery] Ошибка claim кампании ${candidate.id}:`, claimError.message);
        return null;
    }
    if (!claimed || claimed.length === 0) return null;

    return { ...candidate, meta: claimedMeta };
}

export async function loadPendingDeliveries(supabase, campaignId) {
    const rows = [];
    let from = 0;
    while (true) {
        const { data, error } = await supabase
            .from('broadcast_deliveries')
            .select('id, tg_user_id, channel_id, delivery_status, meta')
            .eq('campaign_id', campaignId)
            .eq('delivery_status', 'pending')
            .order('created_at', { ascending: true })
            .range(from, from + DELIVERY_PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < DELIVERY_PAGE_SIZE) break;
        from += DELIVERY_PAGE_SIZE;
    }
    return rows;
}

export async function failAllPending(supabase, campaignId, reason) {
    const { error } = await supabase
        .from('broadcast_deliveries')
        .update({ delivery_status: 'failed', error_text: reason })
        .eq('campaign_id', campaignId)
        .eq('delivery_status', 'pending');
    if (error) {
        console.error(`[BroadcastDelivery] Не пометили pending-доставки кампании ${campaignId} как failed:`, error.message);
    }
}

// Отмена посреди кампании: статус читаем перед каждым получателем.
// Ошибка чтения — не повод рвать доставку, считаем что кампания ещё наша.
export async function isCampaignStillOurs(supabase, campaignId) {
    const { data, error } = await supabase
        .from('broadcast_campaigns')
        .select('status')
        .eq('id', campaignId)
        .maybeSingle();
    if (error) return true;
    return isDeliverableCampaignStatus(data?.status);
}

// Финал по фактическому состоянию БД, а не по локальным счётчикам.
// Статус пишем только из 'sending': отмена кампании всегда выигрывает у финализации.
export async function finalizeCampaign(supabase, campaign, meta) {
    try {
        const { data: rows, error } = await supabase
            .from('broadcast_deliveries')
            .select('delivery_status')
            .eq('campaign_id', campaign.id);
        if (error) throw error;

        const decision = planCampaignFinalization(rows || [], meta);

        if (decision.action === 'wait') {
            if (decision.refreshHeartbeat) {
                console.warn(`[BroadcastDelivery] Кампания ${campaign.id}: ${decision.counts.pending} доставок остались pending — вернёмся следующим тиком`);
                await supabase
                    .from('broadcast_campaigns')
                    .update({ meta: decision.meta })
                    .eq('id', campaign.id)
                    .eq('status', 'sending');
            } else {
                console.warn(`[BroadcastDelivery] Кампания ${campaign.id}: доставок ещё нет, ждём вставки из /send`);
            }
            return;
        }

        const { data: finalized, error: finalizeError } = await supabase
            .from('broadcast_campaigns')
            .update({
                status: decision.status,
                sent_at: decision.meta.delivery_finished_at,
                meta: decision.meta
            })
            .eq('id', campaign.id)
            .in('status', ['sending'])
            .select('id');
        if (finalizeError) throw finalizeError;
        if (finalized && finalized.length > 0) {
            console.log(`[BroadcastDelivery] Кампания ${campaign.id} завершена: ${decision.status}, sent=${decision.counts.sent}, failed=${decision.counts.failed}`);
        } else {
            console.log(`[BroadcastDelivery] Кампания ${campaign.id}: финализация пропущена — статус уже не 'sending' (отменена?)`);
        }
    } catch (error) {
        console.error(`[BroadcastDelivery] Не финализировали кампанию ${campaign.id}:`, error?.message || error);
    }
}
