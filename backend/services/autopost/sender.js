/**
 * Универсальный отправитель поста в канал.
 * Используется планировщиком и при ручной публикации (post_now / sug_post_now),
 * чтобы логика media_type + buttons_config + кнопки «Предложить новость» не дублировалась.
 *
 * Возвращает массив message_ids (для sendMediaGroup их несколько).
 */

function buildReplyMarkup({ channel, botUsername }) {
    if (!channel) return undefined;

    const inline_keyboard = [];

    if (Array.isArray(channel.buttons_config) && channel.buttons_config.length > 0) {
        inline_keyboard.push(
            channel.buttons_config.map(b => ({ text: b.text, url: b.url }))
        );
    }

    if (channel.suggest_button_enabled && botUsername) {
        inline_keyboard.push([
            { text: 'Предложить новость ✉️', url: `https://t.me/${botUsername}?start=suggest_ch${channel.id}` }
        ]);
    }

    return inline_keyboard.length > 0 ? { inline_keyboard } : undefined;
}

function pickFileId(item) {
    return (item.file_ids && item.file_ids.length > 0) ? item.file_ids[0] : item.file_id;
}

/**
 * Bug 8: Telegram выбрасывает 400 "can't parse entities" при любом незакрытом
 * Markdown-символе (_ * [ ` в подписях с URL вида https://t.me/_user).
 * Пробуем Markdown, при ошибке парса ретраим без parse_mode.
 */
async function safeSend(fn, payload, parseMode) {
    try {
        return await fn(parseMode ? { ...payload, parse_mode: parseMode } : payload);
    } catch (err) {
        const msg = String(err?.message || '');
        const isParseError = /can't parse entities|parse mode/i.test(msg) || err?.code === 400;
        if (!isParseError || !parseMode) throw err;
        return await fn(payload);
    }
}

export async function sendItemToChannel(telegramClient, targetChatId, item, options = {}) {
    const { channel = null, botUsername = null, parseMode = 'Markdown' } = options;
    const replyMarkup = buildReplyMarkup({ channel, botUsername });
    const hasCaption = Boolean(item.caption);

    // Альбом (>= 2 медиа). sendMediaGroup у Telegram принимает только однородные
    // альбомы (все photo ИЛИ все video). Смешанные альбомы отправить одним вызовом
    // нельзя — для них админу нужно выбрать "Разбить".
    if (item.file_ids && item.file_ids.length > 1) {
        const groupType = item.media_type === 'video' ? 'video' : 'photo';

        const media = item.file_ids.map((fid, idx) => {
            const entry = { type: groupType, media: fid };
            if (idx === 0 && hasCaption) {
                entry.caption = item.caption;
                if (parseMode) entry.parse_mode = parseMode;
            }
            return entry;
        });

        try {
            const messages = await telegramClient.sendMediaGroup(targetChatId, media);
            return Array.isArray(messages) ? messages.map(m => m.message_id) : [];
        } catch (err) {
            const msg = String(err?.message || '');
            const isParseError = /can't parse entities|parse mode/i.test(msg) || err?.code === 400;
            if (!isParseError || !hasCaption) throw err;
            // Ретраим без parse_mode на первом элементе
            const fallbackMedia = media.map((m, idx) => {
                if (idx === 0) {
                    const { parse_mode, ...rest } = m; // eslint-disable-line no-unused-vars
                    return rest;
                }
                return m;
            });
            const messages = await telegramClient.sendMediaGroup(targetChatId, fallbackMedia);
            return Array.isArray(messages) ? messages.map(m => m.message_id) : [];
        }
    }

    const fileId = pickFileId(item);
    const mediaType = item.media_type || 'photo';
    const caption = item.caption || undefined;
    const baseSendOpts = { caption, reply_markup: replyMarkup };

    let messageId;
    if (!fileId) {
        const msg = await safeSend(
            (opts) => telegramClient.sendMessage(targetChatId, item.caption, opts),
            { reply_markup: replyMarkup },
            hasCaption ? parseMode : null
        );
        messageId = msg.message_id;
    } else if (mediaType === 'video') {
        messageId = (await safeSend(
            (opts) => telegramClient.sendVideo(targetChatId, fileId, opts),
            baseSendOpts,
            hasCaption ? parseMode : null
        )).message_id;
    } else if (mediaType === 'animation') {
        messageId = (await safeSend(
            (opts) => telegramClient.sendAnimation(targetChatId, fileId, opts),
            baseSendOpts,
            hasCaption ? parseMode : null
        )).message_id;
    } else if (mediaType === 'document') {
        messageId = (await safeSend(
            (opts) => telegramClient.sendDocument(targetChatId, fileId, opts),
            baseSendOpts,
            hasCaption ? parseMode : null
        )).message_id;
    } else {
        messageId = (await safeSend(
            (opts) => telegramClient.sendPhoto(targetChatId, fileId, opts),
            baseSendOpts,
            hasCaption ? parseMode : null
        )).message_id;
    }

    return [messageId];
}
