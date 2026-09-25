/**
 * Нативные ветки обсуждений для автопостера.
 *
 * Bot API не создаёт тред обсуждения, когда бот просто отправляет пост в канал:
 * нативная кнопка «Перейти к обсуждению» не появляется. Лечится форвардом
 * опубликованных сообщений в привязанную группу обсуждений (именно forward —
 * forwardMessages/forwardMessage, НЕ copy: Telegram связывает тред только
 * по форварду). После форварда работают нативные комментарии, как у постов,
 * опубликованных вручную.
 */

/** Тексты ошибок включения discussion_forward_enabled — 400 из PATCH-настроек канала. */
export const DISCUSSION_ENABLE_ERRORS = {
    NO_LINKED_CHAT: 'У канала нет привязанной группы обсуждений — привяжи её в настройках Telegram-канала',
    BOT_NOT_MEMBER: 'Бот не состоит в группе обсуждений — добавь его туда (админка не обязательна, достаточно права писать)'
};

/**
 * Чистая валидация включения discussion_forward_enabled (без сети — удобно тестировать).
 *
 *   chat         — результат getChat(channel.tg_chat_id);
 *   memberStatus — status из getChatMember(linked_chat_id, bot user id),
 *                  или null, если вызов упал.
 *
 * Возвращает { ok, linkedChatId, error }.
 */
export function validateDiscussionEnable({ chat, memberStatus }) {
    const linkedChatId = chat?.linked_chat_id ?? null;
    if (linkedChatId == null) {
        return { ok: false, linkedChatId: null, error: DISCUSSION_ENABLE_ERRORS.NO_LINKED_CHAT };
    }
    const status = String(memberStatus || '');
    if (status !== 'administrator' && status !== 'member') {
        return { ok: false, linkedChatId, error: DISCUSSION_ENABLE_ERRORS.BOT_NOT_MEMBER };
    }
    return { ok: true, linkedChatId, error: null };
}

/**
 * Форвардит опубликованные в канале сообщения в привязанную группу обсуждений.
 *
 * Предпочитаем forwardMessages (Bot API 7.0): один вызов, альбом остаётся
 * сгруппированным. На клиентах без метода — по одному forwardMessage.
 * Возвращает массив message_id в группе обсуждений (в том же порядке).
 * Бросает исключение при ошибке Telegram — вызывающий (publishItem) решает,
 * что с ней делать: пост уже в канале, форвард — best-effort.
 */
export async function forwardToDiscussion(telegramClient, targetChatId, linkedChatId, messageIds) {
    const ids = (Array.isArray(messageIds) ? messageIds : [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0);
    if (!telegramClient || linkedChatId == null || ids.length === 0) return [];

    if (typeof telegramClient.forwardMessages === 'function') {
        const messages = await telegramClient.forwardMessages(linkedChatId, targetChatId, ids);
        return (Array.isArray(messages) ? messages : [])
            .map((m) => m?.message_id)
            .filter((id) => Number.isInteger(id));
    }

    const forwarded = [];
    try {
        for (const id of ids) {
            const msg = await telegramClient.forwardMessage(linkedChatId, targetChatId, id);
            if (Number.isInteger(msg?.message_id)) forwarded.push(msg.message_id);
        }
    } catch (e) {
        // Упало на середине: уже отправленные форварды вешаем на ошибку —
        // publishItem сохранит их в discussion_message_ids для последующей уборки.
        e.forwardedIds = forwarded;
        throw e;
    }
    return forwarded;
}
