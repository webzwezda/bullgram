// Выдача юзерботу админ-прав в чате: через официального бота (Bot API) или юзербота-админа из пула (MTProto).

import { Api } from 'telegram';
import { withTimeout } from '../shared/utils.js';

async function callBotApi(token, method, payload) {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }
    return {
        ok: response.ok && data?.ok === true,
        result: data?.result ?? null,
        description: data?.description || `HTTP ${response.status}`
    };
}

export function toBotApiChatId(chatId) {
    const value = String(chatId);
    if (value.startsWith('-')) return value;
    return `-100${value}`;
}

function extractUsername(rawLink) {
    const value = String(rawLink || '').trim();
    if (!value || value.includes('/+')) return null;
    const match = value.match(/^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{4,64})$/i) || value.match(/^@([A-Za-z0-9_]{4,64})$/);
    return match ? match[1] : null;
}

export class ChatAdminRightsService {
    constructor(supabase) {
        this.supabase = supabase;
    }

    async loadOfficialBots(ownerId) {
        const { data } = await this.supabase
            .from('tg_accounts')
            .select('id, tg_username, tg_account_id, session_data')
            .eq('owner_id', ownerId)
            .eq('account_type', 'bot')
            .not('session_data', 'is', null);
        return data || [];
    }

    // ищет бота, который сам админ с правом выдачи прав в этом чате
    async findPromoterBot(ownerId, chatId) {
        const bots = await this.loadOfficialBots(ownerId);
        for (const bot of bots) {
            const token = typeof bot.session_data === 'string'
                ? bot.session_data.trim()
                : String(bot.session_data?.token || '').trim();
            if (!token) continue;

            let botUserId = String(bot.tg_account_id || '').trim();
            if (!botUserId || botUserId === 'null') {
                const me = await callBotApi(token, 'getMe', {});
                if (!me.ok) continue;
                botUserId = String(me.result.id);
            }

            const member = await callBotApi(token, 'getChatMember', {
                chat_id: toBotApiChatId(chatId),
                user_id: Number(botUserId)
            });
            const result = member.result;
            if (result?.status === 'administrator' && result.can_promote_members === true) {
                return { bot: { ...bot, token }, tg_user_id: botUserId };
            }
        }
        return null;
    }

    async grantAdminViaBot(bot, chatId, userbotTgUserId) {
        return callBotApi(bot.token, 'promoteChatMember', {
            chat_id: toBotApiChatId(chatId),
            user_id: Number(userbotTgUserId),
            is_anonymous: false,
            can_manage_chat: true,
            can_delete_messages: false,
            can_restrict_members: false,
            can_promote_members: false,
            can_change_info: false,
            can_invite_users: false,
            can_post_messages: false,
            can_edit_messages: false,
            can_pin_messages: false,
            can_manage_video_chats: false
        });
    }

    // ищет среди юзерботов пула админа с правом выдачи прав и промоутит целевого юзербота через MTProto
    async findPromoterUserbot(userbotService, candidates, rawLink, chatId, targetTgUserId) {
        for (const candidate of candidates || []) {
            if (String(candidate.tg_account_id || '') === String(targetTgUserId)) continue;
            let client = null;
            try {
                client = await userbotService.createAuthorizedClient(candidate);
                const channel = await this.resolveChatEntity(client, rawLink, chatId);
                if (!channel) continue;

                const self = await withTimeout(client.invoke(new Api.channels.GetParticipant({
                    channel,
                    participant: new Api.InputUserSelf()
                })), 30_000, 'GetParticipant');
                const rights = self?.participant?.adminRights;
                if (!rights || rights.canPromoteMembers !== true) continue;

                const participants = await withTimeout(client.getParticipants(channel, { limit: 5000 }), 120_000, 'Скан участников');
                const target = (participants || []).find(participant => String(participant.id) === String(targetTgUserId));
                if (!target || target.accessHash == null) continue;

                await withTimeout(client.invoke(new Api.channels.EditAdmin({
                    channel,
                    userId: new Api.InputUser({ userId: BigInt(String(targetTgUserId)), accessHash: BigInt(String(target.accessHash)) }),
                    adminRights: new Api.ChatAdminRights({ canManageChat: true }),
                    rank: ''
                })), 30_000, 'EditAdmin');
                return { userbot: candidate };
            } catch {
                continue;
            } finally {
                if (client) await client.disconnect().catch(() => {});
            }
        }
        return null;
    }

    // публичный username резолвим напрямую; приватные чаты ищем в диалогах кандидата по chat_id
    async resolveChatEntity(client, rawLink, chatId) {
        const username = extractUsername(rawLink);
        if (username) {
            try {
                return await withTimeout(client.getInputEntity(username), 30_000, 'resolve username');
            } catch {
                // нет доступа по username — пробуем через диалоги
            }
        }
        if (chatId == null) return null;
        const bare = String(chatId).replace(/^-100/, '');
        const dialogs = await withTimeout(client.getDialogs({ limit: 300 }), 120_000, 'Скан диалогов');
        const hit = (dialogs || []).find(dialog =>
            String(dialog.id).replace(/^-100/, '') === bare &&
            (dialog?.entity?.className === 'Channel' || dialog?.entity?.className === 'Chat'));
        return hit?.entity || null;
    }
}
