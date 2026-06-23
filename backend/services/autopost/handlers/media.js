/**
 * Приём фото/видео/гифок/файлов от админов и гостей + сборка альбомов.
 */
import { Markup } from 'telegraf';

export function registerMediaHandler(bot, service, botId) {
    const supabase = service.supabase;

    bot.on(['photo', 'video', 'animation', 'document'], async (ctx) => {
        try {
            const tgUserId = ctx.from.id;
            const { bot: botData, isAdmin } = await service.getBotAdminContext(botId, tgUserId);

            let guestSession = null;
            if (!isAdmin) {
                guestSession = await service.getGuestSession(botId, tgUserId);
                if (!guestSession) {
                    return ctx.reply('Вы можете предложить новость для публикации в наших каналах. Используйте специальные ссылки "Предложить новость" под постами в каналах.');
                }
            }

            const { data: channels } = await supabase
                .from('channels')
                .select('*')
                .eq('autopost_bot_id', botId);

            if (!channels || channels.length === 0) {
                return ctx.reply('Сначала добавьте меня в канал как администратора!');
            }

            let targetChannel = null;
            if (isAdmin) {
                const activeModes = botData.active_modes || {};
                const activeId = activeModes[String(tgUserId)];
                targetChannel = channels.find(c => String(c.tg_chat_id) === String(activeId)) || channels[0];
            } else {
                // Bug 11 fix: раньше если гостевая сессия указывала на удалённый
                // канал, мы молча падали на channels[0] — предложка улетала не туда.
                // Теперь явно инвалидируем сессию и просим стартовать заново.
                if (guestSession.targetChannelId) {
                    targetChannel = channels.find(c => String(c.tg_chat_id) === String(guestSession.targetChannelId));
                    if (!targetChannel) {
                        await service.deleteGuestSession(botId, tgUserId);
                        return ctx.reply('Канал, в который вы предлагали новость, больше не доступен. Откройте свежую ссылку "Предложить новость" под постом в нужном канале.');
                    }
                }
                if (!targetChannel) {
                    const type = guestSession.targetChannelType;
                    if (type) {
                        targetChannel = channels.find(c => c.visibility === type);
                    }
                    if (!targetChannel) {
                        await service.deleteGuestSession(botId, tgUserId);
                        return ctx.reply('Не удалось определить канал для предложения. Откройте ссылку "Предложить новость" под постом в нужном канале.');
                    }
                }
            }

            if (!isAdmin && targetChannel) {
                const maxLimit = targetChannel.max_suggestions_per_day !== undefined ? targetChannel.max_suggestions_per_day : 5;
                if (maxLimit > 0) {
                    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                    const { count, error } = await supabase
                        .from('autopost_items')
                        .select('*', { count: 'exact', head: true })
                        .eq('target_channel_id', targetChannel.tg_chat_id)
                        .eq('suggested_by_tg_id', String(tgUserId))
                        .gte('created_at', twentyFourHoursAgo);

                    if (!error && count >= maxLimit) {
                        return ctx.reply(`⚠️ Вы превысили суточный лимит предложений для канала "${targetChannel.title}" (максимум ${maxLimit} в сутки). Пожалуйста, попробуйте позже.`);
                    }
                }
            }

            let fileId = null;
            let mediaType = 'photo';

            if (ctx.message.photo) {
                const photo = ctx.message.photo[ctx.message.photo.length - 1];
                fileId = photo.file_id;
                mediaType = 'photo';
            } else if (ctx.message.video) {
                fileId = ctx.message.video.file_id;
                mediaType = 'video';
            } else if (ctx.message.animation) {
                fileId = ctx.message.animation.file_id;
                mediaType = 'animation';
            } else if (ctx.message.document) {
                fileId = ctx.message.document.file_id;
                mediaType = 'document';
            }

            if (!fileId) {
                return ctx.reply('❌ Неподдерживаемый тип файла.');
            }

            const mediaGroupId = ctx.message.media_group_id;

            // Bug 2: раньше условие было `mediaGroupId && ctx.message.photo`,
            // то есть альбомы видео/гифок/документов тихо превращались в
            // одиночные посты без вопроса. Теперь ловим альбом любого типа.
            if (mediaGroupId) {
                let group = service.mediaGroups.get(mediaGroupId);
                if (!group) {
                    group = { items: [], captions: [], timer: null };
                    service.mediaGroups.set(mediaGroupId, group);
                }
                group.items.push({ fileId, mediaType });
                if (ctx.message.caption) group.captions.push(ctx.message.caption);

                // Bug 3: 1c маловато для тормозных клиентов — поднимаем до 2с.
                // Поздно пришедшая фотка не должна молча уйти отдельным постом.
                if (group.timer) clearTimeout(group.timer);
                group.timer = setTimeout(async () => {
                    service.mediaGroups.delete(mediaGroupId);
                    const caption = group.captions.join('\n') || '';
                    const fileIds = group.items.map(i => i.fileId);
                    const mediaTypes = group.items.map(i => i.mediaType);
                    // Доминирующий тип — для колонки media_type на айтеме
                    const dominantType = mediaTypes.sort((a, b) =>
                        mediaTypes.filter(v => v === a).length - mediaTypes.filter(v => v === b).length
                    ).pop();

                    if (isAdmin) {
                        const cacheId = `${tgUserId}:${Date.now()}`;
                        await service.setAlbumCache(cacheId, {
                            botId,
                            tgUserId,
                            photos: fileIds,
                            mediaTypes,
                            caption,
                            targetChannelId: targetChannel.tg_chat_id
                        });
                        await ctx.reply(
                            `📸 **Обнаружен альбом из ${fileIds.length} позиций!**`,
                            Markup.inlineKeyboard([
                                [Markup.button.callback('📦 Опубликовать альбомом', `album:keep:${cacheId}`)],
                                [Markup.button.callback('✂️ Разбить на отдельные посты', `album:split:${cacheId}`)]
                            ])
                        );
                    } else {
                        const autoAccept = targetChannel.auto_accept_suggestions || false;
                        const status = autoAccept ? 'queued' : 'suggested';

                        await service.addPostItem({
                            botId,
                            targetChannelId: targetChannel.tg_chat_id,
                            fileIds,
                            caption,
                            status,
                            isSuggestion: true,
                            mediaType: dominantType || 'photo',
                            suggestedByTgId: tgUserId
                        });

                        if (autoAccept) {
                            await service.collapseQueue(botId, targetChannel.tg_chat_id);
                            await ctx.reply('🎉 Спасибо! Ваш пост принят и автоматически запланирован к публикации.');
                        } else {
                            await ctx.reply('🎉 Спасибо! Ваше предложение отправлено на модерацию администраторам.');
                            await service.notifyAdmins(botData, `📥 Получено новое предложение для канала "${targetChannel.title}"!`);
                        }
                    }
                }, 2000);
            } else {
                const caption = ctx.message.caption || '';
                if (isAdmin) {
                    await service.addPostItem({
                        botId,
                        targetChannelId: targetChannel.tg_chat_id,
                        fileIds: [fileId],
                        caption,
                        status: 'queued',
                        mediaType
                    });
                    await service.collapseQueue(botId, targetChannel.tg_chat_id);
                    const typeLabel = mediaType === 'video' ? 'Видео добавлено' : mediaType === 'animation' ? 'Гифка добавлена' : mediaType === 'document' ? 'Файл добавлен' : 'Картинка добавлена';
                    await ctx.reply(`✅ ${typeLabel} в очередь для канала "${targetChannel.title}".`);
                } else {
                    const autoAccept = targetChannel.auto_accept_suggestions || false;
                    const status = autoAccept ? 'queued' : 'suggested';

                    await service.addPostItem({
                        botId,
                        targetChannelId: targetChannel.tg_chat_id,
                        fileIds: [fileId],
                        caption,
                        status,
                        isSuggestion: true,
                        mediaType,
                        suggestedByTgId: tgUserId
                    });

                    if (autoAccept) {
                        await service.collapseQueue(botId, targetChannel.tg_chat_id);
                        await ctx.reply('🎉 Спасибо! Ваш пост принят и автоматически запланирован к публикации.');
                    } else {
                        await ctx.reply('🎉 Спасибо! Ваше предложение отправлено на модерацию администраторам.');
                        await service.notifyAdmins(botData, `📥 Получено новое предложение для канала "${targetChannel.title}"!`);
                    }
                }
            }
        } catch (error) {
            console.error('[Autopost] Ошибка добавления:', error);
            await ctx.reply('❌ Не удалось обработать отправленный контент.');
        }
    });
}
