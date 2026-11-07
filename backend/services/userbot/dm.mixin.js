// Стадия 2 разрезки монстра userbot.service.js (план §7.3b): методы перенесены из
// класса ДОСЛОВНО (тела/JSDoc/комментарии без изменений); this.* зовётся через
// цепочку прототипов mixin-композиции в services/userbot.service.js.
import { Api } from 'teleproto';
import { logTelegramErrorEvent } from '../../utils/telegram-error-events.js';
import { getPeerFromCache } from '../../utils/peer-cache.js';
import { describeTelegramError, isTimeoutLikeTelegramError } from './telegram-errors.js';
import { normalizeChatIdInput } from './helpers.js';
import { findPeerByDialogPages } from './botfather-lib.js';

export const DmMixin = (Base) => class extends Base {
    async checkPresence(userbot, channels) {
        const client = await this.createAuthorizedClient(userbot);

        const presenceMap = {};
        try {
            for (const channel of channels) {
                try {
                    const participants = await client.getParticipants(channel.tg_chat_id, { limit: 5000 });
                    presenceMap[channel.id] = participants.map(p => String(p.id));
                } catch (e) {
                    presenceMap[channel.id] = [];
                }
            }
            return { success: true, presence: presenceMap };
        } finally {
            await client.disconnect();
        }
    }

    async sendMessage(userbot, tg_user_id, message, options = {}) {
        const client = await this.createAuthorizedClient(userbot);
        let targetResolution = null;

        try {
            const spamBlock = await this.inspectSpamBlockStatus(client, {
                userbotId: userbot?.id || null
            });
            if (spamBlock.blocked) {
                const spamBlockError = new Error(spamBlock.reason || 'SpamBot подтвердил, что аккаунт ограничен Telegram.');
                spamBlockError.resolution_source = 'spambot';
                throw spamBlockError;
            }

            targetResolution = await this.resolveDirectMessageTarget(client, userbot, tg_user_id, options);
            if (!targetResolution?.peer) {
                throw new Error('Юзербот не знает этот TG ID. Написать можно только тому, с кем уже был диалог, общий чат или кого удалось найти в общей группе.');
            }

            await client.sendMessage(targetResolution.peer, { message: message });
            return { success: true };
        } catch (sendErr) {
            if (targetResolution?.source && !sendErr?.resolution_source) {
                sendErr.resolution_source = targetResolution.source;
            }
            await logTelegramErrorEvent(this.supabase, {
                owner_id: userbot?.owner_id,
                userbot_id: userbot?.id || null,
                tg_user_id: String(tg_user_id || ''),
                event_source: options?.event_source || 'userbot',
                event_type: options?.event_type || 'direct_message',
                error: sendErr,
                meta: {
                    message_length: String(message || '').length,
                    common_chat_id: options?.common_chat_id ? String(options.common_chat_id) : null,
                    resolution_source: sendErr?.resolution_source || null,
                    resolution_trace: Array.isArray(sendErr?.resolution_trace) ? sendErr.resolution_trace : []
                }
            });
            console.error('Ошибка отправки через юзербот:', {
                tg_user_id: String(tg_user_id),
                message_length: String(message || '').length,
                error_message: sendErr?.message || null,
                error_name: sendErr?.name || null,
                error_code: sendErr?.code || null,
                error_text: sendErr?.errorMessage || null,
                resolution_source: sendErr?.resolution_source || null,
                resolution_trace: Array.isArray(sendErr?.resolution_trace) ? sendErr.resolution_trace : []
            });
            throw new Error(this.getDirectMessageError(sendErr));
        } finally {
            await client.disconnect();
        }
    }

    async markDialogAsRead(userbot, tg_user_id, options = {}) {
        const client = await this.createAuthorizedClient(userbot);

        try {
            const targetResolution = await this.resolveDirectMessageTarget(client, userbot, tg_user_id, options);
            if (!targetResolution?.peer) {
                throw new Error('Юзербот не знает этот TG ID. Не могу отметить диалог как прочитанный.');
            }

            await client.invoke(new Api.messages.ReadHistory({
                peer: targetResolution.peer,
                maxId: 2147483647
            }));

            return { success: true };
        } finally {
            await client.disconnect();
        }
    }

    async normalizeInputPeer(client, candidate) {
        if (!candidate) return null;
        if (candidate.inputEntity) {
            return candidate.inputEntity;
        }
        if (
            candidate instanceof Api.InputPeerUser
            || candidate instanceof Api.InputPeerChat
            || candidate instanceof Api.InputPeerChannel
            || candidate instanceof Api.InputPeerSelf
        ) {
            return candidate;
        }

        return client.getInputEntity(candidate);
    }

    async findPeerByIteratingDialogs(client, normalizedId, options = {}) {
        return findPeerByDialogPages(client, normalizedId, {
            ...options,
            normalize: (dialog) => this.normalizeInputPeer(client, dialog)
        });
    }

    /**
     * Резолв peer для read-операций (fetch/search messages). Свежая сессия юзербота
     * имеет пустой кэш сущностей GramJS — голый getInputEntity падает
     * («Could not find the input entity»), поэтому DM идёт через
     * resolveDirectMessageTarget (кэш access_hash + пагинация диалогов),
     * а чаты/каналы — getInputEntity с fallback на пагинацию диалогов.
     */
    async resolveChatPeerForRead(client, userbot, chatId) {
        const id = normalizeChatIdInput(chatId);
        const chatIdNum = Number(id);
        if (Number.isFinite(chatIdNum) && chatIdNum > 0) {
            const dm = await this.resolveDirectMessageTarget(client, userbot, chatIdNum, {});
            if (dm?.peer) return dm.peer;
            throw new Error(`Юзербот не знает этот TG ID (${id}): нет кэша access_hash, диалога в сессии и общего чата.`);
        }
        try {
            return await client.getInputEntity(id);
        } catch (error) {
            const viaDialogs = await this.findPeerByIteratingDialogs(client, id);
            if (viaDialogs) return viaDialogs;
            throw error;
        }
    }

    async resolveDirectMessageTarget(client, userbot, tgUserId, options = {}) {
        const normalizedId = String(tgUserId || '').trim();
        if (!normalizedId) return null;
        const preferredChatId = options?.common_chat_id ? String(options.common_chat_id).trim() : '';
        const allowAggressiveLookup = options?.aggressive_lookup === true;
        let timeoutLikeError = null;
        const resolutionTrace = [];

        const rememberResolutionError = (stage, error) => {
            resolutionTrace.push({
                stage,
                ...describeTelegramError(error)
            });
        };

        const rememberTimeout = (error) => {
            if (!timeoutLikeError && isTimeoutLikeTelegramError(error)) {
                timeoutLikeError = error;
            }
            rememberResolutionError('timeout_like', error);
        };

        try {
            const me = await client.getMe();
            if (me?.id && String(me.id) === normalizedId) {
                try {
                    return {
                        peer: await client.getInputEntity('me'),
                        source: 'self'
                    };
                } catch {
                    return {
                        peer: new Api.InputPeerSelf(),
                        source: 'self'
                    };
                }
            }
        } catch (error) {
            rememberTimeout(error);
        }

        if (preferredChatId) {
            try {
                const fromPreferredChat = await this.resolveTargetFromSpecificChat(client, preferredChatId, normalizedId);
                if (fromPreferredChat) {
                    return {
                        peer: await this.normalizeInputPeer(client, fromPreferredChat),
                        source: 'preferred_chat'
                    };
                }
            } catch (error) {
                rememberResolutionError('preferred_chat', error);
                rememberTimeout(error);
            }
        }

        try {
            const cachedPeer = await getPeerFromCache(this.supabase, userbot?.id, normalizedId);
            if (cachedPeer?.access_hash) {
                const cachedInputPeer = new Api.InputPeerUser({
                    userId: BigInt(normalizedId),
                    accessHash: BigInt(cachedPeer.access_hash)
                });
                await client.invoke(new Api.users.GetFullUser({ id: cachedInputPeer }));
                return {
                    peer: cachedInputPeer,
                    source: 'cached_access_hash'
                };
            }
        } catch (error) {
            rememberResolutionError('cached_access_hash', error);
            rememberTimeout(error);
        }

        try {
            const dialogPeer = await this.findPeerByIteratingDialogs(client, normalizedId);
            if (dialogPeer) {
                return {
                    peer: dialogPeer,
                    source: 'dialogs'
                };
            }
        } catch (error) {
            rememberResolutionError('dialogs', error);
            rememberTimeout(error);
        }

        try {
            return {
                peer: await client.getInputEntity(normalizedId),
                source: 'input_entity'
            };
        } catch (error) {
            rememberResolutionError('input_entity', error);
            rememberTimeout(error);
        }

        try {
            const entity = await client.getEntity(normalizedId);
            return {
                peer: await this.normalizeInputPeer(client, entity),
                source: 'entity'
            };
        } catch (error) {
            rememberResolutionError('entity', error);
            rememberTimeout(error);
        }

        if (allowAggressiveLookup) {
            try {
                const fromCommonChats = await this.resolveTargetFromCommonChats(client, normalizedId);
                if (fromCommonChats) {
                    return {
                        peer: await this.normalizeInputPeer(client, fromCommonChats),
                        source: 'common_chats'
                    };
                }
            } catch (error) {
                rememberResolutionError('common_chats', error);
                rememberTimeout(error);
            }

            try {
                const fromKnownChannels = await this.resolveTargetFromKnownChannels(client, userbot, normalizedId);
                if (fromKnownChannels) {
                    return {
                        peer: await this.normalizeInputPeer(client, fromKnownChannels),
                        source: 'known_channels'
                    };
                }
            } catch (error) {
                rememberResolutionError('known_channels', error);
                rememberTimeout(error);
            }
        }

        if (timeoutLikeError) {
            timeoutLikeError.resolution_trace = resolutionTrace;
            throw timeoutLikeError;
        }

        return null;
    }

    async resolveTargetFromSpecificChat(client, tgChatId, tgUserId) {
        const participants = await client.getParticipants(tgChatId, { limit: 5000 });
        return (participants || []).find(participant => String(participant?.id || '') === tgUserId) || null;
    }

    async resolveTargetFromCommonChats(client, tgUserId) {
        const dialogs = await client.getDialogs({ limit: 80 });
        const groupDialogs = (dialogs || []).filter(dialog => dialog.isChannel || dialog.isGroup);

        for (const dialog of groupDialogs.slice(0, 25)) {
            try {
                const participants = await client.getParticipants(dialog.entity, { limit: 5000 });
                const target = (participants || []).find(participant => String(participant?.id || '') === tgUserId);
                if (target) {
                    return target;
                }
            } catch {
                // some chats won't return participants; skip them
            }
        }

        return null;
    }

    async resolveTargetFromKnownChannels(client, userbot, tgUserId) {
        if (!userbot?.owner_id) return null;

        const { data: channels, error } = await this.supabase
            .from('channels')
            .select('id, tg_chat_id')
            .eq('owner_id', userbot.owner_id)
            .not('tg_chat_id', 'is', null);

        if (error) throw error;

        for (const channel of channels || []) {
            try {
                const participants = await client.getParticipants(channel.tg_chat_id, { limit: 5000 });
                const target = (participants || []).find(participant => String(participant?.id || '') === tgUserId);
                if (target) {
                    return target;
                }
            } catch {
                // ignore and keep searching other known channels
            }
        }

        return null;
    }

    getDirectMessageError(error) {
        const raw = String(
            error?.errorMessage
            || error?.message
            || error?.description
            || ''
        );
        const normalized = raw.toUpperCase();

        if (
            normalized.includes('YOUR ACCOUNT WAS BLOCKED')
            || normalized.includes('VIOLATIONS OF THE TELEGRAM TERMS OF SERVICE')
            || normalized.includes('CONFIRMED BY OUR MODERATORS')
        ) {
            return 'Telegram через SpamBot подтвердил, что этот аккаунт заблокирован за нарушения. Этим юзерботом больше нельзя писать.';
        }

        if (
            normalized.includes('PEER_ID_INVALID')
            || normalized.includes('INPUT ENTITY')
            || normalized.includes('CANNOT FIND ANY ENTITY')
            || normalized.includes('NO INPUT ENTITY')
        ) {
            const resolutionSource = error?.resolution_source ? ` Последняя попытка шла через ${error.resolution_source}.` : '';
            return `Юзербот не смог корректно собрать Telegram peer для этого адресата.${resolutionSource} Написать можно только тому, с кем уже был диалог, общий чат или кого удалось найти в общей группе.`;
        }

        if (normalized.includes('USER_IS_BLOCKED')) {
            return 'Этот пользователь заблокировал юзербота. Telegram не даст написать.';
        }

        if (normalized.includes('USER_PRIVACY_RESTRICTED')) {
            return 'У пользователя стоит приватность. Telegram не дает написать ему напрямую.';
        }

        if (normalized.includes('FLOOD_WAIT')) {
            return 'Telegram просит притормозить. По этому юзерботу сработал flood wait.';
        }

        if (normalized.includes('CHAT_WRITE_FORBIDDEN')) {
            return 'Юзербот не может писать в этот диалог. Telegram запретил отправку.';
        }

        if (normalized.includes('AUTH_KEY_UNREGISTERED') || normalized.includes('SESSION_REVOKED')) {
            return 'Сессия юзербота сдохла. Нужно переподключить аккаунт.';
        }

        return raw
            ? `Не удалось отправить сообщение. Telegram ответил: ${raw}`
            : 'Не удалось отправить сообщение.';
    }
};
