/**
 * Обработка альбомов: выбор "опубликовать альбомом" или "разбить" + дублирование подписи.
 *
 * Multi-channel: после решения keep/split (и для split — dup/first) показываем
 * channel picker. Один album_keep → fan-out в N каналов с одним batch_id.
 * Один album_split → N постов, каждый со своим batch_id, каждый fan-out в N каналов.
 */
import { Markup } from 'telegraf';
import { promptChannelPicker } from './channel-select.js';

export function registerAlbumCallbacksHandler(bot, service, botId) {
    const supabase = service.supabase;

    bot.action(/album:(keep|split):(.+)/, async (ctx) => {
        const action = ctx.match[1];
        const cacheId = ctx.match[2];
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        // Bug 4 fix: cache живёт в БД, не в памяти — переживает рестарт бэкенда.
        const albumData = await service.getAlbumCache(cacheId);
        if (!albumData) return ctx.answerCbQuery('Данные альбома устарели');

        if (action === 'keep') {
            await service.deleteAlbumCache(cacheId);

            const { data: channels } = await supabase
                .from('channels')
                .select('tg_chat_id, title')
                .eq('autopost_bot_id', botId);

            // Multi-channel bot → picker. Single-channel → old behavior.
            if (channels && channels.length > 1) {
                try { await ctx.deleteMessage(); } catch (e) {}
                await promptChannelPicker(ctx, service, tgUserId, {
                    content: {
                        type: 'album_keep',
                        caption: albumData.caption || '',
                        fileIds: albumData.photos || [],
                        mediaType: (albumData.mediaTypes && albumData.mediaTypes[0]) || 'photo'
                    },
                    defaultChannelId: albumData.targetChannelId,
                    channels
                });
                return ctx.answerCbQuery();
            }

            await service.addPostItem({
                botId,
                targetChannelId: albumData.targetChannelId,
                fileIds: albumData.photos,
                caption: albumData.caption,
                status: 'queued',
                mediaType: (albumData.mediaTypes && albumData.mediaTypes[0]) || 'photo'
            });
            await service.collapseQueue(botId, albumData.targetChannelId);
            await ctx.answerCbQuery('Добавлено как альбом в очередь');
            await ctx.reply('✅ Альбом успешно добавлен в очередь.');
        } else {
            // Переводим кеш в стадию 'split', чтобы пережить и второе нажатие.
            await service.setAlbumCache(cacheId, {
                botId,
                tgUserId,
                photos: albumData.photos,
                mediaTypes: albumData.mediaTypes,
                caption: albumData.caption,
                targetChannelId: albumData.targetChannelId,
                stage: 'split'
            });
            await ctx.reply(
                `Альбом будет разделен на ${albumData.photos.length} постов. Продублировать подпись на каждый пост?`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Да, продублировать', `split_opt:dup:${cacheId}`)],
                    [Markup.button.callback('❌ Только на первом', `split_opt:first:${cacheId}`)]
                ])
            );
            await ctx.answerCbQuery();
        }
        try { await ctx.deleteMessage(); } catch (e) {}
    });

    bot.action(/split_opt:(dup|first):(.+)/, async (ctx) => {
        const option = ctx.match[1];
        const cacheId = ctx.match[2];
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const albumData = await service.getAlbumCache(cacheId);
        if (!albumData) return ctx.answerCbQuery('Данные устарели');
        await service.deleteAlbumCache(cacheId);

        const { data: channels } = await supabase
            .from('channels')
            .select('tg_chat_id, title')
            .eq('autopost_bot_id', botId);

        // Multi-channel bot → picker. Single-channel → old behavior.
        if (channels && channels.length > 1) {
            try { await ctx.deleteMessage(); } catch (e) {}
            await promptChannelPicker(ctx, service, tgUserId, {
                content: {
                    type: 'album_split',
                    caption: albumData.caption || '',
                    fileIds: albumData.photos || [],
                    mediaTypes: albumData.mediaTypes || [],
                    splitOption: option
                },
                defaultChannelId: albumData.targetChannelId,
                channels
            });
            return ctx.answerCbQuery('Посты готовятся');
        }

        for (let i = 0; i < albumData.photos.length; i++) {
            const fileId = albumData.photos[i];
            const caption = (option === 'dup' || i === 0) ? albumData.caption : '';
            await service.addPostItem({
                botId,
                targetChannelId: albumData.targetChannelId,
                fileIds: [fileId],
                caption,
                status: 'queued',
                mediaType: (albumData.mediaTypes && albumData.mediaTypes[i]) || 'photo'
            });
        }

        await service.collapseQueue(botId, albumData.targetChannelId);
        await ctx.answerCbQuery('Посты добавлены');
        await ctx.reply(`✅ Разделено на ${albumData.photos.length} отдельных постов.`);
        try { await ctx.deleteMessage(); } catch (e) {}
    });
}
