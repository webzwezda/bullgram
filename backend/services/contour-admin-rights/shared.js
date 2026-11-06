// Общие константы и чистые хелперы contour-admin-rights (leaf: ни от кого не зависит).
// Разрезка contour-admin-rights.service.js; главный файл реэкспортирует публичные имена.

// Максимальные права official-бота в площадках контура.
export const CONTOUR_OFFICIAL_BOT_MAX_RIGHTS = Object.freeze({
    can_manage_chat: true,
    can_invite_users: true,
    can_restrict_members: true,
    can_promote_members: true
});

// Максимальные права юзербота в площадках контура.
// can_promote_members намеренно отсутствует (safety): юзербот не должен раздавать админок.
// Если перевернуть этот флаг здесь — включатся юзерботы-промоутеры (pool-promoter).
export const CONTOUR_USERBOT_MAX_RIGHTS = Object.freeze({
    can_invite_users: true,
    can_restrict_members: true
});

const CHANNEL_CHAT_TYPES = new Set(['channel']);
const GROUP_CHAT_TYPES = new Set(['group', 'supergroup']);
const ADMIN_MEMBER_STATUSES = new Set(['administrator', 'creator']);
export const LEFT_STATUSES = new Set(['left', 'kicked']);
export const BLOCKED_USERBOT_STATUSES = new Set(['restricted', 'expired', 'error']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const INTER_CELL_DELAY_MS = 500;
export const MEMBERSHIP_WAIT_ATTEMPTS = 3;
export const MEMBERSHIP_WAIT_INTERVAL_MS = 2000;
export const PEER_INVITE_MAX_CANDIDATES = 3;
export const PEER_INVITE_DELAY_MS = 2000;

// Копия CONTOUR_TARGET_CONFIG из sales-contour.service.js (там не экспортируется, а
// добавлять экспорт сверх согласованных правок нельзя). Поля и семантика должны совпадать.
export const CONTOUR_TARGET_CONFIG = Object.freeze({
    public_channel: {
        field: 'public_channel_id',
        label: 'открытый канал',
        allowedChatTypes: CHANNEL_CHAT_TYPES
    },
    public_chat: {
        field: 'public_chat_id',
        label: 'открытый чат',
        allowedChatTypes: GROUP_CHAT_TYPES
    },
    paid_channel: {
        field: 'paid_channel_id',
        label: 'закрытый канал',
        allowedChatTypes: CHANNEL_CHAT_TYPES
    },
    paid_chat: {
        field: 'paid_chat_id',
        label: 'закрытый чат',
        allowedChatTypes: GROUP_CHAT_TYPES
    }
});

export function normalizeUuidValue(value) {
    const raw = String(value || '').trim();
    return UUID_RE.test(raw) ? raw : null;
}

export function extractInviteHash(inviteLink) {
    if (!inviteLink) return null;
    const match = inviteLink.match(/[+](\w[\w-]+)/) || inviteLink.match(/joinchat\/([\w-]+)/);
    return match ? match[1] : null;
}

export function buildErrorMessage(error) {
    return String(error?.errorMessage || error?.response?.description || error?.message || error || '').trim()
        || 'неизвестная ошибка Telegram';
}

// Права участника из ответа Bot API getChatMember (семантика buildTelegramMemberRights
// из sales-contour.service.js).
export function buildBotApiMemberRights(member) {
    const status = String(member?.status || '').trim().toLowerCase();
    const isAdmin = ADMIN_MEMBER_STATUSES.has(status);

    return {
        status: status || 'unknown',
        is_admin: isAdmin,
        is_creator: status === 'creator',
        can_invite_users: !!member?.can_invite_users || status === 'creator',
        can_restrict_members: !!member?.can_restrict_members || status === 'creator',
        can_promote_members: !!member?.can_promote_members || status === 'creator',
        can_manage_chat: !!member?.can_manage_chat || status === 'creator'
    };
}

// Права юзербота из ответа GramJS channels.getParticipant
// (сам участник или обёртка { participant } — поддерживаем обе формы).
export function buildUserbotRightsFromParticipant(participantResult) {
    const raw = participantResult?.participant || participantResult || {};
    const className = String(raw?.className || '').trim();
    const isCreator = className === 'ChannelParticipantCreator';
    const isAdministrator = className === 'ChannelParticipantAdmin';
    const adminRights = raw?.adminRights || {};

    return {
        status: isCreator ? 'creator' : isAdministrator ? 'administrator' : 'member',
        is_admin: isCreator || isAdministrator,
        is_creator: isCreator,
        can_invite_users: isCreator || adminRights.inviteUsers === true,
        can_restrict_members: isCreator || adminRights.banUsers === true,
        can_promote_members: isCreator || adminRights.addAdmins === true,
        can_manage_chat: isCreator || isAdministrator
    };
}

// Проверяет, что текущие права покрывают желаемые.
// creator считается всемогущим даже без объекта флагов.
export function ensureFlagsSufficient(currentFlags, desiredFlags) {
    const desired = desiredFlags && typeof desiredFlags === 'object' ? desiredFlags : {};
    const wanted = Object.keys(desired).filter((flag) => desired[flag] === true);

    if (!wanted.length) {
        return { sufficient: true, missing: [] };
    }

    const status = String(currentFlags?.status || '').trim().toLowerCase();
    if (status === 'creator' || currentFlags?.is_creator === true) {
        return { sufficient: true, missing: [] };
    }

    if (!currentFlags?.is_admin) {
        return { sufficient: false, missing: wanted };
    }

    const missing = wanted.filter((flag) => currentFlags[flag] !== true);
    return { sufficient: missing.length === 0, missing };
}

// Классификация ошибки Telegram/GramJS/Bot API.
// retry_after при flood_wait дописывается в сам объект ошибки (err.retry_after, секунды).
export function classifyTelegramError(error, adminStatus = '') {
    const raw = [
        error?.errorMessage,
        error?.response?.description,
        error?.description,
        error?.message,
        typeof error === 'string' ? error : ''
    ].map((part) => String(part || '')).join(' ');
    const lower = raw.toLowerCase();
    const normalizedAdminStatus = String(adminStatus || '').trim().toLowerCase();

    if (lower.includes('user_already_participant')) {
        return 'already_member';
    }

    if (
        lower.includes('flood_wait')
        || lower.includes('phone_number_flood')
        || lower.includes('peer_flood')
    ) {
        const match = raw.match(/FLOOD_WAIT[_\s]?(\d+)/i) || raw.match(/retry after (\d+)/i);
        const retryAfter = match
            ? Number(match[1])
            : error?.parameters?.retry_after != null ? Number(error.parameters.retry_after) : null;
        if (retryAfter != null && Number.isFinite(retryAfter)) {
            try {
                error.retry_after = retryAfter;
            } catch {
                // read-only объект ошибки — просто не сможем достать retry_after
            }
        }
        return 'flood_wait';
    }

    const adminRequired = lower.includes('chat_admin_required') || lower.includes('not enough rights');
    if (adminRequired) {
        return normalizedAdminStatus === 'administrator' || normalizedAdminStatus === 'creator'
            ? 'owner_appointed'
            : 'promote_forbidden';
    }

    return 'unknown';
}
