/**
 * Юзербот-фолбэк ветка «бот заблокирован» из abandoned-cart.job.js — вынесена без
 * изменения поведения (разрезка под pre-commit лимит 20KB). deps/ctx приходят явно
 * из главного цикла (messagingRouter может быть DI-override из test-lifecycle-dm.js).
 * Контракт: все пути исходной ветки заканчивались `continue` — функция выполняет всю
 * ветку (env-чек, пул, доставку, лог, маркировку) и ничего не возвращает; главный
 * цикл после вызова делает `continue`.
 */
import { stripMarkdownDecor } from '../../utils/bot-send.js';

function isUserbotAbandonedDmEnabled() {
    return String(process.env.USERBOT_ABANDONED_DM_ENABLED || '').trim().toLowerCase() === 'true';
}

export async function deliverViaUserbotFallback(deps, ctx) {
    const { messagingRouter, loadAbandonedPool, logAbandonedEvent, markReminded } = deps;
    const { invoice, ownerId, channelId, channel, discountPercent, messageText } = ctx;

    if (!isUserbotAbandonedDmEnabled()) {
        // Флаг выключен — как раньше: блокировка бота финальна, ретраить нечего
        console.warn(`[Брошенная корзина] Бот заблокирован у юзера ${invoice.tg_user_id}, маркируем без ретрая`);
        await logAbandonedEvent(invoice, ownerId, channelId, {
            delivered_by: 'skipped',
            bot_id: channel.bot_id,
            tariff_id: invoice.tariff_id || null,
            discount_percent: discountPercent,
            reason: 'bot_blocked'
        });
        await markReminded(invoice.id);
        return;
    }

    // Флаг включён: добираем юзерботом из контурного пула бота (или всего пула владельца)
    try {
        const pool = await loadAbandonedPool(ownerId, channel.bot_id);
        if (pool.length === 0) {
            console.warn(`[Брошенная корзина] Бот заблокирован, юзерботов нет у owner ${ownerId} — маркируем без ретрая`);
            await logAbandonedEvent(invoice, ownerId, channelId, {
                delivered_by: 'failed',
                bot_id: channel.bot_id,
                tariff_id: invoice.tariff_id || null,
                discount_percent: discountPercent,
                error_kind: 'pool_exhausted',
                error: 'Нет доступных юзерботов для фолбэка.'
            });
            await markReminded(invoice.id);
            return;
        }

        // Юзербот шлёт без parse_mode и без кнопок — тот же plain-text каркас, что у retention
        const userbotResult = await messagingRouter.deliver({
            ownerId,
            tgUserId: invoice.tg_user_id.toString(),
            text: `🔔 Системное уведомление!\nМой бот не смог до тебя достучаться, пишу лично.\n\n${stripMarkdownDecor(messageText)}`,
            pool,
            eventSource: 'abandoned'
        });

        if (userbotResult.status === 'sent') {
            const actor = pool.find((account) => String(account.id) === String(userbotResult.actorId));
            console.log(`[Брошенная корзина] Дожим ушёл через Юзербота юзеру ${invoice.tg_user_id}`);
            await logAbandonedEvent(invoice, ownerId, channelId, {
                delivered_by: 'userbot',
                bot_id: channel.bot_id,
                userbot_id: userbotResult.actorId || null,
                userbot_username: actor?.tg_username || null,
                tariff_id: invoice.tariff_id || null,
                discount_percent: discountPercent,
                message_text: messageText
            });
        } else {
            console.warn(`[Брошенная корзина] Юзербот-пул не доставил юзеру ${invoice.tg_user_id}: ${userbotResult.errorKind} ${userbotResult.errorText || ''}`);
            await logAbandonedEvent(invoice, ownerId, channelId, {
                delivered_by: 'failed',
                bot_id: channel.bot_id,
                tariff_id: invoice.tariff_id || null,
                discount_percent: discountPercent,
                error_kind: userbotResult.errorKind || 'unknown',
                error: userbotResult.errorText || 'unknown'
            });
        }
        // Финальный исход (доставили или нет) — маркируем, бесконечного ретрая нет
        await markReminded(invoice.id);
    } catch (ubErr) {
        // Упал сам фолбэк (не отправка) — транзиентно, не маркируем
        console.error(`[Брошенная корзина] Ошибка юзербот-фолбэка:`, ubErr?.message || ubErr);
        await logAbandonedEvent(invoice, ownerId, channelId, {
            delivered_by: 'failed',
            bot_id: channel.bot_id,
            tariff_id: invoice.tariff_id || null,
            error: ubErr?.message || 'unknown'
        });
    }
}
