// Стадия 2 разрезки монстра userbot.service.js (план §7.3b): методы перенесены из
// класса ДОСЛОВНО (тела/JSDoc/комментарии без изменений); this.* зовётся через
// цепочку прототипов mixin-композиции в services/userbot.service.js.
import { Api } from 'teleproto';
import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import { withTimeout } from '../../shared/utils.js';
import { encodeCursor, decodeCursor } from '../../shared/pagination.js';
import { sanitizeMessage, sanitizeDialog, sanitizeParticipant } from '../../shared/content-sanitizer.js';
import { wrapTelegramError } from './telegram-errors.js';
import { clampLimit, normalizeChatIdInput, safeDisconnect, matchesDialogType, normalizeTelegramDate } from './helpers.js';
import { assertUserbotOperatable } from './botfather-lib.js';

// Telegram dates are unix SECONDS (GramJS keeps m.date numeric); since/until
// args are ISO strings. Normalize everything to epoch ms before comparing.
// (The pre-2026-11-21 post-filter did new Date(seconds) — 1970, matched all.)
function telegramDateToMs(value) {
    if (value == null) return null;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return Number.isFinite(value) ? value * 1000 : null;
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
}

export const DialogsMixin = (Base) => class extends Base {
    /**
     * Enumerate dialogs the userbot is a member of.
     * Cursor payload: { offset_id: number } — opaque to clients.
     */
    async listDialogs(userbot, { limit = 50, cursor, type, search } = {}) {
        assertUserbotOperatable(userbot);
        const pageLimit = clampLimit(limit, 1, 100);
        const decoded = decodeCursor(cursor);
        const offsetId = decoded?.offset_id ? Number(decoded.offset_id) : undefined;

        const client = await this.createAuthorizedClient(userbot);
        try {
            const dialogs = await withTimeout(
                client.getDialogs({
                    limit: pageLimit + 1,           // fetch one extra to detect has_more
                    offsetId,
                    ...(search ? { search } : {})
                }),
                30_000,
                'listDialogs'
            );
            const hasMore = dialogs.length > pageLimit;
            const trimmed = dialogs.slice(0, pageLimit);
            const items = trimmed
                .map((d) => sanitizeDialog(d))
                .filter((d) => matchesDialogType(d, type));

            const nextOffsetId = hasMore && trimmed.length ? Number(trimmed[trimmed.length - 1]?.id) || null : null;
            return {
                dialogs: items,
                cursor: nextOffsetId ? encodeCursor({ offset_id: nextOffsetId }) : null,
                has_more: hasMore && items.length > 0
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'listDialogs');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Fetch messages from a chat with optional time-window filter.
     *
     * Window semantics (fixed 2026-11-21 — the old build ignored `until` and
     * inverted `since`; see docs/integrations/operations/userbot-messages.md):
     *   - `until` (ISO) — upper bound of the window AND the pagination start
     *     point. Telegram's offsetDate/maxDate is an upper bound ("return
     *     messages older than this date"), so we start the feed at until+1s
     *     to keep the boundary second inclusive.
     *   - `since` (ISO) — lower bound; pagination pages back until messages
     *     older than `since` appear, then stops (has_more=false).
     *   - No bounds — newest-first from the top, as before.
     * Bounds travel inside the cursor payload so follow-up pages keep the
     * window: { offset_id, since?, until? }. Legacy { offset_id } cursors
     * still decode (bounds then come from the call args).
     */
    async fetchMessages(userbot, { chatId, since, until, limit = 50, cursor, textLimit } = {}) {
        assertUserbotOperatable(userbot);
        const id = normalizeChatIdInput(chatId);
        const pageLimit = clampLimit(limit, 1, 200);
        const maxTextLength = clampLimit(textLimit, 200, 200000);
        const decoded = decodeCursor(cursor);
        const sinceIso = since || decoded?.since || null;
        const untilIso = until || decoded?.until || null;
        const sinceMs = sinceIso ? telegramDateToMs(sinceIso) : null;
        const untilMs = untilIso ? telegramDateToMs(untilIso) : null;
        const offsetId = decoded?.offset_id ? Number(decoded.offset_id) : undefined;
        const offsetDate = untilMs !== null ? Math.floor(untilMs / 1000) + 1 : undefined;

        const client = await this.createAuthorizedClient(userbot);
        try {
            const peer = await this.resolveChatPeerForRead(client, userbot, id);
            const collected = [];
            let feedExhausted = false;
            let windowExhausted = false;
            let nextPageOffsetId = offsetId;
            let pages = 0;
            while (collected.length <= pageLimit && pages < 10 && !feedExhausted && !windowExhausted) {
                const batch = await withTimeout(
                    client.getMessages(peer, {
                        limit: pageLimit + 1,
                        offsetId: nextPageOffsetId,
                        ...(pages === 0 && offsetDate !== undefined ? { offsetDate } : {})
                    }),
                    30_000,
                    'fetchMessages'
                );
                pages += 1;
                if (!batch || batch.length === 0) {
                    feedExhausted = true;
                    break;
                }
                let oldestInBatch = Infinity;
                for (const m of batch) {
                    if (!m?.id) continue;
                    const mid = Number(m.id);
                    if (Number.isFinite(mid) && mid < oldestInBatch) oldestInBatch = mid;
                    const ts = telegramDateToMs(m.date);
                    if (sinceMs !== null && ts !== null && ts < sinceMs) {
                        windowExhausted = true;
                        break;
                    }
                    if (untilMs !== null && ts !== null && ts > untilMs) continue;
                    collected.push(m);
                    if (collected.length > pageLimit) break;
                }
                if (windowExhausted || collected.length > pageLimit) break;
                if (!Number.isFinite(oldestInBatch) || batch.length < pageLimit + 1) {
                    feedExhausted = true;
                    break;
                }
                nextPageOffsetId = oldestInBatch;
            }

            const hasMore = collected.length > pageLimit && !windowExhausted;
            const trimmed = collected.slice(0, pageLimit);
            const items = trimmed.map((m) => sanitizeMessage(m, { maxTextLength })).filter(Boolean);

            const nextOffsetId = hasMore && trimmed.length ? Number(trimmed[trimmed.length - 1]?.id) || null : null;
            const cursorPayload = nextOffsetId
                ? {
                    offset_id: nextOffsetId,
                    ...(sinceIso ? { since: sinceIso } : {}),
                    ...(untilIso ? { until: untilIso } : {})
                }
                : null;
            return {
                messages: items,
                cursor: cursorPayload ? encodeCursor(cursorPayload) : null,
                has_more: hasMore && items.length > 0
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'fetchMessages');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Server-side text search within a chat.
     */
    async searchMessages(userbot, { chatId, query, limit = 50, cursor, textLimit } = {}) {
        assertUserbotOperatable(userbot);
        const id = normalizeChatIdInput(chatId);
        const pageLimit = clampLimit(limit, 1, 200);
        const maxTextLength = clampLimit(textLimit, 200, 200000);
        const decoded = decodeCursor(cursor);
        const offsetId = decoded?.offset_id ? Number(decoded.offset_id) : undefined;

        const client = await this.createAuthorizedClient(userbot);
        try {
            const peer = await this.resolveChatPeerForRead(client, userbot, id);
            const messages = await withTimeout(
                client.getMessages(peer, {
                    limit: pageLimit + 1,
                    offsetId,
                    search: String(query || '')
                }),
                30_000,
                'searchMessages'
            );
            const hasMore = messages.length > pageLimit;
            const trimmed = messages.slice(0, pageLimit);
            const items = trimmed.map((m) => sanitizeMessage(m, { maxTextLength })).filter(Boolean);
            const nextOffsetId = hasMore && trimmed.length ? Number(trimmed[trimmed.length - 1]?.id) || null : null;
            return {
                messages: items,
                cursor: nextOffsetId ? encodeCursor({ offset_id: nextOffsetId }) : null,
                has_more: hasMore && items.length > 0
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'searchMessages');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * List participants of a chat/group/channel.
     * GramJS server-side filter only for some classes; client-side filter for others.
     * Hard cap at 5000 to bound cost.
     */
    async listParticipants(userbot, { chatId, limit = 100, cursor } = {}) {
        assertUserbotOperatable(userbot);
        const id = normalizeChatIdInput(chatId);
        const pageLimit = clampLimit(limit, 1, 200);
        const decoded = decodeCursor(cursor);
        const offset = decoded?.offset ? Number(decoded.offset) : 0;
        const HARD_CAP = 5000;
        const effectiveOffset = Math.min(offset, HARD_CAP);

        const client = await this.createAuthorizedClient(userbot);
        try {
            const result = await withTimeout(
                client.getParticipants(id, {
                    limit: pageLimit + 1,
                    offset: effectiveOffset,
                    search: ''
                }),
                30_000,
                'listParticipants'
            );
            const list = Array.isArray(result) ? result : (result?.users || result?.participants || []);
            const hasMore = list.length > pageLimit && (effectiveOffset + pageLimit) < HARD_CAP;
            const trimmed = list.slice(0, pageLimit);
            const items = trimmed.map((p) => sanitizeParticipant(p));
            const nextOffset = hasMore ? effectiveOffset + trimmed.length : null;
            return {
                participants: items,
                cursor: nextOffset ? encodeCursor({ offset: nextOffset }) : null,
                has_more: hasMore
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'listParticipants');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Send a text message. For DMs (chatId > 0), respects USERBOT_DM_ENABLED flag
     * and uses resolveDirectMessageTarget for peer resolution.
     */
    async sendTextMessage(userbot, { chatId, text, replyToMessageId } = {}) {
        assertUserbotOperatable(userbot);
        const id = normalizeChatIdInput(chatId);
        const body = String(text || '');
        if (!body) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "text" is required and must be non-empty.', {});
        }

        const chatIdNum = Number(id);
        const isDm = Number.isFinite(chatIdNum) && chatIdNum > 0;
        if (isDm && String(process.env.USERBOT_DM_ENABLED || '').trim().toLowerCase() !== 'true') {
            throw new MCPError(
                ERROR_CODES.DM_DISABLED,
                'Direct messages are disabled on this server. Set USERBOT_DM_ENABLED=true to enable.',
                { auditStatus: 'error' }
            );
        }

        const client = await this.createAuthorizedClient(userbot);
        try {
            let target = id;
            if (isDm) {
                // resolveDirectMessageTarget возвращает { peer, source } — в sendMessage
                // нужен именно peer, иначе GramJS бросает «Cannot cast [object Object]».
                const resolved = await this.resolveDirectMessageTarget(client, userbot, chatIdNum, {});
                if (!resolved?.peer) {
                    throw new MCPError(
                        ERROR_CODES.INVALID_PARAMS,
                        `Юзербот не знает этот TG ID (${id}): нет кэша access_hash, диалога в сессии и общего чата.`,
                        {}
                    );
                }
                target = resolved.peer;
            }

            const sent = await withTimeout(
                client.sendMessage(target, {
                    message: body,
                    ...(replyToMessageId ? { replyTo: Number(replyToMessageId) } : {})
                }),
                30_000,
                'sendTextMessage'
            );
            return {
                message_id: String(sent?.id || ''),
                date: sent?.date ? normalizeTelegramDate(sent.date) : null
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'sendTextMessage');
        } finally {
            await safeDisconnect(client);
        }
    }

    async leaveChat(userbot, { chatId } = {}) {
        assertUserbotOperatable(userbot);
        const id = normalizeChatIdInput(chatId);
        if (!id) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
        }

        const client = await this.createAuthorizedClient(userbot);
        try {
            const entity = await withTimeout(
                client.getInputEntity(id),
                30_000,
                'leaveChat.resolveEntity'
            );
            if (entity instanceof Api.InputPeerChat) {
                // basic-группа: LeaveChannel не работает — выход = удалить себя из чата.
                // userId требует InputUser (InputPeerSelf сервер отклоняет по схеме TL) —
                // паттерн broadcast-membership-cleanup.job.js (DeleteChatUser + InputUserSelf).
                await withTimeout(
                    client.invoke(new Api.messages.DeleteChatUser({
                        chatId: entity.chatId,
                        userId: new Api.InputUserSelf()
                    })),
                    30_000,
                    'leaveChat.deleteChatUser'
                );
                return { success: true, chat_id: String(id) };
            }
            await withTimeout(
                client.invoke(new Api.channels.LeaveChannel({ channel: entity })),
                30_000,
                'leaveChat.leaveChannel'
            );
            return { success: true, chat_id: String(id) };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'leaveChat');
        } finally {
            await safeDisconnect(client);
        }
    }
};
