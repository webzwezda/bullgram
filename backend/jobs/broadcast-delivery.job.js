/**
 * Cron-задача: доставка массовых рассылок (mark-and-queue).
 *
 * POST /api/broadcast/send больше не отправляет сообщения внутри HTTP-запроса:
 * он создаёт кампанию со статусом 'queued' и сразу вставляет все доставки
 * в broadcast_deliveries со статусом 'pending'. Эта джоба каждые 30 секунд:
 *   1. берёт ОДНУ кампанию: свежую 'queued' ИЛИ зависшую 'sending' (heartbeat в meta
 *      старше STALE_HEARTBEAT_MS — процесс умер посреди кампании);
 *   2. claim'ит её условным апдейтом в 'sending' — если 0 строк, кампанию забрал кто-то другой;
 *   3. доставляет pending-доставки по одной через MessagingRouter (ротация пула,
 *      квоты, паузы актёров, джиттер), маркируя исход каждой после факта отправки
 *      (send-then-mark: краш между отправкой и маркировкой даёт дубль одному
 *      получателю при резюме — осознанный трейд-офф);
 *   4. в try/finally пишет финальный статус: 'sent' или 'completed_with_errors'.
 *
 * Отмена кампании (POST /api/broadcast/campaigns/:id/cancel → status='cancelled')
 * выигрывает у всего: цикл доставки перед каждым получателем проверяет актуальный
 * статус, а финализация пишет статус только из 'sending'.
 *
 * У broadcast_campaigns нет колонки updated_at, поэтому «живость» кампании отслеживается
 * через meta.delivery_heartbeat_at — джоба обновляет его после каждой доставки,
 * а reaper считает кампанию зависшей, если heartbeat протух.
 */
import { UserbotService } from '../services/userbot.service.js';
import { MessagingRouter, resolveMessagingCaps } from '../services/messaging-router.service.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';
import {
    loadPreparationMatrix,
    createBroadcastDeliverySender,
    senderTypeUsesUserbot,
    isPureUserbotSenderType,
    hasDeliverableActor
} from '../services/broadcast-delivery.service.js';
import { wrapJobTick } from '../utils/job-runner.js';
import {
    claimNextCampaign,
    loadPendingDeliveries,
    failAllPending,
    isCampaignStillOurs,
    finalizeCampaign
} from './broadcast-delivery/campaign-ops.js';

const TICK_INTERVAL_MS = 30_000;

function isOperationalUserbot(account) {
    return String(account?.runtime_status || '').trim().toLowerCase() !== 'pending_activation';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function recordDmOutcomes(supabase, ownerId, sentIds, blockedByUser) {
    for (let i = 0; i < sentIds.length; i += 500) {
        await supabase
            .from('channel_audience_members')
            .update({ dm_last_sent_at: new Date().toISOString() })
            .eq('owner_id', ownerId)
            .in('tg_user_id', sentIds.slice(i, i + 500));
    }

    for (const [tgUserId, errorText] of Object.entries(blockedByUser)) {
        const { data: current } = await supabase
            .from('channel_audience_members')
            .select('dm_failed_count')
            .eq('owner_id', ownerId)
            .eq('tg_user_id', tgUserId)
            .limit(1);
        await supabase
            .from('channel_audience_members')
            .update({
                dm_blocked: true,
                dm_last_error: String(errorText || '').slice(0, 300),
                dm_failed_count: (current?.[0]?.dm_failed_count || 0) + 1
            })
            .eq('owner_id', ownerId)
            .eq('tg_user_id', tgUserId);
    }
}

export const startBroadcastDeliveryJob = (supabase, getBotById) => {
    const userbotService = new UserbotService(
        supabase,
        process.env.TG_API_ID,
        process.env.TG_API_HASH
    );
    // Весь юзербот-трафик рассылок — через роутер: квоты, паузы, ротация, джиттер.
    const messagingRouter = new MessagingRouter({
        supabase,
        sendUserbot: (account, tgUserId, text, options) =>
            userbotService.sendMessage(account, tgUserId, text, options)
    });
    const messagingCaps = resolveMessagingCaps(process.env);
    const { deliverToRecipient } = createBroadcastDeliverySender({ supabase, getBotById, router: messagingRouter });

    let running = false;

    // Юзерботы, выбранные для кампании. Пока кампания ждала в очереди, их могли продать
    // в shop или сломать — в работу берём только живых (правило: проданные активы не оперируют).
    async function loadSelectedUserbots(ownerId, userbotIds) {
        const ids = (Array.isArray(userbotIds) ? userbotIds : []).map(id => String(id)).filter(Boolean);
        if (ids.length === 0) return [];

        const reservedUserbotIds = await loadReservedUserbotIds(supabase, ownerId);
        const { data, error } = await supabase
            .from('tg_accounts')
            .select('*, proxies(is_working)')
            .eq('owner_id', ownerId)
            .eq('account_type', 'userbot')
            .in('id', ids);
        if (error) throw error;

        return ids
            .map(id => (data || []).find(account => String(account.id) === id))
            .filter(account =>
                account &&
                !reservedUserbotIds.has(String(account.id)) &&
                isOperationalUserbot(account) &&
                !(account.proxy_id && account.proxies?.is_working === false)
            );
    }

    async function deliverCampaign(campaign) {
        const meta = { ...(campaign.meta || {}) };
        const ownerId = campaign.owner_id;
        const senderType = meta.sender_type || 'official_only';
        const requestedDelayMs = Math.max(0, Math.min(Number(meta.delay_ms) || 0, 30000));
        // Нормализация как в /send: юзербот-рассылка — не быстрее 5 секунд между получателями
        const delayMs = senderTypeUsesUserbot(senderType) ? Math.max(5000, requestedDelayMs) : requestedDelayMs;

        const pending = await loadPendingDeliveries(supabase, campaign.id);

        // Чисто-юзерботная кампания без единого живого актёра (пул пуст, все в карантине/
        // бане или на длинной паузе) — ждать нечего, честно роняем кампанию. flood-паузы
        // временные: такие кампании продолжают тянуться по тикам через pending-строки.
        const selectedUserbots = await loadSelectedUserbots(ownerId, meta.sender_userbot_ids);
        if (pending.length > 0 && isPureUserbotSenderType(senderType) && !hasDeliverableActor(selectedUserbots)) {
            const queueError = 'Нет доступных юзерботов: все на паузе или в карантине. Разберите юзерботов и перезапустите рассылку.';
            console.error(`[BroadcastDelivery] Кампания ${campaign.id}: ${queueError} Помечаем ${pending.length} доставок как failed`);
            await failAllPending(supabase, campaign.id, queueError);
            await supabase
                .from('broadcast_campaigns')
                .update({ status: 'failed', meta: { ...meta, queue_error: queueError } })
                .eq('id', campaign.id)
                .eq('status', 'sending');
            return;
        }
        // Для official_then_* пустой пул юзерботов не фатален — официального бота это не касается.

        let preparationMatrix = null;
        if (meta.preparation_id) {
            try {
                preparationMatrix = await loadPreparationMatrix(supabase, ownerId, meta.preparation_id);
            } catch (matrixError) {
                // Матрица — только приоритезация touchpoint'ов: без неё шлём через обычный пул
                console.warn(`[BroadcastDelivery] Матрица подготовки ${meta.preparation_id} недоступна, шлём без приоритетных touchpoint'ов:`, matrixError?.message || matrixError);
            }
        }

        let sent = Number(meta.sent || 0);
        let failed = Number(meta.failed || 0);
        const dmSentIds = [];
        const dmBlockedByUser = {};

        try {
            for (let index = 0; index < pending.length; index++) {
                // Отмена/чужой статус — прекращаем доставку сразу, строки остаются как есть
                if (!(await isCampaignStillOurs(supabase, campaign.id))) {
                    console.log(`[BroadcastDelivery] Кампания ${campaign.id}: доставка остановлена — статус изменился (отмена?)`);
                    break;
                }

                const delivery = pending[index];
                const row = {
                    tg_user_id: delivery.tg_user_id,
                    channel_id: delivery.channel_id,
                    bot_id: delivery.meta?.bot_id || null,
                    source_type: delivery.meta?.source_type,
                    source_id: delivery.meta?.source_id,
                    channel_title: delivery.meta?.channel_title
                };

                const result = await deliverToRecipient({
                    ownerId,
                    campaignId: campaign.id,
                    messageText: campaign.message_text,
                    senderType,
                    selectedUserbots,
                    preparationMatrix,
                    row,
                    baseDelayMs: delayMs
                });

                // Весь пул на паузе/квоте: строку не трогаем (остаётся pending), тик заканчиваем —
                // квоты за этот тик не разморозятся. Финализация оставит кампанию в 'sending'.
                if (result.quotaWait) {
                    console.warn(`[BroadcastDelivery] Кампания ${campaign.id}: юзерботы пула на паузе или вне квоты — ${pending.length - index} доставок ждём до следующего тика`);
                    break;
                }

                if (result.deliveryStatus === 'sent') {
                    sent++;
                    if (result.sentViaUserbot) dmSentIds.push(String(delivery.tg_user_id));
                } else {
                    failed++;
                    if (result.blockedByUser) dmBlockedByUser[String(delivery.tg_user_id)] = result.errorText;
                }

                const { error: deliveryUpdateError } = await supabase
                    .from('broadcast_deliveries')
                    .update({
                        delivery_status: result.deliveryStatus,
                        error_text: result.errorText,
                        delivered_at: result.deliveredAt,
                        meta: {
                            ...(delivery.meta || {}),
                            ...(result.actualSenderUserbot ? {
                                sender_userbot_id: result.actualSenderUserbot.id,
                                sender_username: result.actualSenderUserbot.tg_username || result.actualSenderUserbot.tg_account_id
                            } : {})
                        }
                    })
                    .eq('id', delivery.id);
                if (deliveryUpdateError) {
                    // Не промаркировали — строка останется pending, следующий тик повторит доставку
                    console.error(`[BroadcastDelivery] Не обновили исход доставки ${delivery.id}:`, deliveryUpdateError.message);
                }

                // Прогресс + heartbeat одним апдейтом: по heartbeat reaper понимает, что кампания жива.
                // Guard по статусу: отмена кампании посреди получателя не должна быть затёрта —
                // при чужом статусе апдейт просто не попадёт в meta.
                meta.sent = sent;
                meta.failed = failed;
                meta.delivery_heartbeat_at = new Date().toISOString();
                const { error: progressError } = await supabase
                    .from('broadcast_campaigns')
                    .update({ meta })
                    .eq('id', campaign.id)
                    .eq('status', 'sending');
                if (progressError) {
                    console.error(`[BroadcastDelivery] Не обновили прогресс кампании ${campaign.id}:`, progressError.message);
                }

                if (delayMs > 0 && index < pending.length - 1) {
                    // Пейсинг между получателями с ±jitterPercent (роутер внутри доставки
                    // джиттерит только между попытками акторов — это другой уровень)
                    const jitterSpan = (messagingCaps.jitterPercent / 100) * delayMs;
                    await sleep(Math.max(0, delayMs + (Math.random() * 2 - 1) * jitterSpan));
                }
            }
        } finally {
            await recordDmOutcomes(supabase, ownerId, dmSentIds, dmBlockedByUser).catch(error => {
                console.error('[BroadcastDelivery] Ошибка записи DM-исходов:', error?.message || error);
            });
            await finalizeCampaign(supabase, campaign, meta);
        }
    }

    const runOnce = async () => {
        // Предыдущий тик ещё не закончился (длинная кампания с задержками) — пропускаем
        if (running) return;
        running = true;

        try {
            const campaign = await claimNextCampaign(supabase);
            if (!campaign) return; // кампаний нет — тихий выход
            await deliverCampaign(campaign);
        } catch (err) {
            console.error('[BroadcastDelivery] Ошибка тика:', err?.message || err);
        } finally {
            running = false;
        }
    };

    console.log('[BroadcastDelivery] started', {
        interval_ms: TICK_INTERVAL_MS,
        stale_heartbeat_ms: STALE_HEARTBEAT_MS
    });
    setInterval(wrapJobTick('broadcast-delivery', runOnce), TICK_INTERVAL_MS);
};
