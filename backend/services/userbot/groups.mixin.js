// Стадия 2 разрезки монстра userbot.service.js (план §7.3b): методы перенесены из
// класса ДОСЛОВНО (тела/JSDoc/комментарии без изменений); this.* зовётся через
// цепочку прототипов mixin-композиции в services/userbot.service.js.
import { Api } from 'telegram';
import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import { withTimeout } from '../../shared/utils.js';
import { PROMOTE_ADMIN_RIGHTS_PRESETS } from './constants.js';
import { wrapTelegramError } from './telegram-errors.js';
import { normalizeChatIdInput, safeDisconnect } from './helpers.js';
import { assertFeatureEnabled, assertUserbotOperatable, parseTelegramInviteLink } from './botfather-lib.js';

export const GroupsMixin = (Base) => class extends Base {
    async joinChatByInvite(userbot, { inviteLink } = {}) {
        assertUserbotOperatable(userbot);
        const raw = String(inviteLink || '').trim();
        if (!raw) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "invite_link" is required.', {});
        }
        const parsed = parseTelegramInviteLink(raw);
        if (!parsed) {
            throw new MCPError(
                ERROR_CODES.INVALID_PARAMS,
                'Unsupported invite link. Use t.me/+hash, t.me/joinchat/hash, t.me/username, or @username.',
                {}
            );
        }
        if (parsed.kind === 'private_permalink') {
            throw new MCPError(
                ERROR_CODES.INVALID_PARAMS,
                't.me/c/<id> private permalinks cannot be joined directly. Need an invite hash (t.me/+hash or t.me/joinchat/hash).',
                {}
            );
        }

        const client = await this.createAuthorizedClient(userbot);
        try {
            let title = null;
            let chatId = null;
            let accessHash = null;
            let kind = parsed.kind === 'username' ? 'channel' : 'group';

            if (parsed.kind === 'invite_hash') {
                const result = await withTimeout(
                    client.invoke(new Api.messages.ImportChatInvite({ hash: parsed.value })),
                    30_000,
                    'joinChatByInvite.importInvite'
                );
                const chat = result?.chats?.[0] || null;
                title = chat?.title || null;
                chatId = chat?.id ? String(chat.id) : null;
                accessHash = chat?.accessHash != null ? String(chat.accessHash) : null;
                kind = chat?.className === 'Channel' ? 'channel' : 'group';
            } else {
                const entity = await withTimeout(
                    client.getEntity(parsed.value),
                    30_000,
                    'joinChatByInvite.resolveEntity'
                );
                await withTimeout(
                    client.invoke(new Api.channels.JoinChannel({ channel: entity })),
                    30_000,
                    'joinChatByInvite.joinChannel'
                );
                title = entity?.title || entity?.username || null;
                chatId = entity?.id ? String(entity.id) : null;
                accessHash = entity?.accessHash != null ? String(entity.accessHash) : null;
                kind = entity?.className === 'Channel' ? 'channel' : 'group';
            }

            return {
                chat_id: chatId,
                access_hash: accessHash,
                title,
                kind
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'joinChatByInvite');
        } finally {
            await safeDisconnect(client);
        }
    }

    // ============================================================
    // Волна 1 userbot-ops: жизненный цикл группы/бота (план 2026-09-17).
    // Все имена Api.* сверены с node_modules/telegram/tl/api.d.ts (telegram 2.26.22).
    // Каждый метод: assertUserbotOperatable → флаг-гейт → createAuthorizedClient →
    // try → finally safeDisconnect → wrapTelegramError.
    // ============================================================

    /**
     * Создать группу или канал, где юзербот — владелец. Сразу выпускает invite-ссылку.
     * GramJS: channels.CreateChannel({ megagroup | broadcast, title, about }) →
     * result.chats[0] (Api.Channel: id/accessHash/title) → messages.ExportChatInvite({ peer }).
     */
    async createGroupChat(userbot, { title, kind = 'group', about = '' } = {}) {
        assertUserbotOperatable(userbot);
        assertFeatureEnabled('USERBOT_GROUP_ADMIN_ENABLED', 'Создание групп/каналов юзерботом');

        const titleStr = String(title || '').trim();
        if (!titleStr || titleStr.length > 128) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "title" is required (1-128 chars).', {});
        }
        const isChannel = String(kind || 'group') === 'channel';
        const aboutStr = String(about || '').trim().slice(0, 255);

        const client = await this.createAuthorizedClient(userbot);
        try {
            const result = await withTimeout(
                client.invoke(new Api.channels.CreateChannel({
                    title: titleStr,
                    about: aboutStr,
                    megagroup: !isChannel,
                    broadcast: isChannel
                })),
                30_000,
                'createGroupChat.createChannel'
            );
            const chat = result?.chats?.[0] || null;
            if (!chat?.id) {
                throw new MCPError(
                    ERROR_CODES.TELEGRAM_ERROR,
                    'Telegram не вернул созданный чат в ответе CreateChannel.',
                    { auditStatus: 'telegram_error' }
                );
            }

            const peer = new Api.InputPeerChannel({
                channelId: BigInt(String(chat.id)),
                accessHash: BigInt(String(chat.accessHash ?? '0'))
            });
            const exported = await withTimeout(
                client.invoke(new Api.messages.ExportChatInvite({ peer })),
                30_000,
                'createGroupChat.exportInvite'
            );

            console.log('[UserbotService] createGroupChat: создан чат:', {
                userbot_id: userbot.id,
                chat_id: String(chat.id),
                kind: isChannel ? 'channel' : 'group',
                title: chat.title || titleStr
            });

            // Bot API-формат: для супергрупп/каналов id маркируется префиксом -100.
            // Голый MTProto-id Bot API не находит («chat not found») — а именно Bot API
            // публикует автопост-бот. Invite/promote резолвят оба формата через getEntity.
            const botApiChatId = `-100${chat.id}`;

            return {
                chat_id: botApiChatId,
                mtproto_id: String(chat.id),
                access_hash: chat?.accessHash != null ? String(chat.accessHash) : null,
                title: chat?.title || titleStr,
                invite_link: exported?.link || null
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'createGroupChat');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Пригласить участников в группу/канал по одному, чтобы отказ одному не ронял остальных.
     * GramJS: channels.InviteToChannel({ channel, users: [entity] }).
     */
    async inviteGroupMembers(userbot, { chatId, members } = {}) {
        assertUserbotOperatable(userbot);
        assertFeatureEnabled('USERBOT_GROUP_ADMIN_ENABLED', 'Приглашение участников юзерботом');

        const id = normalizeChatIdInput(chatId);
        const rawMembers = Array.isArray(members) ? members : [];
        if (rawMembers.length === 0) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "members" must be a non-empty array of @usernames.', {});
        }
        const usernames = rawMembers.map((raw) => {
            const value = String(raw || '').trim();
            if (!/^@?[A-Za-z0-9_]{4,32}$/.test(value)) {
                throw new MCPError(
                    ERROR_CODES.INVALID_PARAMS,
                    `member "${value}" is not a valid @username.`,
                    {}
                );
            }
            return `@${value.replace(/^@/, '')}`;
        });

        const client = await this.createAuthorizedClient(userbot);
        try {
            const channel = await this.resolveChatPeer(client, id);
            const results = [];
            for (let i = 0; i < usernames.length; i++) {
                const username = usernames[i];
                try {
                    const user = await withTimeout(
                        client.getEntity(username),
                        30_000,
                        'inviteGroupMembers.resolveUser'
                    );
                    await withTimeout(
                        client.invoke(new Api.channels.InviteToChannel({ channel, users: [user] })),
                        30_000,
                        'inviteGroupMembers.invite'
                    );
                    results.push({ member: username, status: 'ok', error: null });
                } catch (memberError) {
                    const rawError = String(memberError?.errorMessage || memberError?.message || memberError);
                    // USER_ALREADY_PARTICIPANT — участник уже в чате, это не провал операции.
                    if (rawError.toUpperCase().includes('USER_ALREADY_PARTICIPANT')) {
                        results.push({ member: username, status: 'already', error: null });
                    } else {
                        results.push({
                            member: username,
                            status: 'failed',
                            error: rawError.slice(0, 300)
                        });
                    }
                }
                // Пауза между инвайтами (кроме последнего) — Telegram не любит серию InviteToChannel.
                if (i < usernames.length - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            }
            return { results };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'inviteGroupMembers');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Назначить/разжать админа в группе или канале.
     * Права сверяются с api.d.ts (telegram 2.26.22): Api.ChatAdminRights —
     * changeInfo/postMessages/editMessages/deleteMessages/banUsers/inviteUsers/
     * pinMessages/addAdmins/anonymous/manageCall/other/manageTopics/... —
     * Bot-API-имена (canManageChat/canPromoteMembers) в MTProto отсутствуют:
     * право «назначать админов» = addAdmins.
     */
    async promoteGroupMember(userbot, { chatId, member, rights = 'all' } = {}) {
        assertUserbotOperatable(userbot);
        assertFeatureEnabled('USERBOT_GROUP_ADMIN_ENABLED', 'Назначение админов юзерботом');

        const id = normalizeChatIdInput(chatId);
        const memberStr = String(member || '').trim();
        if (!memberStr) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "member" is required.', {});
        }
        const preset = PROMOTE_ADMIN_RIGHTS_PRESETS[rights];
        if (!preset) {
            throw new MCPError(
                ERROR_CODES.INVALID_PARAMS,
                'Argument "rights" must be one of: all, post_only, revoke.',
                {}
            );
        }

        const client = await this.createAuthorizedClient(userbot);
        try {
            const channel = await this.resolveChatPeer(client, id);

            // Свои права: GetParticipant(channel, InputPeerSelf) — паттерн chat-admin-rights.service.js.
            const self = await withTimeout(
                client.invoke(new Api.channels.GetParticipant({
                    channel,
                    participant: new Api.InputPeerSelf()
                })),
                30_000,
                'promoteGroupMember.getSelf'
            );
            const selfRights = self?.participant?.adminRights;
            if (!selfRights || selfRights.addAdmins !== true) {
                throw new MCPError(
                    ERROR_CODES.FORBIDDEN,
                    'У юзербота нет прав назначать админов в этом чате.',
                    {}
                );
            }

            const targetUser = await this.resolveMemberInputUser(client, channel, memberStr);
            await withTimeout(
                client.invoke(new Api.channels.EditAdmin({
                    channel,
                    userId: targetUser,
                    adminRights: new Api.ChatAdminRights(preset),
                    rank: ''
                })),
                30_000,
                'promoteGroupMember.editAdmin'
            );

            return { chat_id: String(id), member: memberStr, rights };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'promoteGroupMember');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Выпустить свежую invite-ссылку или отозвать: конкретную (аргумент link)
     * либо текущую основную (revoke=true без link — достаём её из
     * channels.GetFullChannel → fullChat.exportedInvite.link, затем
     * messages.EditExportedChatInvite({ peer, link, revoked: true })).
     * Паттерн contour-admin-rights.service.js.
     */
    async exportGroupInviteLink(userbot, { chatId, link = null, revoke = false } = {}) {
        assertUserbotOperatable(userbot);
        assertFeatureEnabled('USERBOT_GROUP_ADMIN_ENABLED', 'Инвайт-ссылки юзерботом');

        const id = normalizeChatIdInput(chatId);
        const linkStr = link != null ? String(link).trim() : '';

        const client = await this.createAuthorizedClient(userbot);
        try {
            const peer = await this.resolveChatPeer(client, id);

            if (revoke && linkStr) {
                await withTimeout(
                    client.invoke(new Api.messages.EditExportedChatInvite({
                        peer,
                        link: linkStr,
                        revoked: true
                    })),
                    30_000,
                    'exportGroupInviteLink.revoke'
                );
                return { chat_id: String(id), revoked: true, invite_link: null };
            }

            if (revoke) {
                const full = await withTimeout(
                    client.invoke(new Api.channels.GetFullChannel({ channel: peer })),
                    30_000,
                    'exportGroupInviteLink.full'
                );
                const currentLink = full?.fullChat?.exportedInvite?.link || null;
                if (!currentLink) {
                    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'У группы нет активной ссылки-инвайта', {});
                }
                await withTimeout(
                    client.invoke(new Api.messages.EditExportedChatInvite({
                        peer,
                        link: currentLink,
                        revoked: true
                    })),
                    30_000,
                    'exportGroupInviteLink.revokeCurrent'
                );
                return { chat_id: String(id), revoked: true, invite_link: null };
            }

            const exported = await withTimeout(
                client.invoke(new Api.messages.ExportChatInvite({ peer })),
                30_000,
                'exportGroupInviteLink.export'
            );
            return {
                chat_id: String(id),
                revoked: false,
                invite_link: exported?.link || null
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'exportGroupInviteLink');
        } finally {
            await safeDisconnect(client);
        }
    }
};
