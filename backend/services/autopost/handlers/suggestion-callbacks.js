/**
 * Callback'и модерации предложек: sug_approve, sug_post_now, sug_reject.
 */

export function registerSuggestionCallbacksHandler(bot, service, botId) {
    const supabase = service.supabase;

    bot.action(/sug_approve:(.+)/, async (ctx) => {
        const itemId = ctx.match[1];
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const { data: item } = await supabase
            .from('autopost_items')
            .select('*')
            .eq('id', itemId)
            .single();

        if (!item) return ctx.answerCbQuery('Пост не найден');

        await supabase
            .from('autopost_items')
            .update({ status: 'queued' })
            .eq('id', itemId);

        await ctx.answerCbQuery('Пост одобрен и добавлен в очередь');
        try { await ctx.deleteMessage(); } catch (e) {}

        if (item.target_channel_id) {
            await service.collapseQueue(botId, item.target_channel_id);
        }
    });

    bot.action(/sug_post_now:(.+)/, async (ctx) => {
        const itemId = ctx.match[1];
        const tgUserId = ctx.from.id;
        const { bot: botData, isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const { data: item } = await supabase
            .from('autopost_items')
            .select('*')
            .eq('id', itemId)
            .single();

        if (!item) return ctx.answerCbQuery('Пост не найден');

        try {
            const { data: channel } = await supabase
                .from('channels')
                .select('*')
                .eq('tg_chat_id', item.target_channel_id)
                .maybeSingle();

            await service.publishItem(bot, item, channel, botData?.username);

            await ctx.answerCbQuery('Опубликовано!');
            try { await ctx.deleteMessage(); } catch (e) {}

            if (item.target_channel_id) {
                await service.collapseQueue(botId, item.target_channel_id);
            }
        } catch (err) {
            console.error('[Autopost] Ошибка публикации предложки:', err.message);
            await supabase
                .from('autopost_items')
                .update({ status: 'failed', error_message: String(err.message || '').slice(0, 1000) })
                .eq('id', itemId);
            await ctx.answerCbQuery('Ошибка: ' + err.message);
        }
    });

    bot.action(/sug_reject:(.+)/, async (ctx) => {
        const itemId = ctx.match[1];
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        await supabase
            .from('autopost_items')
            .delete()
            .eq('id', itemId);

        await ctx.answerCbQuery('Пост отклонен');
        try { await ctx.deleteMessage(); } catch (e) {}
    });
}
