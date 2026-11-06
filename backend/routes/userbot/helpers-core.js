// Ядро хелперов юзербот-роутера: ответы health-check, таймауты, фото профиля,
// загрузка/валидация юзерботов, dead-proxy и expired-session сообщения,
// дата/сигналы, invite-ссылки, operational-загрузка с автофейловером.
// Вынесено дословно из userbot.routes.js на стадии 1 разрезки (2026-11-06).
// USERBOT_PROFILE_SYNC_COOLDOWN_MS / USERBOT_PROFILE_UPLOADS_DIR остаются
// объявленными в userbot.routes.js и импортируются оттуда.
import fs from 'fs';
import path from 'path';
import { UserbotService } from '../../services/userbot.service.js';
import { loadReservedUserbotIds } from '../../utils/shop-reservations.js';
import {
    FRESH_IMPORT_RUNTIME_REASON,
    isFreshImportedUserbot
} from '../../utils/ops-center-selection.js';
import { USERBOT_PROFILE_SYNC_COOLDOWN_MS, USERBOT_PROFILE_UPLOADS_DIR } from '../userbot.routes.js';

function isUserbotDmEnabled() {
    return String(process.env.USERBOT_DM_ENABLED || '').trim().toLowerCase() === 'true';
}

function buildCheckResponse(status, reason = null, details = null, extra = {}) {
    return {
        status,
        reason: reason || null,
        details: details || null,
        ...extra
    };
}

function withTimeout(promise, timeoutMs, message) {
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });
}

function safeUploadSegment(value) {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 96) || 'unknown';
}

function safePhotoExtension(value) {
    const extension = String(value || 'jpg').trim().toLowerCase().replace(/^\./, '');
    return ['jpg', 'jpeg', 'png', 'webp'].includes(extension) ? extension.replace('jpeg', 'jpg') : 'jpg';
}

function storeUserbotProfilePhoto({ ownerId, accountId, photo, extension = 'jpg', maxBytes = 5 * 1024 * 1024 }) {
    if (!Buffer.isBuffer(photo) || photo.length === 0 || photo.length > maxBytes) {
        return null;
    }

    const ownerSegment = safeUploadSegment(ownerId);
    const accountSegment = safeUploadSegment(accountId);
    const dir = path.join(USERBOT_PROFILE_UPLOADS_DIR, ownerSegment);
    fs.mkdirSync(dir, { recursive: true });

    const filename = `${accountSegment}.${safePhotoExtension(extension)}`;
    const fullPath = path.join(dir, filename);
    fs.writeFileSync(fullPath, photo);

    return `/uploads/userbot-profiles/${ownerSegment}/${filename}`;
}

function userbotProfileSyncCooldown(account) {
    const cooldownSource = account?.tg_profile_sync_attempted_at || account?.tg_profile_synced_at;
    if (!cooldownSource) return null;
    const syncedAtMs = new Date(cooldownSource).getTime();
    if (!Number.isFinite(syncedAtMs)) return null;
    const remainingMs = USERBOT_PROFILE_SYNC_COOLDOWN_MS - (Date.now() - syncedAtMs);
    if (remainingMs <= 0) return null;
    return {
        remaining_ms: remainingMs,
        retry_after_seconds: Math.ceil(remainingMs / 1000)
    };
}

function shouldStoreRecoverySource(value) {
    return String(value || '').trim().toLowerCase() === 'true';
}

async function loadLatestUserbot(supabase, ownerId) {
    const reservedUserbotIds = await loadReservedUserbotIds(supabase, ownerId);
    const { data, error } = await supabase
        .from('tg_accounts')
        .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
        .eq('owner_id', ownerId)
        .eq('account_type', 'userbot')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).find(account =>
        !reservedUserbotIds.has(String(account.id)) &&
        !isFreshImportedUserbot(account) &&
        !isUserbotOnDeadProxy(account)
    ) || null;
}

async function loadOwnedUserbot(supabase, ownerId, userbotId = null) {
    if (!userbotId) {
        return loadLatestUserbot(supabase, ownerId);
    }

    const reservedUserbotIds = await loadReservedUserbotIds(supabase, ownerId);
    if (reservedUserbotIds.has(String(userbotId))) {
        return null;
    }

    const { data, error } = await supabase
        .from('tg_accounts')
        .select('*, proxies(id, name, host, port, username, password, is_working, provision_source, inventory_group, last_check_country, last_check_country_code)')
        .eq('owner_id', ownerId)
        .eq('account_type', 'userbot')
        .eq('id', userbotId)
        .limit(1);

    if (error) throw error;
    return data?.[0] || null;
}

function isUserbotOnDeadProxy(userbot) {
    return !!(userbot?.proxy_id && userbot?.proxies?.is_working === false);
}

function getDeadProxyMessage() {
    return 'У этого юзербота сдох прокси. Пока не перепривяжешь его к живому, аккаунт считается неактивным.';
}

function getFailoverCooldownMessage(retryAfterMs = 0) {
    const minutes = Math.max(1, Math.ceil(retryAfterMs / 60000));
    return `Прокси сдох, но авто-переезд уже недавно срабатывал. Подожди еще примерно ${minutes} мин. или перепривяжи аккаунт вручную.`;
}

function isExpiredUserbotSessionError(error) {
    const raw = String(error?.errorMessage || error?.message || '');
    return raw.includes('AUTH_KEY_UNREGISTERED') || raw.includes('SESSION_REVOKED');
}

function sanitizeUserbotImportError(error) {
    const raw = String(error?.message || error || '').trim();
    const lowered = raw.toLowerCase();

    if (isExpiredUserbotSessionError(error)) {
        return {
            statusCode: 400,
            message: 'Этот `.session` уже мертвый. Нужен свежий логин через QR или новый комплект `.session + .json`.'
        };
    }

    if (lowered.includes('sqlite') || lowered.includes('auth_key') || lowered.includes('конвертации ключа')) {
        return {
            statusCode: 400,
            message: 'Файл `.session` не удалось прочитать как Telegram session.'
        };
    }

    if (lowered.includes('json')) {
        return {
            statusCode: 400,
            message: 'Файл `.json` поврежден или не подходит для безопасного импорта.'
        };
    }

    if (lowered.includes('file too large') || lowered.includes('размер')) {
        return {
            statusCode: 400,
            message: 'Файл слишком большой. Для импорта поддерживаем только нормальный `.session` и компактный `.json`.'
        };
    }

    if (raw.includes('только через прокси') || raw.includes('На Trial')) {
        return {
            statusCode: 400,
            message: raw
        };
    }

    return {
        statusCode: 500,
        message: 'Импорт не прошел. Проверь `.session`, `.json` и прокси, затем попробуй снова.'
    };
}

function isMissingRecoveryTable(error) {
    const raw = String(error?.message || error || '').toLowerCase();
    return raw.includes('userbot_restore_sources') && (
        raw.includes('does not exist') ||
        raw.includes('relation') ||
        raw.includes('column')
    );
}

function normalizeMessageDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number') {
        const date = new Date(value * 1000);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function detectSalesSignal(text = '') {
    const value = String(text || '').toLowerCase();
    if (!value.trim()) return false;

    const keywords = [
        'куп', 'покуп', 'куплю', 'хочу', 'интерес', 'интересно',
        'цена', 'сколько', 'оплат', 'оплачу', 'ton', 'usdt',
        'доступ', 'продл', 'подписк', 'как купить', 'как оплатить'
    ];

    return keywords.some(keyword => value.includes(keyword));
}

function sleep(ms) {
    const safeMs = Number(ms);
    if (!Number.isFinite(safeMs) || safeMs <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, safeMs));
}

function newestTimestamp(...values) {
    const timestamps = values
        .filter(Boolean)
        .map(value => new Date(value).getTime())
        .filter(value => Number.isFinite(value));
    if (timestamps.length === 0) return null;
    return new Date(Math.max(...timestamps)).toISOString();
}

function parseTelegramInvite(rawValue = '') {
    const value = String(rawValue || '').trim();
    if (!value) return null;

    // Strip leading @ and any t.me/ prefix wrappers so we end up with
    // the canonical identifier.
    const stripped = value
        .replace(/^@/, '')
        .replace(/^(https?:\/\/)?t\.me\//i, '')
        .replace(/^(https?:\/\/)?telegram\.me\//i, '')
        .replace(/\/+$/, '')
        .trim();

    // t.me/+hash or t.me/joinchat/hash → invite hash
    const plusMatch = value.match(/(?:https?:\/\/)?t\.me\/\+([A-Za-z0-9_-]+)/i)
        || value.match(/^@(?:joinchat)\+(.+)$/i);
    if (plusMatch) {
        return { kind: 'invite_hash', value: plusMatch[1] };
    }

    const joinchatMatch = value.match(/(?:https?:\/\/)?t\.me\/joinchat\/([A-Za-z0-9_-]+)/i);
    if (joinchatMatch) {
        return { kind: 'invite_hash', value: joinchatMatch[1] };
    }

    // t.me/s/<username> (web embed/preview view) — strip the /s/ and treat
    // as public username.
    const sMatch = value.match(/(?:https?:\/\/)?t\.me\/s\/([A-Za-z0-9_]{5,})/i);
    if (sMatch) {
        return { kind: 'username', value: sMatch[1] };
    }

    // t.me/c/<id> — private permalink. Can't "join" via this link; needs
    // an invite hash. Surface a clear error.
    const privatePermalinkMatch = value.match(/(?:https?:\/\/)?t\.me\/c\/(\d+)/i);
    if (privatePermalinkMatch) {
        return { kind: 'private_permalink', value: privatePermalinkMatch[1] };
    }

    // Public username from t.me/<username> or bare <username>.
    // Telegram usernames: 5+ chars, alphanumeric + underscore, must start
    // with a letter. We're permissive on first char to allow namespace
    // expansions, but require the canonical charset.
    const usernameFromUrlMatch = value.match(/(?:https?:\/\/)?t\.me\/([A-Za-z][A-Za-z0-9_]{4,})\/?$/i);
    if (usernameFromUrlMatch) {
        return { kind: 'username', value: usernameFromUrlMatch[1] };
    }

    // Bare username (e.g. "@mygroup" or "mygroup") — only accept if it
    // looks like a real username, not a random URL fragment.
    if (!/\s/.test(value) && /^[A-Za-z][A-Za-z0-9_]{4,}$/.test(stripped)) {
        return { kind: 'username', value: stripped };
    }

    return null;
}

async function loadOperationalUserbot(supabase, ownerId, userbotId = null, options = {}) {
    const userbot = await loadOwnedUserbot(supabase, ownerId, userbotId);
    if (!userbot) {
        return { userbot: null, error: 'Юзербот не подключен.' };
    }

    if (isFreshImportedUserbot(userbot) && options.allowPendingActivation !== true) {
        return { userbot: null, error: FRESH_IMPORT_RUNTIME_REASON };
    }

    if (isUserbotOnDeadProxy(userbot)) {
        if (options.allowFailover !== true) {
            return { userbot: null, error: getDeadProxyMessage() };
        }
        try {
            // api_id/api_hash подставляет конструктор UserbotService из дефолтного отпечатка.
            const service = new UserbotService(supabase);
            const failover = await service.tryAutoFailoverUserbot(userbot);
            if (failover.switched) {
                return { userbot: failover.account, error: null };
            }
            if (failover.reason === 'cooldown') {
                return { userbot: null, error: getFailoverCooldownMessage(failover.retry_after_ms) };
            }
        } catch (error) {
            console.error('Ошибка авто-переключения прокси:', error);
        }

        return { userbot: null, error: getDeadProxyMessage() };
    }

    return { userbot, error: null };
}

export {
    isUserbotDmEnabled,
    buildCheckResponse,
    withTimeout,
    storeUserbotProfilePhoto,
    userbotProfileSyncCooldown,
    shouldStoreRecoverySource,
    isUserbotOnDeadProxy,
    getDeadProxyMessage,
    getFailoverCooldownMessage,
    isExpiredUserbotSessionError,
    sanitizeUserbotImportError,
    isMissingRecoveryTable,
    normalizeMessageDate,
    detectSalesSignal,
    sleep,
    newestTimestamp,
    parseTelegramInvite,
    loadOperationalUserbot
};
