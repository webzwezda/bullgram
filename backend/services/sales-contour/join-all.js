// join-all движок sales-contour (leaf: только normalize.js, leaf contour-admin-rights и внешние файлы).
// Разрезка sales-contour.service.js; методы класса делегируются сюда
// (service-инстанс первым аргументом вместо this). classifyTelegramError берётся
// из leaf shared.js contour-admin-rights — прямого импорта главного сервиса нет,
// новых циклов не создаётся (фасадный цикл главных файлов сохранён как был).

import { Api } from 'teleproto';
import { classifyTelegramError } from '../contour-admin-rights/shared.js';
import {
    ADMIN_MEMBER_STATUSES,
    SalesContourError,
    buildTelegramMemberRights,
    normalizeUuid
} from './normalize.js';

const LEFT_STATUSES = new Set(['left', 'kicked']);
// Права юзербота при promote через join-all. can_promote_members намеренно false (safety):
// юзербот не должен раздавать админок. Полный максимум — CONTOUR_USERBOT_MAX_RIGHTS
// в contour-admin-rights.service.js.
const CONTOUR_USERBOT_PROMOTE_RIGHTS = Object.freeze({
    can_invite_users: true,
    can_promote_members: false,
    can_change_info: false,
    can_delete_messages: false,
    can_restrict_members: true,
    can_pin_messages: false,
    can_manage_topics: false,
    can_manage_video_chats: false,
    can_post_messages: false,
    can_edit_messages: false
});

const JOIN_DELAY_MIN = 3000;
const JOIN_DELAY_MAX = 5000;
const BATCH_PAUSE_AFTER = 2;
const BATCH_PAUSE_MIN = 8000;
const BATCH_PAUSE_MAX = 10000;
const JOIN_ALL_STALE_MS = 10 * 60 * 1000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractInviteHash(inviteLink) {
    if (!inviteLink) return null;
    const match = inviteLink.match(/[+](\w[\w-]+)/) || inviteLink.match(/joinchat\/([\w-]+)/);
    return match ? match[1] : null;
}

export async function startJoinAll(service, ownerId, input = {}, botApi, userbotService) {
    const botId = normalizeUuid(input.bot_id ?? input.account_id, 'bot_id', { required: true });

    await service.assertOwnedSalesBot(ownerId, botId);

    const [channels, contour] = await Promise.all([
        service.loadOwnedChannels(ownerId),
        service.loadContourForBot(ownerId, botId)
    ]);

    if (!contour) {
        throw new SalesContourError('Сначала сохрани контур продаж для этого бота.', 409, 'sales_contour_missing');
    }

    if (!service._buildContourTargets(channels, contour).length) {
        throw new SalesContourError('В контуре нет привязанных площадок.', 409, 'no_targets');
    }

    const staleBefore = new Date(Date.now() - JOIN_ALL_STALE_MS).toISOString();
    const startedAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await service.supabase
        .from('sales_bot_contours')
        .update({
            join_all_status: 'running',
            join_all_result: null,
            join_all_started_at: startedAt
        })
        .eq('bot_id', botId)
        .eq('owner_id', ownerId)
        .or(`join_all_status.neq.running,join_all_started_at.lt.${staleBefore}`)
        .select('bot_id')
        .maybeSingle();

    service.throwIfDbError(claimError);

    if (!claimed) {
        throw new SalesContourError('Вступление уже выполняется, подожди пару минут.', 409, 'join_all_already_running');
    }

    service._runJoinAllInBackground(ownerId, botId, startedAt, botApi, userbotService)
        .catch((e) => console.error('[join-all] background crashed:', e));
}

export async function _runJoinAllInBackground(service, ownerId, botId, startedAt, botApi, userbotService) {
    // Guard по started_at: зависший прогон не перезапишет статус чужого,
    // более нового запуска, даже если дожил до своего терминального апдейта.
    try {
        const data = await service.joinUserbotToAllTargets(ownerId, { bot_id: botId }, botApi, userbotService);

        const { error } = await service.supabase
            .from('sales_bot_contours')
            .update({
                join_all_status: 'done',
                join_all_result: data,
                updated_at: new Date().toISOString()
            })
            .eq('bot_id', botId)
            .eq('owner_id', ownerId)
            .eq('join_all_started_at', startedAt);
        service.throwIfDbError(error);
    } catch (error) {
        console.error('[join-all] background failed:', error);
        const { error: updateError } = await service.supabase
            .from('sales_bot_contours')
            .update({
                join_all_status: 'error',
                join_all_result: {
                    message: error.message || 'Не получилось вступить в площадки контура.',
                    code: error.code || null
                },
                updated_at: new Date().toISOString()
            })
            .eq('bot_id', botId)
            .eq('owner_id', ownerId)
            .eq('join_all_started_at', startedAt);
        if (updateError) {
            console.error('[join-all] failed to save error status:', updateError);
        }
    }
}

export async function getJoinAllStatus(service, ownerId, input = {}) {
    const botId = normalizeUuid(input.bot_id ?? input.account_id, 'bot_id', { required: true });
    await service.assertOwnedSalesBot(ownerId, botId);

    const { data: row, error } = await service.supabase
        .from('sales_bot_contours')
        .select('join_all_status, join_all_result, join_all_started_at')
        .eq('bot_id', botId)
        .eq('owner_id', ownerId)
        .maybeSingle();

    service.throwIfDbError(error);

    if (!row) {
        return { success: true, status: 'idle', result: null };
    }

    const status = row.join_all_status || 'idle';
    const startedAt = row.join_all_started_at ? new Date(row.join_all_started_at) : null;
    const isStale = status === 'running' && (!startedAt || Date.now() - startedAt.getTime() > JOIN_ALL_STALE_MS);

    if (!isStale) {
        return { success: true, status, result: row.join_all_result ?? null };
    }

    // Процесс прерван (рестарт pm2) — помечаем один раз через условный update.
    const staleResult = { message: 'Процесс был прерван перезапуском сервера. Запусти вступление заново.' };
    const { data: flipped, error: updateError } = await service.supabase
        .from('sales_bot_contours')
        .update({
            join_all_status: 'error',
            join_all_result: staleResult,
            updated_at: new Date().toISOString()
        })
        .eq('bot_id', botId)
        .eq('owner_id', ownerId)
        .eq('join_all_status', 'running')
        .lt('join_all_started_at', new Date(Date.now() - JOIN_ALL_STALE_MS).toISOString())
        .select('join_all_status, join_all_result')
        .maybeSingle();

    service.throwIfDbError(updateError);

    // Update мог не сматчиться (прогон успел завершиться между select и update) —
    // тогда отдаём фактическое состояние строки, а не гарантированный error.
    if (!flipped) {
        const { data: fresh, error: freshError } = await service.supabase
            .from('sales_bot_contours')
            .select('join_all_status, join_all_result')
            .eq('bot_id', botId)
            .eq('owner_id', ownerId)
            .maybeSingle();
        service.throwIfDbError(freshError);
        return { success: true, status: fresh?.join_all_status || 'idle', result: fresh?.join_all_result ?? null };
    }

    return { success: true, status: flipped.join_all_status, result: flipped.join_all_result ?? null };
}

export async function joinUserbotToAllTargets(service, ownerId, input = {}, botApi, userbotService) {
    const botId = normalizeUuid(input.bot_id ?? input.account_id, 'bot_id', { required: true });
    const [bot, channels, contour] = await Promise.all([
        service.assertOwnedSalesBot(ownerId, botId),
        service.loadOwnedChannels(ownerId),
        service.loadContourForBot(ownerId, botId)
    ]);

    if (!contour) {
        throw new SalesContourError('Сначала сохрани контур продаж для этого бота.', 409, 'sales_contour_missing');
    }

    const targets = service._buildContourTargets(channels, contour);

    if (!targets.length) {
        throw new SalesContourError('В контуре нет привязанных площадок.', 409, 'no_targets');
    }

    const userbot = await service.loadFirstContourUserbot(ownerId, contour, userbotService);
    const userbotAccount = await service.loadFullUserbotAccount(ownerId, userbot.id);
    if (!userbotAccount?.session_data) {
        throw new SalesContourError('У юзербота нет данных сессии.', 409, 'userbot_session_missing');
    }

    let client;
    try {
        client = await userbotService.createAuthorizedClient(userbotAccount, 1);
    } catch (error) {
        throw new SalesContourError(
            `Не получилось подключить юзербота: ${error.message}`,
            502,
            'userbot_client_failed'
        );
    }

    const results = [];
    try {
        for (let i = 0; i < targets.length; i++) {
            const { key, channel, label } = targets[i];

            if (i > 0) {
                const delay = JOIN_DELAY_MIN + Math.random() * (JOIN_DELAY_MAX - JOIN_DELAY_MIN);
                await sleep(delay);
            }
            if (i > 0 && i % BATCH_PAUSE_AFTER === 0) {
                const pause = BATCH_PAUSE_MIN + Math.random() * (BATCH_PAUSE_MAX - BATCH_PAUSE_MIN);
                await sleep(pause);
            }

            try {
                const result = await service.joinSingleTarget(botApi, client, channel, userbot, key, label);
                results.push(result);
            } catch (error) {
                console.error(`[joinAll] ${label}: FAILED — ${error.message}`, error);
                results.push({
                    target: key,
                    channel_id: channel.id,
                    channel_title: channel.title,
                    status: 'error',
                    message: error.message || `Не получилось вступить в ${label}`
                });
            }
        }
    } finally {
        await client.disconnect().catch(() => null);
    }

    const joined = results.filter((r) => r.status === 'joined' || r.status === 'already_admin').length;
    return {
        results,
        summary: `${joined} из ${targets.length} площадок — юзербот подключен.`
    };
}

export async function _isChatMember(service, botApi, tgChatId, tgUserId) {
    try {
        const member = await botApi.getChatMember(tgChatId, tgUserId);
        const status = String(member?.status || '').toLowerCase();
        return !LEFT_STATUSES.has(status);
    } catch {
        return false;
    }
}

export async function _waitForMembership(service, botApi, tgChatId, tgUserId, { attempts = 3, interval = 2000 } = {}) {
    for (let i = 0; i < attempts; i++) {
        if (await service._isChatMember(botApi, tgChatId, tgUserId)) return true;
        if (i < attempts - 1) await sleep(interval);
    }
    return false;
}

export async function _joinViaInvite(service, botApi, userbotClient, tgChatId) {
    const sources = [
        () => botApi.exportChatInviteLink(tgChatId).then((l) => ({ hash: extractInviteHash(l), revoke: null })),
        () => botApi.createChatInviteLink(tgChatId, {}).then((r) => ({ hash: extractInviteHash(r.invite_link), revoke: r.invite_link }))
    ];

    for (const getInvite of sources) {
        let hash, revoke;
        try {
            ({ hash, revoke } = await getInvite());
        } catch {
            continue;
        }
        if (!hash) continue;

        try {
            await userbotClient.invoke(new Api.messages.ImportChatInvite({ hash }));
            return true;
        } catch {
        } finally {
            if (revoke) {
                await botApi.revokeChatInviteLink(tgChatId, revoke).catch(() => {});
            }
        }
    }
    return false;
}

export async function joinSingleTarget(service, botApi, userbotClient, channel, userbot, targetKey, label) {
    const tgChatId = channel.tg_chat_id;
    const userbotTgId = Number(userbot.tg_account_id);

    const wasMember = await service._isChatMember(botApi, tgChatId, userbotTgId);

    if (!wasMember) {
        const username = String(channel.username || '').trim().replace(/^@/, '');
        if (username) {
            const entity = await userbotClient.getEntity(username);
            await userbotClient.invoke(new Api.channels.JoinChannel({ channel: entity }));
        } else {
            const joined = await service._joinViaInvite(botApi, userbotClient, tgChatId);
            if (!joined) {
                throw new SalesContourError(
                    `Не удалось вступить в ${label} ни одним из способов.`,
                    502,
                    'invite_join_failed'
                );
            }
            await sleep(2000);
        }
    }

    const isNowMember = await service._waitForMembership(botApi, tgChatId, userbotTgId);
    if (!isNowMember) {
        return {
            target: targetKey,
            channel_id: channel.id,
            channel_title: channel.title,
            status: 'error',
            message: `${label}: не удалось добавить юзербота в площадку.`
        };
    }

    const isAdmin = ADMIN_MEMBER_STATUSES.has(
        String((await botApi.getChatMember(tgChatId, userbotTgId).catch(() => null))?.status || '').toLowerCase()
    );

    // Промоут с классификацией ошибок: упал, но юзербот уже админ (назначен владельцем) —
    // это not-error, фиксируем предупреждение. Классификатор общий с ensure-admin.
    let promoteWarnings = [];
    if (!isAdmin) {
        try {
            await botApi.promoteChatMember(tgChatId, userbotTgId, CONTOUR_USERBOT_PROMOTE_RIGHTS);
        } catch (promoteError) {
            const reRead = await botApi.getChatMember(tgChatId, userbotTgId).catch(() => null);
            const reStatus = String(reRead?.status || '').toLowerCase();
            if (ADMIN_MEMBER_STATUSES.has(reStatus)) {
                const classified = classifyTelegramError(promoteError, reStatus);
                promoteWarnings = classified === 'owner_appointed'
                    ? ['назначен владельцем — бот не может менять его права']
                    : [`юзербот уже админ (ошибка promote: ${classified})`];
            } else {
                const classified = classifyTelegramError(promoteError, 'member');
                return {
                    target: targetKey,
                    channel_id: channel.id,
                    channel_title: channel.title,
                    status: 'error',
                    message: `${label}: юзербот вступил, но получить админ-права не получилось (${classified}).`
                };
            }
        }
    }

    // Перечитываем фактические права и включаем их в результат.
    const finalRights = buildTelegramMemberRights(
        await botApi.getChatMember(tgChatId, userbotTgId).catch(() => null)
    );
    const finalIsAdmin = !!finalRights?.is_admin;

    if (!finalIsAdmin && !promoteWarnings.length) {
        return {
            target: targetKey,
            channel_id: channel.id,
            channel_title: channel.title,
            status: 'error',
            rights: finalRights,
            message: `${label}: юзербот вступил, но после выдачи прав админ-статус не подтвердился.`
        };
    }

    return {
        target: targetKey,
        channel_id: channel.id,
        channel_title: channel.title,
        status: (wasMember && isAdmin) || promoteWarnings.length ? 'already_admin' : 'joined',
        rights: finalRights,
        warnings: promoteWarnings,
        message: `${label}: юзербот ${wasMember ? 'уже был в площадке' : 'вступил'}, ${isAdmin ? 'уже админ' : 'получил права админа'}.${promoteWarnings.length ? ` ${promoteWarnings.join(' ')}.` : ''}`
    };
}
