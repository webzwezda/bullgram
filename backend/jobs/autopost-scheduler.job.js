/**
 * Cron-задача: публикация запланированных постов из autopost_items.
 * Запускается каждые 5 минут.
 */

import { log } from '../services/autopost/logger.js';

export const startAutopostScheduler = (supabase, getAutopostBotFunction, autopostService) => {
    // In-flight mutex по botId. Без него setInterval мог стартовать новый тик
    // поверх предыдущего, если публикация затянулась — пост мог уйти в канал дважды.
    const inFlight = new Set();

    setInterval(async () => {
        try {
            const { data: bots, error: botsError } = await supabase
                .from('autopost_bots')
                .select('id, is_active')
                .eq('is_active', true);

            if (botsError) throw botsError;
            if (!bots || bots.length === 0) return;

            for (const botConfig of bots) {
                if (inFlight.has(botConfig.id)) {
                    log.warn('scheduler', 'tick_skipped_still_running', { botId: botConfig.id });
                    continue;
                }
                inFlight.add(botConfig.id);
                try {
                    await processBot(botConfig);
                } finally {
                    inFlight.delete(botConfig.id);
                }
            }
        } catch (err) {
            log.error('scheduler', 'tick_failed', { err: err.message });
        }
    }, 5 * 60 * 1000);

    async function processBot(botConfig) {
        const now = new Date().toISOString();

        const { data: dueItems, error } = await supabase
            .from('autopost_items')
            .select('*')
            .eq('bot_id', botConfig.id)
            .eq('status', 'scheduled')
            .lte('scheduled_at', now)
            .order('scheduled_at', { ascending: true })
            .limit(5);

        if (error) {
            log.error('scheduler', 'query_failed', { botId: botConfig.id, err: error.message });
            return;
        }
        if (!dueItems || dueItems.length === 0) return;

        const bot = getAutopostBotFunction(botConfig.id);
        if (!bot) {
            // Бот пропал из памяти (рестарт backend, падение launch, race в bot-lifecycle).
            // Раньше scheduler здесь молча логировал warning и return — items оставались
            // в scheduled бесконечно без error_message, а стартануть заново через UI
            // нельзя было из-за коротящего has(botId) в startAutopostBot. Пробуем поднять
            // сами: на следующем тике (5 мин) бот уже должен быть в Map и items уйдут.
            try {
                const { data: botRow } = await supabase
                    .from('autopost_bots')
                    .select('bot_token, is_active')
                    .eq('id', botConfig.id)
                    .single();
                if (botRow?.is_active && botRow?.bot_token) {
                    autopostService.startBot(botConfig.id, botRow.bot_token);
                    log.warn('scheduler', 'bot_auto_restart_attempt', {
                        botId: botConfig.id,
                        dueCount: dueItems.length
                    });
                } else {
                    log.error('scheduler', 'bot_cannot_restart', {
                        botId: botConfig.id,
                        isActive: Boolean(botRow?.is_active),
                        hasToken: Boolean(botRow?.bot_token)
                    });
                }
            } catch (e) {
                log.error('scheduler', 'bot_auto_restart_failed', { botId: botConfig.id, err: e.message });
            }
            return;
        }

        for (const item of dueItems) {
            try {
                const { data: botData } = await supabase
                    .from('autopost_bots')
                    .select('username')
                    .eq('id', item.bot_id)
                    .single();

                if (!botData) continue;

                const targetChatId = item.target_channel_id;
                if (!targetChatId) {
                    log.warn('scheduler', 'item_without_channel', { botId: botConfig.id, itemId: item.id });
                    continue;
                }

                const { data: channel } = await supabase
                    .from('channels')
                    .select('id, buttons_config, suggest_button_enabled, seed_reaction_emoji')
                    .eq('tg_chat_id', targetChatId)
                    .maybeSingle();

                await autopostService.publishItem(bot, item, channel, botData?.username);

                log.info('scheduler', 'post_published', {
                    botId: botConfig.id,
                    itemId: item.id,
                    channelId: String(targetChatId),
                    isSuggestion: Boolean(item.is_suggestion)
                });
            } catch (sendErr) {
                log.error('scheduler', 'publish_failed', {
                    botId: botConfig.id,
                    itemId: item.id,
                    channelId: String(item.target_channel_id),
                    err: sendErr.message
                });
                await supabase
                    .from('autopost_items')
                    .update({ status: 'failed', error_message: String(sendErr.message || '').slice(0) })
                    .eq('id', item.id);
            }
        }
    }
};
