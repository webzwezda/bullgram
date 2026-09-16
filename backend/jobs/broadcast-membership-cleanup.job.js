/**
 * Cron-задача: выход юзерботов из групп по окончании рассылки (membership cleanup).
 *
 * Факт «вступал ради кампании» фиксирует phaseJoin в broadcast_preparation_joins
 * (backend/services/broadcast-preparation.service.js → recordPreparationJoin).
 * Эта джоба берёт кампании в терминальном успехе (sent / completed_with_errors) с
 * meta.leave_groups_on_complete === true, meta.preparation_id и живыми pending-строками
 * (removed_at is null — так окно кандидатов не забивают кампании без работы), и по ним делает:
 *   - протекция: свои чаты владельца (channels, tg_chat_id в MARKED-форме) и 4 слота контуров
 *     (sales_bot_contours) → skipped_protected, без походов в Telegram;
 *   - юзербот missing / pending_activation / restricted → skipped_restricted (не дёргаем);
 *   - самовыход: channels.LeaveChannel, для basic-групп messages.DeleteChatUser (InputUserSelf);
 *     USER_NOT_PARTICIPANT = уже вышел — тоже успех;
 *   - самовыход упал → kick-фолбэк через промоутера: официальный бот-админ с
 *     can_restrict_members (Bot API ban+unban), иначе юзербот-админ (EditBanned ban+unban);
 *     kick засчитан только после проверенного unban, иначе failed с пометкой про ручной разбан;
 *   - failed: remove_error с коротким текстом. Кампания с заполненной meta.cleanup
 *     (done+failed >= total, независимо от total) скипается — failed не ретраится, строка
 *     остаётся pending для честной статистики.
 *
 * После батча по кампании — один read-modify-write meta.cleanup = { total, done, failed }
 * (пересчёт из строк, не из локальных счётчиков). С кампанией delivery-джоба делим только
 * meta — пишем узко, по id+owner, последний писавший побеждает.
 *
 * Пейсинг: sleep ~4s ± 20% jitter между реальными Telegram-операциями (не между skip'ами),
 * ≤20 строк за тик. restricted/pending_activation не трогаем никогда (manual-by-default,
 * safe-mode). Подробнее: docs/plans/2026-09-17-broadcast-membership-cleanup.md
 */
import { Api } from 'telegram';
import { UserbotService } from '../services/userbot.service.js';
import { toBotApiChatId } from '../services/chat-admin-rights.service.js';
import { withTimeout } from '../shared/utils.js';

const TICK_INTERVAL_MS = 60_000;
const MAX_ROWS_PER_TICK = 20;
const PACE_MS = 4000;
const CAMPAIGN_WINDOW = 50;

function defaultSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeDisconnect(client) {
    if (!client) return;
    try {
        await withTimeout(client.disconnect(), 5_000, 'client.disconnect');
    } catch (error) {
        console.error('[BroadcastCleanup] disconnect failed:', error?.message || error);
    }
}

function bareChatId(value) {
    return String(value ?? '').replace(/^-100/, '');
}

// «уже не участник» — не ошибка, а успешный исход: удалять нечего
function isAlreadyLeftError(error) {
    const raw = String(error?.errorMessage || error?.message || error || '');
    return /USER_NOT_PARTICIPANT|not\s+a\s+member/i.test(raw);
}

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

// Свежий клиент не знает peer по сырому id — резолвим, а при провале ищем в диалогах
// по bare id (прецедент: contour-admin-rights readUserbotAdminState / resolveChatEntity).
async function resolvePeer(client, chatId) {
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

async function leaveOwnChat(client, chatId) {
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
async function kickViaBotPromoter(supabase, ownerId, chatId, joinerTgUserId) {
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
async function kickViaUserbotPromoter(deps, ownerId, chatId, joinerTgUserId, excludeUserbotId) {
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

export function createBroadcastMembershipCleanup(supabase, deps = {}) {
    const userbotService = new UserbotService(
        supabase,
        process.env.TG_API_ID,
        process.env.TG_API_HASH
    );
    const d = {
        supabase,
        now: deps.now || (() => new Date()),
        sleep: deps.sleep || defaultSleep,
        random: deps.random || Math.random,
        userbotClientFactory: deps.userbotClientFactory || (account => userbotService.createAuthorizedClient(account)),
        kickViaPromoter: deps.kickViaPromoter || ((args) => kickViaPromoterDefault(args))
    };

    // true = kick завершён (ban + проверенный unban); { kicked: false, banned: true } =
    // после бана unban не прошёл — joiner мог остаться забаненным; false = промоутера нет
    async function kickViaPromoterDefault({ ownerId, chatId, joinerTgUserId, joinerUserbotId }) {
        if (!joinerTgUserId) return false;
        const viaBot = await kickViaBotPromoter(supabase, ownerId, chatId, joinerTgUserId);
        if (viaBot) return viaBot;
        return await kickViaUserbotPromoter(d, ownerId, chatId, joinerTgUserId, joinerUserbotId);
    }

    // Кандидаты: терминальный успех + явная галочка + preparation_id + реальные pending-строки.
    // Сначала берём preparation_id непокрытых join-строк и по ним сужаем выборку кампаний: так
    // окно CAMPAIGN_WINDOW не забивают кампании без работы и старые кампании не голодают.
    // Полностью обработанные (meta.cleanup done+failed >= total, независимо от total) не трогаем.
    async function selectCandidates() {
        const { data: pendingRows, error: pendingError } = await supabase
            .from('broadcast_preparation_joins')
            .select('preparation_id')
            .isNull('removed_at');
        if (pendingError) {
            console.error('[BroadcastCleanup] Ошибка выборки pending join-строк:', pendingError.message);
            return [];
        }
        const pendingPrepIds = [...new Set((pendingRows || []).map(row => String(row.preparation_id)))];
        if (pendingPrepIds.length === 0) return [];

        const { data: campaigns, error } = await supabase
            .from('broadcast_campaigns')
            .select('id, owner_id, meta, created_at')
            .in('status', ['sent', 'completed_with_errors'])
            .in('meta->>preparation_id', pendingPrepIds)
            .order('created_at', { ascending: false })
            .limit(CAMPAIGN_WINDOW);
        if (error) {
            console.error('[BroadcastCleanup] Ошибка выборки кампаний:', error.message);
            return [];
        }
        return (campaigns || []).filter(campaign => {
            const meta = campaign.meta || {};
            if (meta.leave_groups_on_complete !== true || !meta.preparation_id) return false;
            const cleanup = meta.cleanup;
            if (cleanup && Number(cleanup.done || 0) + Number(cleanup.failed || 0) >= Number(cleanup.total ?? 0)) return false;
            return true;
        });
    }

    // Никогда не выходим: свои чаты владельца и 4 слота контуров (слоты ссылаются
    // на channels.id — резолвим tg_chat_id через channels).
    async function loadProtectedChatIds(ownerId) {
        const protectedIds = new Set();
        const { data: channels } = await supabase
            .from('channels')
            .select('id, tg_chat_id')
            .eq('owner_id', ownerId);
        const channelByUuid = new Map();
        for (const channel of channels || []) {
            channelByUuid.set(String(channel.id), channel);
            if (channel.tg_chat_id != null && channel.tg_chat_id !== '') {
                protectedIds.add(String(channel.tg_chat_id));
            }
        }
        const { data: contours } = await supabase
            .from('sales_bot_contours')
            .select('public_channel_id, paid_channel_id, public_chat_id, paid_chat_id')
            .eq('owner_id', ownerId);
        for (const contour of contours || []) {
            for (const slot of [contour.public_channel_id, contour.paid_channel_id, contour.public_chat_id, contour.paid_chat_id]) {
                if (!slot) continue;
                const channel = channelByUuid.get(String(slot));
                if (channel?.tg_chat_id != null && channel.tg_chat_id !== '') {
                    protectedIds.add(String(channel.tg_chat_id));
                }
            }
        }
        return protectedIds;
    }

    // Conditional update: removed_at is null — повторный тик не затрёт уже обработанную строку.
    async function markRow(row, patch) {
        const { error } = await supabase
            .from('broadcast_preparation_joins')
            .update(patch)
            .eq('id', row.id)
            .eq('owner_id', row.owner_id)
            .isNull('removed_at');
        if (error) {
            console.error(`[BroadcastCleanup] Не обновили строку ${row.id}:`, error.message);
        }
    }

    // meta.cleanup пересчитываем из строк: total = все join'ы подготовки,
    // done = обработанные (не failed), failed = неудачи (остаются на следующий тик).
    async function refreshCampaignCleanupMeta(campaign) {
        try {
            const { data: rows } = await supabase
                .from('broadcast_preparation_joins')
                .select('remove_status, removed_at')
                .eq('preparation_id', campaign.meta.preparation_id)
                .eq('owner_id', campaign.owner_id);
            const total = (rows || []).length;
            // Пустая подготовка: cleanup-мету не пишем вовсе — вечный {total:0} в meta никому не нужен
            if (total === 0) return;
            const done = (rows || []).filter(r => r.removed_at && r.remove_status !== 'failed').length;
            const failed = (rows || []).filter(r => r.remove_status === 'failed').length;

            const { data: current } = await supabase
                .from('broadcast_campaigns')
                .select('meta')
                .eq('id', campaign.id)
                .eq('owner_id', campaign.owner_id)
                .maybeSingle();
            if (!current) return;
            await supabase
                .from('broadcast_campaigns')
                .update({ meta: { ...(current.meta || {}), cleanup: { total, done, failed } } })
                .eq('id', campaign.id)
                .eq('owner_id', campaign.owner_id);
        } catch (error) {
            console.error(`[BroadcastCleanup] Не обновили meta.cleanup кампании ${campaign.id}:`, error?.message || error);
        }
    }

    // Возвращает true, если по строке была реальная Telegram-операция (для пейсинга).
    // Sleep ставим прямо перед операцией: между skip'ами (протекция/restricted) пауз нет.
    async function processJoinRow(row, protectedIds, pacingState) {
        const chatId = String(row.tg_chat_id || '');

        if (protectedIds.has(chatId)) {
            await markRow(row, { remove_status: 'skipped_protected', removed_at: d.now().toISOString(), remove_error: null });
            return false;
        }

        const { data: account } = await supabase
            .from('tg_accounts')
            .select('*, proxies(is_working)')
            .eq('owner_id', row.owner_id)
            .eq('id', String(row.userbot_id))
            .maybeSingle();
        if (!account || ['pending_activation', 'restricted'].includes(String(account.runtime_status || ''))) {
            await markRow(row, { remove_status: 'skipped_restricted', removed_at: d.now().toISOString(), remove_error: null });
            return false;
        }

        if (pacingState.sawTelegramOp) {
            await d.sleep(Math.round(PACE_MS * (0.8 + d.random() * 0.4)));
        }
        pacingState.sawTelegramOp = true;

        let joinerTgUserId = account.tg_account_id ? String(account.tg_account_id) : null;
        let client = null;
        try {
            client = await d.userbotClientFactory(account);
            if (!joinerTgUserId || joinerTgUserId === 'null') {
                joinerTgUserId = String((await client.getMe()).id);
            }
            await leaveOwnChat(client, chatId);
            await markRow(row, { remove_status: 'left', removed_at: d.now().toISOString(), remove_error: null });
        } catch (leaveError) {
            if (isAlreadyLeftError(leaveError)) {
                await markRow(row, { remove_status: 'left', removed_at: d.now().toISOString(), remove_error: 'уже не участник' });
            } else {
                const reason = String(leaveError?.message || leaveError).slice(0, 200);
                console.warn(`[BroadcastCleanup] Самовыход ${chatId} через ${row.userbot_id} не удался: ${reason}`);
                let kickResult = false;
                try {
                    kickResult = await d.kickViaPromoter({
                        ownerId: row.owner_id,
                        chatId,
                        joinerTgUserId,
                        joinerUserbotId: row.userbot_id
                    });
                } catch (kickError) {
                    console.warn(`[BroadcastCleanup] Kick-фолбэк ${chatId} упал:`, kickError?.message || kickError);
                }
                const kicked = kickResult === true || kickResult?.kicked === true;
                const banMayPersist = kickResult?.banned === true;
                if (kicked) {
                    await markRow(row, { remove_status: 'kicked', removed_at: d.now().toISOString(), remove_error: null });
                } else if (banMayPersist) {
                    await markRow(row, {
                        remove_status: 'failed',
                        removed_at: null,
                        remove_error: 'Кик сорвался после бана — юзербот мог остаться забаненным, разбанить вручную'
                    });
                } else {
                    await markRow(row, {
                        remove_status: 'failed',
                        removed_at: null,
                        remove_error: 'Не смог выйти сам — kick через промоутера не удался'
                    });
                }
            }
        } finally {
            await safeDisconnect(client);
        }
        return true;
    }

    async function runCleanupTick() {
        const candidates = await selectCandidates();
        let budget = MAX_ROWS_PER_TICK;

        for (const campaign of candidates) {
            if (budget <= 0) break;
            const { data: rows, error } = await supabase
                .from('broadcast_preparation_joins')
                .select('*')
                .eq('preparation_id', campaign.meta.preparation_id)
                .eq('owner_id', campaign.owner_id)
                .isNull('removed_at')
                .order('joined_at', { ascending: true })
                .limit(budget);
            if (error) {
                console.error(`[BroadcastCleanup] Ошибка выборки join-строк кампании ${campaign.id}:`, error.message);
                continue;
            }
            if (!rows || rows.length === 0) {
                // pending-строк нет: финальный пересчёт, чтобы meta.cleanup закрыл кампанию
                await refreshCampaignCleanupMeta(campaign);
                continue;
            }

            const protectedIds = await loadProtectedChatIds(campaign.owner_id);
            const pacingState = { sawTelegramOp: false };
            for (const row of rows) {
                await processJoinRow(row, protectedIds, pacingState);
                budget -= 1;
                if (budget <= 0) break;
            }
            await refreshCampaignCleanupMeta(campaign);
        }
    }

    return { runCleanupTick };
}

export const startBroadcastMembershipCleanupJob = (supabase, deps = {}) => {
    const { runCleanupTick } = createBroadcastMembershipCleanup(supabase, deps);
    let running = false;

    const runOnce = async () => {
        if (running) return;
        running = true;
        try {
            await runCleanupTick();
        } catch (error) {
            console.error('[BroadcastCleanup] Ошибка тика:', error?.message || error);
        } finally {
            running = false;
        }
    };

    console.log('[BroadcastCleanup] started', {
        interval_ms: TICK_INTERVAL_MS,
        max_rows_per_tick: MAX_ROWS_PER_TICK,
        pace_ms: PACE_MS
    });
    setInterval(runOnce, TICK_INTERVAL_MS);
};
