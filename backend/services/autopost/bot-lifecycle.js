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

    // Telegraf launch() возвращает Promise, который резолвится только при
    // graceful shutdown (SIGTERM) и реджектится при падении polling loop.
    // Пока бот живёт, Promise висит pending. Если бы мы добавляли в Map в .then,
    // бот никогда бы не попал в Map во время работы — scheduler видел бы «бота нет»,
    // вызывал launch повторно каждые 5 мин, и новая launch конфликтовала с уже
    // живым polling («409 Conflict: terminated by other getUpdates request»).
    // Поэтому добавляем в Map синхронно, а .then/.catch удаляют — тогда Map
    // отражает реальное состояние: есть только пока бот реально работает.
    activeAutopostBots.set(botId, bot);

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
            activeAutopostBots.delete(botId);
            log.info('lifecycle', 'bot_stopped_graceful', { botId });
        })
        .catch(err => {
            activeAutopostBots.delete(botId);
            log.error('lifecycle', 'bot_launch_failed', { botId, err });
        });
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
