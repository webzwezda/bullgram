// Стадия 2 разрезки монстра userbot.service.js (план §7.3b): методы перенесены из
// класса ДОСЛОВНО (тела/JSDoc/комментарии без изменений); this.* зовётся через
// цепочку прототипов mixin-композиции в services/userbot.service.js.
import { Api } from 'telegram';
import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import { withTimeout } from '../../shared/utils.js';
import { wrapTelegramError } from './telegram-errors.js';
import { normalizeChatIdInput, normalizeMessageIdInput, randomPositiveLong, safeDisconnect } from './helpers.js';
import { assertUserbotOperatable } from './botfather-lib.js';

export const MessagesOpsMixin = (Base) => class extends Base {
    /**
     * Отредактировать СВОЁ сообщение. Чужие Telegram отклоняет с
     * MESSAGE_EDIT_FORBIDDEN — маппится wrapTelegramError-ом.
     * GramJS: messages.EditMessage({ peer, id, message }).
     */
    async editSentMessage(userbot, { chatId, messageId, text } = {}) {
        assertUserbotOperatable(userbot);

        const id = normalizeChatIdInput(chatId);
        const textStr = String(text ?? '');
        if (!textStr.trim() || textStr.length > 4096) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "text" is required (1-4096 chars).', {});
        }
        const msgId = normalizeMessageIdInput(messageId);

        const client = await this.createAuthorizedClient(userbot);
        try {
            const peer = await this.resolveChatPeer(client, id);
            await withTimeout(
                client.invoke(new Api.messages.EditMessage({
                    peer,
                    id: msgId,
                    message: textStr
                })),
                30_000,
                'editSentMessage.edit'
            );
            return { chat_id: String(id), message_id: msgId, edited: true };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'editSentMessage');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Удалить сообщения безвозвратно (revoke). GramJS-хелпер client.deleteMessages
     * сам выбирает channels.DeleteMessages для каналов/супергрупп и
     * messages.DeleteMessages({ revoke }) для ЛС/базик-чатов (api.d.ts + client/messages.js).
     */
    async deleteSentMessages(userbot, { chatId, messageIds } = {}) {
        assertUserbotOperatable(userbot);

        const id = normalizeChatIdInput(chatId);
        const rawIds = Array.isArray(messageIds) ? messageIds : [];
        if (rawIds.length === 0) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "message_ids" must be a non-empty array of message IDs.', {});
        }
        // Хелпер принимает только числовые id (client/messages.js deleteMessages).
        const ids = rawIds.map(normalizeMessageIdInput);

        const client = await this.createAuthorizedClient(userbot);
        try {
            // Резолвим peer заранее: внутри хелпера getInputEntity без fallback на диалоги.
            const peer = await this.resolveChatPeer(client, id);
            await withTimeout(
                client.deleteMessages(peer, ids, { revoke: true }),
                60_000,
                'deleteSentMessages.delete'
            );
            console.log('[UserbotService] deleteSentMessages: удалено:', {
                userbot_id: userbot.id,
                chat_id: String(id),
                count: ids.length
            });
            return { chat_id: String(id), deleted: ids.length };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'deleteSentMessages');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Переслать сообщения в другой чат. GramJS: messages.ForwardMessages
     * ({ fromPeer, id, randomId, toPeer }). Конструктор сам автогенерирует
     * randomId, но мы задаём их явно — намеренно, ради дедупликации
     * и тестируемости (детерминированный инвариант в тестах).
     */
    async forwardSentMessages(userbot, { fromChatId, messageIds, toChatId } = {}) {
        assertUserbotOperatable(userbot);

        const fromId = normalizeChatIdInput(fromChatId);
        const toId = normalizeChatIdInput(toChatId);
        const rawIds = Array.isArray(messageIds) ? messageIds : [];
        if (rawIds.length === 0) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "message_ids" must be a non-empty array of message IDs.', {});
        }
        const ids = rawIds.map(normalizeMessageIdInput);

        const client = await this.createAuthorizedClient(userbot);
        try {
            const fromPeer = await this.resolveChatPeer(client, fromId);
            const toPeer = await this.resolveChatPeer(client, toId);
            await withTimeout(
                client.invoke(new Api.messages.ForwardMessages({
                    fromPeer,
                    id: ids,
                    randomId: ids.map(() => randomPositiveLong()),
                    toPeer
                })),
                30_000,
                'forwardSentMessages.forward'
            );
            return { to_chat_id: String(toId), forwarded: ids.length };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'forwardSentMessages');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Закрепить/открепить сообщение в чате.
     * GramJS: messages.UpdatePinnedMessage({ peer, id, unpin }).
     */
    async pinChatMessage(userbot, { chatId, messageId, unpin = false } = {}) {
        assertUserbotOperatable(userbot);

        const id = normalizeChatIdInput(chatId);
        const msgId = normalizeMessageIdInput(messageId);

        const client = await this.createAuthorizedClient(userbot);
        try {
            const peer = await this.resolveChatPeer(client, id);
            await withTimeout(
                client.invoke(new Api.messages.UpdatePinnedMessage({
                    peer,
                    id: msgId,
                    unpin: unpin === true
                })),
                30_000,
                'pinChatMessage.pin'
            );
            return { chat_id: String(id), message_id: msgId, pinned: !(unpin === true) };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'pinChatMessage');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Отметить чат прочитанным. markDialogAsRead не подходит — он резолвит
     * DM-адресата, а не произвольный чат. Peer-ветки по классу результата
     * getInputEntity: каналы/супергруппы — channels.ReadMessageContents по id
     * последнего сообщения (пустой канал размечать нечем), остальные —
     * messages.ReadHistory({ peer, maxId: MAX_INT }).
     */
    async markChatRead(userbot, { chatId } = {}) {
        assertUserbotOperatable(userbot);

        const id = normalizeChatIdInput(chatId);

        const client = await this.createAuthorizedClient(userbot);
        try {
            const peer = await this.resolveChatPeer(client, id);
            const className = String(peer?.className || '');
            const isChannelPeer = className === 'InputPeerChannel' || className === 'Channel';

            if (isChannelPeer) {
                const latest = await withTimeout(
                    client.getMessages(peer, { limit: 1 }),
                    30_000,
                    'markChatRead.latest'
                );
                const latestId = Number(latest?.[0]?.id || 0);
                if (latestId > 0) {
                    await withTimeout(
                        client.invoke(new Api.channels.ReadMessageContents({
                            channel: peer,
                            id: [latestId]
                        })),
                        30_000,
                        'markChatRead.readContents'
                    );
                }
            } else {
                await withTimeout(
                    client.invoke(new Api.messages.ReadHistory({
                        peer,
                        maxId: 2147483647
                    })),
                    30_000,
                    'markChatRead.readHistory'
                );
            }
            return { chat_id: String(id), read: true };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'markChatRead');
        } finally {
            await safeDisconnect(client);
        }
    }
};
