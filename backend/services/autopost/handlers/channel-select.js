/**
 * Multi-target channel picker. После получения контента (текст/медиа/альбом)
 * админ выбирает, в какие каналы опубликовать. Active-канал пред-выбран —
 * тап по другим каналам добавляет их в selection. Тап «Опубликовать» — fan-out
 * через addPostItem({ targetChannelIds }) → N item rows grouped по batch_id.
 *
 * Гости picker НЕ получают — предложка по семантике всегда в один конкретный канал.
 *
 * Bot с 1 каналом picker тоже не показывает — лишний тап без выбора.
 */
import { Markup } from 'telegraf';

const CHANNEL_PICKER_TTL_MS = 10 * 60 * 1000;
const PUBLISH_FORMS = ['канал', 'канала', 'каналов'];

function pluralize(n, forms) {
    const n10 = Math.abs(n) % 10;
    const n100 = Math.abs(n) % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
    return forms[2];
}

export function buildChannelPickerKeyboard(channels, selectedIds) {
    const rows = channels.map((ch) => {
        const isSelected = selectedIds.includes(String(ch.tg_chat_id));
        const mark = isSelected ? '✅ ' : '⬜ ';
        return [Markup.button.callback(`${mark}${ch.title}`, `chpick:tg:${ch.tg_chat_id}`)];
    });

    if (selectedIds.length === 0) {
        rows.push([Markup.button.callback('❌ Нет каналов', 'chpick:empty')]);
    } else {
        const plural = pluralize(selectedIds.length, PUBLISH_FORMS);
        rows.push([Markup.button.callback(
            `🚀 Опубликовать в ${selectedIds.length} ${plural}`,
            'chpick:go'
        )]);
    }
    rows.push([Markup.button.callback('❌ Отмена', 'chpick:cancel')]);
    return Markup.inlineKeyboard(rows);
}

/**
 * Шорткат для callers: показывает picker и сразу сохраняет state.
 * selectedChannelIds предзаполнен defaultChannelId (обычно active).
 *
 * channels — массив записей из таблицы channels (с tg_chat_id и title).
 */
export async function promptChannelPicker(ctx, service, tgUserId, { content, defaultChannelId, channels, introText }) {
    const channelsLite = channels.map(c => ({
        tg_chat_id: String(c.tg_chat_id),
        title: c.title
    }));
    const selectedIds = [String(defaultChannelId)];
    const msg = await ctx.reply(
        introText || '📋 Куда опубликовать пост?\n\nТапните по каналам, чтобы выбрать несколько. Активный уже выбран.',
        buildChannelPickerKeyboard(channelsLite, selectedIds)
    );
    service.setAwaitChannelSelect(tgUserId, {
        content,
        selectedChannelIds: selectedIds,
        channels: channelsLite,
        pickerMessageId: msg.message_id
    });
    return msg;
}

export function registerChannelSelectHandler(bot, service, botId) {
    bot.action(/chpick:tg:(.+)/, async (ctx) => {
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const channelId = ctx.match[1];
        const state = service.adminStates.get(tgUserId);
        if (!state || state.action !== 'await_channel_select') {
            return ctx.answerCbQuery('Выбор устарел. Пришлите контент заново.');
        }

        const set = new Set(state.selectedChannelIds.map(String));
        if (set.has(String(channelId))) {
            set.delete(String(channelId));
        } else {
            set.add(String(channelId));
        }
        state.selectedChannelIds = Array.from(set);
        service.adminStates.set(tgUserId, state);

        try {
            await ctx.editMessageReplyMarkup(
                buildChannelPickerKeyboard(state.channels, state.selectedChannelIds).reply_markup
            );
        } catch (e) {
            // сообщение могли удалить — не критично
        }
        return ctx.answerCbQuery();
    });

    bot.action('chpick:empty', async (ctx) => {
        return ctx.answerCbQuery('Выберите хотя бы один канал');
    });

    bot.action('chpick:cancel', async (ctx) => {
        const tgUserId = ctx.from.id;
        const state = service.adminStates.get(tgUserId);
        if (state?.action === 'await_channel_select') {
            if (state.timer) clearTimeout(state.timer);
            service.adminStates.delete(tgUserId);
        }
        try { await ctx.deleteMessage(); } catch (e) {}
        await ctx.answerCbQuery('Отменено');
        await ctx.reply('❌ Публикация отменена.');
    });

    bot.action('chpick:go', async (ctx) => {
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const state = service.adminStates.get(tgUserId);
        if (!state || state.action !== 'await_channel_select' || state.selectedChannelIds.length === 0) {
            return ctx.answerCbQuery('Выбор устарел. Пришлите контент заново.');
        }

        const { content, selectedChannelIds, channels } = state;
        const channelMap = new Map(channels.map(c => [String(c.tg_chat_id), c]));

        try {
            // album_split: N одельных постов, каждый fan-out в выбранные каналы.
            // Каждый пост получает свой batch_id (одно фото = один логический пост).
            // Остальные типы — один batch_id на всю группу.
            if (content.type === 'album_split') {
                for (let i = 0; i < content.fileIds.length; i++) {
                    const fileId = content.fileIds[i];
                    const caption = (content.splitOption === 'dup' || i === 0) ? (content.caption || '') : '';
                    await service.addPostItem({
                        botId,
                        targetChannelIds: selectedChannelIds,
                        fileIds: [fileId],
                        caption,
                        status: 'queued',
                        mediaType: (content.mediaTypes && content.mediaTypes[i]) || 'photo'
                    });
                }
            } else {
                await service.addPostItem({
                    botId,
                    targetChannelIds: selectedChannelIds,
                    fileIds: content.fileIds || [],
                    caption: content.caption || '',
                    status: 'queued',
                    mediaType: content.mediaType || (content.fileIds?.length ? 'photo' : 'text')
                });
            }

            for (const cid of [...new Set(selectedChannelIds)]) {
                await service.collapseQueue(botId, cid);
            }

            if (state.timer) clearTimeout(state.timer);
            service.adminStates.delete(tgUserId);

            const titles = selectedChannelIds
                .map(cid => channelMap.get(String(cid))?.title || cid)
                .join(', ');
            const plural = pluralize(selectedChannelIds.length, PUBLISH_FORMS);
            await ctx.answerCbQuery('Добавлено');
            try { await ctx.deleteMessage(); } catch (e) {}
            await ctx.reply(`✅ Пост добавлен в ${selectedChannelIds.length} ${plural}: ${titles}.`);
        } catch (err) {
            console.error('[Autopost] channel-select publish failed:', err);
            await ctx.answerCbQuery('Ошибка: ' + String(err?.message || err).slice(0, 200));
            await ctx.reply('❌ Не удалось опубликовать. Попробуйте позже.');
        }
    });
}
