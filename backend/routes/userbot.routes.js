import express from 'express';
import { UserbotService } from '../services/userbot.service.js';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { CustomFile } from 'telegram/client/uploads.js';
import multer from 'multer';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';
import { ManagedProxyService } from '../services/managed-proxy.service.js';
import { enforceOwnedProxyQuota, enforceUserbotQuota, getTierRules } from '../utils/product-tier.js';
import { logTelegramErrorEvent } from '../utils/telegram-error-events.js';
import { cleanupRestrictedUserbotProxy, unpublishRestrictedUserbotListings } from '../utils/restricted-userbot-ops.js';

// Настраиваем загрузку файлов во временную папку сервера
const upload = multer({
    dest: os.tmpdir(),
    limits: {
        files: 2,
        fileSize: 2 * 1024 * 1024
    },
    fileFilter: (_req, file, callback) => {
        const field = String(file?.fieldname || '').trim();
        const name = String(file?.originalname || '').trim().toLowerCase();

        if (field === 'sessionFile') {
            callback(null, name.endsWith('.session'));
            return;
        }

        if (field === 'jsonFile') {
            callback(null, name.endsWith('.json'));
            return;
        }

        callback(null, false);
    }
});

const avatarUpload = multer({
    dest: os.tmpdir(),
    limits: {
        files: 1,
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (_req, file, callback) => {
        const mime = String(file?.mimetype || '').toLowerCase();
        if (['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
            callback(null, true);
            return;
        }
        callback(null, false);
    }
});
const MAX_MANAGED_PROXIES_PER_ADMIN = 32;
const MAX_MANAGED_PROXIES_GLOBAL = 96;
const DEFAULT_ADMIN_PROXY_GROUP = 'shop_sale';
const TRIAL_PROXY_LEASE_HOURS = 24;
const FRESH_IMPORT_RUNTIME_STATUS = 'pending_activation';
const FRESH_IMPORT_RUNTIME_REASON = 'Свежий импорт. Аккаунт в safe-mode: автоматика и живые Telegram-действия отключены до ручной активации.';
const USERBOT_PROFILE_SYNC_COOLDOWN_MS = 10 * 60 * 1000;
const USERBOT_PROFILE_UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'userbot-profiles');
const USERBOT_CENTER_DIALOG_LIMIT = Number(process.env.USERBOT_CENTER_DIALOG_LIMIT || 80);
const USERBOT_CENTER_ADMIN_CHECK_DELAY_MS = Number(process.env.USERBOT_CENTER_ADMIN_CHECK_DELAY_MS || 350);

function isUserbotDmEnabled() {
    return String(process.env.USERBOT_DM_ENABLED || '').trim().toLowerCase() === 'true';
}

function isFreshImportedUserbot(userbot) {
    return String(userbot?.runtime_status || '').trim().toLowerCase() === FRESH_IMPORT_RUNTIME_STATUS;
}

function buildCheckResponse(status, reason = null, details = null, extra = {}) {
    return {
        status,
        reason: reason || null,
        details: details || null,
        ...extra
    };
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

function profilePhotoExtensionFromFile(file) {
    const mime = String(file?.mimetype || '').toLowerCase();
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/jpeg') return 'jpg';
    return safePhotoExtension(path.extname(file?.originalname || ''));
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

function storeUserbotProfilePhotoFromPath({ ownerId, accountId, filePath, extension }) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const photo = fs.readFileSync(filePath);
    return storeUserbotProfilePhoto({ ownerId, accountId, photo, extension });
}

function buildTelegramProfilePatch(me, extra = {}) {
    const firstName = String(me?.firstName || '').trim() || null;
    const lastName = String(me?.lastName || '').trim() || null;
    return {
        tg_account_id: me?.id ? me.id.toString() : null,
        tg_username: me?.username || firstName || null,
        tg_first_name: firstName,
        tg_last_name: lastName,
        tg_phone: String(me?.phone || '').trim() || null,
        ...extra
    };
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

function normalizeEditableTelegramProfile(raw = {}) {
    const firstName = String(raw.first_name ?? raw.firstName ?? '').trim();
    const lastName = String(raw.last_name ?? raw.lastName ?? '').trim();
    const about = String(raw.about ?? '').trim();

    if (!firstName) {
        throw new Error('Имя Telegram-аккаунта не может быть пустым.');
    }
    if (firstName.length > 64) {
        throw new Error('Имя слишком длинное. Telegram обычно принимает до 64 символов.');
    }
    if (lastName.length > 64) {
        throw new Error('Фамилия слишком длинная. Telegram обычно принимает до 64 символов.');
    }
    if (about.length > 70) {
        throw new Error('Описание слишком длинное. Telegram bio обычно принимает до 70 символов.');
    }

    return {
        firstName,
        lastName,
        about
    };
}

function buildUserbotCenterAccount(item, runtimeState = null) {
    return {
        id: item.id,
        tg_username: item.tg_username || null,
        tg_account_id: item.tg_account_id || null,
        tg_first_name: item.tg_first_name || null,
        tg_last_name: item.tg_last_name || null,
        tg_phone: item.tg_phone || null,
        tg_about: item.tg_about || null,
        tg_photo_url: item.tg_photo_url || null,
        tg_photo_synced_at: item.tg_photo_synced_at || null,
        tg_photo_data_url: item.tg_photo_data_url || null,
        tg_profile_synced_at: item.tg_profile_synced_at || null,
        tg_profile_sync_attempted_at: item.tg_profile_sync_attempted_at || null,
        tg_profile_sync_error: item.tg_profile_sync_error || null,
        proxy_id: item.proxy_id || null,
        proxy_name: item.proxies?.name || null,
        proxy_country: item.proxies?.last_check_country || null,
        proxy_is_working: item.proxies?.is_working ?? null,
        runtime_status: runtimeState?.status || item.runtime_status || null,
        runtime_reason: runtimeState?.reason || item.runtime_error || null
    };
}

function buildUserbotCenterSignalConfig(paymentSettings, officialBots = []) {
    const opsBot = (officialBots || []).find(item => (item.bot_role || 'sales') === 'ops') || null;
    return {
        admin_tg_id: paymentSettings?.admin_tg_id ? String(paymentSettings.admin_tg_id) : '',
        has_admin_tg_id: !!paymentSettings?.admin_tg_id,
        ops_bot_count: (officialBots || []).filter(item => (item.bot_role || 'sales') === 'ops').length,
        sales_bot_count: (officialBots || []).filter(item => (item.bot_role || 'sales') !== 'ops').length,
        ops_bot: opsBot
            ? {
                id: opsBot.id,
                tg_username: opsBot.tg_username || null,
                tg_account_id: opsBot.tg_account_id || null
            }
            : null,
        ready: !!paymentSettings?.admin_tg_id && !!opsBot
    };
}

function buildUserbotCenterSummary(groups = [], conversations = []) {
    return {
        groups_total: groups.length,
        groups_admin: groups.filter(group => group.userbot_admin).length,
        linked_groups: groups.filter(group => group.linked_channel_id).length,
        open_dialogs: conversations.length,
        unread_dialogs: conversations.filter(item => item.unread_count > 0).length,
        sales_signals: conversations.filter(item => item.sales_signal).length,
        signaled_dialogs: conversations.filter(item => item.signal_notified_at).length
    };
}

function resolveBatchKickCallSource(...rawValues) {
    const normalized = rawValues
        .map((value) => String(value || '').trim().toLowerCase())
        .find(Boolean) || '';

    if (['customers', 'customer', 'customers_workbench', 'customer_workbench'].includes(normalized)) {
        return {
            requestSource: 'customers',
            payloadSource: 'customers',
            eventSource: 'customers_manual_admin_removed',
            accessNote: 'Удален админом вручную из Customers',
            removalKind: 'manual_admin_removed',
            shouldExpireSubscription: true
        };
    }

    return {
        requestSource: normalized || 'legacy',
        payloadSource: normalized || 'access_screen',
        eventSource: 'manual_batch',
        accessNote: 'Кикнули пачкой из админки',
        removalKind: null,
        shouldExpireSubscription: false
    };
}

function normalizeFingerprintPayload(raw = {}) {
    const input = raw && typeof raw === 'object' ? raw : {};
    return {
        label: String(input.label || '').trim(),
        note: String(input.note || '').trim(),
        api_id: Number(input.api_id || 0),
        api_hash: String(input.api_hash || '').trim(),
        device_model: String(input.device_model || input.deviceModel || '').trim(),
        system_version: String(input.system_version || input.systemVersion || '').trim(),
        app_version: String(input.app_version || input.appVersion || '').trim(),
        system_lang_code: String(input.system_lang_code || input.systemLangCode || '').trim(),
        lang_code: String(input.lang_code || input.langCode || '').trim()
    };
}

function validateCustomFingerprintPayload(fingerprint = {}) {
    if (!fingerprint.label) {
        throw new Error('Назови свой fingerprint-пресет, чтобы потом не гадать, что это за профиль.');
    }
    if (!Number.isInteger(fingerprint.api_id) || fingerprint.api_id <= 0) {
        throw new Error('Для своего fingerprint укажи нормальный api_id.');
    }
    if (!fingerprint.api_hash) {
        throw new Error('Для своего fingerprint укажи api_hash.');
    }
    if (!fingerprint.device_model) {
        throw new Error('Для своего fingerprint укажи модель устройства.');
    }
    if (!fingerprint.system_version) {
        throw new Error('Для своего fingerprint укажи версию системы.');
    }
    if (!fingerprint.app_version) {
        throw new Error('Для своего fingerprint укажи версию Telegram app.');
    }
    if (!fingerprint.system_lang_code) {
        throw new Error('Для своего fingerprint укажи system_lang_code.');
    }
    if (!fingerprint.lang_code) {
        throw new Error('Для своего fingerprint укажи lang_code.');
    }
}

function normalizeProxyProtocol(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'socks5';
    if (raw === 'socks5' || raw === 'socks5h' || raw === 'socks') return 'socks5';
    if (raw === 'http' || raw === 'https') return 'http';
    return raw;
}

function isLikelyIpv4Host(value = '') {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(String(value || '').trim());
}

function isLikelyProxyAddress(value = '') {
    const match = String(value || '').trim().match(/^([^:\s]+):(\d{2,5})$/);
    if (!match) return false;
    const port = Number.parseInt(match[2], 10);
    return Number.isInteger(port) && port > 0 && port <= 65535;
}

function isLikelyDateToken(value = '') {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function isLikelyTimeToken(value = '') {
    return /^\d{2}:\d{2}$/.test(String(value || '').trim());
}

function isIgnorableProxyPasteLine(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return true;
    return [
        'ipv6',
        'ipv6:',
        'socks',
        'socks:',
        'http',
        'http:',
        'https',
        'https:',
        'status',
        'добавить комментарий'
    ].includes(normalized);
}

function parseProxyPasteInput(rawInput = '') {
    const raw = String(rawInput || '').trim();
    if (!raw) {
        throw new Error('Вставь строку с proxy. Подойдут host:port:user:pass, user:pass@host:port или URL вида socks5://user:pass@host:port.');
    }

    const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const compact = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ');

    const keyValuePattern = /(?:^|\s)(host|ip|server|addr|address|port|user|username|login|pass|password|protocol|scheme)\s*[:=]\s*([^\s]+)/gi;
    const bag = {};
    let matchedKeyValue = false;
    let match;
    while ((match = keyValuePattern.exec(compact))) {
        matchedKeyValue = true;
        bag[match[1].toLowerCase()] = match[2];
    }

    if (matchedKeyValue) {
        const host = bag.host || bag.ip || bag.server || bag.addr || bag.address || '';
        const port = Number.parseInt(bag.port, 10);
        const username = bag.user || bag.username || bag.login || '';
        const password = bag.pass || bag.password || '';
        const protocol = normalizeProxyProtocol(bag.protocol || bag.scheme || 'socks5');

        if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
            throw new Error('Не удалось разобрать proxy из вставленного текста. Нужны хотя бы host и port.');
        }

        return {
            protocol,
            host,
            port,
            username: username || null,
            password: password || null,
            raw
        };
    }

    const socksLineIndex = lines.findIndex((line) => /^socks\s*:\s*$/i.test(line));
    if (socksLineIndex >= 0) {
        const hostPortLine = lines[socksLineIndex + 1] || '';
        if (isLikelyProxyAddress(hostPortLine)) {
            const hostPortMatch = hostPortLine.match(/^([^:\s]+):(\d{2,5})$/);
            const host = hostPortMatch?.[1] || '';
            const port = Number.parseInt(hostPortMatch?.[2] || '', 10);
            const filteredTail = lines
                .slice(socksLineIndex + 2)
                .filter((line) => !isIgnorableProxyPasteLine(line))
                .filter((line) => !isLikelyDateToken(line))
                .filter((line) => !isLikelyTimeToken(line))
                .filter((line) => !line.includes(':'));

            const credentials = filteredTail.filter((line) => /^[a-z0-9_\-.!@#$%^&*+=?]+$/i.test(line));
            const username = credentials[0] || null;
            const password = credentials[1] || null;

            return {
                protocol: 'socks5',
                host,
                port,
                username,
                password,
                raw
            };
        }
    }

    const urlLike = compact.match(/^(?:(socks5h?|https?):\/\/)?(?:(.+?):(.+?)@)?([^:\s@]+):(\d{2,5})$/i);
    if (urlLike) {
        const [, scheme, username, password, host, portRaw] = urlLike;
        const port = Number.parseInt(portRaw, 10);
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
            throw new Error('Порт proxy выглядит битым. Проверь строку и попробуй еще раз.');
        }
        return {
            protocol: normalizeProxyProtocol(scheme || 'socks5'),
            host,
            port,
            username: username || null,
            password: password || null,
            raw
        };
    }

    const parts = compact
        .split(/[:\s]+/)
        .filter(Boolean)
        .filter((part) => !isIgnorableProxyPasteLine(part))
        .filter((part) => !isLikelyDateToken(part))
        .filter((part) => !isLikelyTimeToken(part))
        .filter((part) => !/^[0-9]+$/.test(part) || part.length > 5)
        .filter((part) => !/^[a-f0-9:]{8,}$/i.test(part) || !part.includes(':'));

    if (parts.length === 4) {
        const [host, portRaw, username, password] = parts;
        const port = Number.parseInt(portRaw, 10);
        if (!isLikelyIpv4Host(host) || !Number.isInteger(port) || port <= 0 || port > 65535) {
            throw new Error('Порт proxy выглядит битым. Проверь строку и попробуй еще раз.');
        }
        return {
            protocol: 'socks5',
            host,
            port,
            username: username || null,
            password: password || null,
            raw
        };
    }

    if (parts.length === 2) {
        const [host, portRaw] = parts;
        const port = Number.parseInt(portRaw, 10);
        if (!isLikelyIpv4Host(host) || !Number.isInteger(port) || port <= 0 || port > 65535) {
            throw new Error('Порт proxy выглядит битым. Проверь строку и попробуй еще раз.');
        }
        return {
            protocol: 'socks5',
            host,
            port,
            username: null,
            password: null,
            raw
        };
    }

    throw new Error('Не понял формат proxy. Поддерживаются host:port:user:pass, user:pass@host:port и URL вроде socks5://user:pass@host:port.');
}

function normalizeAdminInventoryGroup(value, fallback = DEFAULT_ADMIN_PROXY_GROUP) {
    if (value === 'self_use') return 'self_use';
    if (value === 'shop_sale') return 'shop_sale';
    return fallback;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function buildManagedProxyPendingMessage() {
    return 'Сервер поднимает прокси и гоняет фоновую проверку Telegram. Подожди немного и обнови список.';
}

function launchManagedProxyVerification({
    supabase,
    userbotService,
    ownerId,
    proxyId,
    host,
    port,
    username,
    password
}) {
    void (async () => {
        let health = { success: false, error: 'Прокси еще не успел прогреться' };

        for (let attempt = 1; attempt <= 3; attempt += 1) {
            if (attempt > 1) {
                await wait(4000);
            }

            health = await userbotService.checkProxy({
                host,
                port,
                username,
                password,
                provision_source: 'manual_admin'
            });

            if (health.success) {
                break;
            }
        }

        if (health.success) {
            const updatePayload = {
                is_working: true,
                last_checked_at: new Date().toISOString(),
                last_check_ip: health.ip || null,
                last_check_country: health.country || null,
                last_check_city: health.city || null,
                last_check_isp: health.isp || null,
                last_check_error: null
            };

            if ('countryCode' in health) {
                updatePayload.last_check_country_code = health.countryCode || null;
            }

            const { error } = await supabase
                .from('proxies')
                .update(updatePayload)
                .eq('id', proxyId)
                .eq('owner_id', ownerId);

            if (error) {
                console.error('Не удалось обновить статус managed proxy после фоновой проверки:', error);
            }
            return;
        }

        const { error } = await supabase
            .from('proxies')
            .update({
                is_working: false,
                last_checked_at: new Date().toISOString(),
                last_check_error: health.error || 'Фоновая проверка не прошла'
            })
            .eq('id', proxyId)
            .eq('owner_id', ownerId);

        if (error) {
            console.error('Не удалось сохранить ошибку фоновой проверки managed proxy:', error);
        }
    })().catch((error) => {
        console.error('Фоновая проверка managed proxy упала:', error);
    });
}

function cleanupUploadedFiles(files = []) {
    for (const file of files) {
        if (file?.path && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }
    }
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

async function loadOwnedProxy(supabase, ownerId, proxyId) {
    if (!proxyId) return null;
    const { data, error } = await supabase
        .from('proxies')
        .select('*')
        .eq('id', proxyId)
        .eq('owner_id', ownerId)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

function isMissingProxyProvisionColumn(error) {
    const raw = String(error?.message || error || '').toLowerCase();
    return raw.includes('provision_source') && (
        raw.includes('does not exist') ||
        raw.includes('column') ||
        raw.includes('relation')
    );
}

function isMissingProxyInventoryGroupColumn(error) {
    const raw = String(error?.message || error || '').toLowerCase();
    return raw.includes('inventory_group') && (
        raw.includes('does not exist') ||
        raw.includes('column') ||
        raw.includes('relation')
    );
}

async function supportsProxyProvisionSource(supabase) {
    const { error } = await supabase
        .from('proxies')
        .select('provision_source')
        .limit(1);

    if (!error) return true;
    if (isMissingProxyProvisionColumn(error)) return false;
    throw error;
}

async function supportsProxyInventoryGroup(supabase) {
    const { error } = await supabase
        .from('proxies')
        .select('inventory_group')
        .limit(1);

    if (!error) return true;
    if (isMissingProxyInventoryGroupColumn(error)) return false;
    throw error;
}

async function countManualFreeProxies(supabase, ownerId, sourceSupported) {
    const query = supabase
        .from('proxies')
        .select('id')
        .eq('owner_id', ownerId);

    if (sourceSupported) {
        query.eq('provision_source', 'manual_free');
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).length;
}

async function countOwnedManualProxies(supabase, ownerId, sourceSupported) {
    const query = supabase
        .from('proxies')
        .select('id')
        .eq('owner_id', ownerId);

    if (sourceSupported) {
        query.eq('provision_source', 'manual_owned');
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).length;
}

async function loadFreeProxyClaimState(supabase, ownerId) {
    try {
        const { data, error } = await supabase.auth.admin.getUserById(ownerId);
        if (error) throw error;
        const claimedAt = data?.user?.app_metadata?.free_proxy_claimed_at || null;
        return {
            claimed: !!claimedAt,
            claimed_at: claimedAt
        };
    } catch (error) {
        console.error('Не удалось загрузить состояние старой выдачи прокси:', error);
        return {
            claimed: false,
            claimed_at: null
        };
    }
}

function buildTrialLeaseFromMetadata(appMetadata = {}) {
    const lease = appMetadata?.trial_proxy_lease;
    if (!lease || typeof lease !== 'object') {
        return {
            proxy_id: null,
            original_owner_id: null,
            claimed_at: null,
            expires_at: null,
            reclaimed_at: null
        };
    }

    return {
        proxy_id: lease.proxy_id || null,
        original_owner_id: lease.original_owner_id || null,
        claimed_at: lease.claimed_at || null,
        expires_at: lease.expires_at || null,
        reclaimed_at: lease.reclaimed_at || null
    };
}

async function loadUserMetadata(supabase, ownerId) {
    const { data, error } = await supabase.auth.admin.getUserById(ownerId);
    if (error) throw error;
    const appMetadata = data?.user?.app_metadata && typeof data.user.app_metadata === 'object'
        ? data.user.app_metadata
        : {};
    return { user: data?.user || null, appMetadata };
}

async function persistUserMetadata(supabase, ownerId, appMetadata) {
    const { error } = await supabase.auth.admin.updateUserById(ownerId, { app_metadata: appMetadata });
    if (error) throw error;
}

async function saveTrialProxyLease(supabase, ownerId, leasePatch) {
    const { appMetadata } = await loadUserMetadata(supabase, ownerId);
    const currentLease = buildTrialLeaseFromMetadata(appMetadata);
    await persistUserMetadata(supabase, ownerId, {
        ...appMetadata,
        free_proxy_claimed_at: appMetadata.free_proxy_claimed_at || leasePatch.claimed_at || new Date().toISOString(),
        trial_proxy_lease: {
            ...currentLease,
            ...leasePatch
        }
    });
}

function isLeaseExpired(expiresAt) {
    if (!expiresAt) return false;
    const expiresTs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresTs)) return false;
    return expiresTs <= Date.now();
}

async function reconcileExpiredTrialProxyLease(supabase, ownerId, profile) {
    const rules = getTierRules(profile);
    const { appMetadata } = await loadUserMetadata(supabase, ownerId);
    const lease = buildTrialLeaseFromMetadata(appMetadata);

    if (!lease.proxy_id || !lease.original_owner_id || !lease.expires_at || lease.reclaimed_at) {
        return {
            lease,
            expired: isLeaseExpired(lease.expires_at),
            reclaimed: false
        };
    }

    if (!isLeaseExpired(lease.expires_at)) {
        return {
            lease,
            expired: false,
            reclaimed: false
        };
    }

    const sourceSupported = await supportsProxyProvisionSource(supabase);
    const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);
    const { data: proxy, error: proxyError } = await supabase
        .from('proxies')
        .select('id, owner_id')
        .eq('id', lease.proxy_id)
        .maybeSingle();

    if (proxyError) throw proxyError;

    if (proxy?.owner_id === ownerId) {
        const updatePayload = {
            owner_id: lease.original_owner_id
        };
        if (sourceSupported) {
            updatePayload.provision_source = 'manual_admin';
        }
        if (inventoryGroupSupported) {
            updatePayload.inventory_group = 'site_free_pool';
        }

        const { error: reclaimError } = await supabase
            .from('proxies')
            .update(updatePayload)
            .eq('id', lease.proxy_id)
            .eq('owner_id', ownerId);

        if (reclaimError) throw reclaimError;

        await supabase
            .from('tg_accounts')
            .update({
                proxy_id: null,
                allow_proxy_failover: false,
                failover_proxy_ids: []
            })
            .eq('owner_id', ownerId)
            .eq('account_type', 'userbot')
            .eq('proxy_id', lease.proxy_id);
    }

    const nextLease = {
        ...lease,
        reclaimed_at: new Date().toISOString()
    };

    await persistUserMetadata(supabase, ownerId, {
        ...appMetadata,
        trial_proxy_lease: nextLease
    });

    return {
        lease: nextLease,
        expired: true,
        reclaimed: true,
        canUseTrialProxy: !!rules.canUseTrialProxy
    };
}

async function markFreeProxyClaimed(supabase, ownerId) {
    const { data, error } = await supabase.auth.admin.getUserById(ownerId);
    if (error) throw error;

    const currentAppMetadata = data?.user?.app_metadata && typeof data.user.app_metadata === 'object'
        ? data.user.app_metadata
        : {};

    if (currentAppMetadata.free_proxy_claimed_at) {
        return currentAppMetadata.free_proxy_claimed_at;
    }

    const claimedAt = new Date().toISOString();
    const { error: updateError } = await supabase.auth.admin.updateUserById(ownerId, {
        app_metadata: {
            ...currentAppMetadata,
            free_proxy_claimed_at: claimedAt
        }
    });
    if (updateError) throw updateError;
    return claimedAt;
}

async function loadAvailableSiteFreeProxy(supabase, sourceSupported, inventoryGroupSupported) {
    const { data: adminProfiles, error: adminError } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin');

    if (adminError) throw adminError;

    const adminIds = (adminProfiles || []).map((row) => row.id).filter(Boolean);
    if (!adminIds.length) return null;

    const selectColumns = [
        'id',
        'owner_id',
        'name',
        'host',
        'port',
        'username',
        'password',
        'is_working',
        'last_check_country',
        'last_check_country_code'
    ];

    if (sourceSupported) selectColumns.push('provision_source');
    if (inventoryGroupSupported) selectColumns.push('inventory_group');

    const { data: proxies, error: proxiesError } = await supabase
        .from('proxies')
        .select(selectColumns.join(', '))
        .in('owner_id', adminIds)
        .order('created_at', { ascending: true });

    if (proxiesError) throw proxiesError;

    const { data: userbots, error: userbotsError } = await supabase
        .from('tg_accounts')
        .select('proxy_id')
        .eq('account_type', 'userbot')
        .in('owner_id', adminIds);

    if (userbotsError) throw userbotsError;

    const usedProxyIds = new Set((userbots || []).map((row) => String(row.proxy_id)).filter(Boolean));

    const available = (proxies || []).filter((proxy) => {
        const source = sourceSupported ? (proxy.provision_source || 'manual_free') : 'manual_free';
        const inventoryGroup = inventoryGroupSupported
            ? (proxy.inventory_group || (source === 'manual_admin' ? DEFAULT_ADMIN_PROXY_GROUP : null))
            : (source === 'manual_admin' ? DEFAULT_ADMIN_PROXY_GROUP : null);

        return source === 'manual_admin'
            && inventoryGroup === 'site_free_pool'
            && proxy.is_working !== false
            && !usedProxyIds.has(String(proxy.id));
    });

    return available[0] || null;
}

async function loadAvailableShopSaleProxies(supabase, sourceSupported, inventoryGroupSupported, limit = 6) {
    const { data: adminProfiles, error: adminError } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin');

    if (adminError) throw adminError;

    const adminIds = (adminProfiles || []).map((row) => row.id).filter(Boolean);
    if (!adminIds.length) return [];

    const selectColumns = [
        'id',
        'owner_id',
        'name',
        'host',
        'port',
        'is_working',
        'last_check_country',
        'last_check_country_code',
        'last_check_city'
    ];

    if (sourceSupported) selectColumns.push('provision_source');
    if (inventoryGroupSupported) selectColumns.push('inventory_group');

    const { data: proxies, error: proxiesError } = await supabase
        .from('proxies')
        .select(selectColumns.join(', '))
        .in('owner_id', adminIds)
        .order('created_at', { ascending: false });

    if (proxiesError) throw proxiesError;

    const { data: userbots, error: userbotsError } = await supabase
        .from('tg_accounts')
        .select('proxy_id')
        .eq('account_type', 'userbot')
        .in('owner_id', adminIds);

    if (userbotsError) throw userbotsError;

    const usedProxyIds = new Set((userbots || []).map((row) => String(row.proxy_id)).filter(Boolean));

    return (proxies || [])
        .filter((proxy) => {
            const source = sourceSupported ? (proxy.provision_source || 'manual_free') : 'manual_free';
            const inventoryGroup = inventoryGroupSupported
                ? (proxy.inventory_group || (source === 'manual_admin' ? DEFAULT_ADMIN_PROXY_GROUP : null))
                : (source === 'manual_admin' ? DEFAULT_ADMIN_PROXY_GROUP : null);

            return source === 'manual_admin'
                && inventoryGroup === 'shop_sale'
                && proxy.is_working !== false
                && !usedProxyIds.has(String(proxy.id));
        })
        .slice(0, limit)
        .map((proxy) => ({
            id: proxy.id,
            name: proxy.name,
            host: proxy.host,
            port: proxy.port,
            last_check_country: proxy.last_check_country || null,
            last_check_country_code: proxy.last_check_country_code || null,
            last_check_city: proxy.last_check_city || null
        }));
}

async function countUserbotsOnProxy(supabase, ownerId, proxyId, ignoreAccountId = null) {
    if (!proxyId) return 0;

    const query = supabase
        .from('tg_accounts')
        .select('id')
        .eq('owner_id', ownerId)
        .eq('account_type', 'userbot')
        .eq('proxy_id', proxyId);

    if (ignoreAccountId) {
        query.neq('id', ignoreAccountId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).length;
}

async function ensureExclusiveProxyAssignment(supabase, ownerId, proxyId, ignoreAccountId = null) {
    const count = await countUserbotsOnProxy(supabase, ownerId, proxyId, ignoreAccountId);
    if (count >= 1) {
        throw new Error('Один прокси = один юзербот. Этот прокси уже занят другим аккаунтом.');
    }
}

async function ensureUserbotNotOwnedByAnotherAdmin(supabase, ownerId, tgAccountId, ignoreAccountId = null) {
    if (!tgAccountId) return;

    const query = supabase
        .from('tg_accounts')
        .select('id, owner_id')
        .eq('account_type', 'userbot')
        .eq('tg_account_id', String(tgAccountId))
        .neq('owner_id', ownerId)
        .limit(1);

    if (ignoreAccountId) {
        query.neq('id', ignoreAccountId);
    }

    const { data, error } = await query;
    if (error) throw error;

    if ((data || []).length > 0) {
        throw new Error('Этот юзербот уже подключен у другого админа. Один Telegram-аккаунт нельзя использовать в двух кабинетах.');
    }
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

async function loadUserbotCenterCache(supabase, ownerId, userbotId) {
    const [{ data: groupRows, error: groupError }, { data: conversationRows, error: conversationError }] = await Promise.all([
        supabase
            .from('userbot_center_group_cache')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('userbot_id', userbotId)
            .order('userbot_admin', { ascending: false })
            .order('unread_count', { ascending: false })
            .order('last_message_at', { ascending: false, nullsFirst: false }),
        supabase
            .from('userbot_center_conversation_cache')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('userbot_id', userbotId)
            .order('sales_signal', { ascending: false })
            .order('unread_count', { ascending: false })
            .order('last_message_at', { ascending: false, nullsFirst: false })
    ]);

    if (groupError) throw groupError;
    if (conversationError) throw conversationError;

    const groups = (groupRows || []).map(row => ({
        chat_id: String(row.chat_id),
        title: row.title || null,
        type: row.chat_type || 'group',
        unread_count: Number(row.unread_count || 0),
        last_message_preview: row.last_message_preview || null,
        last_message_at: row.last_message_at || null,
        userbot_admin: !!row.userbot_admin,
        admin_check_skipped: !!row.admin_check_skipped,
        linked_channel_id: row.linked_channel_id || null,
        linked_channel_title: row.linked_channel_title || null,
        admin_error: row.admin_error || null,
        scanned_at: row.scanned_at || null
    }));

    const conversations = (conversationRows || []).map(row => ({
        tg_user_id: String(row.tg_user_id),
        username: row.username || null,
        display_name: row.display_name || row.username || `ID ${row.tg_user_id}`,
        unread_count: Number(row.unread_count || 0),
        last_message_preview: row.last_message_preview || null,
        last_message_at: row.last_message_at || null,
        last_outgoing: !!row.last_outgoing,
        sales_signal: !!row.sales_signal,
        signal_notified_at: row.signal_notified_at || null,
        signal_last_message_id: row.signal_last_message_id || null,
        scanned_at: row.scanned_at || null
    }));

    return {
        groups,
        conversations,
        scanned_at: newestTimestamp(
            ...groups.map(item => item.scanned_at),
            ...conversations.map(item => item.scanned_at)
        )
    };
}

async function replaceUserbotCenterCache(supabase, ownerId, userbotId, groups = [], conversations = [], scannedAt) {
    const normalizedScannedAt = scannedAt || new Date().toISOString();

    const { error: deleteGroupsError } = await supabase
        .from('userbot_center_group_cache')
        .delete()
        .eq('owner_id', ownerId)
        .eq('userbot_id', userbotId);
    if (deleteGroupsError) throw deleteGroupsError;

    const { error: deleteConversationsError } = await supabase
        .from('userbot_center_conversation_cache')
        .delete()
        .eq('owner_id', ownerId)
        .eq('userbot_id', userbotId);
    if (deleteConversationsError) throw deleteConversationsError;

    if (groups.length > 0) {
        const { error: insertGroupsError } = await supabase
            .from('userbot_center_group_cache')
            .insert(groups.map(group => ({
                owner_id: ownerId,
                userbot_id: userbotId,
                chat_id: String(group.chat_id),
                title: group.title || null,
                chat_type: group.type || 'group',
                unread_count: Number(group.unread_count || 0),
                last_message_preview: group.last_message_preview || null,
                last_message_at: group.last_message_at || null,
                userbot_admin: !!group.userbot_admin,
                admin_check_skipped: !!group.admin_check_skipped,
                linked_channel_id: group.linked_channel_id || null,
                linked_channel_title: group.linked_channel_title || null,
                admin_error: group.admin_error || null,
                scanned_at: normalizedScannedAt,
                updated_at: normalizedScannedAt
            })));
        if (insertGroupsError) throw insertGroupsError;
    }

    if (conversations.length > 0) {
        const { error: insertConversationsError } = await supabase
            .from('userbot_center_conversation_cache')
            .insert(conversations.map(conversation => ({
                owner_id: ownerId,
                userbot_id: userbotId,
                tg_user_id: String(conversation.tg_user_id),
                username: conversation.username || null,
                display_name: conversation.display_name || null,
                unread_count: Number(conversation.unread_count || 0),
                last_message_preview: conversation.last_message_preview || null,
                last_message_at: conversation.last_message_at || null,
                last_outgoing: !!conversation.last_outgoing,
                sales_signal: !!conversation.sales_signal,
                signal_notified_at: conversation.signal_notified_at || null,
                signal_last_message_id: conversation.signal_last_message_id || null,
                scanned_at: normalizedScannedAt,
                updated_at: normalizedScannedAt
            })));
        if (insertConversationsError) throw insertConversationsError;
    }
}

function parseTelegramInvite(rawValue = '') {
    const value = String(rawValue || '').trim();
    if (!value) return null;

    const plusMatch = value.match(/(?:https?:\/\/)?t\.me\/\+([A-Za-z0-9_-]+)/i);
    if (plusMatch) {
        return { kind: 'invite_hash', value: plusMatch[1] };
    }

    const joinchatMatch = value.match(/(?:https?:\/\/)?t\.me\/joinchat\/([A-Za-z0-9_-]+)/i);
    if (joinchatMatch) {
        return { kind: 'invite_hash', value: joinchatMatch[1] };
    }

    const usernameMatch = value.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{5,})\/?$/i);
    if (usernameMatch) {
        return { kind: 'username', value: usernameMatch[1] };
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
            const service = new UserbotService(supabase, 4, "014b35b6184100b085b0d0572f9b5103");
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

export default function (supabase) {
    const router = express.Router();

    const apiId = 4;
    const apiHash = "014b35b6184100b085b0d0572f9b5103";
    const userbotService = new UserbotService(supabase, apiId, apiHash);
    const managedProxyService = new ManagedProxyService();

    // ==========================================
    // 1. УПРАВЛЕНИЕ ПУЛОМ ПРОКСИ
    // ==========================================
    router.get('/proxies', authenticateUser, async (req, res) => {
        try {
            const trialLeaseState = req.profile?.role === 'admin'
                ? { lease: { expires_at: null, reclaimed_at: null }, expired: false, reclaimed: false }
                : await reconcileExpiredTrialProxyLease(supabase, req.user.id, req.profile);
            const sourceSupported = await supportsProxyProvisionSource(supabase);
            const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);
            const tierRules = getTierRules(req.profile);
            const [{ data: proxies, error: proxiesError }, { data: userbots, error: userbotsError }] = await Promise.all([
                supabase
                    .from('proxies')
                    .select([
                        '*',
                        sourceSupported ? 'provision_source' : null,
                        inventoryGroupSupported ? 'inventory_group' : null
                    ].filter(Boolean).join(', '))
                    .eq('owner_id', req.user.id)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('tg_accounts')
                    .select('id, tg_username, tg_account_id, proxy_id')
                    .eq('owner_id', req.user.id)
                    .eq('account_type', 'userbot')
            ]);
            if (proxiesError) throw proxiesError;
            if (userbotsError) throw userbotsError;

            const proxyUsage = new Map();
            for (const account of userbots || []) {
                if (!account.proxy_id) continue;
                const key = String(account.proxy_id);
                if (!proxyUsage.has(key)) proxyUsage.set(key, []);
                proxyUsage.get(key).push({
                    id: account.id,
                    tg_username: account.tg_username || null,
                    tg_account_id: account.tg_account_id || null
                });
            }

            const enrichedProxies = (proxies || []).map(proxy => {
                const linkedUserbots = proxyUsage.get(String(proxy.id)) || [];
                const provisionSource = sourceSupported ? (proxy.provision_source || 'manual_free') : 'manual_free';
                const inventoryGroup = inventoryGroupSupported
                    ? (proxy.inventory_group || (provisionSource === 'manual_admin' ? DEFAULT_ADMIN_PROXY_GROUP : null))
                    : (provisionSource === 'manual_admin' ? DEFAULT_ADMIN_PROXY_GROUP : null);
                return {
                    ...proxy,
                    username: req.profile?.role === 'admin' ? (proxy.username || null) : null,
                    password: req.profile?.role === 'admin' ? (proxy.password || null) : null,
                    provision_source: provisionSource,
                    inventory_group: inventoryGroup,
                    userbot_count: linkedUserbots.length,
                    is_safe_single_use: linkedUserbots.length <= 1,
                    linked_userbots: linkedUserbots
                };
            });

            const freeProxyClaimState = req.profile?.role === 'admin'
                ? { claimed: false, claimed_at: null }
                : await loadFreeProxyClaimState(supabase, req.user.id);
            const freeManualQuotaTotal = req.profile?.role === 'admin' ? null : 1;
            const freeManualQuotaUsed = req.profile?.role === 'admin'
                ? 0
                : await countManualFreeProxies(supabase, req.user.id, sourceSupported);
            const ownedProxyQuotaTotal = req.profile?.role === 'admin'
                ? null
                : tierRules.maxOwnedProxies;
            const ownedProxyQuotaUsed = req.profile?.role === 'admin'
                ? 0
                : await countOwnedManualProxies(supabase, req.user.id, sourceSupported);
            const siteFreePoolProxy = req.profile?.role === 'admin'
                ? null
                : await loadAvailableSiteFreeProxy(supabase, sourceSupported, inventoryGroupSupported);
            const shopSalePreview = req.profile?.role === 'admin'
                ? []
                : await loadAvailableShopSaleProxies(supabase, sourceSupported, inventoryGroupSupported);
            const managedProxySupport = req.profile?.role === 'admin'
                ? await managedProxyService.getSupport()
                : { supported: false };
            const managedProxySummary = req.profile?.role === 'admin'
                ? managedProxyService.getStateSummary()
                : { total: 0, groups: {} };

            res.json({
                proxies: enrichedProxies,
                support: {
                    profile_role: req.profile?.role || null,
                    source_supported: sourceSupported,
                    inventory_group_supported: inventoryGroupSupported,
                    can_sell_inventory: req.profile?.role === 'admin',
                    can_provision_server_inventory: req.profile?.role === 'admin',
                    free_manual_quota_total: freeManualQuotaTotal,
                    free_manual_quota_used: freeManualQuotaUsed,
                    owned_proxy_quota_total: ownedProxyQuotaTotal,
                    owned_proxy_quota_used: ownedProxyQuotaUsed,
                    max_owned_userbots: tierRules.maxUserbots,
                    free_proxy_claimed_once: freeProxyClaimState.claimed,
                    free_proxy_claimed_at: freeProxyClaimState.claimed_at,
                    can_buy_assets: !!tierRules.canBuyAssets,
                    can_create_manual_proxy: req.profile?.role === 'admin'
                        ? true
                        : (ownedProxyQuotaUsed < ownedProxyQuotaTotal || !Number.isFinite(ownedProxyQuotaTotal)),
                    shop_sale_proxy_count: shopSalePreview.length,
                    shop_sale_proxy_preview: shopSalePreview,
                    next_proxy_requires_purchase: req.profile?.role !== 'admin'
                        ? (freeProxyClaimState.claimed || freeManualQuotaUsed >= freeManualQuotaTotal)
                        : false,
                    managed_proxy_limits: req.profile?.role === 'admin' ? {
                        total: managedProxySummary.total || 0,
                        per_admin_limit: MAX_MANAGED_PROXIES_PER_ADMIN,
                        global_limit: MAX_MANAGED_PROXIES_GLOBAL,
                        self_use: Number(managedProxySummary.groups?.self_use || 0),
                        shop_sale: Number(managedProxySummary.groups?.shop_sale || 0)
                    } : null,
                    managed_proxy: managedProxySupport
                }
            });
        } catch (error) {
            const statusCode = (error.message || '').includes('Без прокси можно держать только один юзербот') ? 400 : 500;
            res.status(statusCode).json({ error: error.message });
        }
    });

    router.get('/agent/infra-summary', authenticateUser, async (req, res) => {
        try {
            const sourceSupported = await supportsProxyProvisionSource(supabase);
            const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);
            const tierRules = getTierRules(req.profile);
            const reservedUserbotIds = await loadReservedUserbotIds(supabase, req.user.id);

            const [{ data: proxies, error: proxiesError }, { data: accounts, error: accountsError }] = await Promise.all([
                supabase
                    .from('proxies')
                    .select([
                        'id, name, host, port, is_working, last_checked_at, last_check_error',
                        sourceSupported ? 'provision_source' : null,
                        inventoryGroupSupported ? 'inventory_group' : null
                    ].filter(Boolean).join(', '))
                    .eq('owner_id', req.user.id),
                supabase
                    .from('tg_accounts')
                    .select('id, account_type, tg_username, tg_account_id, runtime_status, proxy_id')
                    .eq('owner_id', req.user.id)
            ]);

            if (proxiesError) throw proxiesError;
            if (accountsError) throw accountsError;

            const allProxies = proxies || [];
            const allAccounts = accounts || [];
            const liveUserbots = allAccounts.filter((item) =>
                item.account_type === 'userbot' &&
                !reservedUserbotIds.has(String(item.id))
            );
            const reservedUserbots = allAccounts.filter((item) =>
                item.account_type === 'userbot' &&
                reservedUserbotIds.has(String(item.id))
            );

            const summary = {
                profile_role: req.profile?.role || null,
                product_tier: tierRules.id,
                proxy_total: allProxies.length,
                proxy_working: allProxies.filter((item) => item.is_working === true).length,
                proxy_broken: allProxies.filter((item) => item.is_working === false).length,
                proxy_unchecked: allProxies.filter((item) => item.is_working !== true && item.is_working !== false).length,
                proxy_owned_manual: allProxies.filter((item) => (item.provision_source || 'manual_free') === 'manual_owned').length,
                proxy_purchased: allProxies.filter((item) => (item.provision_source || 'manual_free') === 'purchased').length,
                proxy_admin_inventory: allProxies.filter((item) => (item.provision_source || 'manual_free') === 'manual_admin').length,
                userbot_total: liveUserbots.length,
                userbot_online: liveUserbots.filter((item) => item.runtime_status === 'online').length,
                userbot_problem: liveUserbots.filter((item) => ['dead_proxy', 'expired', 'error', 'restricted'].includes(item.runtime_status)).length,
                userbot_reserved_for_shop: reservedUserbots.length,
                max_owned_proxies: tierRules.maxOwnedProxies,
                max_userbots: tierRules.maxUserbots,
                can_buy_assets: !!tierRules.canBuyAssets
            };

            res.json({
                summary,
                proxies: allProxies.map((item) => ({
                    id: item.id,
                    name: item.name,
                    host: item.host,
                    port: item.port,
                    is_working: item.is_working,
                    last_checked_at: item.last_checked_at || null,
                    last_check_error: item.last_check_error || null,
                    provision_source: item.provision_source || 'manual_free',
                    inventory_group: item.inventory_group || null
                })),
                userbots: liveUserbots.map((item) => ({
                    id: item.id,
                    tg_username: item.tg_username || null,
                    tg_account_id: item.tg_account_id || null,
                    runtime_status: item.runtime_status || null,
                    proxy_id: item.proxy_id || null
                }))
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Не удалось собрать агентный summary.' });
        }
    });

    router.post('/agent/proxy-intake/preview', authenticateUser, async (req, res) => {
        try {
            const parsed = parseProxyPasteInput(req.body?.raw || '');
            res.json({
                success: true,
                parsed,
                message: 'Proxy разобран. Можно показать пользователю preview и только потом сохранять.'
            });
        } catch (error) {
            res.status(400).json({ error: error.message || 'Не удалось разобрать proxy.' });
        }
    });

    router.post('/agent/proxy-intake/import', authenticateUser, async (req, res) => {
        try {
            const sourceSupported = await supportsProxyProvisionSource(supabase);
            const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);
            const isAdmin = req.profile?.role === 'admin';
            const parsed = parseProxyPasteInput(req.body?.raw || '');
            const name = String(req.body?.name || '').trim() || `${parsed.host}:${parsed.port}`;
            const normalizedInventoryGroup = normalizeAdminInventoryGroup(req.body?.inventory_group);

            if (!isAdmin) {
                await enforceOwnedProxyQuota({
                    supabase,
                    ownerId: req.user.id,
                    profile: req.profile
                });
            }

            const proxyData = {
                owner_id: req.user.id,
                name,
                host: parsed.host,
                port: parsed.port,
                username: parsed.username,
                password: parsed.password,
                is_working: null,
                last_checked_at: null,
                last_check_ip: null,
                last_check_country: null,
                last_check_city: null,
                last_check_isp: null,
                last_check_error: null
            };

            if (sourceSupported) {
                proxyData.provision_source = isAdmin ? 'manual_admin' : 'manual_owned';
            }
            if (inventoryGroupSupported && isAdmin) {
                proxyData.inventory_group = normalizedInventoryGroup;
            }

            const { data: inserted, error } = await supabase
                .from('proxies')
                .insert([proxyData])
                .select('id, name, host, port')
                .single();

            if (error) throw error;

            res.json({
                success: true,
                proxy: inserted,
                parsed,
                message: 'Proxy сохранён из вставленного текста.'
            });
        } catch (error) {
            const message = error?.message || 'Не удалось импортировать proxy.';
            const statusCode = message.includes('Trial') ? 403 : 400;
            res.status(statusCode).json({ error: message });
        }
    });

    router.post('/proxies', authenticateUser, async (req, res) => {
        const { id, name, host, port, username, password, inventory_group } = req.body;
        try {
            const sourceSupported = await supportsProxyProvisionSource(supabase);
            const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);
            const isAdmin = req.profile?.role === 'admin';
            const isCreate = !id;
            const normalizedHost = String(host || '').trim();
            const normalizedPort = Number.parseInt(port, 10);
            const normalizedInventoryGroup = normalizeAdminInventoryGroup(inventory_group);

            if (!String(name || '').trim()) {
                return res.status(400).json({ error: 'Дай прокси понятное имя, чтобы потом не гадать, что это за контур.' });
            }

            if (!isAdmin && !normalizedHost) {
                return res.status(400).json({ error: 'Укажи host или IP прокси.' });
            }
            if (!isAdmin && (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535)) {
                return res.status(400).json({ error: 'Укажи корректный порт прокси.' });
            }
            if (isAdmin && normalizedHost && (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535)) {
                return res.status(400).json({ error: 'Если заводишь внешний прокси вручную, укажи корректный порт.' });
            }

            if (isCreate && !isAdmin) {
                await enforceOwnedProxyQuota({
                    supabase,
                    ownerId: req.user.id,
                    profile: req.profile
                });
            }

            if (!isCreate && !isAdmin) {
                const existingProxy = await loadOwnedProxy(supabase, req.user.id, id);
                if (!existingProxy) {
                    return res.status(404).json({ error: 'Прокси не найден.' });
                }
                if ((existingProxy.provision_source || 'manual_free') !== 'manual_owned') {
                    return res.status(403).json({
                        error: 'Редактировать вручную можно только свой proxy. Trial и купленные proxy руками не правим.'
                    });
                }
            }

            if (isCreate && isAdmin && !normalizedHost) {
                const managedSummary = managedProxyService.getStateSummary();
                if (Number(managedSummary.total || 0) >= MAX_MANAGED_PROXIES_GLOBAL) {
                    return res.status(403).json({
                        error: `На сервере уже поднят лимит managed-прокси (${MAX_MANAGED_PROXIES_GLOBAL}). Сначала почисти старый инвентарь.`
                    });
                }

                const { count: ownerManagedCount, error: ownerCountError } = await supabase
                    .from('proxies')
                    .select('*', { count: 'exact', head: true })
                    .eq('owner_id', req.user.id)
                    .eq('provision_source', 'manual_admin');

                if (ownerCountError) throw ownerCountError;

                if (Number(ownerManagedCount || 0) >= MAX_MANAGED_PROXIES_PER_ADMIN) {
                    return res.status(403).json({
                        error: `У одного админа нельзя держать больше ${MAX_MANAGED_PROXIES_PER_ADMIN} серверных прокси. Сначала продай, удали или переразложи старые.`
                    });
                }

                const provisionedProxy = await managedProxyService.provisionManagedProxy({
                    name: String(name || '').trim(),
                    inventoryGroup: normalizedInventoryGroup
                });

                const proxyData = {
                    owner_id: req.user.id,
                    name: provisionedProxy.name,
                    host: provisionedProxy.host,
                    port: provisionedProxy.port,
                    username: provisionedProxy.username,
                    password: provisionedProxy.password,
                    is_working: null,
                    last_checked_at: new Date().toISOString(),
                    last_check_ip: null,
                    last_check_country: null,
                    last_check_city: null,
                    last_check_isp: null,
                    last_check_error: buildManagedProxyPendingMessage()
                };

                if (sourceSupported) {
                    proxyData.provision_source = 'manual_admin';
                }
                if (inventoryGroupSupported) {
                    proxyData.inventory_group = provisionedProxy.inventory_group;
                }

                const { data: insertedProxy, error: insertError } = await supabase
                    .from('proxies')
                    .insert([proxyData])
                    .select('id')
                    .single();
                if (insertError) {
                    await managedProxyService.releaseManagedProxy({
                        host: provisionedProxy.host,
                        port: provisionedProxy.port,
                        username: provisionedProxy.username
                    });
                    throw insertError;
                }

                launchManagedProxyVerification({
                    supabase,
                    userbotService,
                    ownerId: req.user.id,
                    proxyId: insertedProxy.id,
                    host: provisionedProxy.host,
                    port: provisionedProxy.port,
                    username: provisionedProxy.username,
                    password: provisionedProxy.password
                });

                return res.json({
                    success: true,
                    managed: true,
                    verification_status: 'pending',
                    message: buildManagedProxyPendingMessage()
                });
            }

            let result;

            if (id) {
                const existingProxy = await loadOwnedProxy(supabase, req.user.id, id);
                if (!existingProxy) {
                    return res.status(404).json({ error: 'Прокси не найден.' });
                }

                const updatePayload = {
                    name: String(name || '').trim(),
                    host: normalizedHost,
                    port: normalizedPort,
                    username: username || null,
                    password: password || null
                };

                if (inventoryGroupSupported && isAdmin) {
                    updatePayload.inventory_group = normalizedInventoryGroup;
                }

                const connectionChanged =
                    String(existingProxy.host || '') !== String(normalizedHost || '') ||
                    Number(existingProxy.port || 0) !== Number(normalizedPort || 0) ||
                    String(existingProxy.username || '') !== String(username || '') ||
                    String(existingProxy.password || '') !== String(password || '');

                if (connectionChanged) {
                    updatePayload.is_working = null;
                    updatePayload.last_checked_at = null;
                    updatePayload.last_check_ip = null;
                    updatePayload.last_check_country = null;
                    updatePayload.last_check_country_code = null;
                    updatePayload.last_check_city = null;
                    updatePayload.last_check_isp = null;
                    updatePayload.last_check_error = null;
                }

                result = await supabase
                    .from('proxies')
                    .update(updatePayload)
                    .eq('id', id)
                    .eq('owner_id', req.user.id);
            } else {
                const proxyData = {
                    owner_id: req.user.id,
                    name: String(name || '').trim(),
                    host: normalizedHost,
                    port: normalizedPort,
                    username: username || null,
                    password: password || null,
                    is_working: null,
                    last_checked_at: null,
                    last_check_ip: null,
                    last_check_country: null,
                    last_check_city: null,
                    last_check_isp: null,
                    last_check_error: null
                };

                if (sourceSupported) {
                    proxyData.provision_source = isAdmin ? 'manual_admin' : 'manual_owned';
                }

                if (inventoryGroupSupported && isAdmin) {
                    proxyData.inventory_group = normalizedInventoryGroup;
                }

                result = await supabase.from('proxies').insert([proxyData]);
            }
            if (result.error) throw result.error;
            res.json({ success: true });
        } catch (error) {
            const message = error?.message || 'Не удалось сохранить прокси.';
            const statusCode = (
                message.includes('trial proxy') ||
                message.includes('Shop')
            ) ? 403 : 500;
            res.status(statusCode).json({ error: message });
        }
    });

    router.delete('/proxies/:id', authenticateUser, async (req, res) => {
        try {
            const sourceSupported = await supportsProxyProvisionSource(supabase);
            const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);
            const { data: proxy, error: fetchError } = await supabase
                .from('proxies')
                .select('id, owner_id, host, port, username, provision_source')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .maybeSingle();

            if (fetchError) throw fetchError;
            if (!proxy) {
                return res.status(404).json({ error: 'Прокси не найден.' });
            }

            if (proxy.provision_source === 'manual_trial') {
                const { appMetadata } = await loadUserMetadata(supabase, req.user.id);
                const lease = buildTrialLeaseFromMetadata(appMetadata);
                const updatePayload = {
                    owner_id: lease.original_owner_id || req.user.id
                };
                if (sourceSupported) {
                    updatePayload.provision_source = 'manual_admin';
                }
                if (inventoryGroupSupported) {
                    updatePayload.inventory_group = 'site_free_pool';
                }

                const { error: returnError } = await supabase
                    .from('proxies')
                    .update(updatePayload)
                    .eq('id', req.params.id)
                    .eq('owner_id', req.user.id);
                if (returnError) throw returnError;

                await supabase
                    .from('tg_accounts')
                    .update({
                        proxy_id: null,
                        allow_proxy_failover: false,
                        failover_proxy_ids: []
                    })
                    .eq('owner_id', req.user.id)
                    .eq('account_type', 'userbot')
                    .eq('proxy_id', req.params.id);

                await persistUserMetadata(supabase, req.user.id, {
                    ...appMetadata,
                    trial_proxy_lease: {
                        ...lease,
                        reclaimed_at: new Date().toISOString()
                    }
                });

                return res.json({ success: true, returned_to_trial_pool: true });
            }

            const { error } = await supabase.from('proxies').delete().eq('id', req.params.id).eq('owner_id', req.user.id);
            if (error) throw error;

            if (proxy?.provision_source === 'manual_admin' && proxy?.username) {
                await managedProxyService.releaseManagedProxy({
                    host: proxy.host,
                    port: proxy.port,
                    username: proxy.username
                });
            }

            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // ==========================================
    // НОВОЕ: ПРОВЕРКА ПРОКСИ НА ЖИВУЧЕСТЬ
    // ==========================================
    router.get('/proxies/check/:id', authenticateUser, async (req, res) => {
        try {
            const { data: proxy, error } = await supabase
            .from('proxies')
            .select('*')
            .eq('id', req.params.id)
            .eq('owner_id', req.user.id)
            .single();

            if (error || !proxy) return res.status(404).json({ error: 'Прокси не найден' });
            if (!proxy.host || !proxy.port) {
                return res.status(400).json({ error: 'У этого прокси не сохранены host/port. Открой прокси, поправь данные и только потом запускай проверку.' });
            }

            const result = await userbotService.checkProxy({
                host: proxy.host,
                port: proxy.port,
                username: proxy.username,
                password: proxy.password,
                provision_source: proxy.provision_source || null,
                is_working: proxy.is_working,
                last_check_ip: proxy.last_check_ip || null,
                last_check_country: proxy.last_check_country || null,
                last_check_city: proxy.last_check_city || null
            });

            if (result.success) {
                await supabase.from('proxies').update({
                    is_working: true,
                    last_checked_at: new Date().toISOString(),
                    last_check_ip: result.ip,
                    last_check_country: result.country,
                    last_check_country_code: result.countryCode || null,
                    last_check_city: result.city,
                    last_check_isp: result.isp,
                    last_check_error: null
                }).eq('id', proxy.id).eq('owner_id', req.user.id);

                res.json({
                    success: true,
                    ip: result.ip,
                    country: result.country,
                    countryCode: result.countryCode || null,
                    city: result.city,
                    isp: result.isp,
                    username: proxy.username,
                    password: proxy.password
                });
            } else {
                await supabase.from('proxies').update({
                    is_working: false,
                    last_checked_at: new Date().toISOString(),
                    last_check_error: result.error,
                    last_check_ip: null,
                    last_check_country: null,
                    last_check_country_code: null,
                    last_check_city: null,
                    last_check_isp: null
                }).eq('id', proxy.id).eq('owner_id', req.user.id);

                res.json({ success: false, error: result.error });
            }
        } catch (error) {
            res.status(500).json({ error: error.message || 'Внутренняя ошибка сервера' });
        }
    });

    router.post('/bind-proxy', authenticateUser, async (req, res) => {
        const { account_id, proxy_id, allow_proxy_failover, failover_proxy_ids } = req.body;
        try {
            if (req.profile?.role !== 'admin') {
                await reconcileExpiredTrialProxyLease(supabase, req.user.id, req.profile);
            }
            if (!account_id) {
                return res.status(400).json({ error: 'Не передан аккаунт для перепривязки прокси' });
            }

            if (!proxy_id) {
                return res.status(400).json({ error: 'Юзербота нельзя оставлять без прокси. Выбери живой прокси и только потом сохраняй.' });
            }

            const primaryProxy = await loadOwnedProxy(supabase, req.user.id, proxy_id);
            if (!primaryProxy) {
                return res.status(400).json({ error: 'Выбранный прокси не найден или не принадлежит тебе.' });
            }
            if (primaryProxy.is_working === false) {
                return res.status(400).json({ error: 'Нельзя привязать заведомо мертвый прокси. Сначала почини или выбери другой.' });
            }
            await ensureExclusiveProxyAssignment(supabase, req.user.id, proxy_id, account_id);

            const normalizedPool = Array.isArray(failover_proxy_ids)
                ? failover_proxy_ids.map(item => String(item)).filter(Boolean)
                : [];

            if (proxy_id && normalizedPool.includes(String(proxy_id))) {
                return res.status(400).json({ error: 'Основной прокси не должен одновременно быть fallback-прокси для этого же аккаунта.' });
            }

            if (normalizedPool.length > 0) {
                const { data: proxies, error: proxiesError } = await supabase
                    .from('proxies')
                    .select('id, is_working')
                    .eq('owner_id', req.user.id)
                    .in('id', normalizedPool);

                if (proxiesError) throw proxiesError;
                const validIds = new Set((proxies || []).map(proxy => String(proxy.id)));
                const invalidIds = normalizedPool.filter(id => !validIds.has(id));
                if (invalidIds.length > 0) {
                    return res.status(400).json({ error: 'В fallback-пуле есть чужие или несуществующие прокси.' });
                }

                const deadPool = (proxies || []).filter(proxy => proxy.is_working === false);
                if (deadPool.length > 0) {
                    return res.status(400).json({ error: 'В fallback-пуле есть уже помеченные мертвые прокси. Убери их из резерва.' });
                }

                const { data: occupiedFallbackRows, error: occupiedFallbackError } = await supabase
                    .from('tg_accounts')
                    .select('proxy_id')
                    .eq('owner_id', req.user.id)
                    .eq('account_type', 'userbot')
                    .neq('id', account_id)
                    .in('proxy_id', normalizedPool);

                if (occupiedFallbackError) throw occupiedFallbackError;

                const occupiedFallbackIds = new Set(
                    (occupiedFallbackRows || [])
                        .map((row) => String(row.proxy_id || ''))
                        .filter(Boolean)
                );

                if (occupiedFallbackIds.size > 0) {
                    return res.status(400).json({ error: 'В fallback-пуле есть прокси, которые уже заняты другими юзерботами. Один прокси = один юзербот даже для резерва.' });
                }
            }

            const { error } = await supabase.from('tg_accounts').update({
                proxy_id: proxy_id || null,
                allow_proxy_failover: !!allow_proxy_failover,
                failover_proxy_ids: normalizedPool
            }).eq('id', account_id).eq('owner_id', req.user.id);
            if (error) throw error;
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // ==========================================
    // 2. ИМПОРТ ФАЙЛА СЕССИИ (.SESSION / SQLITE)
    // ==========================================
    router.post('/import-session-file', authenticateUser, upload.fields([
        { name: 'sessionFile', maxCount: 1 },
        { name: 'jsonFile', maxCount: 1 }
    ]), async (req, res) => {
        const uploadedFiles = [
            ...(req.files?.sessionFile || []),
            ...(req.files?.jsonFile || [])
        ];

        try {
            const sessionFile = req.files?.sessionFile?.[0];
            const jsonFile = req.files?.jsonFile?.[0];

            if (!sessionFile) return res.status(400).json({ error: 'Загрузи именно `.session` файл. Папки `tdata`, архивы и другие форматы здесь не поддержаны.' });
            const { proxy_id } = req.body;

            if (!jsonFile) {
                return res.status(400).json({ error: 'Для безопасного импорта нужен и `.json` с fingerprint. Без него аккаунт остаётся в risk-case по device/app mismatch.' });
            }

            await userbotService.validateSessionSqliteFile(sessionFile.path);
            const fingerprint = await userbotService.validateConfigJsonFile(jsonFile.path);

            if (!proxy_id) {
                return res.status(400).json({ error: 'Юзербота можно импортировать только через прокси. Сначала выбери живой прокси.' });
            }

            if (req.profile?.role !== 'admin') {
                await reconcileExpiredTrialProxyLease(supabase, req.user.id, req.profile);
            }

            let proxyData = null;
            const data = await loadOwnedProxy(supabase, req.user.id, proxy_id);
            if (data) {
                proxyData = {
                    proxy_host: data.host,
                    proxy_port: data.port,
                    proxy_username: data.username,
                    proxy_password: data.password,
                    proxy_id: data.id,
                    is_working: data.is_working,
                    last_check_ip: data.last_check_ip,
                    last_check_country: data.last_check_country,
                    last_check_city: data.last_check_city,
                    force_ipv6: data.is_working === true && (!data.last_check_ip || data.last_check_ip.includes(':')),
                    provision_source: data.provision_source,
                    inventory_group: data.inventory_group
                };
            }
            if (!proxyData) {
                return res.status(400).json({ error: 'Выбранный прокси не найден или не принадлежит тебе.' });
            }
            if (data.is_working === false) {
                return res.status(400).json({ error: 'Этот прокси уже помечен как мертвый. Сначала почини его или выбери другой.' });
            }

            const sessionString = await userbotService.extractSessionFromSqlite(sessionFile.path);

            const proxyConfig = userbotService._buildProxy(proxyData);
            const clientConfig = userbotService._getClientConfig(proxyConfig, 1, fingerprint, proxyData);

            const client = new TelegramClient(new StringSession(sessionString), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            const me = await client.getMe();
            let existingAccountId = null;

            const { data: existingAccount } = await supabase
                .from('tg_accounts')
                .select('id')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'userbot')
                .eq('tg_account_id', me.id.toString())
                .maybeSingle();

            existingAccountId = existingAccount?.id || null;
            await enforceUserbotQuota({
                supabase,
                ownerId: req.user.id,
                profile: req.profile,
                ignoreAccountId: existingAccountId
            });
            await ensureUserbotNotOwnedByAnotherAdmin(supabase, req.user.id, me.id.toString(), existingAccountId);
            await ensureExclusiveProxyAssignment(supabase, req.user.id, proxy_id, existingAccountId);

            await supabase.from('tg_accounts').upsert({
                owner_id: req.user.id,
                account_type: 'userbot',
                ...buildTelegramProfilePatch(me),
                session_data: encrypt(userbotService.stringifySessionData(client.session.save(), fingerprint, 'session_import')),
                proxy_id: proxyData ? proxyData.proxy_id : null,
                runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                runtime_error: FRESH_IMPORT_RUNTIME_REASON,
                allow_proxy_failover: false,
                failover_proxy_ids: []
            }, { onConflict: 'owner_id, tg_account_id' }).select('id').single();

            const { data: savedAccount } = await supabase
                .from('tg_accounts')
                .select('id')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'userbot')
                .eq('tg_account_id', me.id.toString())
                .maybeSingle();

            if (savedAccount?.id) {
                try {
                    if (shouldStoreRecoverySource(req.body?.save_recovery_source)) {
                        await userbotService.saveRecoverySource({
                            accountId: savedAccount.id,
                            ownerId: req.user.id,
                            tgAccountId: me.id.toString(),
                            sessionFilePath: sessionFile.path,
                            sessionOriginalName: sessionFile.originalname,
                            jsonFilePath: jsonFile?.path || null,
                            jsonOriginalName: jsonFile?.originalname || null,
                            fingerprint
                        });
                    }
                } catch (restoreError) {
                    if (!isMissingRecoveryTable(restoreError)) {
                        throw restoreError;
                    }
                }
            }

            await client.disconnect();

            cleanupUploadedFiles(uploadedFiles);

            res.json({
                success: true,
                username: me.username || me.firstName,
                runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                runtime_reason: FRESH_IMPORT_RUNTIME_REASON,
                recovery_source_saved: shouldStoreRecoverySource(req.body?.save_recovery_source)
            });

        } catch (error) {
            cleanupUploadedFiles(uploadedFiles);
            console.error('[USERBOT_IMPORT] failed:', error?.message || error);
            const sanitized = sanitizeUserbotImportError(error);
            res.status(sanitized.statusCode).json({ error: sanitized.message });
        }
    });

    // ==========================================
    // 3. ГЕНЕРАЦИЯ QR (Классический метод)
    // ==========================================
    router.get('/fingerprint-profiles', authenticateUser, async (req, res) => {
        try {
            const profiles = await userbotService.listQrFingerprintProfiles(req.user.id);
            res.json({ profiles });
        } catch (error) {
            console.error('[USERBOT_FINGERPRINT_PROFILES] failed:', error?.message || error);
            res.status(500).json({ error: 'Не удалось загрузить fingerprint-пресеты.' });
        }
    });

    router.post('/qr-start', authenticateUser, async (req, res) => {
        try {
            const { proxy_id, fingerprint_profile_id, custom_fingerprint, save_as_preset } = req.body;
            const normalizedCustomFingerprint = custom_fingerprint ? normalizeFingerprintPayload(custom_fingerprint) : null;

            if (normalizedCustomFingerprint) {
                validateCustomFingerprintPayload(normalizedCustomFingerprint);
            }

            console.log(
                '[QR-ROUTE] Начинаем генерацию QR, proxy_id:',
                proxy_id,
                'fingerprint_profile_id:',
                fingerprint_profile_id || 'default',
                'custom_fingerprint:',
                normalizedCustomFingerprint ? normalizedCustomFingerprint.label || 'custom' : 'none',
                'save_as_preset:',
                !!save_as_preset
            );

            if (!proxy_id) {
                return res.status(400).json({ error: 'Юзербота можно подключать только через прокси. Сначала выбери живой прокси.' });
            }

            if (req.profile?.role !== 'admin') {
                await reconcileExpiredTrialProxyLease(supabase, req.user.id, req.profile);
            }

            let proxyData = null;
            const data = await loadOwnedProxy(supabase, req.user.id, proxy_id);
            if (data) {
                proxyData = {
                    proxy_host: data.host,
                    proxy_port: data.port,
                    proxy_username: data.username,
                    proxy_password: data.password,
                    proxy_id: data.id,
                    is_working: data.is_working,
                    last_check_ip: data.last_check_ip,
                    last_check_country: data.last_check_country,
                    last_check_city: data.last_check_city,
                    force_ipv6: data.is_working === true && (!data.last_check_ip || data.last_check_ip.includes(':')),
                    provision_source: data.provision_source,
                    inventory_group: data.inventory_group
                };
                console.log('[QR-ROUTE] Прокси найден:', proxyData.proxy_host, ':', proxyData.proxy_port);
                if (data.is_working === false) {
                    return res.status(400).json({ error: 'Этот прокси уже помечен как мертвый. Сначала почини его или выбери другой.' });
                }
                await ensureExclusiveProxyAssignment(supabase, req.user.id, proxy_id);
            } else {
                console.log('[QR-ROUTE] Прокси с ID', proxy_id, 'не найден в БД');
                return res.status(400).json({ error: 'Выбранный прокси не найден или не принадлежит тебе.' });
            }

            const result = await userbotService.generateQR(req.user.id, proxyData, {
                profile_id: fingerprint_profile_id,
                custom_fingerprint: normalizedCustomFingerprint,
                save_as_preset: !!save_as_preset,
                preset_label: normalizedCustomFingerprint?.label || ''
            }, req.user.id);
            console.log('[QR-ROUTE] QR успешно сгенерирован');
            res.json(result);
        } catch (error) {
            console.error('[QR-ROUTE] ❌ ОШИБКА при генерации QR:', error.message);
            const statusCode = String(error.message || '').includes('только через прокси') ? 400 : 500;
            res.status(statusCode).json({
                error: statusCode === 400
                    ? (error.message || 'Ошибка инициализации клиента')
                    : 'Не удалось подготовить QR-вход. Проверь прокси и попробуй еще раз.'
            });
        }
    });

    router.get('/qr-status', authenticateUser, async (req, res) => {
        const sessionData = userbotService.qrSessions.get(req.user.id);
        if (!sessionData) return res.status(404).json({ status: 'not_found' });

        try {
            if (sessionData.authState !== 'authorized') {
                return res.json({ status: 'pending' });
            }

            const savedSession = sessionData.client?.session?.save?.() || '';
            if (savedSession === '') {
                return res.json({ status: 'pending' });
            }

            const token = savedSession;
            const me = await sessionData.client.getMe();
            let existingAccountId = null;

            const { data: existingAccount } = await supabase
                .from('tg_accounts')
                .select('id')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'userbot')
                .eq('tg_account_id', me.id.toString())
                .maybeSingle();

            existingAccountId = existingAccount?.id || null;
            await enforceUserbotQuota({
                supabase,
                ownerId: req.user.id,
                profile: req.profile,
                ignoreAccountId: existingAccountId
            });
            await ensureUserbotNotOwnedByAnotherAdmin(supabase, req.user.id, me.id.toString(), existingAccountId);
            if (sessionData.proxyData?.proxy_id) {
                await ensureExclusiveProxyAssignment(supabase, req.user.id, sessionData.proxyData.proxy_id, existingAccountId);
            }

            await supabase.from('tg_accounts').upsert({
                owner_id: req.user.id,
                account_type: 'userbot',
                ...buildTelegramProfilePatch(me),
                session_data: encrypt(userbotService.stringifySessionData(token, sessionData.fingerprint, 'qr')),
                proxy_id: sessionData.proxyData ? sessionData.proxyData.proxy_id : null,
                runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                runtime_error: FRESH_IMPORT_RUNTIME_REASON,
                allow_proxy_failover: false,
                failover_proxy_ids: []
            }, { onConflict: 'owner_id, tg_account_id' });

            await sessionData.client.disconnect();
            userbotService.qrSessions.delete(req.user.id);
            return res.json({
                status: 'success',
                runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                runtime_reason: FRESH_IMPORT_RUNTIME_REASON,
                fingerprint_profile_id: sessionData.fingerprint?.profileId || null,
                fingerprint_profile_label: sessionData.fingerprint?.profileLabel || null
            });
        } catch (error) {
            const raw = String(error?.errorMessage || error?.message || error || '');
            console.error('[QR-STATUS] failed:', raw);

            if (
                isExpiredUserbotSessionError(error)
                || raw.includes('Cannot send requests while disconnected')
                || raw.includes('TIMEOUT')
                || raw.includes('timed out')
            ) {
                return res.json({ status: 'pending' });
            }

            return res.status(500).json({ error: 'Не удалось проверить статус QR-входа. Попробуй сгенерировать QR заново.' });
        }
    });

    // ==========================================
    // 4. УДАЛЕНИЕ И ПРОВЕРКА АККАУНТОВ
    // ==========================================
    router.post('/profile/:id/sync', authenticateUser, async (req, res) => {
        const accountId = req.params.id;
        let client = null;

        try {
            const { data: account, error } = await supabase
                .from('tg_accounts')
                .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
                .eq('id', accountId)
                .eq('owner_id', req.user.id)
                .single();

            if (error || !account) {
                return res.status(404).json({ error: 'Аккаунт не найден.' });
            }
            if (account.account_type !== 'userbot') {
                return res.status(400).json({ error: 'Профиль так обновляем только у юзерботов.' });
            }
            if (isFreshImportedUserbot(account)) {
                return res.status(409).json({ error: 'Аккаунт в safe-mode. Сначала сделай живую активацию через проверку Telegram.' });
            }
            if (isUserbotOnDeadProxy(account)) {
                return res.status(409).json({ error: 'У юзербота мертвый прокси. Сначала почини или смени прокси.' });
            }

            const cooldown = userbotProfileSyncCooldown(account);
            if (cooldown) {
                return res.json({
                    success: true,
                    cached: true,
                    cooldown,
                    account,
                    message: `Профиль уже обновляли недавно. Повторить можно примерно через ${Math.ceil(cooldown.retry_after_seconds / 60)} мин.`
                });
            }

            const decryptedData = decrypt(account.session_data);
            if (!decryptedData) {
                throw new Error('Сессия не читается или уже недействительна.');
            }

            const { token, fingerprint } = userbotService.parseSessionData(decryptedData);
            const proxyData = account.proxies
                ? {
                    proxy_host: account.proxies.host,
                    proxy_port: account.proxies.port,
                    proxy_username: account.proxies.username,
                    proxy_password: account.proxies.password
                }
                : undefined;

            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            const me = await client.getMe();
            let about = null;
            let photoUrl;

            try {
                const fullUser = await client.invoke(new Api.users.GetFullUser({ id: 'me' }));
                about = String(fullUser?.fullUser?.about || '').trim() || null;
            } catch (profileError) {
                console.warn('[USERBOT_PROFILE_SYNC] about skipped:', profileError?.message || profileError);
            }

            try {
                const photo = await client.downloadProfilePhoto(me, { isBig: false });
                if (Buffer.isBuffer(photo) && photo.length > 0) {
                    photoUrl = storeUserbotProfilePhoto({
                        ownerId: req.user.id,
                        accountId: account.id,
                        photo
                    });
                } else if (Buffer.isBuffer(photo)) {
                    photoUrl = null;
                }
            } catch (photoError) {
                console.warn('[USERBOT_PROFILE_SYNC] photo skipped:', photoError?.message || photoError);
            }

            const syncedAt = new Date().toISOString();
            const patch = {
                ...buildTelegramProfilePatch(me, {
                    tg_about: about,
                    tg_profile_synced_at: syncedAt,
                    tg_profile_sync_attempted_at: syncedAt,
                    ...(photoUrl !== undefined ? { tg_photo_url: photoUrl, tg_photo_synced_at: syncedAt, tg_photo_data_url: null } : {}),
                    tg_profile_sync_error: null
                })
            };

            const { data: updatedAccount, error: updateError } = await supabase
                .from('tg_accounts')
                .update(patch)
                .eq('id', account.id)
                .eq('owner_id', req.user.id)
                .select('*')
                .single();

            if (updateError || !updatedAccount) {
                throw new Error(updateError?.message || 'Профиль не сохранился.');
            }

            return res.json({
                success: true,
                cached: false,
                account: updatedAccount,
                message: 'Профиль юзербота обновлен.'
            });
        } catch (error) {
            console.error('[USERBOT_PROFILE_SYNC] failed', {
                accountId,
                ownerId: req.user?.id || null,
                error: error.message || String(error || '')
            });
            try {
                await supabase
                    .from('tg_accounts')
                    .update({
                        tg_profile_sync_error: error.message || 'Не удалось обновить профиль.',
                        tg_profile_sync_attempted_at: new Date().toISOString()
                    })
                    .eq('id', accountId)
                    .eq('owner_id', req.user.id);
            } catch (updateError) {
                console.error('[USERBOT_PROFILE_SYNC] error marker failed:', updateError?.message || updateError);
            }
            return res.status(500).json({ error: error.message || 'Не удалось обновить профиль.' });
        } finally {
            if (client) {
                try {
                    await client.disconnect();
                } catch {
                    // no-op
                }
            }
        }
    });

    router.post('/profile/:id/update', authenticateUser, async (req, res) => {
        const accountId = req.params.id;
        let client = null;

        try {
            const input = normalizeEditableTelegramProfile(req.body || {});
            const { data: account, error } = await supabase
                .from('tg_accounts')
                .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
                .eq('id', accountId)
                .eq('owner_id', req.user.id)
                .single();

            if (error || !account) {
                return res.status(404).json({ error: 'Аккаунт не найден.' });
            }
            if (account.account_type !== 'userbot') {
                return res.status(400).json({ error: 'Профиль так меняем только у юзерботов.' });
            }
            if (isFreshImportedUserbot(account)) {
                return res.status(409).json({ error: 'Аккаунт в safe-mode. Сначала сделай живую активацию через проверку Telegram.' });
            }
            if (isUserbotOnDeadProxy(account)) {
                return res.status(409).json({ error: 'У юзербота мертвый прокси. Сначала почини или смени прокси.' });
            }

            const decryptedData = decrypt(account.session_data);
            if (!decryptedData) {
                throw new Error('Сессия не читается или уже недействительна.');
            }

            const { token, fingerprint } = userbotService.parseSessionData(decryptedData);
            const proxyData = account.proxies
                ? {
                    proxy_host: account.proxies.host,
                    proxy_port: account.proxies.port,
                    proxy_username: account.proxies.username,
                    proxy_password: account.proxies.password
                }
                : undefined;

            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            await client.invoke(new Api.account.UpdateProfile({
                firstName: input.firstName,
                lastName: input.lastName,
                about: input.about
            }));

            const me = await client.getMe();
            let about = input.about || null;
            try {
                const fullUser = await client.invoke(new Api.users.GetFullUser({ id: 'me' }));
                about = String(fullUser?.fullUser?.about ?? input.about ?? '').trim() || null;
            } catch (profileError) {
                console.warn('[USERBOT_PROFILE_UPDATE] about verify skipped:', profileError?.message || profileError);
            }

            const syncedAt = new Date().toISOString();
            const patch = buildTelegramProfilePatch(me, {
                tg_first_name: input.firstName,
                tg_last_name: input.lastName || null,
                tg_about: about,
                tg_profile_synced_at: syncedAt,
                tg_profile_sync_attempted_at: syncedAt,
                tg_profile_sync_error: null
            });

            const { data: updatedAccount, error: updateError } = await supabase
                .from('tg_accounts')
                .update(patch)
                .eq('id', account.id)
                .eq('owner_id', req.user.id)
                .select('*')
                .single();

            if (updateError || !updatedAccount) {
                throw new Error(updateError?.message || 'Профиль изменился в Telegram, но не сохранился в БД.');
            }

            return res.json({
                success: true,
                account: updatedAccount,
                message: 'Профиль сохранен в Telegram и Supabase.'
            });
        } catch (error) {
            console.error('[USERBOT_PROFILE_UPDATE] failed', {
                accountId,
                ownerId: req.user?.id || null,
                error: error.message || String(error || '')
            });
            try {
                await supabase
                    .from('tg_accounts')
                    .update({
                        tg_profile_sync_error: error.message || 'Не удалось сохранить профиль.',
                        tg_profile_sync_attempted_at: new Date().toISOString()
                    })
                    .eq('id', accountId)
                    .eq('owner_id', req.user.id);
            } catch (updateError) {
                console.error('[USERBOT_PROFILE_UPDATE] error marker failed:', updateError?.message || updateError);
            }
            return res.status(500).json({ error: error.message || 'Не удалось сохранить профиль.' });
        } finally {
            if (client) {
                try {
                    await client.disconnect();
                } catch {
                    // no-op
                }
            }
        }
    });

    router.post('/profile/:id/avatar', authenticateUser, (req, res, next) => {
        avatarUpload.single('avatar')(req, res, (error) => {
            if (error) {
                return res.status(400).json({ error: error.message || 'Не удалось принять файл аватарки.' });
            }
            return next();
        });
    }, async (req, res) => {
        const accountId = req.params.id;
        let client = null;

        try {
            if (!req.file) {
                return res.status(400).json({ error: 'Загрузи JPG, PNG или WEBP до 5 МБ.' });
            }

            const { data: account, error } = await supabase
                .from('tg_accounts')
                .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
                .eq('id', accountId)
                .eq('owner_id', req.user.id)
                .single();

            if (error || !account) {
                return res.status(404).json({ error: 'Аккаунт не найден.' });
            }
            if (account.account_type !== 'userbot') {
                return res.status(400).json({ error: 'Аватарку так меняем только у юзерботов.' });
            }
            if (isFreshImportedUserbot(account)) {
                return res.status(409).json({ error: 'Аккаунт в safe-mode. Сначала сделай живую активацию через проверку Telegram.' });
            }
            if (isUserbotOnDeadProxy(account)) {
                return res.status(409).json({ error: 'У юзербота мертвый прокси. Сначала почини или смени прокси.' });
            }

            const decryptedData = decrypt(account.session_data);
            if (!decryptedData) {
                throw new Error('Сессия не читается или уже недействительна.');
            }

            const { token, fingerprint } = userbotService.parseSessionData(decryptedData);
            const proxyData = account.proxies
                ? {
                    proxy_host: account.proxies.host,
                    proxy_port: account.proxies.port,
                    proxy_username: account.proxies.username,
                    proxy_password: account.proxies.password
                }
                : undefined;

            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            const uploadName = path.basename(req.file.originalname || 'avatar.jpg').slice(0, 96) || 'avatar.jpg';
            const telegramFile = await client.uploadFile({
                file: new CustomFile(uploadName, req.file.size, req.file.path),
                workers: 1
            });

            await client.invoke(new Api.photos.UploadProfilePhoto({
                file: telegramFile
            }));

            const syncedAt = new Date().toISOString();
            const photoUrl = storeUserbotProfilePhotoFromPath({
                ownerId: req.user.id,
                accountId: account.id,
                filePath: req.file.path,
                extension: profilePhotoExtensionFromFile(req.file)
            });

            if (!photoUrl) {
                throw new Error('Аватарка изменилась в Telegram, но локальная копия не сохранилась.');
            }

            const { data: updatedAccount, error: updateError } = await supabase
                .from('tg_accounts')
                .update({
                    tg_photo_url: photoUrl,
                    tg_photo_synced_at: syncedAt,
                    tg_photo_data_url: null,
                    tg_profile_sync_attempted_at: syncedAt,
                    tg_profile_sync_error: null
                })
                .eq('id', account.id)
                .eq('owner_id', req.user.id)
                .select('*')
                .single();

            if (updateError || !updatedAccount) {
                throw new Error(updateError?.message || 'Аватарка изменилась в Telegram, но ссылка не сохранилась в БД.');
            }

            return res.json({
                success: true,
                account: updatedAccount,
                message: 'Аватарка сохранена в Telegram и на сервере.'
            });
        } catch (error) {
            console.error('[USERBOT_PROFILE_AVATAR] failed', {
                accountId,
                ownerId: req.user?.id || null,
                error: error.message || String(error || '')
            });
            try {
                await supabase
                    .from('tg_accounts')
                    .update({
                        tg_profile_sync_error: error.message || 'Не удалось сохранить аватарку.',
                        tg_profile_sync_attempted_at: new Date().toISOString()
                    })
                    .eq('id', accountId)
                    .eq('owner_id', req.user.id);
            } catch (updateError) {
                console.error('[USERBOT_PROFILE_AVATAR] error marker failed:', updateError?.message || updateError);
            }
            return res.status(500).json({ error: error.message || 'Не удалось сохранить аватарку.' });
        } finally {
            if (client) {
                try {
                    await client.disconnect();
                } catch {
                    // no-op
                }
            }
            if (req.file?.path) {
                fs.promises.unlink(req.file.path).catch(() => {});
            }
        }
    });

    router.delete('/:id', authenticateUser, async (req, res) => {
        try {
            try {
                await userbotService.deleteRecoverySource(req.user.id, req.params.id);
            } catch (error) {
                if (!isMissingRecoveryTable(error)) {
                    throw error;
                }
            }
            await supabase.from('tg_accounts').delete().eq('id', req.params.id).eq('owner_id', req.user.id);
            res.status(200).json({ success: true });
        } catch (error) { res.status(500).json({ error: 'Ошибка при удалении' }); }
    });

    router.get('/recovery-status', authenticateUser, async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('userbot_restore_sources')
                .select('account_id, source_type, session_filename, json_filename, updated_at, last_restored_at, last_restore_status, last_restore_error')
                .eq('owner_id', req.user.id);

            if (error) {
                if (isMissingRecoveryTable(error)) {
                    return res.json({ support: { recovery: false }, rows: [] });
                }
                throw error;
            }

            res.json({
                support: { recovery: true },
                rows: data || []
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Ошибка загрузки recovery status' });
        }
    });

    router.post('/restore/:id', authenticateUser, async (req, res) => {
        try {
            const { data: account } = await supabase
                .from('tg_accounts')
                .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .single();

            if (!account) return res.status(404).json({ error: 'Юзербот не найден' });

            const activateNow = String(req.body?.activate_now || '').trim().toLowerCase() === 'true';
            let targetAccount = account;
            if (isUserbotOnDeadProxy(account)) {
                const failover = await userbotService.tryAutoFailoverUserbot(account);
                if (failover.switched) {
                    targetAccount = failover.account;
                } else if (failover.reason === 'cooldown') {
                    return res.status(409).json({ error: getFailoverCooldownMessage(failover.retry_after_ms) });
                } else {
                    return res.status(409).json({ error: getDeadProxyMessage() });
                }
            }

            let restoreSource;
            try {
                restoreSource = await userbotService.getRecoverySource(req.user.id, targetAccount.id);
            } catch (restoreError) {
                if (isMissingRecoveryTable(restoreError)) {
                    return res.status(400).json({ error: 'Сначала примени SQL под session recovery foundation.' });
                }
                throw restoreError;
            }

            if (!restoreSource?.session_blob_encrypted) {
                return res.status(404).json({ error: 'Для этого юзербота нет сохраненного restore source. Нужен новый импорт .session/.json.' });
            }

            const sessionBuffer = Buffer.from(decrypt(restoreSource.session_blob_encrypted), 'base64');
            const sessionString = await userbotService.extractSessionFromSqliteBuffer(sessionBuffer);

            let fingerprint = userbotService.getDefaultFingerprint();
            if (restoreSource.json_blob_encrypted) {
                try {
                    fingerprint = userbotService.parseConfigJsonContent(decrypt(restoreSource.json_blob_encrypted));
                } catch {}
            } else if (restoreSource.fingerprint) {
                fingerprint = userbotService._normalizeFingerprint(restoreSource.fingerprint);
            } else if (targetAccount.session_data) {
                const parsed = userbotService.parseSessionData(decrypt(targetAccount.session_data));
                fingerprint = parsed.fingerprint;
            }

            const proxyData = targetAccount.proxies
                ? {
                    proxy_host: targetAccount.proxies.host,
                    proxy_port: targetAccount.proxies.port,
                    proxy_username: targetAccount.proxies.username,
                    proxy_password: targetAccount.proxies.password,
                    provision_source: targetAccount.proxies.provision_source,
                    inventory_group: targetAccount.proxies.inventory_group
                }
                : undefined;

            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            const client = new TelegramClient(new StringSession(sessionString), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);

            try {
                await userbotService.connectWithProxyFallback(client, proxyData);
                const me = await client.getMe();

                await ensureUserbotNotOwnedByAnotherAdmin(supabase, req.user.id, me.id.toString(), targetAccount.id);
                if (targetAccount.proxy_id) {
                    await ensureExclusiveProxyAssignment(supabase, req.user.id, targetAccount.proxy_id, targetAccount.id);
                }

                await supabase
                    .from('tg_accounts')
                    .update({
                        ...buildTelegramProfilePatch(me),
                        session_data: encrypt(userbotService.stringifySessionData(client.session.save(), fingerprint, 'restored')),
                        runtime_status: activateNow ? 'online' : FRESH_IMPORT_RUNTIME_STATUS,
                        runtime_error: activateNow ? null : FRESH_IMPORT_RUNTIME_REASON,
                        allow_proxy_failover: false,
                        failover_proxy_ids: [],
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', targetAccount.id)
                    .eq('owner_id', req.user.id);

                await supabase
                    .from('userbot_restore_sources')
                    .update({
                        tg_account_id: me.id.toString(),
                        last_restored_at: new Date().toISOString(),
                        last_restore_status: 'restored',
                        last_restore_error: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('account_id', targetAccount.id)
                    .eq('owner_id', req.user.id);

                res.json({
                    success: true,
                    username: me.username || me.firstName,
                    tg_account_id: me.id.toString(),
                    runtime_status: activateNow ? 'online' : FRESH_IMPORT_RUNTIME_STATUS,
                    runtime_reason: activateNow ? null : FRESH_IMPORT_RUNTIME_REASON
                });
            } catch (error) {
                await supabase
                    .from('userbot_restore_sources')
                    .update({
                        last_restore_status: 'failed',
                        last_restore_error: error.message || 'restore_failed',
                        updated_at: new Date().toISOString()
                    })
                    .eq('account_id', targetAccount.id)
                    .eq('owner_id', req.user.id);

                throw error;
            } finally {
                try { await client.disconnect(); } catch {}
            }
        } catch (error) {
            console.error('Ошибка восстановления юзербота:', error?.message || error);
            const sanitized = sanitizeUserbotImportError(error);
            res.status(sanitized.statusCode).json({
                error: sanitized.statusCode === 500
                    ? 'Восстановление из сохраненного комплекта не прошло. Проверь источник и прокси, затем повтори.'
                    : sanitized.message
            });
        }
    });

    router.post('/safe-mode/:id', authenticateUser, async (req, res) => {
        try {
            const enabled = req.body?.enabled === true;
            console.log('[USERBOT_SAFE_MODE] request', {
                accountId: req.params.id,
                ownerId: req.user?.id || null,
                role: req.profile?.role || null,
                enabled
            });
            const { data: account, error } = await supabase
                .from('tg_accounts')
                .select('id, owner_id, account_type, runtime_status')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .single();

            if (error || !account) {
                return res.status(404).json({ error: 'Аккаунт не найден' });
            }

            if (account.account_type !== 'userbot') {
                return res.status(400).json({ error: 'Safe-mode работает только для юзерботов.' });
            }

            if (enabled !== true) {
                return res.status(400).json({ error: 'Выключение safe-mode делается через живую Telegram-проверку.' });
            }

            const { data: updatedAccount, error: updateError } = await supabase
                .from('tg_accounts')
                .update({
                    runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                    runtime_error: FRESH_IMPORT_RUNTIME_REASON
                })
                .eq('id', account.id)
                .eq('owner_id', req.user.id)
                .select('id, runtime_status, runtime_error')
                .single();

            if (updateError || !updatedAccount) {
                throw new Error(updateError?.message || 'Safe-mode update не сохранился.');
            }

            console.log('[USERBOT_SAFE_MODE] switched', {
                accountId: updatedAccount.id,
                ownerId: req.user?.id || null,
                prevStatus: account.runtime_status || null,
                nextStatus: updatedAccount.runtime_status || null
            });

            return res.json({
                success: true,
                runtime_status: updatedAccount.runtime_status || null,
                runtime_reason: updatedAccount.runtime_error || null
            });
        } catch (error) {
            console.error('[USERBOT_SAFE_MODE] failed', {
                accountId: req.params.id,
                ownerId: req.user?.id || null,
                role: req.profile?.role || null,
                error: error.message || String(error || '')
            });
            res.status(500).json({ error: error.message || 'Не удалось переключить safe-mode.' });
        }
    });

    router.get('/check/:id', authenticateUser, async (req, res) => {
        try {
            const { data: account } = await supabase.from('tg_accounts').select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)').eq('id', req.params.id).eq('owner_id', req.user.id).single();
            if (!account) return res.status(404).json({ error: 'Аккаунт не найден' });
            const activate = String(req.query.activate || '').trim().toLowerCase() === 'true';
            console.log('[USERBOT_CHECK] request', {
                accountId: req.params.id,
                ownerId: req.user?.id || null,
                role: req.profile?.role || null,
                activate,
                runtimeStatus: account.runtime_status || null
            });
            if (isFreshImportedUserbot(account) && activate !== true) {
                return res.status(409).json({
                    status: FRESH_IMPORT_RUNTIME_STATUS,
                    reason: `${FRESH_IMPORT_RUNTIME_REASON} Нажми отдельную живую проверку с подтверждением, чтобы активировать аккаунт.`
                });
            }
            if (isUserbotOnDeadProxy(account)) {
                const failover = await userbotService.tryAutoFailoverUserbot(account);
                if (failover.switched) {
                    await supabase.from('tg_accounts').update({
                        runtime_status: 'online',
                        runtime_error: null,
                        last_checked_at: new Date().toISOString()
                    }).eq('id', account.id).eq('owner_id', req.user.id);
                    console.log('[USERBOT_CHECK] failover_switched', {
                        accountId: account.id,
                        ownerId: req.user?.id || null,
                        nextStatus: 'online',
                        proxyId: failover.to_proxy_id
                    });
                    return res.json(buildCheckResponse(
                        'online',
                        'Сессия отвечает. Прокси был автоматически переключен на живой.',
                        {
                            session: 'alive',
                            restriction: 'clear',
                            restriction_reason: '',
                            spambot: {
                                state: 'not_checked',
                                reason: '',
                                source: 'failover_only'
                            }
                        },
                        { failover_switched: true, proxy_id: failover.to_proxy_id }
                    ));
                }
                await supabase.from('tg_accounts').update({
                    runtime_status: 'dead_proxy',
                    runtime_error: 'У юзербота мертвый прокси.',
                    last_checked_at: new Date().toISOString()
                }).eq('id', account.id).eq('owner_id', req.user.id);
                await logTelegramErrorEvent(supabase, {
                    owner_id: req.user.id,
                    userbot_id: account.id,
                    event_source: 'userbot_health',
                    event_type: 'health_check',
                    restriction_kind: 'dead_proxy',
                    severity: 'danger',
                    error_message: 'У юзербота мертвый прокси.',
                    meta: {
                        account_type: account.account_type || 'userbot'
                    }
                });
                return res.json(buildCheckResponse(
                    'inactive_proxy',
                    'У юзербота мертвый прокси.',
                    {
                        session: 'unknown',
                        restriction: 'unknown',
                        restriction_reason: '',
                        spambot: {
                            state: 'not_checked',
                            reason: '',
                            source: 'proxy_dead'
                        }
                    }
                ));
            }
            const checkedAt = new Date().toISOString();
            const decryptedData = decrypt(account.session_data);
            if (!decryptedData) {
                await supabase.from('tg_accounts').update({
                    runtime_status: 'expired',
                    runtime_error: 'Сессия не читается или уже недействительна.',
                    last_checked_at: checkedAt
                }).eq('id', account.id).eq('owner_id', req.user.id);
                await logTelegramErrorEvent(supabase, {
                    owner_id: req.user.id,
                    userbot_id: account.id,
                    event_source: 'userbot_health',
                    event_type: 'health_check',
                    restriction_kind: 'session_revoked',
                    severity: 'danger',
                    is_restriction: true,
                    error_message: 'Сессия не читается или уже недействительна.',
                    meta: {
                        account_type: account.account_type || 'userbot'
                    }
                });
                return res.json(buildCheckResponse(
                    'expired',
                    'Сессия не читается или уже недействительна.',
                    {
                        session: 'dead',
                        restriction: 'unknown',
                        restriction_reason: '',
                        spambot: {
                            state: 'not_checked',
                            reason: '',
                            source: 'session_invalid'
                        }
                    }
                ));
            }
            const { token, fingerprint } = userbotService.parseSessionData(decryptedData);

            if (account.account_type === 'bot') {
                try {
                    const botToken = String(token || decryptedData || '').trim();
                    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
                    const data = await response.json();
                    const status = data.ok ? 'online' : 'expired';
                    await supabase.from('tg_accounts').update({
                        runtime_status: status,
                        runtime_error: data.ok ? null : 'Telegram не подтвердил токен official-бота.',
                        last_checked_at: checkedAt
                    }).eq('id', account.id).eq('owner_id', req.user.id);
                    return res.json(buildCheckResponse(status, data.ok ? 'Official-бот отвечает.' : 'Telegram не подтвердил токен official-бота.'));
                } catch (e) {
                    await supabase.from('tg_accounts').update({
                        runtime_status: 'expired',
                        runtime_error: 'Telegram не ответил на проверку official-бота.',
                        last_checked_at: checkedAt
                    }).eq('id', account.id).eq('owner_id', req.user.id);
                    return res.json(buildCheckResponse('expired', 'Telegram не ответил на проверку official-бота.'));
                }
            }

            const proxyData = account.proxies ? { proxy_host: account.proxies.host, proxy_port: account.proxies.port, proxy_username: account.proxies.username, proxy_password: account.proxies.password } : undefined;
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);
            try {
                const health = await userbotService.inspectAccountHealth(client, {
                    userbotId: account.id
                });
                await supabase.from('tg_accounts').update({
                    runtime_status: health.status || 'error',
                    runtime_error: health.reason || null,
                    last_checked_at: checkedAt
                }).eq('id', account.id).eq('owner_id', req.user.id);
                console.log('[USERBOT_CHECK] result', {
                    accountId: account.id,
                    ownerId: req.user?.id || null,
                    nextStatus: health.status || 'error',
                    reason: health.reason || null
                });
                if (String(health.status || '') === 'restricted') {
                    await unpublishRestrictedUserbotListings(supabase, req.user.id, account.id, health.reason || 'account_restricted');
                    await cleanupRestrictedUserbotProxy(supabase, managedProxyService, req.user.id, account);
                }
                res.json(buildCheckResponse(
                    health.status,
                    health.reason || null,
                    health.details || null
                ));
                if (['restricted', 'expired', 'error'].includes(String(health.status || ''))) {
                    await logTelegramErrorEvent(supabase, {
                        owner_id: req.user.id,
                        userbot_id: account.id,
                        event_source: 'userbot_health',
                        event_type: 'health_check',
                        restriction_kind: health.status === 'restricted' ? 'account_restricted' : (health.status || 'error'),
                        severity: health.status === 'restricted' ? 'danger' : 'warning',
                        is_restriction: health.status === 'restricted',
                        error_message: health.reason || 'Проблема при health-check.',
                        meta: {
                            account_type: account.account_type || 'userbot'
                        }
                    });
                }
            }
            catch (authErr) {
                console.error('Ошибка health-check юзербота:', authErr);
                await supabase.from('tg_accounts').update({
                    runtime_status: 'expired',
                    runtime_error: authErr?.message || 'Проверка сессии не прошла.',
                    last_checked_at: checkedAt
                }).eq('id', account.id).eq('owner_id', req.user.id);
                console.error('[USERBOT_CHECK] auth_failed', {
                    accountId: account.id,
                    ownerId: req.user?.id || null,
                    nextStatus: 'expired',
                    reason: authErr?.message || 'Проверка сессии не прошла.'
                });
                await logTelegramErrorEvent(supabase, {
                    owner_id: req.user.id,
                    userbot_id: account.id,
                    event_source: 'userbot_health',
                    event_type: 'health_check',
                    error: authErr,
                    severity: 'danger',
                    meta: {
                        account_type: account.account_type || 'userbot'
                    }
                });
                res.json(buildCheckResponse(
                    'expired',
                    authErr?.message || 'Проверка сессии не прошла.',
                    {
                        session: 'dead',
                        restriction: 'unknown',
                        restriction_reason: '',
                        spambot: {
                            state: 'not_checked',
                            reason: '',
                            source: 'auth_error'
                        }
                    }
                ));
            }
            finally { await client.disconnect(); }
        } catch (error) { res.status(500).json({ error: 'Ошибка проверки' }); }
    });

    // =========================================================
    // 5. CRM И СИНХРОНИЗАЦИЯ КАНАЛОВ
    // =========================================================
    router.post('/sync-channels', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) return res.status(409).json({ error: userbotError || 'Подключите Юзербота.' });
            const { data: myBots } = await supabase.from('tg_accounts').select('*').eq('owner_id', req.user.id).eq('account_type', 'bot');
            if (!myBots || myBots.length === 0) return res.status(400).json({ error: 'У вас нет официальных ботов.' });

            const proxyData = userbot.proxies ? { proxy_host: userbot.proxies.host, proxy_port: userbot.proxies.port, proxy_username: userbot.proxies.username, proxy_password: userbot.proxies.password } : undefined;
            const { token, fingerprint } = userbotService.parseSessionData(decrypt(userbot.session_data));
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            const syncResults = [];
            try {
                const dialogs = await client.getDialogs({ limit: 50 });
                for (const dialog of dialogs) {
                    if (dialog.isChannel || dialog.isGroup) {
                        try {
                            const admins = await client.getParticipants(dialog.entity, { filter: new Api.ChannelParticipantsAdmins() });
                            for (const admin of admins) {
                                const matchedBot = myBots.find(b => String(b.tg_account_id) === String(admin.id));
                                if (matchedBot) {
                                    const chatIdStr = String(dialog.id);
                                    await supabase.from('channels').upsert({
                                        owner_id: req.user.id,
                                        bot_id: matchedBot.id,
                                        tg_chat_id: chatIdStr,
                                        title: dialog.title,
                                        chat_type: dialog.isGroup ? 'supergroup' : 'channel',
                                        username: String(dialog.entity?.username || '').trim().replace(/^@/, '') || null,
                                        visibility: dialog.entity?.username ? 'public' : 'private',
                                        last_visibility_check_at: new Date().toISOString()
                                    }, { onConflict: 'tg_chat_id' });
                                    if (!syncResults.find(r => r.chat_id === chatIdStr)) syncResults.push({ chat_id: chatIdStr, chat_name: dialog.title, bot_name: matchedBot.tg_username });
                                }
                            }
                        } catch (e) {}
                    }
                }
                res.json({ success: true, count: syncResults.length, results: syncResults });
            } finally { await client.disconnect(); }
        } catch (error) { res.status(500).json({ error: 'Ошибка синхронизации' }); }
    });

    router.get('/admin-audit', authenticateUser, async (req, res) => {
        try {
            const requestedUserbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const runScan = String(req.query.scan || '').trim().toLowerCase() === 'true';

            const { data: userbots } = await supabase
                .from('tg_accounts')
                .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'userbot')
                .order('created_at', { ascending: false });

            if (!userbots || userbots.length === 0) {
                return res.status(404).json({ error: 'Подключите Юзербота.' });
            }

            const preferredAuditableUserbots = userbots.filter(item => !isFreshImportedUserbot(item));
            const userbot = requestedUserbotId
                ? userbots.find(item => String(item.id) === requestedUserbotId)
                : preferredAuditableUserbots[0] || userbots[0];

            if (!userbot) {
                return res.status(404).json({ error: 'Выбранный юзербот не найден' });
            }

            if (isFreshImportedUserbot(userbot)) {
                return res.status(409).json({ error: FRESH_IMPORT_RUNTIME_REASON });
            }

            if (isUserbotOnDeadProxy(userbot)) {
                return res.status(409).json({ error: getDeadProxyMessage() });
            }

            if (!runScan) {
                return res.json({
                    success: true,
                    scan_required: true,
                    selected_userbot_id: userbot.id,
                    selected_userbot_username: userbot.tg_username || userbot.tg_account_id || null,
                    userbots: userbots.map(item => ({
                        id: item.id,
                        tg_username: item.tg_username || null,
                        tg_account_id: item.tg_account_id || null
                    })),
                    audits: []
                });
            }

            const { data: myBots } = await supabase
                .from('tg_accounts')
                .select('id, tg_account_id, tg_username')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'bot');

            const { data: linkedChannels } = await supabase
                .from('channels')
                .select('id, tg_chat_id, title, bot_id')
                .eq('owner_id', req.user.id);

            const proxyData = userbot.proxies
                ? {
                    proxy_host: userbot.proxies.host,
                    proxy_port: userbot.proxies.port,
                    proxy_username: userbot.proxies.username,
                    proxy_password: userbot.proxies.password
                }
                : undefined;

            const { token, fingerprint } = userbotService.parseSessionData(decrypt(userbot.session_data));
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            try {
                const me = await client.getMe();
                const dialogs = await client.getDialogs({ limit: 70 });
                const audits = [];

                for (const dialog of dialogs) {
                    if (!dialog.isChannel && !dialog.isGroup) continue;

                    const chatIdStr = String(dialog.id);
                    const linkedChannel = (linkedChannels || []).find(channel => String(channel.tg_chat_id) === chatIdStr);

                    try {
                        let adminIds = [];
                        let userbotAdmin = false;
                        let adminCheckSkipped = false;

                        if (linkedChannel) {
                            const admins = await client.getParticipants(dialog.entity, { filter: new Api.ChannelParticipantsAdmins() });
                            adminIds = admins.map(admin => String(admin.id));
                            userbotAdmin = adminIds.includes(String(me.id));
                        } else {
                            adminCheckSkipped = true;
                        }

                        const matchedBots = (myBots || []).filter(bot => adminIds.includes(String(bot.tg_account_id)));

                        audits.push({
                            chat_id: chatIdStr,
                            title: dialog.title,
                            userbot_admin: userbotAdmin,
                            admin_check_skipped: adminCheckSkipped,
                            official_bot_admin: matchedBots.length > 0,
                            official_bot_usernames: matchedBots.map(bot => bot.tg_username).filter(Boolean),
                            linked_channel_id: linkedChannel ? linkedChannel.id : null,
                            linked_bot_id: linkedChannel ? linkedChannel.bot_id : null
                        });
                    } catch (e) {
                        audits.push({
                            chat_id: chatIdStr,
                            title: dialog.title,
                            userbot_admin: false,
                            admin_check_skipped: false,
                            official_bot_admin: false,
                            official_bot_usernames: [],
                            linked_channel_id: linkedChannel ? linkedChannel.id : null,
                            linked_bot_id: linkedChannel ? linkedChannel.bot_id : null,
                            error: 'Не удалось проверить админов'
                        });
                    }
                }

                res.json({
                    success: true,
                    selected_userbot_id: userbot.id,
                    selected_userbot_username: userbot.tg_username || userbot.tg_account_id || null,
                    userbots: userbots.map(item => ({
                        id: item.id,
                        tg_username: item.tg_username || null,
                        tg_account_id: item.tg_account_id || null
                    })),
                    audits
                });
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            res.status(500).json({ error: 'Ошибка проверки админских прав' });
        }
    });

    router.get('/ops-center', authenticateUser, async (req, res) => {
        try {
            const requestedUserbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const runScan = String(req.query.scan || '').trim().toLowerCase() === 'true';
            const reservedUserbotIds = await loadReservedUserbotIds(supabase, req.user.id);
            const { data: paymentSettings } = await supabase
                .from('payment_settings')
                .select('admin_tg_id')
                .eq('owner_id', req.user.id)
                .maybeSingle();

            const { data: officialBots } = await supabase
                .from('tg_accounts')
                .select('id, tg_username, tg_account_id, bot_role')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'bot')
                .order('created_at', { ascending: true });

            const { data: userbots } = await supabase
                .from('tg_accounts')
                .select('*, proxies(id, name, host, port, username, password, is_working, provision_source, inventory_group, last_check_country, last_check_country_code)')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'userbot')
                .order('created_at', { ascending: false });

            if (!userbots || userbots.length === 0) {
                return res.status(404).json({ error: 'Подключите Юзербота.' });
            }

            if (requestedUserbotId && reservedUserbotIds.has(requestedUserbotId)) {
                return res.status(409).json({
                    error: 'Этот юзербот сейчас выставлен в shop и выведен из рабочей Telegram-операционки. Сними его с витрины или выбери другой аккаунт.'
                });
            }

            const operationalUserbots = userbots.filter((item) =>
                !reservedUserbotIds.has(String(item.id)) &&
                !isFreshImportedUserbot(item)
            );
            if (operationalUserbots.length === 0) {
                return res.status(409).json({
                    error: 'Сейчас нет ни одного активированного юзербота для рабочего центра. Свежие импорты сначала нужно вручную активировать живой проверкой.'
                });
            }

            const preferredUserbot = requestedUserbotId
                ? operationalUserbots.find(item => String(item.id) === requestedUserbotId)
                : operationalUserbots[0];

            if (!preferredUserbot) {
                return res.status(404).json({ error: 'Выбранный юзербот не найден' });
            }

            if (isFreshImportedUserbot(preferredUserbot)) {
                return res.status(409).json({ error: FRESH_IMPORT_RUNTIME_REASON });
            }

            const { data: linkedChannels } = await supabase
                .from('channels')
                .select('id, tg_chat_id, title, bot_id')
                .eq('owner_id', req.user.id);

            if (!runScan) {
                const cache = await loadUserbotCenterCache(supabase, req.user.id, preferredUserbot.id);
                return res.json({
                    success: true,
                    scan_required: !cache.scanned_at,
                    cache_source: cache.scanned_at ? 'database' : 'empty',
                    cache_scanned_at: cache.scanned_at,
                    selected_userbot_id: preferredUserbot.id,
                    selected_userbot_username: preferredUserbot.tg_username || preferredUserbot.tg_account_id || null,
                    signal_config: buildUserbotCenterSignalConfig(paymentSettings, officialBots),
                    userbots: operationalUserbots.map(item => buildUserbotCenterAccount(item)),
                    summary: buildUserbotCenterSummary(cache.groups, cache.conversations),
                    groups: cache.groups,
                    conversations: cache.conversations
                });
            }

            let userbot = null;
            let client = null;
            const runtimeStates = new Map();

            const orderedCandidates = requestedUserbotId
                ? [preferredUserbot, ...operationalUserbots.filter(item => String(item.id) !== requestedUserbotId)]
                : operationalUserbots;

            for (const candidate of orderedCandidates) {
                if (isUserbotOnDeadProxy(candidate)) {
                    runtimeStates.set(String(candidate.id), {
                        status: 'dead_proxy',
                        reason: getDeadProxyMessage()
                    });
                    continue;
                }

                try {
                    const candidateClient = await userbotService.createAuthorizedClient(candidate, 1);
                    const health = await userbotService.inspectAccountHealth(candidateClient, {
                        userbotId: candidate.id
                    });
                    if (health.status !== 'online') {
                        runtimeStates.set(String(candidate.id), health);
                        await candidateClient.disconnect();
                        continue;
                    }

                    runtimeStates.set(String(candidate.id), health);
                    userbot = candidate;
                    client = candidateClient;
                    break;
                } catch (error) {
                    const status = isExpiredUserbotSessionError(error) ? 'expired' : 'error';
                    runtimeStates.set(String(candidate.id), {
                        status,
                        reason: status === 'expired'
                            ? 'Сессия юзербота сдохла. Нужно переподключить аккаунт.'
                            : (error?.message || 'Юзербот сейчас не отвечает.')
                    });
                }
            }

            if (!userbot || !client) {
                const preferredState = runtimeStates.get(String(preferredUserbot.id));
                const fallbackMessage = preferredState?.reason || 'Сейчас нет ни одного живого юзербота для центра.';
                return res.status(409).json({
                    error: fallbackMessage,
                    userbots: operationalUserbots.map(item => buildUserbotCenterAccount(item, runtimeStates.get(String(item.id)) || {
                        status: 'unknown',
                        reason: null
                    }))
                });
            }

            try {
                const me = await client.getMe();
                const dialogs = await client.getDialogs({ limit: USERBOT_CENTER_DIALOG_LIMIT });
                const groups = [];
                const conversations = [];
                let adminChecks = 0;

                for (const dialog of dialogs) {
                    const previewText = String(dialog?.message?.message || '').trim();
                    const lastMessageAt = normalizeMessageDate(dialog?.message?.date);
                    const unreadCount = Number(dialog?.unreadCount || 0);

                    if (dialog.isChannel || dialog.isGroup) {
                        const chatIdStr = String(dialog.id);
                        const linkedChannel = (linkedChannels || []).find(channel => String(channel.tg_chat_id) === chatIdStr);

                        let userbotAdmin = false;
                        let adminError = null;
                        let adminCheckSkipped = false;

                        if (linkedChannel) {
                            try {
                                if (adminChecks > 0) {
                                    await sleep(USERBOT_CENTER_ADMIN_CHECK_DELAY_MS);
                                }
                                adminChecks += 1;
                                const admins = await client.getParticipants(dialog.entity, { filter: new Api.ChannelParticipantsAdmins() });
                                userbotAdmin = admins.some(admin => String(admin.id) === String(me.id));
                            } catch (error) {
                                adminError = 'Не удалось проверить админство';
                            }
                        } else {
                            adminCheckSkipped = true;
                        }

                        groups.push({
                            chat_id: chatIdStr,
                            title: dialog.title,
                            type: dialog.isChannel ? 'channel' : 'group',
                            unread_count: unreadCount,
                            last_message_preview: previewText || null,
                            last_message_at: lastMessageAt,
                            userbot_admin: userbotAdmin,
                            admin_check_skipped: adminCheckSkipped,
                            linked_channel_id: linkedChannel?.id || null,
                            linked_channel_title: linkedChannel?.title || null,
                            admin_error: adminError
                        });
                        continue;
                    }

                    const entity = dialog.entity;
                    if (!entity || entity.className !== 'User' || entity.bot || entity.self) {
                        continue;
                    }

                    conversations.push({
                        tg_user_id: String(entity.id),
                        username: entity.username || null,
                        display_name: [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim() || entity.username || `ID ${entity.id}`,
                        unread_count: unreadCount,
                        last_message_preview: previewText || null,
                        last_message_at: lastMessageAt,
                        last_outgoing: !!dialog?.message?.out,
                        sales_signal: !dialog?.message?.out && detectSalesSignal(previewText)
                    });
                }

                groups.sort((a, b) => {
                    if (b.userbot_admin !== a.userbot_admin) return Number(b.userbot_admin) - Number(a.userbot_admin);
                    if ((b.unread_count || 0) !== (a.unread_count || 0)) return (b.unread_count || 0) - (a.unread_count || 0);
                    return String(b.last_message_at || '').localeCompare(String(a.last_message_at || ''));
                });

                conversations.sort((a, b) => {
                    if (b.sales_signal !== a.sales_signal) return Number(b.sales_signal) - Number(a.sales_signal);
                    if ((b.unread_count || 0) !== (a.unread_count || 0)) return (b.unread_count || 0) - (a.unread_count || 0);
                    return String(b.last_message_at || '').localeCompare(String(a.last_message_at || ''));
                });

                const conversationIds = conversations.map(item => item.tg_user_id);
                let notificationMap = {};
                if (conversationIds.length > 0) {
                    const { data: notifications } = await supabase
                        .from('userbot_inbox_notifications')
                        .select('dialog_tg_user_id, notified_at, last_message_id')
                        .eq('owner_id', req.user.id)
                        .eq('userbot_id', userbot.id)
                        .in('dialog_tg_user_id', conversationIds)
                        .order('notified_at', { ascending: false });

                    notificationMap = Object.fromEntries(
                        (notifications || []).map(item => [
                            String(item.dialog_tg_user_id),
                            {
                                notified_at: item.notified_at || null,
                                last_message_id: item.last_message_id || null
                            }
                        ])
                    );
                }

                const enrichedConversations = conversations.map(conversation => ({
                    ...conversation,
                    signal_notified_at: notificationMap[String(conversation.tg_user_id)]?.notified_at || null,
                    signal_last_message_id: notificationMap[String(conversation.tg_user_id)]?.last_message_id || null
                }));

                const scannedAt = new Date().toISOString();
                await replaceUserbotCenterCache(supabase, req.user.id, userbot.id, groups, enrichedConversations, scannedAt);

                res.json({
                    success: true,
                    scan_required: false,
                    cache_source: 'telegram',
                    cache_scanned_at: scannedAt,
                    selected_userbot_id: userbot.id,
                    selected_userbot_username: userbot.tg_username || userbot.tg_account_id || null,
                    signal_config: buildUserbotCenterSignalConfig(paymentSettings, officialBots),
                    userbots: operationalUserbots.map(item => buildUserbotCenterAccount(item, runtimeStates.get(String(item.id)) || null)),
                    summary: buildUserbotCenterSummary(groups, enrichedConversations),
                    groups,
                    conversations: enrichedConversations
                });
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            console.error('Ошибка центра юзербота:', error);
            res.status(500).json({ error: 'Ошибка загрузки центра юзербота' });
        }
    });

    router.get('/ops-center/thread', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const tgUserId = req.query.tg_user_id ? String(req.query.tg_user_id) : null;

            if (!tgUserId) {
                return res.status(400).json({ error: 'Не передан TG ID диалога' });
            }

            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId);
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            const client = await userbotService.createAuthorizedClient(userbot, 1);
            try {
                let peer = null;

                try {
                    peer = await client.getInputEntity(tgUserId);
                } catch {
                    peer = null;
                }

                if (!peer) {
                    return res.json({
                        success: true,
                        messages: [],
                        unavailable_reason: 'Безопасный режим: тред открываем только по уже известному диалогу. Шумный поиск по чатам сейчас отключен.'
                    });
                }

                const messages = await client.getMessages(peer, { limit: 20 });
                const rows = (messages || [])
                    .map(message => ({
                        id: String(message.id),
                        outgoing: !!message.out,
                        text: String(message.message || '').trim(),
                        date: normalizeMessageDate(message.date)
                    }))
                    .filter(message => message.text || message.date)
                    .reverse();

                res.json({ success: true, messages: rows, unavailable_reason: null });
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            console.error('Ошибка загрузки треда юзербота:', error);
            res.status(500).json({ error: 'Ошибка загрузки переписки' });
        }
    });

    router.post('/ops-center/mark-read', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const tgUserId = req.body?.tg_user_id ? String(req.body.tg_user_id) : null;

            if (!tgUserId) {
                return res.status(400).json({ error: 'Не передан TG ID диалога' });
            }

            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            await userbotService.markDialogAsRead(userbot, tgUserId);
            res.json({ success: true });
        } catch (error) {
            console.error('Ошибка отметки диалога как прочитанного:', error);
            res.status(500).json({ error: error?.message || 'Не получилось отметить диалог как прочитанный' });
        }
    });

    router.post('/ops-center/join-invite', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const inviteLink = String(req.body?.invite_link || '').trim();
            if (!inviteLink) {
                return res.status(400).json({ error: 'Не вставлена пригласительная ссылка' });
            }

            const parsedInvite = parseTelegramInvite(inviteLink);
            if (!parsedInvite) {
                return res.status(400).json({ error: 'Ссылка кривовата. Жду t.me/+hash, joinchat или публичный t.me/username.' });
            }

            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            const client = await userbotService.createAuthorizedClient(userbot, 1);
            try {
                let title = 'Неизвестная группа';
                let chatId = null;

                if (parsedInvite.kind === 'invite_hash') {
                    const result = await client.invoke(new Api.messages.ImportChatInvite({
                        hash: parsedInvite.value
                    }));
                    const chat = result?.chats?.[0] || null;
                    title = chat?.title || title;
                    chatId = chat?.id ? String(chat.id) : null;
                } else {
                    const entity = await client.getEntity(parsedInvite.value);
                    await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
                    title = entity?.title || entity?.username || title;
                    chatId = entity?.id ? String(entity.id) : null;
                }

                res.json({
                    success: true,
                    title,
                    chat_id: chatId,
                    userbot_id: userbot.id
                });
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            console.error('Ошибка входа по инвайту:', error);
            res.status(500).json({ error: 'Не получилось зайти по ссылке этим юзерботом' });
        }
    });

    router.get('/ops-center/authorizations', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId);
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            const authorizations = await userbotService.getAccountAuthorizations(userbot);
            res.json({ success: true, authorizations });
        } catch (error) {
            console.error('Ошибка загрузки активных сессий юзербота:', error);
            res.status(500).json({ error: error?.message || 'Не получилось загрузить активные сессии' });
        }
    });

    router.post('/ops-center/authorizations/reset-others', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            const authorizations = await userbotService.resetOtherAuthorizations(userbot);
            res.json({
                success: true,
                authorizations,
                message: 'Все остальные Telegram-сессии этого аккаунта разлогинены. На сервисе осталась текущая сессия.'
            });
        } catch (error) {
            console.error('Ошибка сброса остальных сессий юзербота:', error);
            res.status(500).json({ error: error?.message || 'Не получилось разлогинить остальные устройства' });
        }
    });

    router.get('/error-events', authenticateUser, async (req, res) => {
        try {
            const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
            const userbotId = req.query.userbot_id ? String(req.query.userbot_id) : '';
            const restrictionsOnly = String(req.query.restrictions_only || '').trim().toLowerCase() === 'true';

            let query = supabase
                .from('telegram_error_events')
                .select('id, owner_id, userbot_id, tg_user_id, event_source, event_type, severity, restriction_kind, is_restriction, error_code, error_message, happened_at, meta')
                .eq('owner_id', req.user.id)
                .order('happened_at', { ascending: false })
                .limit(limit);

            if (userbotId) {
                query = query.eq('userbot_id', userbotId);
            }
            if (restrictionsOnly) {
                query = query.eq('is_restriction', true);
            }

            const { data, error } = await query;
            if (error) throw error;

            res.json({
                success: true,
                events: data || []
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Не удалось загрузить журнал Telegram-ошибок.' });
        }
    });

    // =========================================================
    // 6. СКАНЕР УЧАСТНИКОВ (FETCH MEMBERS)
    // =========================================================
    router.post('/fetch-members', authenticateUser, async (req, res) => {
        const { tg_chat_id, userbot_id } = req.body;
        if (!tg_chat_id) return res.status(400).json({ error: 'ID чата не передан' });

        try {
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbot_id ? String(userbot_id) : null, {
                allowFailover: true
            });
            if (!userbot) return res.status(409).json({ error: userbotError || 'У вас не подключен Юзербот.' });

            const { data: channel } = await supabase.from('channels').select('id').eq('tg_chat_id', String(tg_chat_id)).single();

            const proxyData = userbot.proxies ? { proxy_host: userbot.proxies.host, proxy_port: userbot.proxies.port, proxy_username: userbot.proxies.username, proxy_password: userbot.proxies.password } : undefined;
            const { token, fingerprint } = userbotService.parseSessionData(decrypt(userbot.session_data));
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);

            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            try {
                const participants = await client.getParticipants(tg_chat_id, { limit: 300 });

                let activeSubs = [];
                if (channel) {
                    const { data: subs } = await supabase.from('subscriptions').select('*').eq('channel_id', channel.id).eq('status', 'active');
                    if (subs) activeSubs = subs;
                }

                const members = participants.map(p => {
                    const participantIdStr = String(p.id);
                    const sub = activeSubs.find(s => String(s.tg_user_id) === participantIdStr);

                    return {
                        id: participantIdStr,
                        username: p.username || null,
                        first_name: p.firstName || '',
                        last_name: p.lastName || '',
                        is_bot: p.bot || false,
                        is_premium: p.premium || false,
                        has_subscription: !!sub,
                        expires_at: sub ? sub.expires_at : null
                    };
                });

                res.json({ success: true, chat_id: tg_chat_id, count: members.length, members: members });
            } finally { await client.disconnect(); }
        } catch (error) { res.status(500).json({ error: 'Внутренняя ошибка сервера' }); }
    });

    // =========================================================
    // 7. CRM БАЗА КЛИЕНТОВ - ПОЛУЧЕНИЕ
    // =========================================================
    router.get('/crm/subscribers', authenticateUser, async (req, res) => {
        try {
            const { data: channels } = await supabase.from('channels').select('id, title').eq('owner_id', req.user.id);
            if (!channels || channels.length === 0) return res.json({ subscribers: [] });

            const channelIds = channels.map(c => c.id);
            const { data: subs, error } = await supabase.from('subscriptions').select('*').in('channel_id', channelIds).order('created_at', { ascending: false });
            if (error) throw error;

            const result = subs.map(sub => {
                const ch = channels.find(c => c.id === sub.channel_id);
                return { ...sub, channel_title: ch ? ch.title : 'Неизвестный канал' };
            });

            res.json({ subscribers: result });
        } catch (error) { res.status(500).json({ error: 'Ошибка загрузки базы данных' }); }
    });

    // =========================================================
    // 8. CRM БАЗА КЛИЕНТОВ - ПОДАРИТЬ ДНИ
    // =========================================================
    router.post('/crm/subscribers/:id/add-days', authenticateUser, async (req, res) => {
        const subId = req.params.id;
        const { days } = req.body;

        try {
            const { data: sub } = await supabase.from('subscriptions').select('*').eq('id', subId).single();
            if (!sub) return res.status(404).json({ error: 'Подписка не найдена' });

            const { data: channel } = await supabase.from('channels').select('*').eq('id', sub.channel_id).single();
            if (!channel || channel.owner_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });

            let newExpiresAt = null;
            if (days !== 'forever') {
                const now = new Date();
                let baseDate = new Date();
                if (sub.status === 'active' && sub.expires_at) {
                    const currentExp = new Date(sub.expires_at);
                    if (currentExp > now) baseDate = currentExp;
                }
                baseDate.setDate(baseDate.getDate() + parseInt(days));
                newExpiresAt = baseDate.toISOString();
            }

            await supabase.from('subscriptions').update({ expires_at: newExpiresAt, status: 'active' }).eq('id', subId);
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: 'Внутренняя ошибка' }); }
    });

    router.post('/crm/subscribers/batch-add-days', authenticateUser, async (req, res) => {
        const subscriptionIds = Array.isArray(req.body?.subscription_ids) ? req.body.subscription_ids.map(String) : [];
        const { days } = req.body || {};

        if (subscriptionIds.length === 0) {
            return res.status(400).json({ error: 'Не переданы подписки для продления' });
        }

        try {
            const { data: subscriptions, error } = await supabase
                .from('subscriptions')
                .select('*')
                .in('id', subscriptionIds);

            if (error) throw error;
            if (!subscriptions || subscriptions.length === 0) {
                return res.status(404).json({ error: 'Подписки не найдены' });
            }

            const channelIds = Array.from(new Set(subscriptions.map(sub => sub.channel_id).filter(Boolean)));
            const { data: channels, error: channelsError } = await supabase
                .from('channels')
                .select('id, owner_id')
                .in('id', channelIds);

            if (channelsError) throw channelsError;

            const ownedChannelIds = new Set((channels || []).filter(channel => channel.owner_id === req.user.id).map(channel => channel.id));
            const allowedSubscriptions = subscriptions.filter(sub => ownedChannelIds.has(sub.channel_id));

            if (allowedSubscriptions.length === 0) {
                return res.status(403).json({ error: 'Нет доступа к этим подпискам' });
            }

            let updated = 0;

            for (const sub of allowedSubscriptions) {
                let newExpiresAt = null;
                if (days !== 'forever') {
                    const now = new Date();
                    let baseDate = new Date();
                    if (sub.status === 'active' && sub.expires_at) {
                        const currentExp = new Date(sub.expires_at);
                        if (currentExp > now) baseDate = currentExp;
                    }
                    baseDate.setDate(baseDate.getDate() + parseInt(days));
                    newExpiresAt = baseDate.toISOString();
                }

                const updates = {
                    expires_at: newExpiresAt,
                    status: 'active'
                };

                if (sub.last_access_event === 'kicked') {
                    updates.last_access_event = 'manual_restore';
                    updates.access_note = days === 'forever'
                        ? 'Доступ восстановлен вручную из админки навсегда'
                        : `Доступ восстановлен вручную из админки на ${parseInt(days)} дней`;
                }

                const { error: updateError } = await supabase
                    .from('subscriptions')
                    .update(updates)
                    .eq('id', sub.id);

                if (!updateError) {
                    if (sub.last_access_event === 'kicked') {
                        await supabase.from('access_events').insert({
                            owner_id: req.user.id,
                            channel_id: sub.channel_id,
                            subscription_id: sub.id,
                            invoice_id: null,
                            invite_id: null,
                            tg_user_id: String(sub.tg_user_id),
                            event_type: 'restored',
                            event_source: 'manual_restore',
                            payload: {
                                days: days === 'forever' ? 'forever' : parseInt(days),
                                source: 'admin_extend',
                                note: days === 'forever'
                                    ? 'Доступ восстановлен вручную из админки навсегда'
                                    : `Доступ восстановлен вручную из админки на ${parseInt(days)} дней`
                            }
                        });
                    }

                    updated += 1;
                }
            }

            res.json({
                success: true,
                requested: subscriptionIds.length,
                updated
            });
        } catch (error) {
            console.error('Ошибка batch-add-days:', error);
            res.status(500).json({ error: 'Внутренняя ошибка batch-продления' });
        }
    });

    router.post('/crm/subscribers/batch-kick', authenticateUser, async (req, res) => {
        const subscriptionIds = Array.isArray(req.body?.subscription_ids) ? req.body.subscription_ids.map(String) : [];
        const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
        const batchKickSource = resolveBatchKickCallSource(
            req.body?.action_source,
            req.body?.source,
            req.body?.event_source
        );

        if (subscriptionIds.length === 0) {
            return res.status(400).json({ error: 'Не переданы подписки для кика' });
        }

        try {
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });

            const { data: subscriptions, error } = await supabase
                .from('subscriptions')
                .select('id, tg_user_id, channel_id, status, expires_at')
                .in('id', subscriptionIds);

            if (error) throw error;
            if (!subscriptions || subscriptions.length === 0) {
                return res.status(404).json({ error: 'Подписки не найдены' });
            }

            const channelIds = Array.from(new Set(subscriptions.map(sub => sub.channel_id).filter(Boolean)));
            const { data: channels, error: channelsError } = await supabase
                .from('channels')
                .select('id, owner_id, tg_chat_id')
                .in('id', channelIds);

            if (channelsError) throw channelsError;

            const channelMap = new Map((channels || []).filter(channel => channel.owner_id === req.user.id).map(channel => [channel.id, channel]));
            const allowedSubscriptions = subscriptions.filter(sub => channelMap.has(sub.channel_id));

            if (allowedSubscriptions.length === 0) {
                return res.status(403).json({ error: 'Нет доступа к этим подпискам' });
            }

            let kicked = 0;

            for (const sub of allowedSubscriptions) {
                const channel = channelMap.get(sub.channel_id);
                if (!channel?.tg_chat_id) continue;

                try {
                    await userbotService.kickMemberFromChannel(userbot, channel.tg_chat_id, sub.tg_user_id);

                    await supabase.from('access_events').insert({
                        owner_id: req.user.id,
                        channel_id: sub.channel_id,
                        subscription_id: sub.id,
                        invoice_id: null,
                        invite_id: null,
                        tg_user_id: String(sub.tg_user_id),
                        event_type: 'kicked',
                        event_source: batchKickSource.eventSource,
                        payload: {
                            source: batchKickSource.payloadSource,
                            note: batchKickSource.accessNote,
                            ...(batchKickSource.removalKind
                                ? { removal_kind: batchKickSource.removalKind }
                                : {})
                        }
                    });

                    const subscriptionPatch = {
                        last_access_event: 'kicked',
                        access_note: batchKickSource.accessNote
                    };

                    if (batchKickSource.shouldExpireSubscription) {
                        subscriptionPatch.status = 'expired';
                    }

                    await supabase
                        .from('subscriptions')
                        .update(subscriptionPatch)
                        .eq('id', sub.id);

                    kicked += 1;
                } catch (kickError) {
                    console.error(`Ошибка batch-kick для ${sub.tg_user_id}:`, kickError.message);
                }
            }

            res.json({
                success: true,
                requested: subscriptionIds.length,
                kicked
            });
        } catch (error) {
            console.error('Ошибка batch-kick:', error);
            res.status(500).json({ error: 'Внутренняя ошибка batch-кика' });
        }
    });

    // =========================================================
    // 9. ОТПРАВКА СООБЩЕНИЯ В ЛИЧКУ
    // =========================================================
    router.post('/send-message', authenticateUser, async (req, res) => {
        if (!isUserbotDmEnabled()) {
            return res.status(403).json({
                error: 'Ручная отправка в ЛС через юзербота сейчас отключена в конфиге.'
            });
        }
        if (req.body?.manual_confirmed !== true) {
            return res.status(403).json({
                error: 'ЛС через юзербота теперь отправляются только после явного подтверждения из интерфейса.'
            });
        }
        const { tg_user_id, message, userbot_id, common_chat_id, known_dialog } = req.body;
        if (!tg_user_id || !message) return res.status(400).json({ error: 'Не указан ID пользователя или текст' });
        if (!/^\d+$/.test(String(tg_user_id).trim())) {
            return res.status(400).json({ error: 'TG ID должен быть числовым.' });
        }
        if (String(message).trim().length > 4000) {
            return res.status(400).json({ error: 'Сообщение слишком длинное. Оставь до 4000 символов.' });
        }
        if (!String(common_chat_id || '').trim() && known_dialog !== true) {
            return res.status(400).json({
                error: 'Для ручной отправки по TG ID теперь нужен явный общий чат. Если диалог уже открыт в центре, отвечай из существующей переписки.'
            });
        }

        try {
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbot_id ? String(userbot_id) : null, {
                allowFailover: true
            });
            if (!userbot) return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });

            await userbotService.sendMessage(userbot, tg_user_id, String(message).trim(), {
                common_chat_id: common_chat_id ? String(common_chat_id).trim() : ''
            });
            res.json({ success: true });
        } catch (error) {
            const text = String(error?.message || '');
            const status = (
                text.includes('Юзербот не знает этот TG ID')
                || text.includes('заблокировал юзербота')
                || text.includes('приватность')
                || text.includes('flood wait')
                || text.includes('не может писать')
                || text.includes('Сессия юзербота сдохла')
            ) ? 400 : 500;
            res.status(status).json({ error: text || 'Внутренняя ошибка сервера' });
        }
    });

    // =========================================================
    // 10. МАССОВЫЙ ИМПОРТ ИЗ СКАНЕРА
    // =========================================================
    router.post('/crm/import', authenticateUser, async (req, res) => {
        const { tg_user_ids, days, channel_id } = req.body;

        if (!tg_user_ids || !Array.isArray(tg_user_ids) || tg_user_ids.length === 0) {
            return res.status(400).json({ error: 'Не переданы пользователи' });
        }

        if (!channel_id) {
            return res.status(400).json({ error: 'Не передан канал для импорта' });
        }

        try {
            const { data: channel } = await supabase
                .from('channels')
                .select('*')
                .eq('id', channel_id)
                .eq('owner_id', req.user.id)
                .single();

            if (!channel) return res.status(400).json({ error: 'Канал не найден или недоступен' });

            let expiresAt = null;
            if (days !== 'forever') {
                const date = new Date();
                date.setDate(date.getDate() + parseInt(days));
                expiresAt = date.toISOString();
            }

            const upsertData = tg_user_ids.map(uid => ({
                tg_user_id: String(uid),
                                                       channel_id: channel.id,
                                                       status: 'active',
                                                       expires_at: expiresAt
            }));

            const { error: insertError } = await supabase.from('subscriptions').upsert(upsertData, { onConflict: 'tg_user_id, channel_id' });
            if (insertError) throw insertError;

            res.json({ success: true, imported_count: tg_user_ids.length });
        } catch (error) { res.status(500).json({ error: 'Ошибка БД при импорте' }); }
    });

    // =========================================================
    // 11. ПРОВЕРКА НАЛИЧИЯ ПОЛЬЗОВАТЕЛЕЙ В ГРУППАХ
    // =========================================================
    router.get('/crm/presence', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId);
            if (!userbot) return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });

            const { data: channels } = await supabase.from('channels').select('*').eq('owner_id', req.user.id);
            if (!channels || channels.length === 0) return res.json({ presence: {} });

            const proxyData = userbot.proxies ? { proxy_host: userbot.proxies.host, proxy_port: userbot.proxies.port, proxy_username: userbot.proxies.username, proxy_password: userbot.proxies.password } : undefined;
            const { token, fingerprint } = userbotService.parseSessionData(decrypt(userbot.session_data));
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);

            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            const presenceMap = {};

            try {
                for (const channel of channels) {
                    try {
                        const participants = await client.getParticipants(channel.tg_chat_id, { limit: 5000 });
                        presenceMap[channel.id] = participants.map(p => String(p.id));
                    } catch (e) {
                        presenceMap[channel.id] = [];
                    }
                }
                res.json({ success: true, presence: presenceMap });
            } finally { await client.disconnect(); }
        } catch (error) { res.status(500).json({ error: 'Внутренняя ошибка сервера при проверке присутствия' }); }
    });

    return router;
}
