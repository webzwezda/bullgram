/**
 * Cron-задача: Брошенные корзины (Abandoned Cart) с умной защитой и скидками.
 * Запускается каждые 15 минут.
 */

import { deliverViaBot, stripMarkdownDecor } from '../utils/bot-send.js';

export const startAbandonedCart = (supabase, getBotFunction) => {
    // Политика маркировки: reminded/reminded_at ставятся только по финальному исходу — доставлено ботом или дефинитивный скип; транзиентные ошибки не маркируем, чтобы следующий тик повторил попытку (сумма счёта не мутируется, ретрай безопасен)
    async function markReminded(invoiceId) {
        const { error } = await supabase
            .from('invoices')
            .update({ reminded: true, reminded_at: new Date().toISOString() })
            .eq('id', invoiceId);
        if (error) {
            // Не промаркировали — следующий тик отправит повторно, поэтому сбой должен быть виден в логах
            console.error('[Брошенная корзина] Не поставили reminded/reminded_at:', error.message);
        }
    }

    async function logAbandonedEvent(invoice, ownerId, channelId, payload) {
        try {
            await supabase.from('access_events').insert({
                owner_id: ownerId,
                channel_id: channelId,
                invoice_id: invoice.id,
                tg_user_id: String(invoice.tg_user_id),
                event_source: 'abandoned',
                event_type: 'abandoned_reminder',
                payload
            });
        } catch (logErr) {
            console.error('[Брошенная корзина] Не записали access_event:', logErr?.message || logErr);
        }
    }

    let running = false;
    setInterval(async () => {
        // Предыдущий тик ещё не закончился — пропускаем
        if (running) return;
        running = true;

        const now = new Date();
        // Ищем счета старше 2 часов, но младше 3 часов
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
        const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();

        try {
            // Только pending: awaiting_receipt — клиент уже в процессе оплаты, дожимать его скидкой нельзя.
            // tariffs!inner + is_active: инвойсы с удалённым/выключенным тарифом не приходят в выборку в принципе.
            const { data: abandonedInvoices, error } = await supabase
                .from('invoices')
                .select(`*, tariffs!inner ( id, title, trial_label, is_trial, price, currency, is_active, owner_id, channel_id )`)
                .eq('status', 'pending')
                .eq('reminded', false)
                .eq('tariffs.is_active', true)
                .lte('created_at', twoHoursAgo)
                .gte('created_at', threeHoursAgo);

            if (error) throw error;
            if (!abandonedInvoices || abandonedInvoices.length === 0) return;

            for (const invoice of abandonedInvoices) {
                // Битые тарифы отсечены через tariffs!inner, но страхуемся как в retention
                if (!invoice.tariffs) continue;

                const channelId = invoice.tariffs.channel_id || null;
                const ownerId = invoice.tariffs.owner_id;

                try {
                    // Канал нужен ради bot_id; owner_id берём из tariffs!inner
                    const { data: channel } = await supabase
                        .from('channels')
                        .select('bot_id, owner_id')
                        .eq('id', channelId)
                        .maybeSingle();

                    if (!channel) {
                        // Канал удалён — дефинитивный скип
                        await logAbandonedEvent(invoice, ownerId, channelId, {
                            delivered_by: 'skipped',
                            bot_id: null,
                            tariff_id: invoice.tariff_id || null,
                            reason: 'channel_missing'
                        });
                        await markReminded(invoice.id);
                        continue;
                    }

                    // ЗАЩИТА №1: Проверяем, есть ли у юзера более НОВЫЕ счета на этот же тариф
                    const { data: newerInvoices } = await supabase
                        .from('invoices')
                        .select('id, status')
                        .eq('tg_user_id', invoice.tg_user_id)
                        .eq('tariff_id', invoice.tariff_id)
                        .gt('created_at', invoice.created_at);

                    // ЗАЩИТА №2: Проверяем, есть ли у юзера уже АКТИВНАЯ подписка на этот канал
                    const { data: activeSub } = await supabase
                        .from('subscriptions')
                        .select('id')
                        .eq('tg_user_id', invoice.tg_user_id)
                        .eq('channel_id', invoice.tariffs.channel_id)
                        .eq('status', 'active')
                        .maybeSingle();

                    // Если юзер уже пересоздал счет или уже подписан — просто "глушим" этот старый счет
                    if ((newerInvoices && newerInvoices.length > 0) || activeSub) {
                        const skipReason = activeSub ? 'already_subscribed' : 'newer_invoice_exists';
                        await logAbandonedEvent(invoice, ownerId, channelId, {
                            delivered_by: 'skipped',
                            bot_id: channel.bot_id,
                            tariff_id: invoice.tariff_id || null,
                            reason: skipReason
                        });
                        await markReminded(invoice.id);
                        continue;
                    }

                    const bot = getBotFunction(channel.bot_id);
                    if (!bot) {
                        // Бот не поднят — дефинитивный скип с логом, а не молчаливый ретрай каждый тик
                        await logAbandonedEvent(invoice, ownerId, channelId, {
                            delivered_by: 'skipped',
                            bot_id: channel.bot_id || null,
                            tariff_id: invoice.tariff_id || null,
                            reason: 'bot_missing'
                        });
                        await markReminded(invoice.id);
                        continue;
                    }

                    const { data: settings } = await supabase
                        .from('payment_settings')
                        .select('abandoned_text, abandoned_discount_percent')
                        .eq('owner_id', ownerId)
                        .maybeSingle();

                    // Клэмп скидки 0..99: админ мог вписать 150 — без клэмпа уехали бы в отрицательную цену
                    const discountPercent = Math.min(99, Math.max(0, Math.round(Number(settings?.abandoned_discount_percent) || 0)));

                    // Скидку НЕ пишем в счёт: цена считается на лету от базовой цены тарифа, invoice.amount остаётся нетронутым — повторные тики не накручивают скидку поверх скидки
                    const currency = invoice.tariffs.currency || invoice.currency;
                    const basePrice = Number(invoice.tariffs.price || 0);
                    const discountedPrice = discountPercent > 0
                        ? (currency === 'TON'
                            ? parseFloat((basePrice * (1 - discountPercent / 100)).toFixed(2))
                            : Math.round(basePrice * (1 - discountPercent / 100)))
                        : basePrice;

                    // Дефолтный текст (жирный в legacy Markdown — одиночная *, двойная ** ломает parse_mode); при 0% — вариант без скидочной строки
                    const defaultText = invoice.tariffs?.is_trial
                        ? `🧪 *Ты почти забрал пробник*\n\nЯ увидел, что ты хотел зайти через «*{tariff_name}*», но не добил оплату.\n\nЕсли хочешь быстро посмотреть, что внутри, просто вернись в бота и закончи оплату.\n\n👉 *Пробник нужен, чтобы быстро зайти и принять решение. Не тяни.*`
                        : `🛒 *Привет!*\n\nЯ заметил, что ты хотел купить «*{tariff_name}*», но остановился.\n\n${discountPercent > 0 ? `🎁 Только сейчас я даю тебе *скидку {discount_percent}%*!\nНовая цена: *{discount_price} {currency}* (вместо {old_price} {currency}).\n\n` : ''}Возвращайся и закончи оплату.\n\n👉 *Жми кнопку ниже, чтобы ${discountPercent > 0 ? 'забрать доступ' : 'продолжить оплату'}!*`;

                    const rawText = (settings && settings.abandoned_text) ? settings.abandoned_text : defaultText;

                    // Подстановка переменных в текст
                    const messageText = rawText
                        .replace(/{tariff_name}/g, invoice.tariffs.trial_label || invoice.tariffs.title)
                        .replace(/{discount_percent}/g, discountPercent)
                        .replace(/{discount_price}/g, discountedPrice)
                        .replace(/{old_price}/g, basePrice)
                        .replace(/{currency}/g, currency);

                    let botUsername = null;
                    try {
                        if (bot?.botInfo?.username) {
                            botUsername = bot.botInfo.username;
                        } else if (bot) {
                            const me = await bot.telegram.getMe();
                            botUsername = me?.username || null;
                        }
                    } catch (e) {
                        // не критично
                    }

                    // Гонка «оплатил между выборкой и отправкой»: дешёвый ре-чек статуса прямо перед дожимом.
                    // Счёт мог стать paid / awaiting_receipt / expired после выборки — дожимать скидкой такой счёт нельзя
                    const { data: currentInvoice, error: recheckError } = await supabase
                        .from('invoices')
                        .select('status')
                        .eq('id', invoice.id)
                        .maybeSingle();

                    if (recheckError) throw recheckError;

                    if (!currentInvoice || currentInvoice.status !== 'pending') {
                        const currentStatus = currentInvoice?.status || 'deleted';
                        console.log(`[Брошенная корзина] Счёт ${invoice.id} сменил статус (${currentStatus}) между выборкой и отправкой, пропускаем дожим`);
                        await logAbandonedEvent(invoice, ownerId, channelId, {
                            delivered_by: 'skipped',
                            bot_id: channel.bot_id || null,
                            tariff_id: invoice.tariff_id || null,
                            reason: 'status_changed',
                            status: currentStatus
                        });
                        await markReminded(invoice.id);
                        continue;
                    }

                    // Кнопка ведёт на abbuy_<tariff>: по клику создаётся СВЕЖИЙ счёт со скидкой, а не новый по полной цене
                    const result = await deliverViaBot(bot, invoice.tg_user_id, messageText, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{
                                    text: discountPercent > 0 ? '💳 Оплатить со скидкой' : '💳 Продолжить оплату',
                                    callback_data: `abbuy_${invoice.tariff_id}`
                                }]
                            ]
                        }
                    });

                    if (result.status === 'delivered') {
                        console.log(`[Брошенная корзина] Успешный дожим (скидка ${discountPercent}%) юзеру ${invoice.tg_user_id}${result.plainUsed ? ' (plain-text после parse-ошибки)' : ''}`);
                        await logAbandonedEvent(invoice, ownerId, channelId, {
                            delivered_by: 'bot',
                            parse_fallback: result.plainUsed,
                            bot_id: channel.bot_id,
                            bot_username: botUsername,
                            tariff_id: invoice.tariff_id || null,
                            message_text: result.plainUsed ? stripMarkdownDecor(messageText) : messageText,
                            discount_percent: discountPercent,
                            original_amount: basePrice,
                            discounted_amount: discountedPrice,
                            currency
                        });
                        await markReminded(invoice.id);
                        continue;
                    }

                    if (result.status === 'undeliverable') {
                        // Текст не ушёл даже plain-text'ом — дефинитивный исход, маркируем
                        console.warn(`[Брошенная корзина] Не доставили даже plain-text'ом юзеру ${invoice.tg_user_id}:`, result.error?.message || result.error);
                        await logAbandonedEvent(invoice, ownerId, channelId, {
                            delivered_by: 'failed',
                            bot_id: channel.bot_id,
                            tariff_id: invoice.tariff_id || null,
                            reason: 'plain_text_retry_failed',
                            error: result.error?.message || 'unknown'
                        });
                        await markReminded(invoice.id);
                        continue;
                    }

                    if (result.status === 'blocked') {
                        // Юзербот-фолбэка у дожима нет — блокировка бота финальна, ретраить нечего
                        console.warn(`[Брошенная корзина] Бот заблокирован у юзера ${invoice.tg_user_id}, маркируем без ретрая`);
                        await logAbandonedEvent(invoice, ownerId, channelId, {
                            delivered_by: 'skipped',
                            bot_id: channel.bot_id,
                            tariff_id: invoice.tariff_id || null,
                            discount_percent: discountPercent,
                            reason: 'bot_blocked'
                        });
                        await markReminded(invoice.id);
                        continue;
                    }

                    // transient — не финальный исход: не маркируем, следующий тик повторит попытку
                    console.warn(`[Брошенная корзина] Транзиентная ошибка доставки (${result.status}) юзеру ${invoice.tg_user_id}:`, result.error?.message || result.error);
                    await logAbandonedEvent(invoice, ownerId, channelId, {
                        delivered_by: result.status === 'blocked' ? 'blocked' : 'failed',
                        bot_id: channel.bot_id,
                        tariff_id: invoice.tariff_id || null,
                        discount_percent: discountPercent,
                        reason: result.status,
                        error: result.error?.message || 'unknown'
                    });
                } catch (invErr) {
                    // Ошибка одного счёта не должна ронять остаток батча; не маркируем — ретрай следующим тиком
                    console.error(`[Брошенная корзина] Ошибка обработки счёта ${invoice.id}:`, invErr?.message || invErr);
                    await logAbandonedEvent(invoice, ownerId, channelId, {
                        delivered_by: 'failed',
                        bot_id: null,
                        tariff_id: invoice.tariff_id || null,
                        error: invErr?.message || 'unknown'
                    });
                }
            }
        } catch (err) {
            console.error('Ошибка в Cron-Брошенные корзины:', err.message);
        } finally {
            running = false;
        }
    }, 15 * 60 * 1000); // Проверка каждые 15 минут
};
