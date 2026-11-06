// Лоадеры/валидаторы sales-contour (leaf: только normalize.js и внешние файлы).
// Разрезка sales-contour.service.js; методы класса делегируются сюда
// (service-инстанс первым аргументом вместо this).

import { loadReservedUserbotIds } from '../../utils/shop-reservations.js';
import {
    CONTOUR_TARGET_CONFIG,
    CONTOUR_TARGET_KEYS,
    SalesContourError,
    buildUserbotOption,
    mapContourRightsRow,
    normalizeBotKind,
    normalizeChatType,
    normalizeContourTarget,
    normalizeUuid
} from './normalize.js';

export async function loadOwnedOfficialBots(service, ownerId) {
    const { data, error } = await service.supabase
        .from('tg_accounts')
        .select('id, owner_id, account_type, tg_account_id, tg_username, bot_role, bot_kind, runtime_status, runtime_error, admin_tg_id, created_at')
        .eq('owner_id', ownerId)
        .eq('account_type', 'bot')
        .neq('bot_role', 'ops')
        .order('created_at', { ascending: false });

    service.throwIfDbError(error);
    return data || [];
}

export async function loadOwnedChannels(service, ownerId) {
    const { data, error } = await service.supabase
        .from('channels')
        .select('id, owner_id, bot_id, tg_chat_id, title, chat_type, username, visibility, last_visibility_check_at, created_at')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false });

    service.throwIfDbError(error);
    return data || [];
}

export async function loadOwnedUserbots(service, ownerId) {
    const [reservedUserbotIds, response] = await Promise.all([
        loadReservedUserbotIds(service.supabase, ownerId),
        service.supabase
            .from('tg_accounts')
            .select('id, owner_id, account_type, tg_account_id, tg_username, proxy_id, runtime_status, runtime_error, created_at, proxies(id, name, is_working, last_check_country, last_check_country_code)')
            .eq('owner_id', ownerId)
            .eq('account_type', 'userbot')
            .order('created_at', { ascending: false })
    ]);

    service.throwIfDbError(response.error);

    const userbots = response.data || [];
    const options = userbots.map((userbot) => buildUserbotOption(userbot, reservedUserbotIds));
    const optionById = new Map(options.map((item) => [String(item.id), item]));

    return {
        userbots,
        options,
        optionById,
        reservedUserbotIds
    };
}

export async function loadUserbotBindings(service, ownedBotIds) {
    const botIds = (ownedBotIds || []).map((id) => String(id)).filter(Boolean);
    if (!botIds.length) return [];

    const { data, error } = await service.supabase
        .from('official_bot_userbot_bindings')
        .select('bot_id, userbot_id, is_active, created_at')
        .in('bot_id', botIds);
    service.throwIfDbError(error);
    return data || [];
}

export async function toggleUserbotBinding(service, ownerId, botId, userbotId, isActive) {
    const normalizedBotId = normalizeUuid(botId, 'bot_id', { required: true });
    const normalizedUserbotId = normalizeUuid(userbotId, 'userbot_id', { required: true });

    await service.assertOwnedSalesBot(ownerId, normalizedBotId);

    const { data: userbot } = await service.supabase
        .from('tg_accounts')
        .select('id, owner_id, account_type')
        .eq('id', normalizedUserbotId)
        .eq('owner_id', ownerId)
        .eq('account_type', 'userbot')
        .maybeSingle();

    if (!userbot) {
        throw new SalesContourError('Юзербот не найден.', 404, 'userbot_not_found');
    }

    const { error } = await service.supabase
        .from('official_bot_userbot_bindings')
        .upsert({
            bot_id: normalizedBotId,
            userbot_id: normalizedUserbotId,
            is_active: !!isActive
        }, { onConflict: 'bot_id,userbot_id' });
    service.throwIfDbError(error);

    return { bot_id: normalizedBotId, userbot_id: normalizedUserbotId, is_active: isActive };
}

export async function syncUserbotBindings(service, ownerId, botId, activeUserbotIds) {
    const { data: existing, error } = await service.supabase
        .from('official_bot_userbot_bindings')
        .select('userbot_id')
        .eq('bot_id', botId);
    service.throwIfDbError(error);

    const existingIds = new Set((existing || []).map((r) => String(r.userbot_id)));
    const desiredIds = new Set(activeUserbotIds.map(String));

    const toAdd = [...desiredIds].filter((id) => !existingIds.has(id));
    const toRemove = [...existingIds].filter((id) => !desiredIds.has(id));

    if (toAdd.length) {
        const rows = toAdd.map((userbotId) => ({
            bot_id: botId,
            userbot_id: userbotId,
            is_active: true
        }));
        const { error: insertError } = await service.supabase
            .from('official_bot_userbot_bindings')
            .upsert(rows, { onConflict: 'bot_id,userbot_id' });
        service.throwIfDbError(insertError);
    }

    if (toRemove.length) {
        for (const userbotId of toRemove) {
            await service.supabase
                .from('official_bot_userbot_bindings')
                .delete()
                .eq('bot_id', botId)
                .eq('userbot_id', userbotId);
        }
    }
}

export async function loadContours(service, ownerId) {
    const { data, error } = await service.supabase
        .from('sales_bot_contours')
        .select('bot_id, owner_id, public_channel_id, paid_channel_id, public_chat_id, paid_chat_id, userbot_mode, selected_userbot_id, selected_userbot_ids, created_at, updated_at')
        .eq('owner_id', ownerId)
        .order('updated_at', { ascending: false });

    service.throwIfDbError(error);
    return data || [];
}

export async function loadContourRights(service, ownerId) {
    const { data, error } = await service.supabase
        .from('sales_bot_contour_rights')
        .select('owner_id, bot_id, channel_id, target, status, admin_status, is_admin, can_invite_users, can_restrict_members, can_promote_members, can_manage_chat, warnings, message, checked_at, updated_at')
        .eq('owner_id', ownerId)
        .order('checked_at', { ascending: false });

    service.throwIfDbError(error);
    return data || [];
}

export async function saveContourRights(service, ownerId, { bot, channel, target, rights, warnings, status, message }) {
    const payload = {
        owner_id: ownerId,
        bot_id: bot.id,
        channel_id: channel.id,
        target: normalizeContourTarget(target),
        status: status || 'unknown',
        admin_status: rights.status || 'unknown',
        is_admin: !!rights.is_admin,
        can_invite_users: !!rights.can_invite_users,
        can_restrict_members: !!rights.can_restrict_members,
        can_promote_members: !!rights.can_promote_members,
        can_manage_chat: !!rights.can_manage_chat,
        warnings: Array.isArray(warnings) ? warnings : [],
        message: message || '',
        raw_rights: rights,
        checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    const { data, error } = await service.supabase
        .from('sales_bot_contour_rights')
        .upsert(payload, { onConflict: 'bot_id,target' })
        .select('owner_id, bot_id, channel_id, target, status, admin_status, is_admin, can_invite_users, can_restrict_members, can_promote_members, can_manage_chat, warnings, message, checked_at, updated_at')
        .single();

    service.throwIfDbError(error);
    return mapContourRightsRow(data);
}

export async function loadContourForBot(service, ownerId, botId) {
    const { data, error } = await service.supabase
        .from('sales_bot_contours')
        .select('bot_id, owner_id, public_channel_id, paid_channel_id, public_chat_id, paid_chat_id, userbot_mode, selected_userbot_id, selected_userbot_ids, created_at, updated_at')
        .eq('owner_id', ownerId)
        .eq('bot_id', botId)
        .maybeSingle();

    service.throwIfDbError(error);
    return data || null;
}

export async function assertOwnedSalesBot(service, ownerId, botId) {
    const { data, error } = await service.supabase
        .from('tg_accounts')
        .select('id, owner_id, account_type, tg_username, tg_account_id, bot_role, bot_kind, runtime_status, runtime_error, session_data')
        .eq('id', botId)
        .eq('owner_id', ownerId)
        .eq('account_type', 'bot')
        .maybeSingle();

    service.throwIfDbError(error);

    if (!data) {
        throw new SalesContourError('Бот не найден.', 404, 'bot_not_found');
    }

    if (normalizeBotKind(data.bot_kind, { allowMissing: true }) !== 'sales') {
        throw new SalesContourError('Сохранять sales contour можно только для bot_kind=sales.', 409, 'bot_kind_not_sales');
    }

    if ((data.bot_role || 'sales') === 'ops') {
        throw new SalesContourError('Ops-бот не может владеть sales contour.', 409, 'bot_role_not_sales');
    }

    return data;
}

export function validateChannelForBot(service, channel, botId, fieldName, { allowedChatTypes = null } = {}) {
    if (!channel?.id) {
        throw new SalesContourError(`Канал ${fieldName} не найден у владельца.`, 404, `${fieldName}_not_found`);
    }

    const chatType = normalizeChatType(channel.chat_type || 'unknown');
    if (chatType === 'private') {
        throw new SalesContourError(`Канал ${fieldName} не подходит для sales contour.`, 409, `${fieldName}_chat_type_invalid`);
    }

    if (allowedChatTypes && !allowedChatTypes.has(chatType)) {
        const expected = allowedChatTypes.has('channel') ? 'channel' : 'group или supergroup';
        throw new SalesContourError(`Для ${fieldName} нужен ${expected}.`, 409, `${fieldName}_chat_type_invalid`);
    }

    const linkedBotId = String(channel.bot_id || '').trim();
    if (!linkedBotId) {
        throw new SalesContourError(
            `Сначала сделай этого official-бота админом в выбранном чате ${fieldName}, чтобы канал привязался к bot_id.`,
            409,
            `${fieldName}_bot_link_missing`
        );
    }

    if (linkedBotId !== String(botId)) {
        throw new SalesContourError(
            `Выбранный чат ${fieldName} сейчас привязан к другому official-боту.`,
            409,
            `${fieldName}_bot_link_mismatch`
        );
    }
}

export function validateSelectedUserbots(service, requestedIds, optionById) {
    const selected = [];

    for (const userbotId of requestedIds) {
        const option = optionById.get(String(userbotId));
        if (!option) {
            throw new SalesContourError('Выбранный юзербот не найден у владельца.', 404, 'userbot_not_found');
        }
        if (!option.eligible_for_contour) {
            throw new SalesContourError(
                option.availability_reason || 'Выбранный юзербот сейчас нельзя использовать в sales contour.',
                409,
                'userbot_not_eligible'
            );
        }
        selected.push(option);
    }

    return selected;
}

export function resolveContourTargetChannel(service, { contour, channels, botId, target }) {
    const normalizedTarget = normalizeContourTarget(target);
    const targetConfig = CONTOUR_TARGET_CONFIG[normalizedTarget];
    const targetChannelId = contour?.[targetConfig.field];
    if (!targetChannelId) {
        throw new SalesContourError(
            targetConfig.missingMessage,
            409,
            targetConfig.missingCode
        );
    }

    const channel = channels.find((item) => String(item.id) === String(targetChannelId)) || null;
    service.validateChannelForBot(
        channel,
        botId,
        targetConfig.field,
        { allowedChatTypes: targetConfig.allowedChatTypes }
    );

    return channel;
}

export async function loadContourRuntimeContext(service, ownerId, input = {}) {
    const botId = normalizeUuid(input.bot_id ?? input.account_id, 'bot_id', { required: true });
    const target = normalizeContourTarget(input.target);

    const [bot, channels, contour] = await Promise.all([
        service.assertOwnedSalesBot(ownerId, botId),
        service.loadOwnedChannels(ownerId),
        service.loadContourForBot(ownerId, botId)
    ]);

    if (!contour) {
        throw new SalesContourError('Сначала сохрани контур продаж для этого бота.', 409, 'sales_contour_missing');
    }

    const channel = service.resolveContourTargetChannel({
        contour,
        channels,
        botId: bot.id,
        target
    });

    return { bot, channels, contour, channel, target };
}

export async function loadFirstContourUserbot(service, ownerId, contour, userbotService = null) {
    const userbotState = await service.loadOwnedUserbots(ownerId);
    let candidateIds = [];

    if (contour?.userbot_mode === 'single' && contour?.selected_userbot_id) {
        candidateIds = [String(contour.selected_userbot_id)];
    } else if (contour?.userbot_mode === 'pool' && Array.isArray(contour?.selected_userbot_ids)) {
        candidateIds = contour.selected_userbot_ids.map(String);
    }

    const ineligibleReasons = [];

    for (const id of candidateIds) {
        const option = userbotState.optionById.get(id);
        if (!option) continue;

        let eligible = option.eligible_for_contour;
        let currentOption = option;

        if (!eligible && currentOption.availability_status === 'proxy_dead' && userbotService) {
            try {
                const rawUserbot = userbotState.userbots.find((u) => String(u.id) === String(id));
                if (rawUserbot) {
                    const failover = await userbotService.tryAutoFailoverUserbot(rawUserbot);
                    if (failover?.switched && failover?.account) {
                        const updatedOption = buildUserbotOption(failover.account, userbotState.reservedUserbotIds);
                        if (updatedOption.eligible_for_contour) {
                            currentOption = updatedOption;
                            eligible = true;
                        }
                    }
                }
            } catch (failoverErr) {
                console.error(`[loadFirstContourUserbot] auto-failover failed for userbot ${id}:`, failoverErr);
            }
        }

        if (eligible) {
            return currentOption;
        } else {
            ineligibleReasons.push(
                `@${currentOption.tg_username || id}: ${currentOption.availability_reason || 'недоступен'}`
            );
        }
    }

    const reasonSuffix = ineligibleReasons.length
        ? ` (${ineligibleReasons.join('; ')})`
        : ' (В настройках контура этого бота не привязано ни одного юзербота)';
    throw new SalesContourError(`Нет доступного юзербота в контуре.${reasonSuffix}`, 409, 'no_eligible_userbot');
}

export function _buildContourTargets(channels, contour) {
    return CONTOUR_TARGET_KEYS
        .map((key) => {
            const config = CONTOUR_TARGET_CONFIG[key];
            const channelId = contour[config.field];
            if (!channelId) return null;
            const channel = channels.find((c) => String(c.id) === String(channelId));
            if (!channel) return null;
            return { key, channel, label: config.label };
        })
        .filter(Boolean);
}

export async function loadFullUserbotAccount(service, ownerId, userbotId) {
    const { data, error } = await service.supabase
        .from('tg_accounts')
        .select('id, owner_id, account_type, tg_account_id, tg_username, session_data, proxy_id, runtime_status, proxies(id, name, is_working, last_check_country, last_check_country_code)')
        .eq('id', userbotId)
        .eq('owner_id', ownerId)
        .single();
    service.throwIfDbError(error);
    return data;
}
