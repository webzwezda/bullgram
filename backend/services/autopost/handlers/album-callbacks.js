/**
 * Обработка альбомов: выбор "опубликовать альбомом" или "разбить" + дублирование подписи.
 */
import { Markup } from 'telegraf';

export function registerAlbumCallbacksHandler(bot, service, botId) {
    bot.action(/album:(keep|split):(.+)/, async (ctx) => {
        const action = ctx.match[1];
        const cacheId = ctx.match[2];
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const albumData = service.albumCache.get(cacheId);
        if (!albumData) return ctx.answerCbQuery('Данные альбома устарели');
        service.albumCache.delete(cacheId);

        if (action === 'keep') {
            await service.addPostItem({
                botId,
                targetChannelId: albumData.targetChannelId,
                fileIds: albumData.photos,
                caption: albumData.caption,
                status: 'queued'
            });
            await service.collapseQueue(botId, albumData.targetChannelId);
            await ctx.answerCbQuery('Добавлено как альбом в очередь');
            await ctx.reply('✅ Альбом успешно добавлен в очередь.');
        } else {
            const splitCacheId = `${tgUserId}:${Date.now()}`;
            service.splitCache.set(splitCacheId, albumData);
            await ctx.reply(
                `Альбом будет разделен на ${albumData.photos.length} постов. Продублировать подпись на каждый пост?`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Да, продублировать', `split_opt:dup:${splitCacheId}`)],
                    [Markup.button.callback('❌ Только на первом', `split_opt:first:${splitCacheId}`)]
                ])
            );
            await ctx.answerCbQuery();
        }
        try { await ctx.deleteMessage(); } catch (e) {}
    });

    bot.action(/split_opt:(dup|first):(.+)/, async (ctx) => {
        const option = ctx.match[1];
        const splitCacheId = ctx.match[2];
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const albumData = service.splitCache.get(splitCacheId);
        if (!albumData) return ctx.answerCbQuery('Данные устарели');
        service.splitCache.delete(splitCacheId);

        for (let i = 0; i < albumData.photos.length; i++) {
            const fileId = albumData.photos[i];
            const caption = (option === 'dup' || i === 0) ? albumData.caption : '';
            await service.addPostItem({
                botId,
                targetChannelId: albumData.targetChannelId,
                fileIds: [fileId],
                caption,
                status: 'queued'
            });
        }

        await service.collapseQueue(botId, albumData.targetChannelId);
        await ctx.answerCbQuery('Посты добавлены');
        await ctx.reply(`✅ Разделено на ${albumData.photos.length} отдельных постов.`);
        try { await ctx.deleteMessage(); } catch (e) {}
    });
}
