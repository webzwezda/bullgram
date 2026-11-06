// Персистентность и лоадеры contour-admin-rights (leaf: только shared.js и внешние файлы).
// Разрезка contour-admin-rights.service.js; методы класса делегируются сюда
// (service-инстанс первым аргументом вместо this). assertOwnedSalesBot остаётся
// в главном файле (зависит от SalesContourError/normalizeBotKind из sales-contour).

import { loadReservedUserbotIds } from '../../utils/shop-reservations.js';
import {
    BLOCKED_USERBOT_STATUSES,
    CONTOUR_TARGET_CONFIG,
    normalizeUuidValue
} from './shared.js';

export async function saveActorRight(service, ownerId, botId, result) {
    const checkedAt = new Date(service.deps.now()).toISOString();
    const payload = {
        owner_id: ownerId,
        bot_id: botId,
        actor_type: result.actor_type,
        actor_id: result.actor_id,
        channel_id: result.channel_id || null,
        target: result.target,
        state: result.state,
        is_admin: !!result.is_admin,
        flags: result.flags || {},
        warnings: result.warnings || [],
        message: result.message || '',
        checked_at: checkedAt,
        updated_at: checkedAt
    };

    const { error } = await service.supabase
        .from('sales_contour_actor_rights')
        .upsert(payload, { onConflict: 'bot_id,actor_type,actor_id,target' });

    if (error) {
        console.error(`[contour-admin-rights] upsert failed (${result.actor_type}/${result.target}):`, error.message);
    }
    return payload;
}

export function buildContourTargets(channels, contour) {
    return Object.keys(CONTOUR_TARGET_CONFIG)
        .map((key) => {
            const config = CONTOUR_TARGET_CONFIG[key];
            const channelId = contour?.[config.field];
            if (!channelId) return null;
            const channel = (channels || []).find((item) => String(item.id) === String(channelId));
            if (!channel) return null;
            return { key, channel, label: config.label };
        })
        .filter(Boolean);
}

// Активные юзерботы-акторы: is_active-связки + single-режим контура.
// Shop-reserved / свежий импорт / мёртвый прокси / заблокированные — пропускаем
// (та же логика, что buildUserbotOption в sales-contour.service.js).
export async function loadActorUserbots(service, ownerId, botId, contour) {
    const ids = new Set();

    try {
        const { data: bindings, error } = await service.supabase
            .from('official_bot_userbot_bindings')
            .select('bot_id, userbot_id, is_active, created_at')
            .eq('bot_id', botId)
            .eq('is_active', true);
        if (error) throw error;
        for (const binding of bindings || []) {
            ids.add(String(binding.userbot_id));
        }
    } catch (error) {
        console.error('[contour-admin-rights] failed to load userbot bindings:', error.message);
    }

    if (contour?.userbot_mode === 'single' && contour?.selected_userbot_id) {
        ids.add(String(contour.selected_userbot_id));
    }

    const userbotIds = [...ids].filter((id) => normalizeUuidValue(id));
    if (!userbotIds.length) return [];

    const [reservedUserbotIds, response] = await Promise.all([
        loadReservedUserbotIds(service.supabase, ownerId),
        service.supabase
            .from('tg_accounts')
            .select('id, owner_id, account_type, tg_account_id, tg_username, session_data, proxy_id, runtime_status, proxies(id, name, is_working, last_check_country, last_check_country_code)')
            .eq('owner_id', ownerId)
            .eq('account_type', 'userbot')
            .in('id', userbotIds)
    ]);

    if (response.error) throw response.error;

    return (response.data || []).filter((userbot) => service.isUserbotEligible(userbot, reservedUserbotIds));
}

export function isUserbotEligible(userbot, reservedUserbotIds) {
    if (reservedUserbotIds?.has(String(userbot?.id || ''))) return false;
    const runtimeStatus = String(userbot?.runtime_status || '').trim().toLowerCase();
    if (runtimeStatus === 'pending_activation') return false;
    if (BLOCKED_USERBOT_STATUSES.has(runtimeStatus)) return false;
    if (userbot?.proxy_id && userbot?.proxies?.is_working === false) return false;
    return true;
}

// Те же колонки, что loadOwnedChannels в sales-contour.service.js.
export async function loadOwnedChannels(service, ownerId) {
    const { data, error } = await service.supabase
        .from('channels')
        .select('id, owner_id, bot_id, tg_chat_id, title, chat_type, username, visibility, last_visibility_check_at, created_at')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

// Те же колонки, что loadContourForBot в sales-contour.service.js.
export async function loadContourForBot(service, ownerId, botId) {
    const { data, error } = await service.supabase
        .from('sales_bot_contours')
        .select('bot_id, owner_id, public_channel_id, paid_channel_id, public_chat_id, paid_chat_id, userbot_mode, selected_userbot_id, selected_userbot_ids, created_at, updated_at')
        .eq('owner_id', ownerId)
        .eq('bot_id', botId)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}
