/**
 * Lifecycle Telegraf-ботов семейных чеклистов.
 * Точная копия паттерна из autopost/bot-lifecycle.js:
 *
 *   activeBots.set(botId, bot) СИНХРОННО перед launch(), .then/.catch удаляют.
 *
 * Это критично: launch() возвращает Promise который резолвится ТОЛЬКО при
 * graceful shutdown. Если бы добавляли в Map в .then, бот никогда не был бы
 * в Map во время работы → повторные launch → 409 Conflict.
 */

import { Telegraf } from 'telegraf';
import { registerHandlers } from './handlers.js';

const activeBots = new Map();

export function startChecklistBot(botId, token, ownerId, supabase) {
    if (activeBots.has(botId)) return;

    const bot = new Telegraf(token);
    registerHandlers(bot, ownerId, botId, supabase);

    activeBots.set(botId, bot);

    bot.launch({
        allowed_updates: [
            'message',
            'edited_message',
            'callback_query',
            'channel_post',
            'edited_channel_post'
        ]
    })
        .then(() => {
            activeBots.delete(botId);
            console.log('[checklist] bot_stopped_graceful', botId);
        })
        .catch(err => {
            activeBots.delete(botId);
            console.error('[checklist] bot_launch_failed', botId, err?.message || err);
        });
}

export function getChecklistBot(botId) {
    return activeBots.get(botId);
}

export function stopChecklistBot(botId) {
    const bot = activeBots.get(botId);
    if (!bot) return;
    try { bot.stop('SIGTERM'); } catch (e) {}
    activeBots.delete(botId);
    console.log('[checklist] bot_stopped', botId);
}

export function stopAllChecklistBots() {
    for (const botId of activeBots.keys()) {
        stopChecklistBot(botId);
    }
}

export function getActiveChecklistBotIds() {
    return Array.from(activeBots.keys());
}
