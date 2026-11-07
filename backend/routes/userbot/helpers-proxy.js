// Proxy-хелперы юзербот-роутера: парсеры вставки proxy-строк, маскировка кредов,
// лёгкий cooldown ручной проверки (единственный module-level Map), фоновая
// проверка managed-proxy, классификаторы колонок миграций и подсчёты
// эксклюзивного назначения «1 прокси = 1 юзербот».
// Вынесено дословно из userbot.routes.js на стадии 1 разрезки (2026-11-06).
// DEFAULT_ADMIN_PROXY_GROUP / MAX_MANAGED_PROXY_BATCH с стадии 2a объявлены
// в ./constants.js (общая копия, без цикла через userbot.routes.js).
import fs from 'fs';
import { MANAGED_PROXY_PENDING_MARKER } from '../../utils/proxy-batch.js';
import { DEFAULT_ADMIN_PROXY_GROUP, MAX_MANAGED_PROXY_BATCH } from './constants.js';

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

function isManagedProxyPending(proxy) {
    return (proxy.provision_source || 'manual_free') === 'manual_admin'
        && proxy.is_working == null
        && String(proxy.last_check_error || '').includes(MANAGED_PROXY_PENDING_MARKER);
}

// Креды прокси не отдаем в API даже админу: маскированный username сохраняет
// опознавательный префикс (mp_* для managed), password не отдаем совсем.
function maskCredential(value) {
    const raw = String(value || '');
    if (!raw) return null;
    if (raw.length <= 4) return '***';
    return `${raw.slice(0, 3)}***`;
}

// Лёгкий кулдаун ручной проверки прокси: Map «userId:proxyId -> timestamp».
const PROXY_CHECK_COOLDOWN_MS = 10 * 1000;
const proxyCheckCooldown = new Map();

function normalizeManagedBatchCount(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) return 1;
    return Math.min(parsed, MAX_MANAGED_PROXY_BATCH);
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
                provision_source: 'manual_admin',
                force_ipv6: true
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

export {
    parseProxyPasteInput,
    normalizeAdminInventoryGroup,
    isManagedProxyPending,
    maskCredential,
    PROXY_CHECK_COOLDOWN_MS,
    proxyCheckCooldown,
    normalizeManagedBatchCount,
    launchManagedProxyVerification,
    cleanupUploadedFiles,
    loadOwnedProxy,
    supportsProxyProvisionSource,
    supportsProxyInventoryGroup,
    countManualFreeProxies,
    countOwnedManualProxies,
    ensureExclusiveProxyAssignment,
    ensureUserbotNotOwnedByAnotherAdmin
};
