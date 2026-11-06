/**
 * Text-input handler очереди: редактирование подписи (edit_caption),
 * создание текстового поста (await_text_post), подсказка в channel-picker.
 */
import { Markup } from 'telegraf';
import { promptChannelPicker } from './channel-select.js';

const CHANNEL_FORMS = ['канал', 'канала', 'каналов'];

export function pluralizeChannels(n) {
    const n10 = Math.abs(n) % 10;
    const n100 = Math.abs(n) % 100;
    if (n10 === 1 && n100 !== 11) return CHANNEL_FORMS[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return CHANNEL_FORMS[1];
    return CHANNEL_FORMS[2];
}

export function registerTextInputHandler(bot, service, botId) {
    const supabase = service.supabase;

    // Редактирование текста подписи через текстовый ввод + создание текстового поста.
    // Branching по state.action: 'edit_caption' (старая логика), 'await_text_post' (новая),
    // 'await_channel_select' (admin в picker — игнорим текст, подсказываем).
    bot.on('text', async (ctx, next) => {
        const tgUserId = ctx.from.id;
        const state = service.adminStates.get(tgUserId);

        if (!state) return next();

        // Ветка создания текстового поста
        if (state.action === 'await_text_post') {
            const text = ctx.message.text?.trim();

            // Валидация ДО delete state — иначе пустой/длинный текст заставляет
            // админа заново кликать «📝 Текст».
            if (!text) {
                return ctx.reply('❌ Пустой текст. Пришлите текст поста следующим сообщением или /cancel для отмены.');
            }
            if (text.length > 4096) {
                return ctx.reply(`❌ Текст слишком длинный (${text.length} символов, максимум 4096). Сократите и пришлите снова.`);
            }

            service.adminStates.delete(tgUserId);
            if (state.timer) clearTimeout(state.timer);

            try {
                // Multi-channel bot → показываем picker. Single-channel → old behavior.
                const { data: channels } = await supabase
                    .from('channels')
                    .select('tg_chat_id, title')
                    .eq('autopost_bot_id', botId);

                if (channels && channels.length > 1) {
                    await promptChannelPicker(ctx, service, tgUserId, {
                        content: { type: 'text', caption: text, fileIds: [], mediaType: 'text' },
                        defaultChannelId: state.targetChannelId,
                        channels
                    });
                    return;
                }

                await service.addPostItem({
                    botId,
                    targetChannelId: state.targetChannelId,
                    fileIds: [],
                    caption: text,
                    status: 'queued',
                    mediaType: 'text'
                });
                await service.collapseQueue(botId, state.targetChannelId);
                await ctx.reply(`✅ Текстовый пост добавлен в очередь для канала «${state.targetChannelTitle}».`);
            } catch (err) {
                console.error('[Autopost] Ошибка создания текстового поста:', err);
                await ctx.reply('❌ Не удалось создать пост. Попробуйте позже.');
            }
            return;
        }

        // Админ в picker — текст не нужен, подсказываем
        if (state.action === 'await_channel_select') {
            return ctx.reply('📋 Вы выбираете каналы. Нажмите «🚀 Опубликовать» или «❌ Отмена» под сообщением выше.');
        }

        // Существующая ветка — редактирование подписи
        if (state.action !== 'edit_caption') return next();

        service.adminStates.delete(tgUserId);

        let newCaption = ctx.message.text;
        if (newCaption.toLowerCase() === 'нет') {
            newCaption = '';
        }

        // Восстанавливаем per-sibling prev status/scheduled_at + обновляем caption.
        // Posted siblings получают только caption-апдейт (Telegram stays as-is).
        const affectedCount = (state.editableSiblings?.length || 0) + (state.postedSiblingIds?.length || 0);
        for (const s of state.editableSiblings || []) {
            await supabase
                .from('autopost_items')
                .update({
                    caption: newCaption,
                    status: s.prevStatus || 'queued',
                    scheduled_at: s.prevScheduledAt || null
                })
                .eq('id', s.id);
        }
        if (state.postedSiblingIds && state.postedSiblingIds.length > 0) {
            await supabase
                .from('autopost_items')
                .update({ caption: newCaption })
                .in('id', state.postedSiblingIds);
        }

        // Обновляем только кликнутую карточку. Sibling-карточки в других каналах
        // устаревают — обновятся при следующем открытии очереди (задокументированная
        // UX-шероховатость).
        const { data: item } = await supabase
            .from('autopost_items')
            .select('*')
            .eq('id', state.clickedItemId)
            .maybeSingle();

        if (item) {
            try {
                const fileId = item.file_ids && item.file_ids.length > 0 ? item.file_ids[0] : item.file_id;
                const statusText = item.status === 'scheduled'
                    ? `📅 Запланирован на ${new Date(item.scheduled_at).toLocaleString('ru-RU')} (подпись изменена)`
                    : '📦 В очереди (подпись изменена)';
                const buttons = [
                    [
                        Markup.button.callback('⚡️ Опубликовать', `post_now:${item.id}`),
                        Markup.button.callback('📝 Изменить текст', `edit_post_txt:${item.id}`)
                    ],
                    [Markup.button.callback('❌ Удалить', `del_post:${item.id}`)]
                ];

                if (fileId) {
                    await ctx.telegram.editMessageCaption(state.chatId, state.messageId, undefined, `${statusText}\n\n${newCaption}`, Markup.inlineKeyboard(buttons));
                } else {
                    await ctx.telegram.editMessageText(state.chatId, state.messageId, undefined, `${statusText}\n\n${newCaption}`, Markup.inlineKeyboard(buttons));
                }
            } catch (e) {
                console.error('Failed to update inline message caption:', e.message);
            }
        }

        try { await ctx.deleteMessage(); } catch (e) {}
        const plural = pluralizeChannels(affectedCount);
        const replyText = affectedCount > 1
            ? `✅ Подпись изменена в ${affectedCount} ${plural}`
            : '✅ Подпись успешно изменена!';
        return ctx.reply(replyText);
    });
}
