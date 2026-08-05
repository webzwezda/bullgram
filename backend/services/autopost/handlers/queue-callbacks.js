/**
 * Callback'и управления очередью: post_now, edit_post_txt, move_post, del_post
 * + text-input handler для редактирования подписи + пагинация очереди.
 */
import { Markup } from 'telegraf';
import { showQueueForChannel } from '../keyboard.js';
import { promptChannelPicker } from './channel-select.js';

const CHANNEL_FORMS = ['канал', 'канала', 'каналов'];

function pluralizeChannels(n) {
    const n10 = Math.abs(n) % 10;
    const n100 = Math.abs(n) % 100;
    if (n10 === 1 && n100 !== 11) return CHANNEL_FORMS[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return CHANNEL_FORMS[1];
    return CHANNEL_FORMS[2];
}

// Восстанавливает editable siblings предыдущей незавершённой правки.
// Используется в Bug 6 guard (edit_post_txt) и при cancel.
async function restorePrevEdit(supabase, state) {
    if (!state?.editableSiblings) return;
    for (const s of state.editableSiblings) {
        await supabase
            .from('autopost_items')
            .update({
                status: s.prevStatus || 'queued',
                scheduled_at: s.prevScheduledAt || null
            })
            .eq('id', s.id);
    }
}

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

            await service.publishItem(bot, item, channel, botData?.username);

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

        // Bug 6 guard: если админ уже редактирует другой пост — восстанавливаем
        // editable siblings предыдущего batch'а, иначе они зависнут в 'editing'
        // на 10 минут до stuck-editing cron.
        const prevState = service.adminStates.get(tgUserId);
        if (prevState && prevState.action === 'edit_caption' && prevState.clickedItemId !== itemId) {
            await restorePrevEdit(supabase, prevState);
            service.adminStates.delete(tgUserId);
        }

        const { data: item } = await supabase
            .from('autopost_items')
            .select('id, post_batch_id')
            .eq('id', itemId)
            .single();
        if (!item?.post_batch_id) return ctx.answerCbQuery('Пост не найден');

        const batchId = item.post_batch_id;

        // Concurrent-edit protection: отказываем если другой админ активно
        // редактирует этот же batch. Проверка через adminStates (не status='editing'!)
        // — иначе блокировали бы легитимную правку после забытой, пока cron не сработал.
        const isBeingEditedByOther = service.adminStates && Array.from(service.adminStates.values())
            .some(s => s.action === 'edit_caption' && s.batchId === batchId);
        if (isBeingEditedByOther) {
            return ctx.answerCbQuery('Этот пост сейчас редактируют');
        }

        // Load siblings, split editable (queued/scheduled) vs posted (already public).
        // 'failed' остаёмся не трогаем — админ решит отдельно через retry/delete.
        const { data: siblings } = await supabase
            .from('autopost_items')
            .select('id, status, scheduled_at, target_channel_id')
            .eq('post_batch_id', batchId);
        const allSiblings = siblings || [];
        const editable = allSiblings.filter(s => ['queued', 'scheduled', 'editing'].includes(s.status));
        const posted = allSiblings.filter(s => s.status === 'posted');

        if (editable.length === 0) {
            return ctx.answerCbQuery('В очереди нет редактируемых постов этого batch');
        }

        // Помечаем editable как 'editing' — scheduler их пропустит. Single UPDATE.
        await supabase
            .from('autopost_items')
            .update({ status: 'editing' })
            .in('id', editable.map(s => s.id));

        service.adminStates.set(tgUserId, {
            action: 'edit_caption',
            batchId,
            clickedItemId: itemId,
            messageId: ctx.callbackQuery.message.message_id,
            chatId: ctx.chat.id,
            editableSiblings: editable.map(s => ({
                id: s.id,
                prevStatus: s.status === 'editing' ? 'queued' : s.status,
                prevScheduledAt: s.scheduled_at
            })),
            postedSiblingIds: posted.map(s => s.id)
        });

        const totalChannels = editable.length + posted.length;
        const plural = pluralizeChannels(totalChannels);
        const prompt = totalChannels > 1
            ? `Введите новый текст (применится ко всем ${totalChannels} ${plural} этого поста, или напишите "нет" для пустой подписи):`
            : 'Введите новый текст для этого поста (или напишите "нет" для пустой подписи):';
        await ctx.reply(prompt);
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
            .select('post_batch_id')
            .eq('id', itemId)
            .single();
        if (!item?.post_batch_id) return ctx.answerCbQuery('Пост не найден');

        // Actionable siblings: queued/scheduled/editing. Posted/failed не трогаем —
        // posted уже в Telegram, deleting DB row только запутает счётчик.
        const { data: siblings } = await supabase
            .from('autopost_items')
            .select('target_channel_id')
            .eq('post_batch_id', item.post_batch_id)
            .in('status', ['queued', 'scheduled', 'editing']);
        const affectedChannels = [...new Set((siblings || []).map(s => String(s.target_channel_id)))];
        const affectedCount = siblings?.length || 0;

        await supabase
            .from('autopost_items')
            .delete()
            .eq('post_batch_id', item.post_batch_id)
            .in('status', ['queued', 'scheduled', 'editing']);

        await ctx.answerCbQuery(`Удалено из очереди: ${affectedCount} ${pluralizeChannels(affectedCount)}`);
        try { await ctx.deleteMessage(); } catch (e) {}

        for (const cid of affectedChannels) {
            await service.collapseQueue(botId, cid);
        }
    });

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

    // Пагинация очереди: callback_data = queue_page:CHANNEL_ID:offset (число или 'last')
    bot.action(/queue_page:(-?\d+):(\d+|last)/, async (ctx) => {
        const channelId = ctx.match[1];
        const offsetRaw = ctx.match[2];
        const offset = offsetRaw === 'last' ? 'last' : parseInt(offsetRaw, 10);

        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const { data: channel } = await supabase
            .from('channels')
            .select('*')
            .eq('tg_chat_id', String(channelId))
            .eq('autopost_bot_id', botId)
            .maybeSingle();
        if (!channel) {
            return ctx.answerCbQuery('Канал не найден');
        }

        try { await ctx.deleteMessage(); } catch (e) {}
        await ctx.answerCbQuery();
        await showQueueForChannel(ctx, botId, channel, supabase, offset);
    });
}
