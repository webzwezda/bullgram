import { UserbotService } from '../services/userbot.service.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';
// Хелперы доставки переехали в общий util (единственный источник; до этого дублировались здесь и в abandoned-cart.job.js)
import { deliverViaBot, stripMarkdownDecor } from '../utils/bot-send.js';

function isUserbotRetentionDmEnabled() {
    return String(process.env.USERBOT_RETENTION_DM_ENABLED || '').trim().toLowerCase() === 'true';
}

function isOperationalUserbot(account) {
    return String(account?.runtime_status || '').trim().toLowerCase() !== 'pending_activation';
}

/**
 * Cron-задача: Напоминания за 24 часа до окончания подписки
 * Запускается каждые 5 минут, проверяет подписки которые истекают через 24ч
 * и отправляет напоминания (сначала ботом, если заблокирован - юзерботом)
 */

export const startRetention = (supabase, getBotFunction) => {
    const userbotService = new UserbotService(
        supabase,
        process.env.TG_API_ID,
        process.env.TG_API_HASH
    );

    async function loadLatestUserbot(ownerId) {
        const reservedUserbotIds = await loadReservedUserbotIds(supabase, ownerId);
        const { data, error } = await supabase
            .from('tg_accounts')
            .select('*, proxies(is_working)')
            .eq('owner_id', ownerId)
            .eq('account_type', 'userbot')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return (data || []).find(account =>
            !reservedUserbotIds.has(String(account.id)) &&
            isOperationalUserbot(account) &&
            !(account.proxy_id && account.proxies?.is_working === false)
        ) || null;
    }

    // Политика маркировки: last_reminder_sent_at ставится только по финальному исходу — доставлено ботом/юзерботом или дефинитивный скип; транзиентные ошибки не маркируем, чтобы следующий тик повторил попытку
    async function markReminderSent(subscriptionId) {
        const { error } = await supabase
            .from('subscriptions')
            .update({ last_reminder_sent_at: new Date().toISOString() })
            .eq('id', subscriptionId);
        if (error) {
            // Не промаркировали — следующий тик отправит повторно, поэтому сбой должен быть виден в логах
            console.error('[Напоминание] Не поставили last_reminder_sent_at:', error.message);
        }
    }

    async function logReminderEvent(sub, ownerId, botId, payload) {
        try {
            await supabase.from('access_events').insert({
                owner_id: ownerId,
                channel_id: sub.channel_id || null,
                subscription_id: sub.id,
                tg_user_id: String(sub.tg_user_id),
                event_source: 'retention',
                event_type: 'retention_reminder',
                payload
            });
        } catch (logErr) {
            console.error('[Напоминание] Не записали access_event:', logErr?.message || logErr);
        }
    }

    let running = false;
    setInterval(async () => {
        // Предыдущий тик ещё не закончился — пропускаем
        if (running) return;
        running = true;

        try {
            const now = new Date();
            const nowIso = now.toISOString();
            const targetTime = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
            const reminderWindowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

            // Ищем подписки, которые истекают в ближайшие 24 часа и которым ещё не отправляли напоминание (или прошло больше суток)
            const { data: expiringSubs, error } = await supabase
                .from('subscriptions')
                .select(`id, tg_user_id, channel_id, channels!inner ( owner_id, bot_id, title )`)
                .eq('status', 'active')
                .gt('expires_at', nowIso)
                .lte('expires_at', targetTime)
                .or(`last_reminder_sent_at.is.null,last_reminder_sent_at.lt.${reminderWindowStart}`)
                .limit(100);

            if (error) {
                console.error('[Напоминание] Ошибка выборки подписок:', error.message);
                return;
            }
            if (!expiringSubs || expiringSubs.length === 0) return;

            for (const sub of expiringSubs) {
                try {
                    // Гард: без канала дальше делать нечего (удалённые каналы не должны проходить из-за channels!inner)
                    if (!sub.channels) continue;

                    const ownerId = sub.channels.owner_id;
                    const botId = sub.channels.bot_id;
                    const bot = getBotFunction(botId);

                    let sourceTariff = null;
                    let upsellTariff = null;
                    let lastPaidTariff = null;
                    try {
                        // Скоуп по владельцу: чужие инвойсы и тарифы не должны влиять на текст и deep-link
                        const { data: recentInvoices } = await supabase
                            .from('invoices')
                            .select('id, tariff_id, paid_at, tariffs!inner(id, title, is_trial, upsell_tariff_id, price, currency)')
                            .eq('tg_user_id', sub.tg_user_id)
                            .eq('status', 'paid')
                            .eq('tariffs.owner_id', ownerId)
                            .order('paid_at', { ascending: false })
                            .limit(20);

                        sourceTariff = (recentInvoices || []).find(invoice =>
                            invoice.tariffs &&
                            invoice.tariffs.is_trial
                        )?.tariffs || null;

                        lastPaidTariff = (recentInvoices || []).find(invoice =>
                            invoice.tariffs && !invoice.tariffs.is_trial
                        )?.tariffs || null;

                        if (sourceTariff?.upsell_tariff_id) {
                            const { data } = await supabase
                                .from('tariffs')
                                .select('id, title, price, currency')
                                .eq('id', sourceTariff.upsell_tariff_id)
                                .eq('owner_id', ownerId)
                                .maybeSingle();
                            upsellTariff = data || null;
                        }
                    } catch (e) {
                        // Не валим удержание, если пробный сценарий не прочитался
                    }

                    // 1. Берем кастомный текст админа из базы
                    const { data: settings } = await supabase.from('payment_settings').select('reminder_text').eq('owner_id', ownerId).single();

                    // Дефолтный текст, если админ ничего не написал (жирный в legacy Markdown — одиночная *, двойная ** ломает parse_mode)
                    const defaultText = sourceTariff?.is_trial && upsellTariff
                        ? `⏳ *Пробник почти закончился*\n\nТвой доступ в «*{channel_name}*» скоро сгорит.\n\nЕсли хочешь остаться дальше, переходи в основной тариф:\n*{upsell_tariff_name}* — *{upsell_price} {upsell_currency}*\n\n👉 {renewal_link}`
                        : `⏳ *Привет!*\n\nТвой доступ в закрытый канал «*{channel_name}*» закончится менее чем через 24 часа.\n\nЧтобы не потерять доступ, продли в один клик:\n👉 {renewal_link}\n\n_Если уже оплатил — просто проигнорируй это сообщение._`;

                    let rawText = (settings && settings.reminder_text) ? settings.reminder_text : defaultText;

                    // Определяем тариф для продления и строим deep-link
                    let renewalTariffId = null;
                    if (sourceTariff?.is_trial && upsellTariff) {
                        renewalTariffId = upsellTariff.id;
                    } else if (lastPaidTariff?.id) {
                        renewalTariffId = lastPaidTariff.id;
                    }

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

                    let renewalLink = null;
                    if (botUsername) {
                        renewalLink = renewalTariffId
                            ? `https://t.me/${botUsername}?start=buy_${renewalTariffId}`
                            : `https://t.me/${botUsername}`;
                    } else {
                        // Нет юзернейма бота — убираем строку со ссылкой, чтобы не отправить литеральный {renewal_link}
                        console.warn(`[Напоминание] botUsername недоступен, убираем ссылку на продление из текста (subscription ${sub.id})`);
                        rawText = rawText
                            .split('\n')
                            .filter(line => !line.includes('{renewal_link}'))
                            .join('\n')
                            .replace(/\n{3,}/g, '\n\n')
                            .trim();
                    }

                    // Меняем плейсхолдеры на реальные значения
                    const messageText = rawText
                        .replaceAll('{channel_name}', sub.channels.title)
                        .replaceAll('{upsell_tariff_name}', upsellTariff?.title || 'основной тариф')
                        .replaceAll('{upsell_price}', upsellTariff?.price || '')
                        .replaceAll('{upsell_currency}', upsellTariff?.currency || '')
                        .replaceAll('{renewal_link}', renewalLink || '');

                    // 2. Пробуем отправить официальным ботом (с inline-кнопкой)
                    const sendMessageOptions = { parse_mode: 'Markdown' };
                    if (renewalTariffId && botUsername) {
                        sendMessageOptions.reply_markup = {
                            inline_keyboard: [[
                                { text: '💳 Продлить доступ', url: renewalLink }
                            ]]
                        };
                    }

                    let botOutcome = 'no_bot';
                    let botError = null;
                    let plainUsed = false;
                    if (bot) {
                        const result = await deliverViaBot(bot, sub.tg_user_id, messageText, sendMessageOptions);
                        botOutcome = result.status;
                        botError = result.error || null;
                        plainUsed = !!result.plainUsed;
                    }

                    if (botOutcome === 'delivered') {
                        console.log(`[Напоминание] Успешно отправлено ботом юзеру ${sub.tg_user_id}${plainUsed ? ' (plain-text после parse-ошибки)' : ''}`);
                        await logReminderEvent(sub, ownerId, botId, {
                            delivered_by: 'bot',
                            parse_fallback: plainUsed,
                            bot_id: botId || null,
                            bot_username: botUsername,
                            message_text: plainUsed ? stripMarkdownDecor(messageText) : messageText,
                            renewal_tariff_id: renewalTariffId,
                            renewal_link: renewalLink,
                            source_tariff_id: sourceTariff?.id || null,
                            upsell_tariff_id: upsellTariff?.id || null
                        });
                    } else if (botOutcome === 'transient') {
                        // Транзиентная ошибка бота (сеть/таймаут) — не маркируем, ретрай следующим тиком
                        console.warn(`[Напоминание] Транзиентная ошибка бота для ${sub.tg_user_id}:`, botError?.message || botError);
                    } else if (botOutcome === 'undeliverable') {
                        // Текст не ушёл даже plain-text'ом — дефинитивный исход, маркируем
                        console.warn(`[Напоминание] Не смогли доставить даже plain-text'ом для ${sub.tg_user_id}:`, botError?.message || botError);
                        await logReminderEvent(sub, ownerId, botId, {
                            delivered_by: 'failed',
                            bot_id: botId || null,
                            reason: 'plain_text_retry_failed',
                            error: botError?.message || 'unknown'
                        });
                    } else if (botOutcome === 'blocked') {
                        console.log(`[Напоминание] Бот заблокирован. Будим Юзербота для ${sub.tg_user_id}...`);
                    }

                    if (botOutcome === 'delivered' || botOutcome === 'undeliverable') {
                        await markReminderSent(sub.id);
                        continue;
                    }

                    // 3. Юзербот-фолбэк: только при реальной блокировке бота (или если бота нет вовсе) и при явном env-флаге
                    if (!bot || botOutcome === 'blocked') {
                        try {
                            if (!isUserbotRetentionDmEnabled()) {
                                console.log(`[Напоминание] USERBOT_RETENTION_DM_ENABLED=false, пропускаем ЛС через юзербота для ${sub.tg_user_id}`);
                                await logReminderEvent(sub, ownerId, botId, {
                                    delivered_by: 'skipped',
                                    bot_id: botId || null,
                                    reason: bot ? 'userbot_dm_disabled' : 'no_bot_and_userbot_dm_disabled'
                                });
                                // Дефинитивный скип — маркируем, чтобы не обрабатывать подписку каждый тик
                                await markReminderSent(sub.id);
                            } else {
                                const userbot = await loadLatestUserbot(ownerId);
                                if (userbot) {
                                    // Юзербот шлёт без parse_mode — сырые ** и _ ушли бы подписчику литералами
                                    await userbotService.sendMessage(
                                        userbot,
                                        sub.tg_user_id.toString(),
                                        `🔔 Системное уведомление!\nМой бот не смог до тебя достучаться, пишу лично.\n\n${stripMarkdownDecor(messageText)}`,
                                        {
                                            event_source: 'retention',
                                            event_type: 'retention_reminder',
                                            channel_id: sub.channel_id || null,
                                            subscription_id: sub.id
                                        }
                                    );
                                    console.log(`[Напоминание] Доставлено через Юзербота юзеру ${sub.tg_user_id}`);
                                    await logReminderEvent(sub, ownerId, botId, {
                                        delivered_by: 'userbot',
                                        bot_id: botId || null,
                                        userbot_id: userbot?.id || null,
                                        userbot_username: userbot?.tg_username || null,
                                        message_text: messageText,
                                        source_tariff_id: sourceTariff?.id || null,
                                        upsell_tariff_id: upsellTariff?.id || null
                                    });
                                    await markReminderSent(sub.id);
                                } else {
                                    // Нет рабочего юзербота — не маркируем, попробуем в следующий тик
                                    console.warn(`[Напоминание] Нет рабочего юзербота у owner ${ownerId}, откладываем напоминание для ${sub.tg_user_id}`);
                                }
                            }
                        } catch (ubErr) {
                            // Ошибка юзербота — транзиентная, не маркируем
                            console.error(`[Напоминание] Ошибка Юзербота:`, ubErr.message);
                            await logReminderEvent(sub, ownerId, botId, {
                                delivered_by: 'failed',
                                bot_id: botId || null,
                                error: ubErr?.message || 'unknown'
                            });
                        }
                    }
                } catch (subErr) {
                    // Ошибка одной подписки не должна ронять остаток батча
                    console.error(`[Напоминание] Ошибка обработки подписки ${sub.id}:`, subErr?.message || subErr);
                }
            }
        } catch (err) { console.error('Ошибка в Cron-напоминаниях:', err.message); } finally {
            running = false;
        }
    }, 5 * 60 * 1000);
};
