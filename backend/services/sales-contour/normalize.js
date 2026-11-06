// Чистые нормализаторы/мапперы и константы sales-contour (leaf: ни от кого не зависит);
// главный файл реэкспортирует публичные имена — путь фасада не меняется.

export const SALES_BOT_KINDS = Object.freeze(['sales', 'template']);
export const SALES_CONTOUR_USERBOT_MODES = Object.freeze(['none', 'single', 'pool']);

export const GROUP_CHAT_TYPES = new Set(['group', 'supergroup']);
export const CHANNEL_CHAT_TYPES = new Set(['channel']);
export const CONTOUR_TARGET_CONFIG = Object.freeze({
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
const BLOCKED_USERBOT_STATUSES = new Set(['restricted', 'expired', 'error', 'frozen']);
const FRESH_IMPORT_RUNTIME_STATUS = 'pending_activation';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ADMIN_MEMBER_STATUSES = new Set(['administrator', 'creator']);
export const CONTOUR_TARGET_KEYS = Object.keys(CONTOUR_TARGET_CONFIG);

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
    // Только коды Postgres: 42P01 (undefined_table), 42703 (undefined_column).
    // Текстовые совпадения убраны: ловили ложные срабатывания на именах колонок/таблиц
    // в данных и в сообщениях прикладных ошибок.
    return error?.code === '42P01' || error?.code === '42703';
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

export function normalizeUuid(value, fieldName, { required = false } = {}) {
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

export function normalizeUuidList(value, fieldName) {
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

export function normalizeUserbotMode(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) {
        throw new SalesContourError('Не передан userbot_mode.', 400, 'userbot_mode_missing');
    }
    if (!SALES_CONTOUR_USERBOT_MODES.includes(raw)) {
        throw new SalesContourError('userbot_mode должен быть none, single или pool.', 400, 'userbot_mode_invalid');
    }
    return raw;
}

export function normalizeChatType(value) {
    return String(value || '').trim().toLowerCase();
}

export function normalizeVisibility(value) {
    const raw = String(value || '').trim().toLowerCase();
    return ['public', 'private', 'unknown'].includes(raw) ? raw : 'unknown';
}

export function normalizeContourTarget(value) {
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

export function normalizeTelegramError(error) {
    const message = String(error?.response?.description || error?.description || error?.message || error || '').trim();
    const code = String(error?.code || error?.response?.error_code || '').trim();
    return {
        message,
        code,
        isNotFound: /user_not_participant|user not found|participant_id_invalid|member not found|not found/i.test(message),
        isForbidden: /forbidden|not enough rights|can't|have no rights|not an administrator|chat_admin_required/i.test(message)
    };
}

export function buildTelegramMemberRights(member) {
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

export function buildBotRightsWarnings(rights) {
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

export function buildRoleRightsWarnings(rights, target) {
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

export function mapTelegramMember(member) {
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

export function mapContourRightsRow(row) {
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

export function buildUserbotOption(userbot, reservedUserbotIds = new Set()) {
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

export function mapChannel(channel, selectedBotId = null) {
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

export function mapContourRow(contour, { channelById, userbotById }) {
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

export function assertDistinctContourTargets(payload) {
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

export function buildContourReadiness(bot, contourPayload) {
    return {
        status: 'ready',
        is_ready: true,
        warnings: []
    };
}
