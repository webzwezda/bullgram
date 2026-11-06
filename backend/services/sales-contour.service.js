// Sales contour: контур продаж official-бота (площадки, юзерботы, права, join-all).
// Фасад разрезки: normalize.js / loaders.js / join-all.js; импорт classifyTelegramError
// из contour-admin-rights.service.js сохранён как был (цикл двух сервисов держат фасады).

import { classifyTelegramError } from './contour-admin-rights.service.js';
import {
    CHANNEL_CHAT_TYPES,
    CONTOUR_TARGET_CONFIG,
    GROUP_CHAT_TYPES,
    SALES_BOT_KINDS,
    SALES_CONTOUR_USERBOT_MODES,
    SalesContourError,
    assertDistinctContourTargets,
    buildBotRightsWarnings,
    buildContourReadiness,
    buildRoleRightsWarnings,
    buildTelegramMemberRights,
    getSalesContourFoundationMessage,
    isSalesContourFoundationError,
    mapChannel,
    mapContourRightsRow,
    mapContourRow,
    mapTelegramMember,
    normalizeBotKind,
    normalizeChatType,
    normalizeSalesContourPayload,
    normalizeTelegramError
} from './sales-contour/normalize.js';
import {
    _buildContourTargets,
    assertOwnedSalesBot,
    loadContourForBot,
    loadContourRights,
    loadContours,
    loadFirstContourUserbot,
    loadContourRuntimeContext,
    loadFullUserbotAccount,
    loadOwnedChannels,
    loadOwnedOfficialBots,
    loadOwnedUserbots,
    loadUserbotBindings,
    resolveContourTargetChannel,
    saveContourRights,
    syncUserbotBindings,
    toggleUserbotBinding,
    validateChannelForBot,
    validateSelectedUserbots
} from './sales-contour/loaders.js';
import {
    _isChatMember,
    _joinViaInvite,
    _runJoinAllInBackground,
    _waitForMembership,
    getJoinAllStatus,
    joinSingleTarget,
    joinUserbotToAllTargets,
    startJoinAll
} from './sales-contour/join-all.js';

// Публичные имена модуля (импортируются contour-admin-rights и роутами — фасад держит цикл).
export {
    SALES_BOT_KINDS,
    SALES_CONTOUR_USERBOT_MODES,
    SalesContourError,
    getSalesContourFoundationMessage,
    isSalesContourFoundationError,
    normalizeBotKind,
    normalizeSalesContourPayload
};

export class SalesContourService {
    constructor(supabase) {
        this.supabase = supabase;
    }

    mapDbError(error) {
        if (isSalesContourFoundationError(error)) {
            return new SalesContourError(getSalesContourFoundationMessage(), 400, 'sales_contour_sql_missing');
        }
        return error;
    }

    throwIfDbError(error) {
        if (error) {
            throw this.mapDbError(error);
        }
    }

    async loadOwnedOfficialBots(ownerId) {
        return loadOwnedOfficialBots(this, ownerId);
    }

    async loadOwnedChannels(ownerId) {
        return loadOwnedChannels(this, ownerId);
    }

    async loadOwnedUserbots(ownerId) {
        return loadOwnedUserbots(this, ownerId);
    }

    async loadUserbotBindings(ownedBotIds) {
        return loadUserbotBindings(this, ownedBotIds);
    }

    async toggleUserbotBinding(ownerId, botId, userbotId, isActive) {
        return toggleUserbotBinding(this, ownerId, botId, userbotId, isActive);
    }

    async syncUserbotBindings(ownerId, botId, activeUserbotIds) {
        return syncUserbotBindings(this, ownerId, botId, activeUserbotIds);
    }

    async loadContours(ownerId) {
        return loadContours(this, ownerId);
    }

    async loadContourRights(ownerId) {
        return loadContourRights(this, ownerId);
    }

    async saveContourRights(ownerId, options) {
        return saveContourRights(this, ownerId, options);
    }

    async loadContourForBot(ownerId, botId) {
        return loadContourForBot(this, ownerId, botId);
    }

    async assertOwnedSalesBot(ownerId, botId) {
        return assertOwnedSalesBot(this, ownerId, botId);
    }

    validateChannelForBot(channel, botId, fieldName, options = {}) {
        return validateChannelForBot(this, channel, botId, fieldName, options);
    }

    validateSelectedUserbots(requestedIds, optionById) {
        return validateSelectedUserbots(this, requestedIds, optionById);
    }

    resolveContourTargetChannel(options) {
        return resolveContourTargetChannel(this, options);
    }

    async loadContourRuntimeContext(ownerId, input = {}) {
        return loadContourRuntimeContext(this, ownerId, input);
    }

    async loadFirstContourUserbot(ownerId, contour, userbotService = null) {
        return loadFirstContourUserbot(this, ownerId, contour, userbotService);
    }

    _buildContourTargets(channels, contour) {
        return _buildContourTargets(channels, contour);
    }

    async loadFullUserbotAccount(ownerId, userbotId) {
        return loadFullUserbotAccount(this, ownerId, userbotId);
    }

    async getBotChatRights(ownerId, input = {}, botApi) {
        if (!botApi?.getChatMember) {
            throw new SalesContourError('Telegram API бота недоступен.', 500, 'telegram_bot_api_missing');
        }

        const context = await this.loadContourRuntimeContext(ownerId, input);
        const botTelegramId = String(context.bot.tg_account_id || '').trim();
        if (!botTelegramId) {
            throw new SalesContourError('У official-бота нет Telegram ID.', 409, 'bot_telegram_id_missing');
        }

        let member;
        try {
            member = await botApi.getChatMember(context.channel.tg_chat_id, botTelegramId);
        } catch (error) {
            const telegramError = normalizeTelegramError(error);
            throw new SalesContourError(
                telegramError.message || 'Не получилось проверить права official-бота в Telegram.',
                telegramError.isForbidden ? 409 : 502,
                telegramError.isForbidden ? 'bot_rights_check_forbidden' : 'bot_rights_check_failed'
            );
        }

        const rights = buildTelegramMemberRights(member);
        const warnings = buildRoleRightsWarnings(rights, context.target);
        const status = warnings.length ? 'needs_attention' : 'ready';
        const message = warnings.length ? warnings.join(' ') : 'Права official-бота сохранены.';
        const cachedRights = await this.saveContourRights(ownerId, {
            bot: context.bot,
            channel: context.channel,
            target: context.target,
            rights,
            warnings,
            status,
            message
        });

        return {
            target: context.target,
            status,
            admin_status: rights.status,
            channel_id: context.channel.id,
            channel: mapChannel(context.channel, context.bot.id),
            bot: {
                id: context.bot.id,
                tg_username: context.bot.tg_username || null,
                tg_account_id: botTelegramId
            },
            member: mapTelegramMember(member),
            rights,
            warnings,
            cached_rights: cachedRights,
            checked_at: cachedRights?.checked_at || null,
            message,
            is_ready_for_userbot_admin: buildBotRightsWarnings(rights).length === 0
        };
    }

    async startJoinAll(ownerId, input = {}, botApi, userbotService) {
        return startJoinAll(this, ownerId, input, botApi, userbotService);
    }

    async _runJoinAllInBackground(ownerId, botId, startedAt, botApi, userbotService) {
        return _runJoinAllInBackground(this, ownerId, botId, startedAt, botApi, userbotService);
    }

    async getJoinAllStatus(ownerId, input = {}) {
        return getJoinAllStatus(this, ownerId, input);
    }

    async joinUserbotToAllTargets(ownerId, input = {}, botApi, userbotService) {
        return joinUserbotToAllTargets(this, ownerId, input, botApi, userbotService);
    }

    async _isChatMember(botApi, tgChatId, tgUserId) {
        return _isChatMember(this, botApi, tgChatId, tgUserId);
    }

    async _waitForMembership(botApi, tgChatId, tgUserId, options = {}) {
        return _waitForMembership(this, botApi, tgChatId, tgUserId, options);
    }

    async _joinViaInvite(botApi, userbotClient, tgChatId) {
        return _joinViaInvite(this, botApi, userbotClient, tgChatId);
    }

    async joinSingleTarget(botApi, userbotClient, channel, userbot, targetKey, label) {
        return joinSingleTarget(this, botApi, userbotClient, channel, userbot, targetKey, label);
    }

    async getContoursOverview(ownerId) {
        const bots = await this.loadOwnedOfficialBots(ownerId);
        const [channels, contours, contourRights, userbotState, userbotBindings] = await Promise.all([
            this.loadOwnedChannels(ownerId),
            this.loadContours(ownerId),
            this.loadContourRights(ownerId),
            this.loadOwnedUserbots(ownerId),
            this.loadUserbotBindings(bots.map((bot) => bot.id))
        ]);

        const bindingByBotId = new Map();
        for (const binding of userbotBindings) {
            const botKey = String(binding.bot_id);
            if (!bindingByBotId.has(botKey)) bindingByBotId.set(botKey, []);
            bindingByBotId.get(botKey).push({ userbot_id: binding.userbot_id, is_active: binding.is_active });
        }

        const contourByBotId = new Map(contours.map((item) => [String(item.bot_id), item]));
        const rightsByBotId = new Map();
        const channelById = new Map(channels.map((item) => [String(item.id), item]));
        const linkedChannelMap = new Map();

        for (const row of contourRights) {
            const botId = String(row.bot_id || '');
            const mapped = mapContourRightsRow(row);
            if (!botId || !mapped) continue;
            if (!rightsByBotId.has(botId)) rightsByBotId.set(botId, {});
            rightsByBotId.get(botId)[mapped.target] = mapped;
        }

        for (const channel of channels) {
            const botId = String(channel.bot_id || '').trim();
            if (!botId) continue;
            if (!linkedChannelMap.has(botId)) linkedChannelMap.set(botId, []);
            linkedChannelMap.get(botId).push(channel);
        }

        return {
            bots: bots.map((bot) => {
                const botKind = normalizeBotKind(bot.bot_kind, { allowMissing: true }) || 'sales';
                const linkedChannels = linkedChannelMap.get(String(bot.id)) || [];
                const channelOptions = linkedChannels
                    .filter((channel) => normalizeChatType(channel.chat_type) === 'channel')
                    .map((channel) => mapChannel(channel, bot.id));
                const chatOptions = linkedChannels
                    .filter((channel) => GROUP_CHAT_TYPES.has(normalizeChatType(channel.chat_type)))
                    .map((channel) => mapChannel(channel, bot.id));
                const rawContour = contourByBotId.get(String(bot.id)) || null;
                const rightsByTarget = rightsByBotId.get(String(bot.id)) || {};
                const contour = rawContour
                    ? mapContourRow(rawContour, {
                        channelById,
                        userbotById: userbotState.optionById
                    })
                    : null;
                const readiness = buildContourReadiness(bot, contour);

                return {
                    id: bot.id,
                    owner_id: bot.owner_id || ownerId,
                    account_type: bot.account_type,
                    tg_username: bot.tg_username || null,
                    tg_account_id: bot.tg_account_id ? String(bot.tg_account_id) : null,
                    bot_role: bot.bot_role || 'sales',
                    bot_kind: botKind,
                    runtime_status: bot.runtime_status || null,
                    runtime_error: bot.runtime_error || null,
                    contour,
                    rights_by_target: rightsByTarget,
                    readiness,
                    linked_channels: linkedChannels.map((channel) => mapChannel(channel, bot.id)),
                    public_channel_options: channelOptions,
                    paid_channel_options: channelOptions,
                    public_chat_options: chatOptions,
                    paid_chat_options: chatOptions,
                    userbot_bindings: bindingByBotId.get(String(bot.id)) || []
                };
            }),
            userbot_options: userbotState.options,
            support: {
                bot_kinds: SALES_BOT_KINDS,
                userbot_modes: SALES_CONTOUR_USERBOT_MODES
            }
        };
    }

    async saveContour(ownerId, input = {}) {
        const payload = normalizeSalesContourPayload(input);
        assertDistinctContourTargets(payload);
        const bot = await this.assertOwnedSalesBot(ownerId, payload.botId);

        const [channels, userbotState] = await Promise.all([
            this.loadOwnedChannels(ownerId),
            this.loadOwnedUserbots(ownerId)
        ]);

        const channelById = new Map(channels.map((item) => [String(item.id), item]));
        const publicChannel = payload.publicChannelId ? channelById.get(String(payload.publicChannelId)) || null : null;
        const paidChannel = payload.paidChannelId ? channelById.get(String(payload.paidChannelId)) || null : null;
        const publicChat = payload.publicChatId ? channelById.get(String(payload.publicChatId)) || null : null;
        const paidChat = payload.paidChatId ? channelById.get(String(payload.paidChatId)) || null : null;

        if (publicChannel) {
            this.validateChannelForBot(publicChannel, bot.id, 'public_channel_id', { allowedChatTypes: CHANNEL_CHAT_TYPES });
        }

        if (paidChannel) {
            this.validateChannelForBot(paidChannel, bot.id, 'paid_channel_id', { allowedChatTypes: CHANNEL_CHAT_TYPES });
        }

        if (publicChat) {
            this.validateChannelForBot(publicChat, bot.id, 'public_chat_id', { allowedChatTypes: GROUP_CHAT_TYPES });
        }

        if (paidChat) {
            this.validateChannelForBot(paidChat, bot.id, 'paid_chat_id', { allowedChatTypes: GROUP_CHAT_TYPES });
        }

        const requestedUserbotIds = payload.userbotMode === 'single'
            ? [payload.selectedUserbotId]
            : payload.userbotMode === 'pool'
                ? payload.selectedUserbotIds
                : [];

        const selectedUserbots = this.validateSelectedUserbots(requestedUserbotIds, userbotState.optionById);

        const upsertPayload = {
            bot_id: bot.id,
            owner_id: ownerId,
            public_channel_id: payload.publicChannelId,
            paid_channel_id: payload.paidChannelId,
            public_chat_id: payload.publicChatId,
            paid_chat_id: payload.paidChatId,
            userbot_mode: payload.userbotMode,
            selected_userbot_id: payload.userbotMode === 'single' ? payload.selectedUserbotId : null,
            selected_userbot_ids: payload.userbotMode === 'pool' ? selectedUserbots.map((item) => item.id) : [],
            updated_at: new Date().toISOString()
        };

        const { data, error } = await this.supabase
            .from('sales_bot_contours')
            .upsert(upsertPayload, { onConflict: 'bot_id' })
            .select('bot_id, owner_id, public_channel_id, paid_channel_id, public_chat_id, paid_chat_id, userbot_mode, selected_userbot_id, selected_userbot_ids, created_at, updated_at')
            .single();

        this.throwIfDbError(error);

        const allUserbotIds = [
            ...(payload.userbotMode === 'single' && payload.selectedUserbotId ? [payload.selectedUserbotId] : []),
            ...(payload.userbotMode === 'pool' ? selectedUserbots.map((item) => item.id) : [])
        ].filter(Boolean);
        await this.syncUserbotBindings(ownerId, bot.id, allUserbotIds);
        await this.ensureContourBases(ownerId, data);

        return {
            contour: mapContourRow(data, {
                channelById,
                userbotById: userbotState.optionById
            }),
            bot: {
                id: bot.id,
                tg_username: bot.tg_username || null,
                tg_account_id: bot.tg_account_id ? String(bot.tg_account_id) : null,
                bot_role: bot.bot_role || 'sales',
                bot_kind: normalizeBotKind(bot.bot_kind, { allowMissing: true }) || 'sales'
            },
            readiness: buildContourReadiness(bot, data)
        };
    }

    async ensureContourBases(ownerId, contourRow) {
        const TARGET_LABELS = {
            public_channel: 'Открытый канал',
            paid_channel: 'Платный канал',
            public_chat: 'Открытый чат',
            paid_chat: 'Платный чат'
        };

        const targets = Object.entries(CONTOUR_TARGET_CONFIG);
        for (const [targetType, config] of targets) {
            const channelId = contourRow[config.field];
            if (!channelId) continue;

            const { data: existing } = await this.supabase
                .from('channel_audiences')
                .select('id')
                .eq('contour_id', contourRow.bot_id)
                .eq('target_type', targetType)
                .maybeSingle();

            if (existing) continue;

            const { error } = await this.supabase
                .from('channel_audiences')
                .insert({
                    owner_id: ownerId,
                    contour_id: contourRow.bot_id,
                    target_type: targetType,
                    name: TARGET_LABELS[targetType] || targetType
                })
                .select('id')
                .single();

            if (error && !String(error.message || '').includes('already exists')) {
                console.error(`[ensureContourBases] failed for ${targetType}:`, error.message);
                continue;
            }

            const baseId = error ? null : (await this.supabase
                .from('channel_audiences')
                .select('id')
                .eq('contour_id', contourRow.bot_id)
                .eq('target_type', targetType)
                .single()
            ).data?.id;

            if (!baseId) continue;

            await this.supabase
                .from('channel_audience_channels')
                .upsert({
                    base_id: baseId,
                    channel_id: channelId
                }, { onConflict: 'base_id,channel_id' });
        }
    }
}
