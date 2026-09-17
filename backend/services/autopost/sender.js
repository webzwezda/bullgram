/**
 * Универсальный отправитель поста в канал.
 * Используется планировщиком и при ручной публикации (post_now / sug_post_now),
 * чтобы логика media_type + buttons_config + кнопки «Предложить новость» не дублировалась.
 *
 * Возвращает массив message_ids (для sendMediaGroup их несколько).
 */

import { buildChecklistMessage } from './checklist.js';

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
 * Fix 5 (код-ревью): распознаёт FLOOD_WAIT (429) от Telegram.
 * Telegraf кладёт retry_after в err.response.parameters.retry_after.
 * Возвращает количество секунд ожидания или 0, если ошибка не flood.
 */
export function getFloodWaitSeconds(err) {
    if (!err) return 0;
    const retryAfter = Number(err?.response?.parameters?.retry_after);
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter;
    const code = err?.response?.error_code ?? err?.code;
    const msg = String(err?.message || '');
    if (Number(code) === 429 || /too many requests|flood/i.test(msg)) {
        const m = msg.match(/retry after (\d+)/i);
        return m ? Number(m[1]) : 5;
    }
    return 0;
}

/**
 * Fix 3 (код-ревью): Bot API не принимает reply_markup в sendMediaGroup, поэтому
 * инлайн-кнопки канала навешиваются вторым шагом — editMessageReplyMarkup на
 * первом сообщении альбома (кнопка растягивается на весь альбом). Ошибка edit
 * не роняет отправку: пост уже в канале, логируем и возвращаем messageIds.
 */
async function applyAlbumReplyMarkup(telegramClient, targetChatId, messageIds, replyMarkup) {
    if (!replyMarkup || !Array.isArray(messageIds) || messageIds.length === 0) return;
    try {
        await telegramClient.editMessageReplyMarkup(targetChatId, messageIds[0], undefined, replyMarkup);
    } catch (e) {
        console.error('[Autopost sender] Не удалось навесить кнопки на альбом (non-fatal):', e.message);
    }
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
            const ids = Array.isArray(messages) ? messages.map(m => m.message_id) : [];
            await applyAlbumReplyMarkup(telegramClient, targetChatId, ids, replyMarkup);
            return ids;
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
            const ids = Array.isArray(messages) ? messages.map(m => m.message_id) : [];
            await applyAlbumReplyMarkup(telegramClient, targetChatId, ids, replyMarkup);
            return ids;
        }
    }

    // Чек-лист: собственный рендер (текст с прогрессом + кнопка на пункт).
    // Данные (checklist/items/showNames) прокидывает publishItem через item.options —
    // здесь БД не читаем. Канальные URL-кнопки и «Предложить новость» не подмешиваем:
    // клавиатура чек-листа принадлежит его пунктам (решение 8 из плана). Plain text.
    if (item.media_type === 'checklist') {
        const checklistOpts = item.options || {};
        const { text, replyMarkup } = buildChecklistMessage(checklistOpts.checklist, checklistOpts.items, {
            showNames: checklistOpts.showNames !== false
        });
        const message = await telegramClient.sendMessage(targetChatId, text, { reply_markup: replyMarkup });
        return [message.message_id];
    }

    const fileId = pickFileId(item);
    const mediaType = item.media_type || 'photo';
    const caption = item.caption || undefined;
    const baseSendOpts = { caption, reply_markup: replyMarkup };

    let messageId;
    if (!fileId) {
        const msg = await safeSend(
            (opts) => telegramClient.sendMessage(targetChatId, item.caption, opts),
            { reply_markup: replyMarkup, disable_web_page_preview: true },
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
