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

                        await bot.telegram.sendPhoto(botData.target_channel_tg_id, item.file_id, {
                            caption: item.caption || undefined,
                            parse_mode: item.caption ? 'Markdown' : undefined
                        });

                        await supabase
                            .from('autopost_items')
                            .update({ status: 'posted', posted_at: new Date().toISOString() })
                            .eq('id', item.id);

                        console.log(`[Autopost scheduler] Опубликован пост ${item.id} в канал ${botData.target_channel_tg_id}`);
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
