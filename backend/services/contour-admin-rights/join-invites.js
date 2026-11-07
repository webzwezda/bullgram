// join/wait/peer-invite хелперы contour-admin-rights (leaf: только shared.js и внешние файлы).
// Разрезка contour-admin-rights.service.js; методы класса делегируются сюда
// (service-инстанс передаётся первым аргументом вместо this).

import { Api } from 'teleproto';
import { loadReservedUserbotIds } from '../../utils/shop-reservations.js';
import {
    LEFT_STATUSES,
    MEMBERSHIP_WAIT_ATTEMPTS,
    MEMBERSHIP_WAIT_INTERVAL_MS,
    PEER_INVITE_DELAY_MS,
    PEER_INVITE_MAX_CANDIDATES,
    buildErrorMessage,
    buildUserbotRightsFromParticipant,
    classifyTelegramError,
    extractInviteHash,
    normalizeUuidValue
} from './shared.js';

// Чтение админ-состояния юзербота в площадке (юзербот читает сам себя).
// ВАЖНО (проверено на telegram@2.26.22):
//   - client.getParticipant НЕ существует (только getParticipants);
//   - InputUserSelf не кастится в InputPeer ("Cannot cast InputUserSelf to any kind
//     of InputPeer") — рабочий вариант: resolved-пир + InputPeerSelf.
// Поэтому сначала резолвим entity: базисные группы (InputPeerChat) не поддерживают
// channels.GetParticipant — список участников читаем через messages.GetFullChat.
export async function readUserbotAdminState(client, tgChatId, userbotTgId) {
    const peer = await client.getInputEntity(tgChatId);

    if (peer instanceof Api.InputPeerChat) {
        // базисная группа: гранулярных админ-флагов нет — админ = все флаги
        const full = await client.invoke(new Api.messages.GetFullChat({ chatId: peer.chatId }));
        const participants = full?.fullChat?.participants?.participants
            || full?.participants?.participants
            || [];
        const self = participants.find((p) => String(p?.userId ?? '') === String(userbotTgId));
        if (!self) {
            return {
                status: 'left',
                is_admin: false,
                is_creator: false,
                can_invite_users: false,
                can_restrict_members: false,
                can_promote_members: false,
                can_manage_chat: false
            };
        }
        const isCreator = self.className === 'ChatParticipantCreator';
        const isAdmin = isCreator || self.className === 'ChatParticipantAdmin';
        return {
            status: isCreator ? 'creator' : isAdmin ? 'administrator' : 'member',
            is_admin: isCreator || isAdmin,
            is_creator: isCreator,
            can_invite_users: isAdmin || isCreator,
            can_restrict_members: isAdmin || isCreator,
            can_promote_members: isAdmin || isCreator,
            can_manage_chat: isAdmin || isCreator
        };
    }

    // канал/супергруппа
    const res = await client.invoke(new Api.channels.GetParticipant({
        channel: peer,
        participant: new Api.InputPeerSelf()
    }));
    return buildUserbotRightsFromParticipant(res);
}

// Членство через Bot API. «user not found / participant_id_invalid» = не состоит
// (обычный ответ для не-участника канала). flood → throw (cooldown). Остальные
// ошибки (бот не видит состав площадки) → throw: caller решает, это не «не состоит».
export async function isBotApiMember(botApi, tgChatId, tgUserId) {
    let member;
    try {
        member = await botApi.getChatMember(tgChatId, String(tgUserId));
    } catch (error) {
        if (classifyTelegramError(error, 'member') === 'flood_wait') throw error;
        const message = buildErrorMessage(error);
        if (/user not found|user_not_participant|participant_id_invalid|member not found/i.test(message)) {
            return false;
        }
        throw error;
    }
    return !LEFT_STATUSES.has(String(member?.status || '').toLowerCase());
}

export async function waitForBotApiMembership(service, botApi, tgChatId, tgUserId, {
    attempts = MEMBERSHIP_WAIT_ATTEMPTS,
    interval = MEMBERSHIP_WAIT_INTERVAL_MS
} = {}) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            if (await service.isBotApiMember(botApi, tgChatId, tgUserId)) return true;
        } catch (error) {
            if (classifyTelegramError(error, 'member') === 'flood_wait') throw error;
            // проверка не удалась — считаем «ещё не появился» и пробуем снова
        }
        if (attempt < attempts - 1) await service.deps.sleep(interval);
    }
    return false;
}

// Стратегия вступления из joinSingleTarget: публичный username → JoinChannel,
// приватная площадка → инвайт-ссылка через бота + ImportChatInvite,
// и третий способ — инвайт от юзербота-соседа, уже подтверждённого внутри площадки
// (выручает, когда official-бота в площадке нет и бот-инвайт невозможен).
export async function joinUserbotToChannel(service, botApi, client, channel, warnings, { ownerId, botId, target, excludeActorId } = {}) {
    const tgChatId = channel.tg_chat_id;
    const username = String(channel.username || '').trim().replace(/^@/, '');

    if (username) {
        try {
            const entity = await client.getEntity(username);
            await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
            return true;
        } catch (error) {
            const classified = classifyTelegramError(error, 'member');
            if (classified === 'flood_wait') throw error;
            if (classified === 'already_member') return true;
            warnings.push(`вступление по username не получилось (${buildErrorMessage(error)}) — пробуем инвайт-ссылку`);
        }
    }

    const inviteSources = [
        () => botApi.exportChatInviteLink(tgChatId).then((link) => ({
            hash: extractInviteHash(link),
            revoke: null
        })),
        () => botApi.createChatInviteLink(tgChatId, {}).then((created) => ({
            hash: extractInviteHash(created?.invite_link),
            revoke: created?.invite_link || null
        }))
    ];

    for (const getInvite of inviteSources) {
        let hash = null;
        let revoke = null;
        try {
            ({ hash, revoke } = await getInvite());
        } catch (error) {
            if (classifyTelegramError(error, 'member') === 'flood_wait') throw error;
            continue;
        }
        if (!hash) continue;

        try {
            await client.invoke(new Api.messages.ImportChatInvite({ hash }));
            return true;
        } catch (error) {
            const classified = classifyTelegramError(error, 'member');
            if (classified === 'flood_wait') throw error;
            if (classified === 'already_member') return true;
        } finally {
            if (revoke) {
                await botApi.revokeChatInviteLink(tgChatId, revoke).catch(() => {});
            }
        }
    }

    // 3. Инвайт от юзербота-соседа. Неудача соседа — только предупреждение,
    // наверх летит лишь flood_wait самого вступающего (как у бот-инвайта).
    return await service.tryJoinViaPeerUserbotInvite({
        ownerId,
        botId,
        target,
        channel,
        client,
        excludeActorId,
        warnings
    });
}

// Инвайт от юзербота-соседа, который уже сидит в площадке. Кандидаты — только
// подтверждённые ячейки прав этой же площадки (ok / owner_appointed), сам
// вступающий исключён: сам себя он пригласить не может.
// Метод не бросает исключений, кроме flood_wait вступающего на ImportChatInvite.
export async function tryJoinViaPeerUserbotInvite(service, { ownerId, botId, target, channel, client, excludeActorId, warnings }) {
    if (!ownerId || !botId || !target) return false;

    const candidates = await service.loadPeerInviteCandidates(ownerId, botId, target, excludeActorId);
    if (!candidates.length) return false;

    for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        const who = candidate.tg_username || candidate.id;
        if (index > 0) await service.deps.sleep(PEER_INVITE_DELAY_MS);

        let exporter = null;
        let peer = null;
        let link = null;
        try {
            exporter = await service.deps.userbotClientFactory(candidate);
            peer = await exporter.getInputEntity(channel.tg_chat_id);
            // telegram@2.26.x: channels.ExportInvite больше нет — messages.ExportChatInvite
            // принимает resolved-пир и канала/супергруппы, и базисной группы.
            const exported = await exporter.invoke(new Api.messages.ExportChatInvite({ peer }));
            link = exported?.link || null;
        } catch (error) {
            warnings.push(`юзербот ${who} не смог сделать инвайт (${buildErrorMessage(error)}) — пробуем дальше`);
            // ссылки нет — отзывать нечего, просто отпускаем клиента соседа
            if (exporter?.disconnect) await exporter.disconnect().catch(() => {});
            continue;
        }

        const hash = extractInviteHash(link);
        if (!hash) {
            warnings.push(`инвайт-ссылка от юзербота ${who} без хеша — пробуем дальше`);
            await service.revokePeerInvite(exporter, peer, link);
            continue;
        }

        try {
            await client.invoke(new Api.messages.ImportChatInvite({ hash }));
            return true;
        } catch (error) {
            const classified = classifyTelegramError(error, 'member');
            if (classified === 'flood_wait') throw error;
            if (classified === 'already_member') return true;
            warnings.push(`вступление по инвайту от юзербота ${who} не получилось (${buildErrorMessage(error)})`);
        } finally {
            await service.revokePeerInvite(exporter, peer, link);
        }
    }

    return false;
}

// Отзыв инвайта и отключение клиента соседа. Best-effort: прав на отзыв у соседа
// может не быть, провал отзыва не должен влиять на результат вступления.
export async function revokePeerInvite(exporter, peer, link) {
    if (!exporter) return;
    if (link && peer) {
        try {
            await exporter.invoke(new Api.messages.EditExportedChatInvite({ peer, link, revoked: true }));
        } catch {
            // нет прав на отзыв — ссылку отзовёт владелец площадки или она истечёт сама
        }
    }
    if (exporter.disconnect) {
        await exporter.disconnect().catch(() => {});
    }
}

// Соседи-приглашатели: actor_id из подтверждённых ячеек прав этой площадки →
// полные аккаунты tg_accounts с той же отбраковкой, что и акторы
// (shop-reserved / pending_activation / restricted — мимо).
export async function loadPeerInviteCandidates(service, ownerId, botId, target, excludeActorId) {
    let actorIds = [];
    try {
        const { data, error } = await service.supabase
            .from('sales_contour_actor_rights')
            .select('actor_id')
            .eq('owner_id', ownerId)
            .eq('bot_id', botId)
            .eq('target', target)
            .eq('actor_type', 'userbot')
            .in('state', ['ok', 'owner_appointed']);
        if (error) throw error;
        actorIds = [...new Set((data || [])
            .map((row) => normalizeUuidValue(row.actor_id))
            .filter((id) => id && id !== excludeActorId))];
    } catch (error) {
        console.error('[contour-admin-rights] failed to load peer-invite candidates:', error.message);
        return [];
    }

    if (!actorIds.length) return [];

    const [reservedUserbotIds, response] = await Promise.all([
        loadReservedUserbotIds(service.supabase, ownerId),
        service.supabase
            .from('tg_accounts')
            .select('id, owner_id, account_type, tg_account_id, tg_username, session_data, proxy_id, runtime_status, proxies(id, name, is_working, last_check_country, last_check_country_code)')
            .eq('owner_id', ownerId)
            .eq('account_type', 'userbot')
            .in('id', actorIds)
    ]);

    if (response.error) {
        console.error('[contour-admin-rights] failed to load peer-invite accounts:', response.error.message);
        return [];
    }

    return (response.data || [])
        .filter((userbot) => service.isUserbotEligible(userbot, reservedUserbotIds))
        .slice(0, PEER_INVITE_MAX_CANDIDATES);
}

export function floodWaitCell(base, error, subject = 'юзербота') {
    const retryAfter = Number.isFinite(error?.retry_after) ? error.retry_after : null;
    return {
        ...base,
        state: 'error',
        is_admin: false,
        flags: {},
        warnings: [],
        message: `${base.label}: Telegram просит паузу (flood wait${retryAfter != null ? ` ${retryAfter} c` : ''}). Обработка остальных площадок для этого ${subject} приостановлена.`,
        stop: true
    };
}
