/**
 * Cron-задача: публикация запланированных постов из autopost_items.
 * Запускается каждые 5 минут.
 */

import { sendItemToChannel } from '../services/autopost/sender.js';
import { log } from '../services/autopost/logger.js';

export const startAutopostScheduler = (supabase, getAutopostBotFunction) => {
    setInterval(async () => {
        try {
            const { data: bots, error: botsError } = await supabase
                .from('autopost_bots')
                .select('id, is_active')
                .eq('is_active', true);

            if (botsError) throw botsError;
            if (!bots || bots.length === 0) return;

            for (const botConfig of bots) {
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
                    continue;
                }
                if (!dueItems || dueItems.length === 0) continue;

                const bot = getAutopostBotFunction(botConfig.id);
                if (!bot) {
                    log.warn('scheduler', 'bot_not_running', { botId: botConfig.id, dueCount: dueItems.length });
                    continue;
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
                            .select('id, buttons_config, suggest_button_enabled')
                            .eq('tg_chat_id', targetChatId)
                            .maybeSingle();

                        await sendItemToChannel(bot.telegram, targetChatId, item, {
                            channel,
                            botUsername: botData?.username
                        });

                        await supabase
                            .from('autopost_items')
                            .update({ status: 'posted', posted_at: new Date().toISOString() })
                            .eq('id', item.id);

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
                            .update({ status: 'failed' })
                            .eq('id', item.id);
                    }
                }
            }
        } catch (err) {
            log.error('scheduler', 'tick_failed', { err: err.message });
        }
    }, 5 * 60 * 1000);
};
