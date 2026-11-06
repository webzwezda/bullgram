// Recompute-фаза и публичные операции подготовки (status/listMembers/recheck/
// cancel/addJoinTargets), плюс join-support хелперы phaseJoin: countRecentJoins,
// buildJoinTargets, tryGrantAdminRights, scanChatParticipants,
// applyConfirmedTouchpoints. Выделено из broadcast-preparation.service.js при
// разрезке под pre-commit лимит: методы класса стали однострочными делегатами,
// инстанс сервиса передаётся первым аргументом (service).
import { Api } from 'telegram';
import { ChatAdminRightsService } from '../chat-admin-rights.service.js';
import { upsertPeerCacheBatch } from '../../utils/peer-cache.js';
import { withTimeout } from '../../shared/utils.js';
import {
    PreparationError,
    ACTIVE_STATUSES,
    normalizeExternalTargets,
    envFlag,
    touchpoint,
    chunk,
    scanChatIdsCache
} from './phase-scan.js';

function isAutoAdminEnabled() {
    return envFlag('USERBOT_AUTO_ADMIN_ENABLED');
}

export async function countRecentJoins(service, userbotId) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await service.supabase
        .from('userbot_join_log')
        .select('id', { count: 'exact', head: true })
        .eq('userbot_id', String(userbotId))
        .gte('created_at', since);
    if (error) return Infinity;
    return count || 0;
}

export async function buildJoinTargets(service, preparation) {
    const targets = [];

    for (const external of preparation.external_targets || []) {
        if (external.status !== 'pending') continue;
        targets.push({ raw: external.raw, scope: 'external', index: (preparation.external_targets || []).indexOf(external) });
    }

    if (preparation.audience_type === 'channel_audience_members' && preparation.base_id) {
        const { data: links } = await service.supabase
            .from('channel_audience_channels')
            .select('channel_id, channels(id, title, tg_chat_id, username)')
            .eq('base_id', preparation.base_id);
        for (const link of links || []) {
            const channel = link.channels;
            if (!channel) continue;
            if (!channel.username) {
                await service.updatePhaseDetail(preparation.id, {
                    errors: [`«${channel.title}» — приватный канал без ссылки-инвайта, юзерботу не вступить. Добавь группу вручную по ссылке.`]
                });
                continue;
            }
            targets.push({
                raw: `https://t.me/${channel.username}`,
                scope: 'owner',
                chat_id: channel.tg_chat_id ? String(channel.tg_chat_id) : null,
                title: channel.title
            });
        }
    } else if (preparation.audience_type === 'client_base_members' || preparation.audience_type === 'manual_list') {
        // вступаем в каналы-источники получателей: где человек замечен в аудиториях, там и ищем общий чат
        const sourceMap = await service.loadMemberSourceChannels(preparation.owner_id, preparation);
        const neededIds = new Set();
        for (const list of sourceMap.values()) {
            for (const id of list || []) neededIds.add(String(id));
        }
        if (neededIds.size > 0) {
            const { data: channels } = await service.supabase
                .from('channels')
                .select('id, title, tg_chat_id, username')
                .eq('owner_id', preparation.owner_id)
                .in('id', [...neededIds]);
            for (const channel of channels || []) {
                if (!channel.username) {
                    await service.updatePhaseDetail(preparation.id, {
                        errors: [`«${channel.title}» — приватный канал без ссылки-инвайта, юзерботу не вступить. Добавь группу вручную по ссылке.`]
                    });
                    continue;
                }
                targets.push({
                    raw: `https://t.me/${channel.username}`,
                    scope: 'owner',
                    chat_id: channel.tg_chat_id ? String(channel.tg_chat_id) : null,
                    title: channel.title
                });
            }
        }
    }

    return targets;
}

// CHAT_ADMIN_REQUIRED: пытаемся выдать юзерботу админ-права — сначала через официального бота, потом через юзербота-админа из пула
export async function tryGrantAdminRights(service, preparation, pool, userbot, chatId, rawLink) {
    if (!isAutoAdminEnabled()) return false;
    try {
        const rights = new ChatAdminRightsService(service.supabase);

        let tgUserId = String(userbot.tg_account_id || '').trim();
        if (!tgUserId || tgUserId === 'null') {
            const client = await service.userbotService.createAuthorizedClient(userbot);
            try {
                tgUserId = String((await client.getMe()).id);
            } finally {
                await client.disconnect();
            }
        }

        const bot = await rights.findPromoterBot(preparation.owner_id, chatId);
        if (bot) {
            const promoted = await rights.grantAdminViaBot(bot.bot, chatId, tgUserId);
            if (promoted.ok) {
                await service.updatePhaseDetail(preparation.id, {
                    note: `${rawLink}: админ-права выданы ботом @${bot.bot.tg_username || 'official'} — сканируем участников.`
                });
                return true;
            }
            await service.updatePhaseDetail(preparation.id, {
                admin_hints: [`${rawLink}: бот @${bot.bot.tg_username || 'official'} не смог выдать права (${promoted.description}) — пробуем юзербота-админа.`]
            });
        }

        const candidates = (pool || []).filter(candidate => String(candidate.id) !== String(userbot.id));
        const viaUserbot = await rights.findPromoterUserbot(service.userbotService, candidates, rawLink, chatId, tgUserId);
        if (viaUserbot) {
            await service.updatePhaseDetail(preparation.id, {
                note: `${rawLink}: админ-права выданы юзерботом @${viaUserbot.userbot.tg_username || viaUserbot.userbot.id} — сканируем участников.`
            });
            return true;
        }

        await service.updatePhaseDetail(preparation.id, {
            admin_hints: [`${rawLink}: выдать админ-права некому — ни официальный бот, ни юзерботы пула не админы этого чата. Выдай права руками и нажми «Проверить снова».`]
        });
        return false;
    } catch (error) {
        console.error(`[broadcast-preparation] auto-admin ${rawLink} failed:`, error?.message || error);
        return false;
    }
}

export async function scanChatParticipants(service, userbot, chatId, accessHash = null) {
    const client = await service.userbotService.createAuthorizedClient(userbot);
    try {
        // сырой положительный id канала свежий клиент не разрезолвит (PeerUser) — ходим через access_hash из вступления
        const entity = accessHash
            ? new Api.InputPeerChannel({
                channelId: String(chatId).replace(/^-100/, ''),
                accessHash: String(accessHash)
            })
            : chatId;
        const participants = await withTimeout(client.getParticipants(entity, { limit: 5000 }), 120_000, 'Скан участников группы');
        await upsertPeerCacheBatch(service.supabase, (participants || [])
            .filter(participant => participant?.accessHash != null)
            .map(participant => ({
                owner_id: userbot.owner_id,
                userbot_id: userbot.id,
                tg_user_id: String(participant.id),
                access_hash: participant.accessHash.toString(),
                username: participant.username || null,
                source: 'get_participants'
            })));
        return new Set((participants || []).map(participant => String(participant.id)));
    } finally {
        await client.disconnect();
    }
}

export async function applyConfirmedTouchpoints(service, preparationId, userbotId, confirmedUserIds, via, chatId) {
    if (!confirmedUserIds || confirmedUserIds.size === 0) return;
    const items = await service.loadItems(preparationId);
    const updates = [];
    for (const item of items) {
        if (!confirmedUserIds.has(item.tg_user_id)) continue;
        const existing = Array.isArray(item.reachable_by) ? item.reachable_by : [];
        const already = existing.some(tp => tp.userbot_id === userbotId && tp.confirmed);
        if (already) continue;
        updates.push({
            preparation_id: preparationId,
            tg_user_id: item.tg_user_id,
            reachable_by: [...existing.filter(tp => !(tp.userbot_id === userbotId && !tp.confirmed)), touchpoint(via, userbotId, { chatId })],
            status: 'reachable'
        });
    }
    for (const part of chunk(updates, 500)) {
        await service.supabase
            .from('broadcast_preparation_items')
            .upsert(part, { onConflict: 'preparation_id,tg_user_id' });
    }
}

export async function phaseRecompute(service, preparation) {
    const items = await service.loadItems(preparation.id);
    const perUserbot = new Map();

    let confirmed = 0;
    let probable = 0;
    let unreachable = 0;

    for (const item of items) {
        const touchpoints = Array.isArray(item.reachable_by) ? item.reachable_by : [];
        const isReachable = touchpoints.length > 0;
        const isConfirmed = touchpoints.some(tp => tp.confirmed);

        if (isConfirmed) confirmed += 1;
        else if (isReachable) probable += 1;
        else unreachable += 1;

        for (const tp of touchpoints) {
            const key = String(tp.userbot_id);
            perUserbot.set(key, (perUserbot.get(key) || 0) + 1);
        }
    }

    const total = items.length;
    const coverage = total > 0 ? Math.round(((confirmed + probable) / total) * 100) : 0;

    // подсказки про админ-права всплывают только в финале и только когда есть кому помогло бы
    const { data: row } = await service.supabase
        .from('broadcast_preparations')
        .select('phase_detail')
        .eq('id', preparation.id)
        .single();
    const current = row?.phase_detail || {};
    const adminHints = Array.isArray(current.admin_hints) ? [...new Set(current.admin_hints)] : [];
    // при полном покрытии подсказки про админ-права неактуальны — вычищаем в том числе старые из errors
    const withoutHints = (current.errors || []).filter(message => !adminHints.includes(message));
    const mergedErrors = [...new Set([...withoutHints, ...(unreachable > 0 ? adminHints : [])])].slice(-30);

    await service.supabase
        .from('broadcast_preparations')
        .update({
            status: 'ready',
            stats: {
                total,
                confirmed,
                probable,
                unreachable,
                coverage_pct: coverage,
                per_userbot: Object.fromEntries(perUserbot)
            },
            phase_detail: { ...current, errors: mergedErrors, admin_hints: [] },
            updated_at: new Date().toISOString()
        })
        .eq('id', preparation.id)
        .eq('status', 'recomputing');
}

export async function getStatus(service, ownerId, preparationId) {
    const preparation = await service.getPreparationRow(ownerId, preparationId);
    if (!preparation) throw new PreparationError(404, 'Подготовка не найдена');
    return preparation;
}

export async function listMembers(service, ownerId, preparationId, { filter, limit = 50, offset = 0 } = {}) {
    const preparation = await service.getPreparationRow(ownerId, preparationId);
    if (!preparation) throw new PreparationError(404, 'Подготовка не найдена');

    let query = service.supabase
        .from('broadcast_preparation_items')
        .select('tg_user_id, username, display_name, reachable_by, status, last_error', { count: 'exact' })
        .eq('preparation_id', preparationId)
        .order('status', { ascending: true })
        .range(offset, offset + limit - 1);
    if (filter === 'unreachable') query = query.eq('status', 'unreachable');
    if (filter === 'reachable') query = query.eq('status', 'reachable');

    const { data, count } = await query;
    return { members: data || [], total: count || 0 };
}

export async function addJoinTargets(service, ownerId, preparationId, rawTargets = []) {
    const preparation = await service.getPreparationRow(ownerId, preparationId);
    if (!preparation) throw new PreparationError(404, 'Подготовка не найдена');
    if (!['ready', 'failed'].includes(preparation.status)) {
        throw new PreparationError(400, 'Добавлять группы можно только к завершённой подготовке');
    }

    const fresh = normalizeExternalTargets(rawTargets);
    if (fresh.length === 0) throw new PreparationError(400, 'Список групп пуст');

    await service.supabase
        .from('broadcast_preparations')
        .update({
            external_targets: [...(preparation.external_targets || []), ...fresh],
            status: 'joining',
            updated_at: new Date().toISOString()
        })
        .eq('id', preparationId);

    service.kick(preparationId);
    return { status: 'joining', added: fresh.length };
}

export async function recheck(service, ownerId, preparationId) {
    const preparation = await service.getPreparationRow(ownerId, preparationId);
    if (!preparation) throw new PreparationError(404, 'Подготовка не найдена');
    if (!['ready', 'failed'].includes(preparation.status)) {
        throw new PreparationError(400, 'Перепроверка доступна только для завершённой подготовки');
    }

    await service.setStatus(preparationId, 'scanning');
    service.kick(preparationId);
    return { status: 'scanning' };
}

export async function cancel(service, ownerId, preparationId) {
    const preparation = await service.getPreparationRow(ownerId, preparationId);
    if (!preparation) throw new PreparationError(404, 'Подготовка не найдена');
    if (!ACTIVE_STATUSES.has(preparation.status)) {
        throw new PreparationError(400, 'Эта подготовка уже не активна');
    }
    await service.setStatus(preparationId, 'cancelled');
    scanChatIdsCache.delete(preparationId);
    return { status: 'cancelled' };
}
