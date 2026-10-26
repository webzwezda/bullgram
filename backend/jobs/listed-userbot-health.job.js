import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { decrypt } from '../utils/crypto.js';
import { logTelegramErrorEvent } from '../utils/telegram-error-events.js';
import { cleanupRestrictedUserbotProxy, unpublishRestrictedUserbotListings } from '../utils/restricted-userbot-ops.js';
import { ManagedProxyService } from '../services/managed-proxy.service.js';

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_CONNECT_TIMEOUT_MS = 25_000;
const DEFAULT_INSPECT_TIMEOUT_MS = 35_000;
const QUARANTINE_STATUSES = ['restricted', 'expired', 'dead_proxy', 'error', 'frozen'];

function listedHealthCheckEnabled() {
    return String(process.env.USERBOT_LISTED_HEALTH_CHECK_ENABLED || '').trim().toLowerCase() !== 'false';
}

function getIntervalMs() {
    const raw = Number(process.env.USERBOT_LISTED_HEALTH_INTERVAL_MS || DEFAULT_INTERVAL_MS);
    if (!Number.isFinite(raw) || raw < MIN_INTERVAL_MS) {
        return DEFAULT_INTERVAL_MS;
    }
    return raw;
}

function getConnectTimeoutMs() {
    const raw = Number(process.env.USERBOT_HEALTH_CONNECT_TIMEOUT_MS || DEFAULT_CONNECT_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CONNECT_TIMEOUT_MS;
}

function getInspectTimeoutMs() {
    const raw = Number(process.env.USERBOT_HEALTH_INSPECT_TIMEOUT_MS || DEFAULT_INSPECT_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INSPECT_TIMEOUT_MS;
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

// Юзерботы из опубликованных лотов: два запроса по образцу loadReservedAssetMap,
// supabase-js join тут не нужен.
async function loadListedUserbots(supabase) {
    const { data: items, error: itemsError } = await supabase
        .from('shop_items')
        .select('id')
        .eq('status', 'published')
        .in('visibility', ['public', 'unlisted']);
    if (itemsError) throw itemsError;
    if (!items?.length) return [];

    const { data: assets, error: assetsError } = await supabase
        .from('shop_item_assets')
        .select('asset_id')
        .eq('asset_type', 'userbot')
        .in('shop_item_id', items.map(item => item.id));
    if (assetsError) throw assetsError;

    const ids = Array.from(new Set((assets || []).map(asset => String(asset.asset_id))));
    if (!ids.length) return [];

    const { data: accounts, error: accountsError } = await supabase
        .from('tg_accounts')
        .select('id, owner_id, tg_username, proxy_id, runtime_status, session_data, last_checked_at')
        .eq('account_type', 'userbot')
        .in('id', ids);
    if (accountsError) throw accountsError;
    return accounts || [];
}

function classifyCheckFailure(rawError, connectOk) {
    const message = String(rawError?.message || rawError || '');
    const normalized = message.toUpperCase();
    if (!connectOk) {
        return { status: 'dead_proxy', reason: 'Telegram не ответил на подключение за отведенное время.' };
    }
    if (normalized.includes('USER_DEACTIVATED') || normalized.includes('AUTH_KEY_INVALID')) {
        return { status: 'expired', reason: message || 'Сессия недействительна.' };
    }
    return { status: 'error', reason: message || 'Проверка сессии не прошла.' };
}

async function checkUserbotHealth(supabase, userbotService, account, proxy) {
    // Полное зеркало loadOwnedProxy: force_ipv6 обязателен для managed-слотов,
    // иначе сессия идёт на IPv4-DC мимо IPv6-only прокси (см. intake-resting.job.js).
    const proxyData = proxy
        ? {
            proxy_host: proxy.host,
            proxy_port: proxy.port,
            proxy_username: proxy.username,
            proxy_password: proxy.password,
            provision_source: proxy.provision_source,
            inventory_group: proxy.inventory_group,
            is_working: proxy.is_working,
            last_check_ip: proxy.last_check_ip,
            force_ipv6: proxy.is_working === true && (!proxy.last_check_ip || String(proxy.last_check_ip).includes(':'))
        }
        : undefined;

    if (proxy && proxy.is_working === false) {
        return { status: 'dead_proxy', reason: 'У юзербота мертвый прокси.', details: null };
    }

    const decryptedData = decrypt(account.session_data);
    if (!decryptedData) {
        return { status: 'expired', reason: 'Сессия не читается или уже недействительна.', details: null };
    }

    const { token, fingerprint } = userbotService.parseSessionData(decryptedData);
    const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
    const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
    userbotService.prepareServiceClient(client);
    userbotService._forceManagedIpv6Dc(client, proxyData);

    let connectOk = false;
    let getMeOk = false;
    try {
        await withTimeout(
            userbotService.connectWithProxyFallback(client, proxyData),
            getConnectTimeoutMs(),
            'Telegram не ответил на подключение за отведенное время.'
        );
        connectOk = true;
        await withTimeout(client.getMe(), getInspectTimeoutMs(), 'Telegram не отдал профиль аккаунта за отведенное время.');
        getMeOk = true;
        const health = await withTimeout(
            userbotService.inspectAccountHealth(client, { userbotId: account.id }),
            getInspectTimeoutMs(),
            'Telegram health-check завис на SpamBot/profile check.'
        );
        return {
            status: health.status || 'error',
            reason: health.reason || null,
            details: health.details || null
        };
    } catch (error) {
        // Как в ручной проверке (userbot.routes.js): сессия отвечает, но
        // SpamBot/profile check не успел — это деградация, а не смерть,
        // с витрины такой лот снимать нельзя.
        if (getMeOk) {
            return { status: 'online', reason: null, details: null };
        }
        const classified = classifyCheckFailure(error, connectOk);
        return { ...classified, details: null };
    } finally {
        await client.disconnect().catch(() => {});
    }
}

export async function runListedHealthCheck(supabase, userbotService, { checkFn = checkUserbotHealth } = {}) {
    const accounts = await loadListedUserbots(supabase);
    if (!accounts.length) return;

    const minCheckAgeMs = 60 * 60 * 1000;
    const nowMs = Date.now();
    const targets = accounts.filter(account => {
        const checkedAt = account.last_checked_at ? new Date(account.last_checked_at).getTime() : 0;
        return !checkedAt || (nowMs - checkedAt) >= minCheckAgeMs;
    });
    if (!targets.length) return;

    console.log('[ListedUserbotHealth] run', { accounts: targets.length });

    for (const account of targets) {
        try {
            let proxy = null;
            if (account.proxy_id) {
                const { data: proxyRow, error: proxyError } = await supabase
                    .from('proxies')
                    .select('host, port, username, password, is_working, last_check_ip, provision_source, inventory_group')
                    .eq('id', account.proxy_id)
                    .maybeSingle();
                if (proxyError) throw proxyError;
                proxy = proxyRow || null;
            }

            const result = await checkFn(supabase, userbotService, account, proxy);
            const status = String(result.status || 'error');
            const checkedAt = new Date().toISOString();

            await supabase
                .from('tg_accounts')
                .update({
                    runtime_status: status,
                    runtime_error: result.reason || null,
                    last_checked_at: checkedAt
                })
                .eq('id', account.id)
                .eq('owner_id', account.owner_id);

            if (status === 'restricted') {
                await logTelegramErrorEvent(supabase, {
                    owner_id: account.owner_id,
                    userbot_id: account.id,
                    event_source: 'userbot_health',
                    event_type: 'health_check',
                    restriction_kind: 'account_restricted',
                    severity: 'danger',
                    is_restriction: true,
                    happened_at: checkedAt,
                    error_message: result.reason || 'Аккаунт ограничен Telegram (автопроверка лота).'
                });
                await unpublishRestrictedUserbotListings(supabase, account.owner_id, account.id, result.reason || 'account_restricted');
                await cleanupRestrictedUserbotProxy(supabase, new ManagedProxyService(), account.owner_id, account);
                console.error('[ListedUserbotHealth] restricted — лот снят:', {
                    userbot_id: account.id,
                    username: account.tg_username,
                    reason: result.reason
                });
            } else if (status === 'frozen') {
                // Заморозка: сессию и прокси храним (идёт апелляция), пуржа для
                // frozen не существует — снимаем только с витрины.
                await logTelegramErrorEvent(supabase, {
                    owner_id: account.owner_id,
                    userbot_id: account.id,
                    event_source: 'userbot_health',
                    event_type: 'health_check',
                    restriction_kind: 'account_frozen',
                    severity: 'danger',
                    is_restriction: false,
                    happened_at: checkedAt,
                    error_message: result.reason || 'Аккаунт заморожен Telegram (автопроверка лота).'
                });
                await unpublishRestrictedUserbotListings(supabase, account.owner_id, account.id, result.reason || 'account_frozen');
                console.error('[ListedUserbotHealth] frozen — лот снят, аккаунт и прокси сохранены:', {
                    userbot_id: account.id,
                    username: account.tg_username,
                    reason: result.reason
                });
            } else if (QUARANTINE_STATUSES.includes(status)) {
                // Проблемный, но не Telegram-бан: прокси и аккаунт не трогаем,
                // уходим только с витрины — восстанавливается после живой проверки.
                await unpublishRestrictedUserbotListings(supabase, account.owner_id, account.id, result.reason || status);
                console.error('[ListedUserbotHealth] quarantine — лот снят:', {
                    userbot_id: account.id,
                    username: account.tg_username,
                    status,
                    reason: result.reason
                });
            } else {
                console.log('[ListedUserbotHealth] ok', {
                    userbot_id: account.id,
                    username: account.tg_username,
                    status
                });
            }
        } catch (error) {
            console.error('[ListedUserbotHealth] account check failed:', {
                userbot_id: account.id,
                error: error?.message || error
            });
        }
    }
}

export const startListedUserbotHealthCheck = (supabase, { userbotService } = {}) => {
    if (!userbotService) {
        console.error('[ListedUserbotHealth] disabled: userbotService is required');
        return;
    }
    if (!listedHealthCheckEnabled()) {
        console.log('[ListedUserbotHealth] disabled by USERBOT_LISTED_HEALTH_CHECK_ENABLED flag');
        return;
    }

    const intervalMs = getIntervalMs();
    console.log('[ListedUserbotHealth] started', { interval_ms: intervalMs });

    let running = false;
    const run = () => {
        if (running) return;
        running = true;
        runListedHealthCheck(supabase, userbotService)
            .catch(error => {
                console.error('[ListedUserbotHealth] run failed:', error?.message || error);
            })
            .finally(() => {
                running = false;
            });
    };

    run();
    setInterval(run, intervalMs);
};
