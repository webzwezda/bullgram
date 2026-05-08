import { loadReservedUserbotIds } from '../utils/shop-reservations.js';

export const SALES_BOT_KINDS = Object.freeze(['sales', 'template']);
export const SALES_CONTOUR_USERBOT_MODES = Object.freeze(['none', 'single', 'pool']);

const GROUP_CHAT_TYPES = new Set(['group', 'supergroup']);
const CHANNEL_CHAT_TYPES = new Set(['channel']);
const CONTOUR_TARGET_CONFIG = Object.freeze({
    public_channel: {
        field: 'public_channel_id',
        label: 'открытый канал',
        missingCode: 'public_channel_missing',
        missingMessage: 'В контуре не выбран открытый канал.',
        allowedChatTypes: CHANNEL_CHAT_TYPES
    },
    public_chat: {
        field: 'public_chat_id',
        label: 'открытый чат',
        missingCode: 'public_chat_missing',
        missingMessage: 'В контуре не выбран открытый чат.',
        allowedChatTypes: GROUP_CHAT_TYPES
    },
    paid_channel: {
        field: 'paid_channel_id',
        label: 'закрытый канал',
        missingCode: 'paid_channel_missing',
        missingMessage: 'В контуре не выбран закрытый канал.',
        allowedChatTypes: CHANNEL_CHAT_TYPES
    },
    paid_chat: {
        field: 'paid_chat_id',
        label: 'закрытый чат',
        missingCode: 'paid_chat_missing',
        missingMessage: 'В контуре не выбран закрытый чат.',
        allowedChatTypes: GROUP_CHAT_TYPES
    }
});
const BLOCKED_USERBOT_STATUSES = new Set(['restricted', 'expired', 'error']);
const FRESH_IMPORT_RUNTIME_STATUS = 'pending_activation';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN_MEMBER_STATUSES = new Set(['administrator', 'creator']);

export class SalesContourError extends Error {
    constructor(message, statusCode = 400, code = 'sales_contour_error') {
        super(message);
        this.name = 'SalesContourError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

export function getSalesContourFoundationMessage() {
    return 'Сначала примени SQL из backend/sql/sales-contours.sql';
}

export function isSalesContourFoundationError(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('sales_bot_contours')
        || message.includes('sales_bot_contour_rights')
        || message.includes('bot_kind')
        || message.includes('selected_userbot_ids');
}

export function normalizeBotKind(value, { allowMissing = false } = {}) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) {
        if (allowMissing) return null;
        throw new SalesContourError('Не передан bot_kind.', 400, 'bot_kind_missing');
    }
    if (!SALES_BOT_KINDS.includes(raw)) {
        throw new SalesContourError('bot_kind должен быть sales или template.', 400, 'bot_kind_invalid');
    }
    return raw;
}

function normalizeUuid(value, fieldName, { required = false } = {}) {
    const raw = String(value || '').trim();
    if (!raw) {
        if (required) {
            throw new SalesContourError(`Не передан ${fieldName}.`, 400, `${fieldName}_missing`);
        }
        return null;
    }
    if (!UUID_RE.test(raw)) {
        throw new SalesContourError(`${fieldName} должен быть UUID.`, 400, `${fieldName}_invalid`);
    }
    return raw;
}

function normalizeUuidList(value, fieldName) {
    const source = Array.isArray(value)
        ? value
        : typeof value === 'string' && value.trim()
            ? (() => {
                try {
                    const parsed = JSON.parse(value);
                    return Array.isArray(parsed) ? parsed : value.split(',');
                } catch {
                    return value.split(',');
                }
            })()
            : [];

    const seen = new Set();
    const result = [];

    for (const item of source) {
        const normalized = normalizeUuid(item, fieldName, { required: false });
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }

    return result;
}

function normalizeUserbotMode(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) {
        throw new SalesContourError('Не передан userbot_mode.', 400, 'userbot_mode_missing');
    }
    if (!SALES_CONTOUR_USERBOT_MODES.includes(raw)) {
        throw new SalesContourError('userbot_mode должен быть none, single или pool.', 400, 'userbot_mode_invalid');
    }
    return raw;
}

function normalizeChatType(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeVisibility(value) {
    const raw = String(value || '').trim().toLowerCase();
    return ['public', 'private', 'unknown'].includes(raw) ? raw : 'unknown';
}

function normalizeContourTarget(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw || raw === 'paid') return 'paid_channel';
    if (raw === 'public') return 'public_chat';
    if (raw === 'open_channel') return 'public_channel';
    if (raw === 'open_chat') return 'public_chat';
    if (raw === 'closed_channel' || raw === 'access_channel') return 'paid_channel';
    if (raw === 'closed_chat' || raw === 'access_chat') return 'paid_chat';
    if (Object.prototype.hasOwnProperty.call(CONTOUR_TARGET_CONFIG, raw)) return raw;
    throw new SalesContourError('target должен быть public_channel, public_chat, paid_channel или paid_chat.', 400, 'target_invalid');
}

function normalizeTelegramError(error) {
    const message = String(error?.response?.description || error?.description || error?.message || error || '').trim();
    const code = String(error?.code || error?.response?.error_code || '').trim();
    return {
        message,
        code,
        isNotFound: /user_not_participant|user not found|participant_id_invalid|member not found|not found/i.test(message),
        isForbidden: /forbidden|not enough rights|can't|have no rights|not an administrator|chat_admin_required/i.test(message)
    };
}

function buildTelegramMemberRights(member) {
    const status = String(member?.status || '').trim().toLowerCase();
    const isAdmin = ADMIN_MEMBER_STATUSES.has(status);

    return {
        status: status || 'unknown',
        is_admin: isAdmin,
        is_creator: status === 'creator',
        can_invite_users: !!member?.can_invite_users || status === 'creator',
        can_promote_members: !!member?.can_promote_members || status === 'creator',
        can_manage_chat: !!member?.can_manage_chat || status === 'creator',
        can_change_info: !!member?.can_change_info || status === 'creator',
        can_delete_messages: !!member?.can_delete_messages || status === 'creator',
        can_restrict_members: !!member?.can_restrict_members || status === 'creator'
    };
}

function buildBotRightsWarnings(rights) {
    const warnings = [];

    if (!rights?.is_admin) {
        warnings.push('Официальный бот не админ в этом Telegram-месте.');
    }
    if (!rights?.can_invite_users) {
        warnings.push('Боту нужно право добавлять участников, чтобы выдать ссылку юзерботу.');
    }
    if (!rights?.can_promote_members) {
        warnings.push('Боту нужно право добавлять админов, чтобы повысить юзербота.');
    }

    return warnings;
}

function buildRoleRightsWarnings(rights, target) {
    const warnings = [];
    const normalizedTarget = normalizeContourTarget(target);

    if (!rights?.is_admin) {
        warnings.push('Бот не назначен админом в этой площадке.');
        return warnings;
    }

    if (['paid_channel', 'paid_chat'].includes(normalizedTarget)) {
        if (!rights?.can_invite_users) {
            warnings.push('Не хватает права приглашать участников.');
        }
        if (!rights?.can_restrict_members) {
            warnings.push('Не хватает права удалять участников.');
        }
    }

    return warnings;
}

function mapTelegramMember(member) {
    if (!member) return null;
    return {
        status: String(member.status || '').toLowerCase() || 'unknown',
        user: member.user
            ? {
                id: member.user.id ? String(member.user.id) : null,
                username: member.user.username || null,
                first_name: member.user.first_name || null,
                last_name: member.user.last_name || null,
                is_bot: !!member.user.is_bot
            }
            : null,
        rights: buildTelegramMemberRights(member)
    };
}

function mapContourRightsRow(row) {
    if (!row) return null;
    const target = normalizeContourTarget(row.target);
    const warnings = Array.isArray(row.warnings)
        ? row.warnings.map((item) => String(item || '').trim()).filter(Boolean)
        : [];

    return {
        target,
        status: row.status || 'unknown',
        admin_status: row.admin_status || 'unknown',
        is_admin: !!row.is_admin,
        channel_id: row.channel_id || null,
        bot_id: row.bot_id || null,
        checked_at: row.checked_at || null,
        rights: {
            status: row.admin_status || 'unknown',
            is_admin: !!row.is_admin,
            is_creator: row.admin_status === 'creator',
            can_invite_users: row.can_invite_users,
            can_restrict_members: row.can_restrict_members,
            can_promote_members: row.can_promote_members,
            can_manage_chat: row.can_manage_chat
        },
        warnings,
        message: row.message || ''
    };
}

function isFreshImportedUserbot(userbot) {
    return String(userbot?.runtime_status || '').trim().toLowerCase() === FRESH_IMPORT_RUNTIME_STATUS;
}

function isUserbotOnDeadProxy(userbot) {
    return !!(userbot?.proxy_id && userbot?.proxies?.is_working === false);
}

function buildUserbotOption(userbot, reservedUserbotIds = new Set()) {
    const userbotId = String(userbot?.id || '');
    const runtimeStatus = String(userbot?.runtime_status || '').trim().toLowerCase();

    let availabilityStatus = 'ready';
    let availabilityReason = null;

    if (reservedUserbotIds.has(userbotId)) {
        availabilityStatus = 'reserved_in_shop';
        availabilityReason = 'Этот юзербот сейчас выставлен в shop и не должен участвовать в sales contour.';
    } else if (isFreshImportedUserbot(userbot)) {
        availabilityStatus = 'pending_activation';
        availabilityReason = 'Свежий импорт. Сначала вручную активируй юзербота.';
    } else if (isUserbotOnDeadProxy(userbot)) {
        availabilityStatus = 'proxy_dead';
        availabilityReason = 'У этого юзербота мертвый прокси. Сначала привяжи живой прокси.';
    } else if (BLOCKED_USERBOT_STATUSES.has(runtimeStatus)) {
        availabilityStatus = runtimeStatus;
        availabilityReason = userbot?.runtime_error || 'Telegram считает этот юзербот нерабочим для контура.';
    }

    return {
        id: userbotId,
        tg_username: userbot?.tg_username || null,
        tg_account_id: userbot?.tg_account_id ? String(userbot.tg_account_id) : null,
        proxy_id: userbot?.proxy_id || null,
        proxy_name: userbot?.proxies?.name || null,
        proxy_country: userbot?.proxies?.last_check_country || null,
        proxy_is_working: userbot?.proxies?.is_working ?? null,
        runtime_status: userbot?.runtime_status || null,
        runtime_error: userbot?.runtime_error || null,
        availability_status: availabilityStatus,
        availability_reason: availabilityReason,
        eligible_for_contour: availabilityStatus === 'ready'
    };
}

function mapChannel(channel, selectedBotId = null) {
    const username = String(channel.username || '').trim().replace(/^@/, '') || null;
    const visibility = normalizeVisibility(channel.visibility || (username ? 'public' : 'unknown'));

    return {
        id: channel.id,
        title: channel.title || null,
        tg_chat_id: channel.tg_chat_id ? String(channel.tg_chat_id) : null,
        bot_id: channel.bot_id || null,
        chat_type: normalizeChatType(channel.chat_type || 'unknown') || 'unknown',
        username,
        visibility,
        is_public: visibility === 'public',
        last_visibility_check_at: channel.last_visibility_check_at || null,
        created_at: channel.created_at || null,
        linked_to_selected_bot: selectedBotId ? String(channel.bot_id || '') === String(selectedBotId) : false
    };
}

function mapContourRow(contour, { channelById, userbotById }) {
    const selectedUserbotIds = Array.isArray(contour?.selected_userbot_ids)
        ? contour.selected_userbot_ids.map((item) => String(item)).filter(Boolean)
        : typeof contour?.selected_userbot_ids === 'string' && contour.selected_userbot_ids.trim()
            ? (() => {
                try {
                    const parsed = JSON.parse(contour.selected_userbot_ids);
                    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
                } catch {
                    return [];
                }
            })()
            : [];
    const paidChannel = contour?.paid_channel_id ? channelById.get(String(contour.paid_channel_id)) || null : null;
    const publicChannel = contour?.public_channel_id ? channelById.get(String(contour.public_channel_id)) || null : null;
    const publicChat = contour?.public_chat_id ? channelById.get(String(contour.public_chat_id)) || null : null;
    const paidChat = contour?.paid_chat_id ? channelById.get(String(contour.paid_chat_id)) || null : null;

    return {
        bot_id: contour.bot_id,
        owner_id: contour.owner_id,
        public_channel_id: contour.public_channel_id || null,
        paid_channel_id: contour.paid_channel_id,
        public_chat_id: contour.public_chat_id || null,
        paid_chat_id: contour.paid_chat_id || null,
        userbot_mode: contour.userbot_mode || 'none',
        selected_userbot_id: contour.selected_userbot_id || null,
        selected_userbot_ids: selectedUserbotIds,
        created_at: contour.created_at || null,
        updated_at: contour.updated_at || null,
        public_channel: publicChannel ? mapChannel(publicChannel) : null,
        paid_channel: paidChannel ? mapChannel(paidChannel) : null,
        public_chat: publicChat ? mapChannel(publicChat) : null,
        paid_chat: paidChat ? mapChannel(paidChat) : null,
        selected_userbot: contour.selected_userbot_id ? userbotById.get(String(contour.selected_userbot_id)) || null : null,
        selected_userbots: selectedUserbotIds.map((id) => userbotById.get(String(id)) || null).filter(Boolean)
    };
}

export function normalizeSalesContourPayload(input = {}) {
    const botId = normalizeUuid(input.bot_id ?? input.account_id, 'bot_id', { required: true });
    const publicChannelId = normalizeUuid(input.public_channel_id, 'public_channel_id', { required: false });
    const paidChannelId = normalizeUuid(input.paid_channel_id, 'paid_channel_id', { required: false });
    const publicChatId = normalizeUuid(input.public_chat_id, 'public_chat_id', { required: false });
    const paidChatId = normalizeUuid(input.paid_chat_id, 'paid_chat_id', { required: false });
    const userbotMode = normalizeUserbotMode(input.userbot_mode ?? input.userbotMode);
    const selectedUserbotId = userbotMode === 'single'
        ? normalizeUuid(input.selected_userbot_id, 'selected_userbot_id', { required: false })
        : null;
    const selectedUserbotIds = userbotMode === 'pool'
        ? normalizeUuidList(input.selected_userbot_ids, 'selected_userbot_ids')
        : [];

    if (userbotMode === 'single' && !selectedUserbotId) {
        throw new SalesContourError('Для режима single нужно выбрать selected_userbot_id.', 400, 'selected_userbot_id_missing');
    }

    if (userbotMode === 'pool' && selectedUserbotIds.length === 0) {
        throw new SalesContourError('Для режима pool нужно передать selected_userbot_ids.', 400, 'selected_userbot_ids_missing');
    }

    return {
        botId,
        publicChannelId,
        paidChannelId,
        publicChatId,
        paidChatId,
        userbotMode,
        selectedUserbotId: userbotMode === 'single' ? selectedUserbotId : null,
        selectedUserbotIds: userbotMode === 'pool' ? selectedUserbotIds : []
    };
}

function assertDistinctContourTargets(payload) {
    const selected = [
        ['public_channel_id', payload.publicChannelId],
        ['paid_channel_id', payload.paidChannelId],
        ['public_chat_id', payload.publicChatId],
        ['paid_chat_id', payload.paidChatId]
    ].filter(([, value]) => value);

    for (let index = 0; index < selected.length; index += 1) {
        const [fieldName, value] = selected[index];
        const duplicate = selected.slice(index + 1).find(([, nextValue]) => String(nextValue) === String(value));
        if (duplicate) {
            throw new SalesContourError(
                `Telegram-площадка не может одновременно быть ${fieldName} и ${duplicate[0]}.`,
                409,
                'contour_targets_not_distinct'
            );
        }
    }
}

function buildContourReadiness(bot, contourPayload) {
    return {
        status: 'ready',
        is_ready: true,
        warnings: []
    };
}

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
        const { data, error } = await this.supabase
            .from('tg_accounts')
            .select('id, owner_id, account_type, tg_account_id, tg_username, bot_role, bot_kind, runtime_status, runtime_error, admin_tg_id, created_at')
            .eq('owner_id', ownerId)
            .eq('account_type', 'bot')
            .neq('bot_role', 'ops')
            .order('created_at', { ascending: false });

        this.throwIfDbError(error);
        return data || [];
    }

    async loadOwnedChannels(ownerId) {
        const { data, error } = await this.supabase
            .from('channels')
            .select('id, owner_id, bot_id, tg_chat_id, title, chat_type, username, visibility, last_visibility_check_at, created_at')
            .eq('owner_id', ownerId)
            .order('created_at', { ascending: false });

        this.throwIfDbError(error);
        return data || [];
    }

    async loadOwnedUserbots(ownerId) {
        const [reservedUserbotIds, response] = await Promise.all([
            loadReservedUserbotIds(this.supabase, ownerId),
            this.supabase
                .from('tg_accounts')
                .select('id, owner_id, account_type, tg_account_id, tg_username, proxy_id, runtime_status, runtime_error, created_at, proxies(id, name, is_working, last_check_country, last_check_country_code)')
                .eq('owner_id', ownerId)
                .eq('account_type', 'userbot')
                .order('created_at', { ascending: false })
        ]);

        this.throwIfDbError(response.error);

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

    async loadContours(ownerId) {
        const { data, error } = await this.supabase
            .from('sales_bot_contours')
            .select('bot_id, owner_id, public_channel_id, paid_channel_id, public_chat_id, paid_chat_id, userbot_mode, selected_userbot_id, selected_userbot_ids, created_at, updated_at')
            .eq('owner_id', ownerId)
            .order('updated_at', { ascending: false });

        this.throwIfDbError(error);
        return data || [];
    }

    async loadContourRights(ownerId) {
        const { data, error } = await this.supabase
            .from('sales_bot_contour_rights')
            .select('owner_id, bot_id, channel_id, target, status, admin_status, is_admin, can_invite_users, can_restrict_members, can_promote_members, can_manage_chat, warnings, message, checked_at, updated_at')
            .eq('owner_id', ownerId)
            .order('checked_at', { ascending: false });

        this.throwIfDbError(error);
        return data || [];
    }

    async saveContourRights(ownerId, { bot, channel, target, rights, warnings, status, message }) {
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

        const { data, error } = await this.supabase
            .from('sales_bot_contour_rights')
            .upsert(payload, { onConflict: 'bot_id,target' })
            .select('owner_id, bot_id, channel_id, target, status, admin_status, is_admin, can_invite_users, can_restrict_members, can_promote_members, can_manage_chat, warnings, message, checked_at, updated_at')
            .single();

        this.throwIfDbError(error);
        return mapContourRightsRow(data);
    }

    async loadContourForBot(ownerId, botId) {
        const { data, error } = await this.supabase
            .from('sales_bot_contours')
            .select('bot_id, owner_id, public_channel_id, paid_channel_id, public_chat_id, paid_chat_id, userbot_mode, selected_userbot_id, selected_userbot_ids, created_at, updated_at')
            .eq('owner_id', ownerId)
            .eq('bot_id', botId)
            .maybeSingle();

        this.throwIfDbError(error);
        return data || null;
    }

    async assertOwnedSalesBot(ownerId, botId) {
        const { data, error } = await this.supabase
            .from('tg_accounts')
            .select('id, owner_id, account_type, tg_username, tg_account_id, bot_role, bot_kind, runtime_status, runtime_error, session_data')
            .eq('id', botId)
            .eq('owner_id', ownerId)
            .eq('account_type', 'bot')
            .single();

        this.throwIfDbError(error);

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

    validateChannelForBot(channel, botId, fieldName, { allowedChatTypes = null } = {}) {
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

    validateSelectedUserbots(requestedIds, optionById) {
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

    resolveContourTargetChannel({ contour, channels, botId, target }) {
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
        this.validateChannelForBot(
            channel,
            botId,
            targetConfig.field,
            { allowedChatTypes: targetConfig.allowedChatTypes }
        );

        return channel;
    }

    async loadContourRuntimeContext(ownerId, input = {}) {
        const botId = normalizeUuid(input.bot_id ?? input.account_id, 'bot_id', { required: true });
        const target = normalizeContourTarget(input.target);

        const [bot, channels, contour] = await Promise.all([
            this.assertOwnedSalesBot(ownerId, botId),
            this.loadOwnedChannels(ownerId),
            this.loadContourForBot(ownerId, botId)
        ]);

        if (!contour) {
            throw new SalesContourError('Сначала сохрани контур продаж для этого бота.', 409, 'sales_contour_missing');
        }

        const channel = this.resolveContourTargetChannel({
            contour,
            channels,
            botId: bot.id,
            target
        });

        return { bot, channels, contour, channel, target };
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

    async createUserbotInvite(botApi, channel) {
        if (!botApi?.createChatInviteLink) {
            throw new SalesContourError('Telegram API бота не умеет создавать invite link.', 500, 'telegram_invite_api_missing');
        }

        const expireDate = Math.floor(Date.now() / 1000) + 60 * 60;
        const inviteName = `BullRun_userbot_${new Date().toISOString().slice(0, 16)}`;

        try {
            const invite = await botApi.createChatInviteLink(channel.tg_chat_id, {
                name: inviteName,
                expire_date: expireDate,
                member_limit: 1,
                creates_join_request: false
            });

            return {
                invite_link: invite?.invite_link || null,
                expire_date: expireDate,
                name: inviteName
            };
        } catch (error) {
            const telegramError = normalizeTelegramError(error);
            throw new SalesContourError(
                telegramError.message || 'Не получилось создать ссылку для юзербота.',
                telegramError.isForbidden ? 409 : 502,
                telegramError.isForbidden ? 'invite_create_forbidden' : 'invite_create_failed'
            );
        }
    }

    async loadSelectedContourUserbot(ownerId, contour) {
        if (contour?.userbot_mode !== 'single' || !contour?.selected_userbot_id) {
            throw new SalesContourError('Для подготовки нужен режим “Один юзербот” и выбранный аккаунт.', 409, 'single_userbot_missing');
        }

        const userbotState = await this.loadOwnedUserbots(ownerId);
        const userbot = userbotState.optionById.get(String(contour.selected_userbot_id));
        if (!userbot) {
            throw new SalesContourError('Выбранный юзербот не найден у владельца.', 404, 'userbot_not_found');
        }
        if (!userbot.eligible_for_contour) {
            throw new SalesContourError(
                userbot.availability_reason || 'Выбранный юзербот сейчас нельзя использовать в sales contour.',
                409,
                'userbot_not_eligible'
            );
        }
        if (!userbot.tg_account_id) {
            throw new SalesContourError('У выбранного юзербота нет Telegram ID.', 409, 'userbot_telegram_id_missing');
        }

        return userbot;
    }

    async prepareSelectedUserbotAdmin(ownerId, input = {}, botApi) {
        if (!botApi?.getChatMember || !botApi?.promoteChatMember) {
            throw new SalesContourError('Telegram API бота недоступен.', 500, 'telegram_bot_api_missing');
        }

        const context = await this.loadContourRuntimeContext(ownerId, input);
        const rightsResult = await this.getBotChatRights(ownerId, { bot_id: context.bot.id, target: context.target }, botApi);
        const missingRights = buildBotRightsWarnings(rightsResult.rights);
        if (missingRights.length) {
            throw new SalesContourError(missingRights.join(' '), 409, 'bot_rights_missing');
        }

        const userbot = await this.loadSelectedContourUserbot(ownerId, context.contour);
        let userbotMember = null;

        try {
            userbotMember = await botApi.getChatMember(context.channel.tg_chat_id, userbot.tg_account_id);
        } catch (error) {
            const telegramError = normalizeTelegramError(error);
            if (!telegramError.isNotFound) {
                throw new SalesContourError(
                    telegramError.message || 'Не получилось проверить юзербота в Telegram-чате.',
                    telegramError.isForbidden ? 409 : 502,
                    telegramError.isForbidden ? 'userbot_member_check_forbidden' : 'userbot_member_check_failed'
                );
            }
        }

        if (!userbotMember || ['left', 'kicked'].includes(String(userbotMember.status || '').toLowerCase())) {
            const invite = await this.createUserbotInvite(botApi, context.channel);
            return {
                status: 'needs_join',
                target: context.target,
                channel: mapChannel(context.channel, context.bot.id),
                userbot,
                selected_userbot_id: userbot.id,
                invite,
                invite_link: invite.invite_link,
                message: 'Юзербот ещё не в чате. Открой ссылку в этом аккаунте, дождись вступления и нажми подготовку ещё раз.'
            };
        }

        const memberRights = buildTelegramMemberRights(userbotMember);
        if (memberRights.is_admin) {
            return {
                status: 'already_admin',
                target: context.target,
                channel: mapChannel(context.channel, context.bot.id),
                userbot,
                selected_userbot_id: userbot.id,
                userbot_member: mapTelegramMember(userbotMember),
                message: 'Юзербот уже админ в этом Telegram-месте.'
            };
        }

        try {
            await botApi.promoteChatMember(context.channel.tg_chat_id, userbot.tg_account_id, {
                can_invite_users: true,
                can_promote_members: false,
                can_change_info: false,
                can_delete_messages: false,
                can_restrict_members: false,
                can_pin_messages: false,
                can_manage_topics: false,
                can_manage_video_chats: false,
                can_post_messages: false,
                can_edit_messages: false
            });
        } catch (error) {
            const telegramError = normalizeTelegramError(error);
            throw new SalesContourError(
                telegramError.message || 'Не получилось сделать юзербота админом.',
                telegramError.isForbidden ? 409 : 502,
                telegramError.isForbidden ? 'userbot_promote_forbidden' : 'userbot_promote_failed'
            );
        }

        let promotedMember = null;
        try {
            promotedMember = await botApi.getChatMember(context.channel.tg_chat_id, userbot.tg_account_id);
        } catch {
            promotedMember = null;
        }

        return {
            status: 'promoted',
            target: context.target,
            channel: mapChannel(context.channel, context.bot.id),
            userbot,
            selected_userbot_id: userbot.id,
            userbot_member: mapTelegramMember(promotedMember),
            granted_rights: {
                can_invite_users: true,
                can_promote_members: false,
                can_change_info: false,
                can_delete_messages: false,
                can_restrict_members: false
            },
            message: 'Юзербот повышен до админа с минимальными правами.'
        };
    }

    async getContoursOverview(ownerId) {
        const [bots, channels, contours, contourRights, userbotState] = await Promise.all([
            this.loadOwnedOfficialBots(ownerId),
            this.loadOwnedChannels(ownerId),
            this.loadContours(ownerId),
            this.loadContourRights(ownerId),
            this.loadOwnedUserbots(ownerId)
        ]);

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
                    userbot_options: userbotState.options
                };
            }),
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
}
