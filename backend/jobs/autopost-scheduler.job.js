/**
 * Cron-задача: публикация запланированных постов из autopost_items.
 * Запускается каждые 5 минут.
 */

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
                    console.error(`[Autopost scheduler] Ошибка запроса для бота ${botConfig.id}:`, error.message);
                    continue;
                }
                if (!dueItems || dueItems.length === 0) continue;

                const bot = getAutopostBotFunction(botConfig.id);
                if (!bot) continue;

                for (const item of dueItems) {
                    try {
                        const { data: botData } = await supabase
                            .from('autopost_bots')
                            .select('target_channel_tg_id')
                            .eq('id', item.bot_id)
                            .single();

                        if (!botData) continue;

                        const targetChatId = item.target_channel_id || botData.target_channel_tg_id;
                        if (!targetChatId) {
                            console.warn(`[Autopost scheduler] Нет назначения для поста ${item.id}`);
                            continue;
                        }

                        // Получаем настройки канала (для инлайн-кнопок)
                        const { data: channel } = await supabase
                            .from('channels')
                            .select('buttons_config')
                            .eq('tg_chat_id', targetChatId)
                            .maybeSingle();

                        let reply_markup = undefined;
                        if (channel?.buttons_config && Array.isArray(channel.buttons_config) && channel.buttons_config.length > 0) {
                            reply_markup = {
                                inline_keyboard: [
                                    channel.buttons_config.map(b => ({ text: b.text, url: b.url }))
                                ]
                            };
                        }

                        // Если это альбом (несколько картинок)
                        if (item.file_ids && item.file_ids.length > 1) {
                            const media = item.file_ids.map((fid, idx) => ({
                                type: 'photo',
                                media: fid,
                                caption: idx === 0 ? item.caption || undefined : undefined,
                                parse_mode: (idx === 0 && item.caption) ? 'Markdown' : undefined
                            }));
                            await bot.telegram.sendMediaGroup(targetChatId, media);
                        } else {
                            // Одиночное фото или текстовый пост
                            const fileId = item.file_ids && item.file_ids.length > 0 ? item.file_ids[0] : item.file_id;
                            if (fileId) {
                                await bot.telegram.sendPhoto(targetChatId, fileId, {
                                    caption: item.caption || undefined,
                                    parse_mode: item.caption ? 'Markdown' : undefined,
                                    reply_markup
                                });
                            } else {
                                await bot.telegram.sendMessage(targetChatId, item.caption, {
                                    parse_mode: 'Markdown',
                                    reply_markup
                                });
                            }
                        }

                        await supabase
                            .from('autopost_items')
                            .update({ status: 'posted', posted_at: new Date().toISOString() })
                            .eq('id', item.id);

                        console.log(`[Autopost scheduler] Опубликован пост ${item.id} в канал ${targetChatId}`);
                    } catch (sendErr) {
                        console.error(`[Autopost scheduler] Ошибка публикации ${item.id}:`, sendErr.message);
                        await supabase
                            .from('autopost_items')
                            .update({ status: 'failed' })
                            .eq('id', item.id);
                    }
                }
            }
        } catch (err) {
            console.error('[Autopost scheduler] Ошибка cron:', err.message);
        }
    }, 5 * 60 * 1000);
};
