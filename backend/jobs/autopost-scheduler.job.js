/**
 * Cron-задача: публикация запланированных постов из autopost_items.
 * Запускается каждые 5 минут.
 */

import { log } from '../services/autopost/logger.js';
import { getFloodWaitSeconds } from '../services/autopost/sender.js';

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
                    .select('id, buttons_config, suggest_button_enabled, seed_reaction_emoji, discussion_forward_enabled, linked_chat_id')
                    .eq('tg_chat_id', targetChatId)
                    .eq('autopost_bot_id', item.bot_id)
                    .maybeSingle();

                // Claim/lease (код-ревью P1): атомарно забираем item условным UPDATE.
                // 0 строк → item уже забран другим воркером или изменён — пропускаем.
                // Это закрывает дубли mark-after-send при краше/pm2 reload: item в
                // 'sending' не матчится повторной выборкой 'scheduled'. updated_at
                // бампится триггером set_updated_at — это timestamp лизинга для
                // recovery зависших 'sending' (autopost-stuck-editing job).
                const { data: claimed, error: claimErr } = await supabase
                    .from('autopost_items')
                    .update({ status: 'sending' })
                    .eq('id', item.id)
                    .eq('status', 'scheduled')
                    .select('id');
                if (claimErr) {
                    log.error('scheduler', 'item_claim_failed', { botId: botConfig.id, itemId: item.id, err: claimErr.message });
                    continue;
                }
                if (!claimed || claimed.length === 0) {
                    log.warn('scheduler', 'item_claim_lost', { botId: botConfig.id, itemId: item.id });
                    continue;
                }

                await autopostService.publishItem(bot, item, channel, botData?.username, { claimed: true });

                log.info('scheduler', 'post_published', {
                    botId: botConfig.id,
                    itemId: item.id,
                    channelId: String(targetChatId),
                    isSuggestion: Boolean(item.is_suggestion)
                });
            } catch (sendErr) {
                // FLOOD_WAIT (429) — не ошибка публикации: возвращаем item в
                // 'scheduled' с scheduled_at = now + retry_after (минимум 5с),
                // Telegram сам скажет, сколько ждать. Остальные ошибки — 'failed'.
                const floodSeconds = getFloodWaitSeconds(sendErr);
                if (floodSeconds > 0) {
                    const retryAt = new Date(Date.now() + Math.max(floodSeconds, 5) * 1000).toISOString();
                    log.warn('scheduler', 'publish_flood_wait', {
                        botId: botConfig.id,
                        itemId: item.id,
                        channelId: String(item.target_channel_id),
                        retryAfterSeconds: floodSeconds,
                        retryAt
                    });
                    const { error: floodErr } = await supabase
                        .from('autopost_items')
                        .update({ status: 'scheduled', scheduled_at: retryAt })
                        .eq('id', item.id)
                        .eq('status', 'sending');
                    if (floodErr) {
                        log.error('scheduler', 'flood_reschedule_failed', { botId: botConfig.id, itemId: item.id, err: floodErr.message });
                    }
                    continue;
                }

                log.error('scheduler', 'publish_failed', {
                    botId: botConfig.id,
                    itemId: item.id,
                    channelId: String(item.target_channel_id),
                    err: sendErr.message
                });
                const { error: failErr } = await supabase
                    .from('autopost_items')
                    .update({ status: 'failed', error_message: String(sendErr.message || '').slice(0, 1000) })
                    .eq('id', item.id)
                    .eq('status', 'sending');
                if (failErr) {
                    log.error('scheduler', 'mark_failed_failed', { botId: botConfig.id, itemId: item.id, err: failErr.message });
                }
            }
        }
    }
};
