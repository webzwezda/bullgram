import { loadReservedUserbotIds } from './shop-reservations.js';
import { getTierRules } from './product-tier.js';

export const DEFAULT_ADMIN_PROXY_GROUP = 'shop_sale';

export function normalizeProxyProtocol(value = '') {
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

export function parseProxyPasteInput(rawInput = '') {
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

export function normalizeAdminInventoryGroup(value, fallback = DEFAULT_ADMIN_PROXY_GROUP) {
    if (value === 'self_use') return 'self_use';
    if (value === 'shop_sale') return 'shop_sale';
    return fallback;
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

export async function supportsProxyProvisionSource(supabase) {
    const { error } = await supabase
        .from('proxies')
        .select('provision_source')
        .limit(1);

    if (!error) return true;
    if (isMissingProxyProvisionColumn(error)) return false;
    throw error;
}

export async function supportsProxyInventoryGroup(supabase) {
    const { error } = await supabase
        .from('proxies')
        .select('inventory_group')
        .limit(1);

    if (!error) return true;
    if (isMissingProxyInventoryGroupColumn(error)) return false;
    throw error;
}

export async function buildAgentInfraPayload({ supabase, user, profile }) {
    const sourceSupported = await supportsProxyProvisionSource(supabase);
    const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);
    const tierRules = getTierRules(profile);
    const reservedUserbotIds = await loadReservedUserbotIds(supabase, user.id);

    const [{ data: proxies, error: proxiesError }, { data: accounts, error: accountsError }] = await Promise.all([
        supabase
            .from('proxies')
            .select([
                'id, name, host, port, is_working, last_checked_at, last_check_error',
                sourceSupported ? 'provision_source' : null,
                inventoryGroupSupported ? 'inventory_group' : null
            ].filter(Boolean).join(', '))
            .eq('owner_id', user.id),
        supabase
            .from('tg_accounts')
            .select('id, account_type, tg_username, tg_account_id, runtime_status, proxy_id')
            .eq('owner_id', user.id)
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

    return {
        summary: {
            profile_role: profile?.role || null,
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
        },
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
    };
}
