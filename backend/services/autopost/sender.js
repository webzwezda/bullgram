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

export async function sendItemToChannel(telegramClient, targetChatId, item, options = {}) {
    const { channel = null, botUsername = null, parseMode = 'Markdown' } = options;
    const replyMarkup = buildReplyMarkup({ channel, botUsername });

    // Альбом из нескольких фото
    if (item.file_ids && item.file_ids.length > 1) {
        const media = item.file_ids.map((fid, idx) => ({
            type: 'photo',
            media: fid,
            caption: idx === 0 ? (item.caption || undefined) : undefined,
            parse_mode: idx === 0 && item.caption ? parseMode : undefined
        }));
        const messages = await telegramClient.sendMediaGroup(targetChatId, media);
        return Array.isArray(messages) ? messages.map(m => m.message_id) : [];
    }

    const fileId = pickFileId(item);
    const mediaType = item.media_type || 'photo';
    const caption = item.caption || undefined;
    const sendOpts = {
        caption,
        parse_mode: item.caption ? parseMode : undefined,
        reply_markup: replyMarkup
    };

    let messageId;
    if (!fileId) {
        const msg = await telegramClient.sendMessage(targetChatId, item.caption, {
            parse_mode: parseMode,
            reply_markup: replyMarkup
        });
        messageId = msg.message_id;
    } else if (mediaType === 'video') {
        messageId = (await telegramClient.sendVideo(targetChatId, fileId, sendOpts)).message_id;
    } else if (mediaType === 'animation') {
        messageId = (await telegramClient.sendAnimation(targetChatId, fileId, sendOpts)).message_id;
    } else if (mediaType === 'document') {
        messageId = (await telegramClient.sendDocument(targetChatId, fileId, sendOpts)).message_id;
    } else {
        messageId = (await telegramClient.sendPhoto(targetChatId, fileId, sendOpts)).message_id;
    }

    return [messageId];
}
