/**
 * Lifecycle Telegraf-ботов автопостера.
 * Хранит реестр запущенных polling-инстансов, позволяет стартовать/останавливать
 * и корректно завершать работу при SIGTERM.
 */
import { Telegraf } from 'telegraf';
import { log } from './logger.js';

const activeAutopostBots = new Map();

export function startAutopostBot(botId, token, registerHandlers) {
    if (activeAutopostBots.has(botId)) return;

    const bot = new Telegraf(token);
    registerHandlers(bot, botId);
    // message_reaction — опциональный update, по дефолту Telegram его не шлёт.
    // Нужен для подсчёта реакций и best-of. chat_member уже использовался в chat-member.js.
    //
    // Раньше activeAutopostBots.set выполнялся синхронно после launch() — бот
    // попадал в Map до того, как polling реально подключался. Если launch падал
    // (5xx Telegram, битый токен, race при старте), бот оставался в Map
    // «полумёртвым»: getAutopostBot возвращал инстанс, но connection не работал,
    // и последующий startBot коротил по has(botId) — оживить было нельзя.
    // Поэтому добавляем в Map только после успешного resolve launch().
    bot.launch({
        allowed_updates: [
            'message',
            'edited_message',
            'callback_query',
            'channel_post',
            'edited_channel_post',
            'message_reaction',
            'chat_member'
        ]
    })
        .then(() => {
            activeAutopostBots.set(botId, bot);
            log.info('lifecycle', 'bot_started', { botId });
        })
        .catch(err => log.error('lifecycle', 'bot_launch_failed', { botId, err }));
}

export function getAutopostBot(botId) {
    return activeAutopostBots.get(botId);
}

export function stopAutopostBot(botId) {
    const bot = activeAutopostBots.get(botId);
    if (!bot) return;
    try { bot.stop('SIGTERM'); } catch (e) {}
    activeAutopostBots.delete(botId);
    log.info('lifecycle', 'bot_stopped', { botId });
}

export function stopAllAutopostBots() {
    for (const botId of activeAutopostBots.keys()) {
        stopAutopostBot(botId);
    }
}

export function getActiveAutopostBotIds() {
    return Array.from(activeAutopostBots.keys());
}
