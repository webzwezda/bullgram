/**
 * Callback'и управления очередью: post_now, edit_post_txt, move_post, del_post
 * + text-input handler для редактирования подписи.
 */
import { Markup } from 'telegraf';
import { sendItemToChannel } from '../sender.js';

export function registerQueueCallbacksHandler(bot, service, botId) {
    const supabase = service.supabase;

    bot.action(/post_now:(.+)/, async (ctx) => {
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

            await sendItemToChannel(ctx.telegram, item.target_channel_id, item, {
                channel,
                botUsername: botData?.username
            });

            await supabase
                .from('autopost_items')
                .update({ status: 'posted', posted_at: new Date().toISOString(), error_message: null })
                .eq('id', itemId);

            await ctx.answerCbQuery('Опубликовано!');
            try { await ctx.deleteMessage(); } catch (e) {}

            if (item.target_channel_id) {
                await service.collapseQueue(botId, item.target_channel_id);
            }
        } catch (err) {
            console.error('[Autopost] Ошибка публикации:', err.message);
            await supabase
                .from('autopost_items')
                .update({ status: 'failed', error_message: String(err.message || '').slice(0, 1000) })
                .eq('id', itemId);
            await ctx.answerCbQuery('Ошибка: ' + err.message);
        }
    });

    bot.action(/edit_post_txt:(.+)/, async (ctx) => {
        const itemId = ctx.match[1];
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        // Bug 6 guard: если админ уже редактирует другой пост — сбрасываем
        // старый предмет обратно в его прежний статус, иначе он зависнет в 'editing'
        // на 10 минут до того, как stuck-editing cron до него доберётся.
        const prevState = service.adminStates.get(tgUserId);
        if (prevState && prevState.action === 'edit_caption' && prevState.itemId !== itemId) {
            await supabase
                .from('autopost_items')
                .update({ status: prevState.prevStatus || 'queued', scheduled_at: prevState.prevScheduledAt || null })
                .eq('id', prevState.itemId);
            service.adminStates.delete(tgUserId);
        }

        const { data: itemBefore } = await supabase
            .from('autopost_items')
            .select('status, scheduled_at')
            .eq('id', itemId)
            .single();

        await supabase
            .from('autopost_items')
            .update({ status: 'editing' })
            .eq('id', itemId);

        service.adminStates.set(tgUserId, {
            action: 'edit_caption',
            itemId,
            messageId: ctx.callbackQuery.message.message_id,
            chatId: ctx.chat.id,
            prevStatus: itemBefore?.status || 'queued',
            prevScheduledAt: itemBefore?.scheduled_at || null
        });

        await ctx.reply('Введите новый текст для этого поста (или напишите "нет" для пустой подписи):');
        await ctx.answerCbQuery();
    });

    bot.action(/move_post:(.+)/, async (ctx) => {
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

        const { data: channels } = await supabase
            .from('channels')
            .select('*')
            .eq('autopost_bot_id', botId);

        if (!channels || channels.length < 2) {
            return ctx.answerCbQuery('Подключите оба канала для переноса.');
        }

        const otherChannel = channels.find(c => String(c.tg_chat_id) !== String(item.target_channel_id));
        if (!otherChannel) return ctx.answerCbQuery('Другой канал не найден');

        const oldChannelId = item.target_channel_id;

        await supabase
            .from('autopost_items')
            .update({ target_channel_id: otherChannel.tg_chat_id, status: 'queued', scheduled_at: null })
            .eq('id', itemId);

        await ctx.answerCbQuery(`Перенесено в ${otherChannel.title}`);
        try { await ctx.deleteMessage(); } catch (e) {}

        if (oldChannelId) await service.collapseQueue(botId, oldChannelId);
        await service.collapseQueue(botId, otherChannel.tg_chat_id);
    });

    bot.action(/del_post:(.+)/, async (ctx) => {
        const itemId = ctx.match[1];
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const { data: item } = await supabase
            .from('autopost_items')
            .select('target_channel_id')
            .eq('id', itemId)
            .single();

        await supabase
            .from('autopost_items')
            .delete()
            .eq('id', itemId);

        await ctx.answerCbQuery('Пост удален');
        try { await ctx.deleteMessage(); } catch (e) {}

        if (item?.target_channel_id) {
            await service.collapseQueue(botId, item.target_channel_id);
        }
    });

    // Редактирование текста подписи через текстовый ввод
    bot.on('text', async (ctx, next) => {
        const tgUserId = ctx.from.id;
        const state = service.adminStates.get(tgUserId);
        if (!state || state.action !== 'edit_caption') {
            return next();
        }

        service.adminStates.delete(tgUserId);

        let newCaption = ctx.message.text;
        if (newCaption.toLowerCase() === 'нет') {
            newCaption = '';
        }

        // Важно: апдейтим caption + восстанавливаем прежний status/scheduled_at.
        // Раньше код сбрасывал status → 'queued' и scheduled_at → null,
        // после чего collapseQueue пересчитывал весь канал. Это означало, что
        // правка подписи у одного поста незаметно сдвигала расписание всех остальных.
        // Теперь status/scheduled_at сохраняются — правка текста не двигает расписание.
        await supabase
            .from('autopost_items')
            .update({
                caption: newCaption,
                status: state.prevStatus || 'queued',
                scheduled_at: state.prevScheduledAt || null
            })
            .eq('id', state.itemId);

        const { data: item } = await supabase
            .from('autopost_items')
            .select('*')
            .eq('id', state.itemId)
            .single();

        try {
            const fileId = item.file_ids && item.file_ids.length > 0 ? item.file_ids[0] : item.file_id;
            const statusText = `📦 В очереди (подпись изменена)`;
            const buttons = [
                [
                    Markup.button.callback('⚡️ Опубликовать', `post_now:${item.id}`),
                    Markup.button.callback('📝 Изменить текст', `edit_post_txt:${item.id}`)
                ],
                [
                    Markup.button.callback('❌ Удалить', `del_post:${item.id}`)
                ]
            ];

            if (fileId) {
                await ctx.telegram.editMessageCaption(state.chatId, state.messageId, undefined, `${statusText}\n\n${newCaption}`, Markup.inlineKeyboard(buttons));
            } else {
                await ctx.telegram.editMessageText(state.chatId, state.messageId, undefined, `${statusText}\n\n${newCaption}`, Markup.inlineKeyboard(buttons));
            }
        } catch (e) {
            console.error('Failed to update inline message caption:', e.message);
        }

        try { await ctx.deleteMessage(); } catch (e) {}
        return ctx.reply('✅ Подпись успешно изменена!');
    });
}
