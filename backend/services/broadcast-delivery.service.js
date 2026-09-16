// Общая логика доставки рассылок. Единственный источник для:
// - валидации POST /api/broadcast/send (матрица подготовки фильтрует аудиторию);
// - крон-джобы backend/jobs/broadcast-delivery.job.js (отправка одному получателю).
// До этого вся логика доставки жила в теле HTTP-хэндлера /send — из-за этого
// массовая отправка умирала вместе с сокетом.
//
// Юзербот-нога доставки идёт через MessagingRouter (ротация пула, квоты, паузы
// актёров, джиттер): docs/plans/2026-09-16-messaging-router.md.
import { classifyTelegramError } from '../utils/telegram-error-events.js';
import { isActorEligible } from './messaging-router.service.js';

const BLOCKED_BY_USER_KINDS = ['privacy_restricted', 'user_blocked', 'peer_invalid'];
// Причины неэлигибельности, которые не рассосутся сами: актёр мёртв до ручного разбора.
// Зеркало BLOCKED_USERBOT_STATUSES из messaging-router.service.js (там множество не экспортировано).
const PERMANENT_USERBOT_STATUSES = ['pending_activation', 'restricted', 'expired', 'error'];
// flood-пауза истекает сама — из-за неё кампанию не убиваем, только ждём.
const TRANSIENT_PAUSE_REASON = 'flood_wait';

export function senderTypeUsesUserbot(senderType = '') {
    return [
        'userbot_only',
        'official_then_userbot',
        'userbot_pool_round_robin',
        'official_then_userbot_pool'
    ].includes(String(senderType || '').trim());
}

function senderTypeUsesUserbotPool(senderType = '') {
    return [
        'userbot_pool_round_robin',
        'official_then_userbot_pool'
    ].includes(String(senderType || '').trim());
}

// Чисто-юзерботные кампании: без официального бота фолбэка нет вообще.
export function isPureUserbotSenderType(senderType = '') {
    return [
        'userbot_only',
        'userbot_pool_round_robin'
    ].includes(String(senderType || '').trim());
}

// Актёр не оживёт сам: карантин/бан/служебный статус/мёртвый прокси либо длинная пауза.
// flood-пауза — временная, такой актёр считается живым (доиграем после истечения).
export function isActorPermanentlyUnavailable(account, { now } = {}) {
    if (!account) return true;
    if (isActorEligible(account, { now })) return false;
    const runtimeStatus = String(account.runtime_status || '').trim().toLowerCase();
    if (PERMANENT_USERBOT_STATUSES.includes(runtimeStatus)) return true;
    if (account.proxy_id && account.proxies?.is_working === false) return true;
    const nowMs = now != null && Number.isFinite(new Date(now).getTime())
        ? new Date(now).getTime()
        : Date.now();
    const pausedUntilMs = account.dm_paused_until != null ? new Date(account.dm_paused_until).getTime() : NaN;
    if (Number.isFinite(pausedUntilMs) && pausedUntilMs > nowMs) {
        return String(account.dm_pause_reason || '') !== TRANSIENT_PAUSE_REASON;
    }
    return true;
}

// Есть ли в пуле хоть один актёр, способный доставить (не мёртв навсегда).
// Пустой пул или пул из одних трупов → кампания чисто-юзерботного типа не имеет смысла.
export function hasDeliverableActor(pool = [], { now } = {}) {
    return (Array.isArray(pool) ? pool : []).some(account => !isActorPermanentlyUnavailable(account, { now }));
}

// Только из 'sending' можно финализировать/доставлять: отмена и другой сторонний
// статус всегда выигрывают у финализации.
export function isDeliverableCampaignStatus(status) {
    return String(status || '').trim().toLowerCase() === 'sending';
}

/**
 * Чистое решение финализации по фактическому состоянию строк доставок.
 * Резюм зависшей кампании и легаси-кампании без pending-строк финализируются тем же путём.
 * rows: [{ delivery_status }], meta: счётчики кампании, nowIso — инжект для детерминизма.
 */
export function planCampaignFinalization(rows = [], meta = {}, nowIso = new Date().toISOString()) {
    const total = rows.length;
    const sentTotal = rows.filter(row => row.delivery_status === 'sent').length;
    const failedTotal = rows.filter(row => row.delivery_status === 'failed').length;
    const pendingTotal = rows.filter(row => row.delivery_status === 'pending').length;
    const counts = { sent: sentTotal, failed: failedTotal, pending: pendingTotal, total };

    // Есть незамаркированные доставки (сбой БД во время маркировки или весь пул на квоте/паузе) —
    // не финализируем: строки доиграют следующим тиком, свежий heartbeat не даёт reaper'у
    // утащить кампанию раньше времени.
    if (pendingTotal > 0) {
        return {
            action: 'wait',
            status: null,
            refreshHeartbeat: true,
            counts,
            meta: { ...meta, sent: sentTotal, failed: failedTotal, total, delivery_heartbeat_at: nowIso }
        };
    }

    // /send вставляет доставки ПОСЛЕ создания 'queued' кампании: если тик попал
    // в это окно, pending ещё нет, а meta.total обещает их получить. Финализировать
    // нельзя — оставшиеся батчи легли бы в уже закрытую кампанию и остались
    // pending навсегда (reaper берёт только queued/sending). Ждём следующего тика.
    if (total === 0 && Number(meta.total || 0) > 0) {
        return { action: 'wait', status: null, refreshHeartbeat: false, counts, meta: { ...meta, ...counts } };
    }

    return {
        action: 'finalize',
        status: failedTotal > 0 ? 'completed_with_errors' : 'sent',
        refreshHeartbeat: false,
        counts,
        meta: { ...meta, sent: sentTotal, failed: failedTotal, total, delivery_finished_at: nowIso }
    };
}

export async function loadPreparationMatrix(supabase, ownerId, preparationId) {
    const { data: preparation } = await supabase
        .from('broadcast_preparations')
        .select('id, status, userbot_ids')
        .eq('id', preparationId)
        .eq('owner_id', ownerId)
        .maybeSingle();

    if (!preparation) throw new Error('Подготовка не найдена');
    if (preparation.status !== 'ready') throw new Error('Подготовка еще не завершена — дождись статуса «готово»');

    const items = [];
    let from = 0;
    while (true) {
        const { data } = await supabase
            .from('broadcast_preparation_items')
            .select('tg_user_id, reachable_by')
            .eq('preparation_id', preparationId)
            .range(from, from + 999)
            .order('id', { ascending: true });
        if (!data || data.length === 0) break;
        items.push(...data);
        if (data.length < 1000) break;
        from += 1000;
    }

    const matrix = new Map();
    for (const item of items) {
        const touchpoints = Array.isArray(item.reachable_by) ? item.reachable_by : [];
        touchpoints.sort((a, b) => Number(b.confirmed) - Number(a.confirmed));
        matrix.set(String(item.tg_user_id), touchpoints);
    }
    return matrix;
}

/**
 * Пул юзерботов одной доставки + приоритетный touchpoint из матрицы подготовки.
 * Порядок внутри пула дальше решает роутер (touchpoint первым, затем по минимуму отправок).
 */
function buildUserbotPool(senderType, selectedUserbots, preparationMatrix, row) {
    const selectedUserbot = selectedUserbots[0] || null;
    let pool = senderTypeUsesUserbotPool(senderType)
        ? [...selectedUserbots]
        : [selectedUserbot].filter(Boolean);
    let touchpointActorId = null;
    let commonChatId = null;

    if (preparationMatrix) {
        const touchpoints = preparationMatrix.get(String(row.tg_user_id)) || [];
        const selectedIds = new Set(selectedUserbots.map(userbot => String(userbot.id)));
        const preferred = touchpoints.find(tp => selectedIds.has(String(tp.userbot_id)));
        if (preferred) {
            const preferredUserbot = selectedUserbots.find(userbot => String(userbot.id) === String(preferred.userbot_id));
            if (preferredUserbot && !pool.includes(preferredUserbot)) {
                pool = [preferredUserbot, ...pool];
            }
            touchpointActorId = String(preferred.userbot_id);
            if (preferred.via === 'shared_chat' && preferred.chat_id) {
                commonChatId = preferred.chat_id;
            }
        }
    }

    return { pool, touchpointActorId, commonChatId };
}

// true — весь пул сейчас на паузе или вне квоты (попыток не было, есть смысл ждать);
// false — есть готовый актёр, значит роутер пытался и не смог.
async function isPoolQuotaPaused(router, pool) {
    for (const account of pool) {
        if (!isActorEligible(account)) continue;
        try {
            const quota = await router.isUnderQuota(account.id);
            if (quota?.ok) return false;
        } catch (quotaError) {
            // Не смогли спросить квоту — считаем актёра готовым, строку не замораживаем
            console.warn('[BroadcastDelivery] Не проверили квоту юзербота:', quotaError?.message || quotaError);
            return false;
        }
    }
    return true;
}

// Роутер наружу отдаёт только общий 'pool_exhausted'; конкретную причину попыток
// (privacy/blocked/peer) добираем из леджера userbot_send_log за окно этой доставки,
// чтобы dm_blocked-writeback по заблокировавшим нас получателям не потерялся.
async function ledgerHasBlockedByUserAttempt(supabase, { ownerId, campaignId, tgUserId, sinceIso }) {
    if (!supabase || !campaignId) return false;
    try {
        const { count, error } = await supabase
            .from('userbot_send_log')
            .select('id', { count: 'exact', head: true })
            .eq('owner_id', ownerId)
            .eq('campaign_id', campaignId)
            .eq('tg_user_id', String(tgUserId))
            .eq('status', 'failed')
            .in('error_kind', BLOCKED_BY_USER_KINDS)
            .gte('created_at', sinceIso);
        if (error) {
            console.warn('[BroadcastDelivery] Не дочитали леджер попыток:', error.message);
            return false;
        }
        return (count || 0) > 0;
    } catch (ledgerError) {
        console.warn('[BroadcastDelivery] Не дочитали леджер попыток:', ledgerError?.message || ledgerError);
        return false;
    }
}

/**
 * Фабрика отправителя рассылки: официальный бот -> пул юзерботов через MessagingRouter,
 * с приоритетом touchpoint'а из матрицы подготовки. Наружу не бросает —
 * возвращает честный исход одной доставки. quotaWait=true значит «весь пул на
 * паузе/квоте»: строку оставляем pending и доигрываем следующим тиком.
 */
export function createBroadcastDeliverySender({ supabase, getBotById, router }) {
    if (!router) throw new Error('createBroadcastDeliverySender: нужен MessagingRouter');

    async function deliverToRecipient({ ownerId, campaignId, messageText, senderType, selectedUserbots, preparationMatrix, row, baseDelayMs = 5000 }) {
        const bot = row.bot_id ? getBotById(row.bot_id) : null;
        let deliveryStatus = 'failed';
        let errorText = null;
        let deliveredAt = null;
        let actualSenderUserbot = null;
        let sentViaUserbot = false;
        let blockedByUser = false;
        let quotaWait = false;
        const canUseOfficialBot = senderType === 'official_only' ||
            senderType === 'official_then_userbot' ||
            senderType === 'official_then_userbot_pool';
        const canFallbackToUserbot = senderType === 'official_then_userbot' ||
            senderType === 'official_then_userbot_pool';
        const canUseOnlyUserbot = senderType === 'userbot_only' ||
            senderType === 'userbot_pool_round_robin';

        try {
            if (canUseOfficialBot && bot) {
                await bot.telegram.sendMessage(row.tg_user_id, messageText, { parse_mode: 'Markdown' });
                deliveryStatus = 'sent';
                deliveredAt = new Date().toISOString();
            } else {
                throw new Error(
                    canUseOnlyUserbot
                        ? 'Выбран режим отправки только юзерботами'
                        : 'Официальный бот недоступен'
                );
            }
        } catch (botError) {
            try {
                if (!canFallbackToUserbot && !canUseOnlyUserbot) {
                    throw botError;
                }

                const { pool, touchpointActorId, commonChatId } = buildUserbotPool(senderType, selectedUserbots, preparationMatrix, row);
                if (pool.length === 0) throw botError;

                const attemptWindowStart = new Date().toISOString();
                const routerResult = await router.deliver({
                    ownerId,
                    tgUserId: row.tg_user_id,
                    text: messageText,
                    pool,
                    baseDelayMs,
                    touchpointActorId,
                    commonChatId,
                    eventSource: 'broadcast',
                    campaignId
                });

                if (routerResult.status === 'sent') {
                    deliveryStatus = 'sent';
                    deliveredAt = new Date().toISOString();
                    sentViaUserbot = true;
                    actualSenderUserbot = pool.find(userbot => String(userbot.id) === String(routerResult.actorId)) || null;
                } else if (routerResult.errorKind === 'pool_exhausted' && (await isPoolQuotaPaused(router, pool))) {
                    // Весь пул на паузе/вне квоты — попыток не было, доиграем следующим тиком
                    deliveryStatus = 'pending';
                    quotaWait = true;
                } else {
                    deliveryStatus = 'failed';
                    errorText = routerResult.errorText || botError.message || 'Не удалось доставить сообщение';
                    if (BLOCKED_BY_USER_KINDS.includes(routerResult.errorKind)) {
                        blockedByUser = true;
                    } else if (routerResult.errorKind === 'pool_exhausted') {
                        // Попытки были и провалились: причину blocked-by-user берём из леджера
                        blockedByUser = await ledgerHasBlockedByUserAttempt(supabase, {
                            ownerId,
                            campaignId,
                            tgUserId: row.tg_user_id,
                            sinceIso: attemptWindowStart
                        });
                    }
                }
            } catch (userbotError) {
                deliveryStatus = 'failed';
                errorText = userbotError.message || botError.message || 'Не удалось доставить сообщение';
                const classification = classifyTelegramError(userbotError);
                if (BLOCKED_BY_USER_KINDS.includes(classification.restriction_kind)) {
                    blockedByUser = true;
                }
            }
        }

        return { deliveryStatus, errorText, deliveredAt, actualSenderUserbot, sentViaUserbot, blockedByUser, quotaWait };
    }

    return { deliverToRecipient };
}
