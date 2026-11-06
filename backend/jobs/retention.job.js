// Хелперы доставки переехали в общий util (единственный источник; до этого дублировались здесь и в abandoned-cart.job.js)
import { deliverViaBot, stripMarkdownDecor } from '../utils/bot-send.js';
import { MessagingRouter } from '../services/messaging-router.service.js';
import { wrapJobTick } from '../utils/job-runner.js';
import { loadRetentionPool, markReminderSent, logReminderEvent } from './retention/helpers.js';
import { buildReminderContent } from './retention/reminder-text.js';

function isUserbotRetentionDmEnabled() {
    return String(process.env.USERBOT_RETENTION_DM_ENABLED || '').trim().toLowerCase() === 'true';
}

/**
 * Cron-задача: Напоминания за 24 часа до окончания подписки
 * Запускается каждые 5 минут, проверяет подписки которые истекают через 24ч
 * и отправляет напоминания (сначала ботом, если заблокирован - юзерботом)
 */

export const startRetention = (supabase, getBotFunction, { messagingRouter: messagingRouterOverride } = {}) => {
    const messagingRouter = messagingRouterOverride || new MessagingRouter({ supabase });

    let running = false;
    setInterval(wrapJobTick('retention', async () => {
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
                .select(`id, tg_user_id, channel_id, channels!inner ( owner_id, bot_id, title, tg_chat_id )`)
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

                    const { sourceTariff, upsellTariff, renewalTariffId, botUsername, renewalLink, messageText } =
                        await buildReminderContent(supabase, sub, ownerId, bot);

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
                        await logReminderEvent(supabase, sub, ownerId, botId, {
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
                        await logReminderEvent(supabase, sub, ownerId, botId, {
                            delivered_by: 'failed',
                            bot_id: botId || null,
                            reason: 'plain_text_retry_failed',
                            error: botError?.message || 'unknown'
                        });
                    } else if (botOutcome === 'blocked') {
                        console.log(`[Напоминание] Бот заблокирован. Будим Юзербота для ${sub.tg_user_id}...`);
                    }

                    if (botOutcome === 'delivered' || botOutcome === 'undeliverable') {
                        await markReminderSent(supabase, sub.id);
                        continue;
                    }

                    // 3. Юзербот-фолбэк: только при реальной блокировке бота (или если бота нет вовсе) и при явном env-флаге
                    if (!bot || botOutcome === 'blocked') {
                        try {
                            if (!isUserbotRetentionDmEnabled()) {
                                console.log(`[Напоминание] USERBOT_RETENTION_DM_ENABLED=false, пропускаем ЛС через юзербота для ${sub.tg_user_id}`);
                                await logReminderEvent(supabase, sub, ownerId, botId, {
                                    delivered_by: 'skipped',
                                    bot_id: botId || null,
                                    reason: bot ? 'userbot_dm_disabled' : 'no_bot_and_userbot_dm_disabled'
                                });
                                // Дефинитивный скип — маркируем, чтобы не обрабатывать подписку каждый тик
                                await markReminderSent(supabase, sub.id);
                            } else {
                                const pool = await loadRetentionPool(supabase, ownerId, botId);
                                if (pool.length > 0) {
                                    // Юзербот шлёт без parse_mode — сырые ** и _ ушли бы подписчику литералами
                                    const result = await messagingRouter.deliver({
                                        ownerId,
                                        tgUserId: sub.tg_user_id.toString(),
                                        text: `🔔 Системное уведомление!\nМой бот не смог до тебя достучаться, пишу лично.\n\n${stripMarkdownDecor(messageText)}`,
                                        pool,
                                        // Общая группа подписки: даём роутеру шанс собрать peer сканом общего чата
                                        commonChatId: sub.channels.tg_chat_id ? String(sub.channels.tg_chat_id) : null,
                                        eventSource: 'retention'
                                    });

                                    if (result.status === 'sent') {
                                        const actor = pool.find((account) => String(account.id) === String(result.actorId));
                                        console.log(`[Напоминание] Доставлено через Юзербота юзеру ${sub.tg_user_id}`);
                                        await logReminderEvent(supabase, sub, ownerId, botId, {
                                            delivered_by: 'userbot',
                                            bot_id: botId || null,
                                            userbot_id: result.actorId || null,
                                            userbot_username: actor?.tg_username || null,
                                            message_text: messageText,
                                            source_tariff_id: sourceTariff?.id || null,
                                            upsell_tariff_id: upsellTariff?.id || null
                                        });
                                        await markReminderSent(supabase, sub.id);
                                    } else {
                                        // Роутер не дотянулся (пауза/квота/ошибка Telegram) — транзиентно, не маркируем
                                        console.warn(`[Напоминание] Юзербот-пул не доставил для ${sub.tg_user_id}: ${result.errorKind} ${result.errorText || ''}`);
                                        await logReminderEvent(supabase, sub, ownerId, botId, {
                                            delivered_by: 'failed',
                                            bot_id: botId || null,
                                            error_kind: result.errorKind || 'unknown',
                                            error: result.errorText || 'unknown'
                                        });
                                    }
                                } else {
                                    // Нет рабочего юзербота — не маркируем, попробуем в следующий тик
                                    console.warn(`[Напоминание] Нет рабочего юзербота у owner ${ownerId}, откладываем напоминание для ${sub.tg_user_id}`);
                                }
                            }
                        } catch (ubErr) {
                            // Ошибка юзербота — транзиентная, не маркируем
                            console.error(`[Напоминание] Ошибка Юзербота:`, ubErr.message);
                            await logReminderEvent(supabase, sub, ownerId, botId, {
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
    }), 5 * 60 * 1000);
};
