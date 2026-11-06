/**
 * Telegram-слой membership-cleanup (самовыход из чатов + kick-фолбэки через промоутеров)
 * — вынесен из broadcast-membership-cleanup.job.js без изменения поведения (разрезка под
 * pre-commit лимит 20KB). Все функции module-level: замыканий на DI-фабрику нет —
 * supabase/deps приходят параметрами. Константы пейсинга (PACE_MS/MAX_ROWS_PER_TICK)
 * остаются в job-файле.
 */
import { Api } from 'telegram';
import { toBotApiChatId } from '../../services/chat-admin-rights.service.js';
import { withTimeout } from '../../shared/utils.js';

export function defaultSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function safeDisconnect(client) {
    if (!client) return;
    try {
        await withTimeout(client.disconnect(), 5_000, 'client.disconnect');
    } catch (error) {
        console.error('[BroadcastCleanup] disconnect failed:', error?.message || error);
    }
}

export function bareChatId(value) {
    return String(value ?? '').replace(/^-100/, '');
}

// «уже не участник» — не ошибка, а успешный исход: удалять нечего
export function isAlreadyLeftError(error) {
    const raw = String(error?.errorMessage || error?.message || error || '');
    return /USER_NOT_PARTICIPANT|not\s+a\s+member/i.test(raw);
}

export async function callBotApi(token, method, payload) {
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

// Свежий клиент не знает peer по сырому id — резолвим, а при провале ищем в диалогах
// по bare id (прецедент: contour-admin-rights readUserbotAdminState / resolveChatEntity).
export async function resolvePeer(client, chatId) {
    try {
        return await client.getInputEntity(Number(chatId));
    } catch (error) {
        const dialogs = await withTimeout(client.getDialogs({ limit: 300 }), 120_000, 'Скан диалогов');
        const hit = (dialogs || []).find(dialog =>
            bareChatId(dialog?.id) === bareChatId(chatId) &&
            (dialog?.entity?.className === 'Channel' || dialog?.entity?.className === 'Chat'));
        if (!hit?.entity) throw error;
        return hit.entity;
    }
}

export async function leaveOwnChat(client, chatId) {
    const peer = await resolvePeer(client, chatId);
    if (peer instanceof Api.InputPeerChat) {
        // basic-группа: выход = удалить себя из чата (user_id требует InputUser —
        // InputPeerSelf сервер отклоняет по схеме TL)
        await withTimeout(
            client.invoke(new Api.messages.DeleteChatUser({ chatId: peer.chatId, userId: new Api.InputUserSelf() })),
            30_000,
            'DeleteChatUser'
        );
        return;
    }
    await withTimeout(
        client.invoke(new Api.channels.LeaveChannel({ channel: peer })),
        30_000,
        'LeaveChannel'
    );
}

// Промоутер №1: официальный бот владельца, админ этой группы с правом бана. Kick = ban + unban.
export async function kickViaBotPromoter(supabase, ownerId, chatId, joinerTgUserId) {
    const { data: bots } = await supabase
        .from('tg_accounts')
        .select('id, tg_account_id, session_data')
        .eq('owner_id', ownerId)
        .eq('account_type', 'bot')
        .not('session_data', 'is', null);
    for (const bot of bots || []) {
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
        if (member.result?.status !== 'administrator' || member.result?.can_restrict_members !== true) continue;

        const banned = await callBotApi(token, 'banChatMember', {
            chat_id: toBotApiChatId(chatId),
            user_id: Number(joinerTgUserId)
        });
        if (!banned.ok) continue;
        // kick завершён только после проверенного unban — иначе юзербот остаётся забаненным
        const unbanPayload = {
            chat_id: toBotApiChatId(chatId),
            user_id: Number(joinerTgUserId),
            only_if_banned: true
        };
        let unbanned = await callBotApi(token, 'unbanChatMember', unbanPayload);
        if (!unbanned.ok) {
            unbanned = await callBotApi(token, 'unbanChatMember', unbanPayload);
        }
        if (!unbanned.ok) return { kicked: false, banned: true };
        return true;
    }
    return false;
}

// Промоутер №2: юзербот-админ этой группы с can_restrict_members (подход findPromoterUserbot).
export async function kickViaUserbotPromoter(deps, ownerId, chatId, joinerTgUserId, excludeUserbotId) {
    const { data: candidates, error } = await deps.supabase
        .from('tg_accounts')
        .select('*, proxies(is_working)')
        .eq('owner_id', ownerId)
        .eq('account_type', 'userbot');
    if (error) return false;
    const pool = (candidates || []).filter(account =>
        String(account.id) !== String(excludeUserbotId) &&
        account.runtime_status !== 'pending_activation' &&
        account.runtime_status !== 'restricted' &&
        !(account.proxy_id && account.proxies?.is_working === false));

    const banRights = new Api.ChatBannedRights({
        untilDate: 0,
        viewMessages: true,
        sendMessages: true,
        sendMedia: true,
        sendStickers: true,
        sendGifs: true,
        sendGames: true,
        sendInline: true,
        sendPolls: true,
        changeInfo: true,
        inviteUsers: true,
        pinMessages: true
    });
    const unbanRights = new Api.ChatBannedRights({
        untilDate: 0,
        viewMessages: false,
        sendMessages: false,
        sendMedia: false,
        sendStickers: false,
        sendGifs: false,
        sendGames: false,
        sendInline: false,
        sendPolls: false,
        changeInfo: false,
        inviteUsers: false,
        pinMessages: false
    });

    for (const candidate of pool) {
        let client = null;
        try {
            client = await deps.userbotClientFactory(candidate);
            const peer = await resolvePeer(client, chatId);
            if (peer instanceof Api.InputPeerChat) continue; // basic-группа: EditBanned не работает
            const self = await withTimeout(
                client.invoke(new Api.channels.GetParticipant({ channel: peer, participant: new Api.InputPeerSelf() })),
                30_000,
                'GetParticipant'
            );
            if (self?.participant?.adminRights?.canRestrictMembers !== true) continue;
            await withTimeout(
                client.invoke(new Api.channels.EditBanned({ channel: peer, participant: String(joinerTgUserId), bannedRights: banRights })),
                30_000,
                'EditBanned'
            );
            // unban — отдельная компенсация со своим ретраем: если он сорвался, joiner
            // остаётся в бане, и kick нельзя засчитывать
            let unbanned = false;
            try {
                await withTimeout(
                    client.invoke(new Api.channels.EditBanned({ channel: peer, participant: String(joinerTgUserId), bannedRights: unbanRights })),
                    30_000,
                    'EditBanned'
                );
                unbanned = true;
            } catch {
                try {
                    await withTimeout(
                        client.invoke(new Api.channels.EditBanned({ channel: peer, participant: String(joinerTgUserId), bannedRights: unbanRights })),
                        30_000,
                        'EditBanned'
                    );
                    unbanned = true;
                } catch {
                    unbanned = false;
                }
            }
            if (!unbanned) return { kicked: false, banned: true };
            return true;
        } catch {
            continue;
        } finally {
            await safeDisconnect(client);
        }
    }
    return false;
}
