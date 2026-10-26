// Отстой свежепринятых аккаунтов (account shop intake, Wave 2 — «resting»).
// Брат listed-userbot-health.job.js по структуре, но про приёмку: цели —
// userbot-аккаунты платформенных админов в safe-mode
// (runtime_status='pending_activation'). Джоба по одному подключает аккаунт,
// заполняет tg_account_id/профиль, пишет health и отправляет плохие в карантин.
//
// Правила:
//   - online: safe-mode СОХРАНЯЕМ (pending_activation не превращается в online —
//     активация только вручную), runtime_error чистим, health_summary пишем;
//   - restricted: статус + событие + снятие с витрины + чистка прокси (как в
//     отстойнике магазина);
//   - frozen: статус + событие + снятие с витрины, прокси и аккаунт храним
//     (идёт апелляция, пуржа для frozen нет);
//   - expired/dead_proxy/error: статус + причина, прокси и аккаунт не трогаем;
//   - дубликат (такой же tg_account_id уже есть у владельца) — error, health не ищем;
//   - НИЧЕГО не удаляем и не публикуем здесь.
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { decrypt } from '../utils/crypto.js';
import { logTelegramErrorEvent } from '../utils/telegram-error-events.js';
import { cleanupRestrictedUserbotProxy, unpublishRestrictedUserbotListings } from '../utils/restricted-userbot-ops.js';
import { buildHealthSummary, buildTelegramProfilePatch } from '../utils/telegram-profile.js';
import { ManagedProxyService } from '../services/managed-proxy.service.js';

const DEFAULT_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_SLEEP_MS = 25_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 25_000;
const DEFAULT_INSPECT_TIMEOUT_MS = 35_000;

function intakeRestingEnabled() {
    return String(process.env.USERBOT_INTAKE_RESTING_ENABLED || '').trim().toLowerCase() !== 'false';
}

function getIntervalMs() {
    const raw = Number(process.env.USERBOT_INTAKE_RESTING_INTERVAL_MS || DEFAULT_INTERVAL_MS);
    if (!Number.isFinite(raw) || raw < MIN_INTERVAL_MS) {
        return DEFAULT_INTERVAL_MS;
    }
    return raw;
}

function getSleepMs() {
    const raw = Number(process.env.USERBOT_INTAKE_RESTING_SLEEP_MS || DEFAULT_SLEEP_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_SLEEP_MS;
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

// Цели: юзерботы платформенных админов в safe-mode ИЗ ПРИЁМКИ (у restore source
// проставлен intake_batch_id). Ручные dormant-импорты админа джоба не трогает:
// их не подключаем и статус не переписываем. Админ-ids грузим отдельно —
// джоба ходит по всем владельцам приёмки, а не по одному.
async function loadPendingActivationAccounts(supabase) {
    const { data: sources, error: sourcesError } = await supabase
        .from('userbot_restore_sources')
        .select('account_id')
        .not('intake_batch_id', 'is', null);
    if (sourcesError) throw sourcesError;
    const intakeAccountIds = Array.from(new Set((sources || []).map((row) => String(row.account_id))));
    if (!intakeAccountIds.length) return [];

    const { data: admins, error: adminsError } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin');
    if (adminsError) throw adminsError;
    const adminIds = (admins || []).map((row) => row.id);
    if (!adminIds.length) return [];

    const { data: accounts, error: accountsError } = await supabase
        .from('tg_accounts')
        .select('id, owner_id, tg_account_id, tg_username, runtime_status, session_data, proxy_id, last_checked_at')
        .eq('account_type', 'userbot')
        .eq('runtime_status', 'pending_activation')
        .in('owner_id', adminIds)
        .in('id', intakeAccountIds);
    if (accountsError) throw accountsError;
    return accounts || [];
}

async function checkIntakeAccount(supabase, userbotService, account, proxy) {
    // Полное зеркало loadOwnedProxy (userbot.routes.js): без provision_source/
    // force_ipv6 не срабатывает форс IPv6-DC (_shouldUseIpv6TelegramDc), и сессия
    // продавца уходит на IPv4-адрес, недостижимый с IPv6-only managed-слота —
    // getMe висит до таймаута.
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
        return { status: 'dead_proxy', reason: 'У юзербота мертвый прокси.', details: null, me: null };
    }

    const decryptedData = decrypt(account.session_data);
    if (!decryptedData) {
        return { status: 'expired', reason: 'Сессия не читается или уже недействительна.', details: null, me: null };
    }

    const { token, fingerprint } = userbotService.parseSessionData(decryptedData);
    const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
    const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
    userbotService.prepareServiceClient(client);
    userbotService._forceManagedIpv6Dc(client, proxyData);

    let me = null;
    let connectOk = false;
    let getMeOk = false;
    try {
        await withTimeout(
            userbotService.connectWithProxyFallback(client, proxyData),
            getConnectTimeoutMs(),
            'Telegram не ответил на подключение за отведенное время.'
        );
        connectOk = true;
        me = await withTimeout(client.getMe(), getInspectTimeoutMs(), 'Telegram не отдал профиль аккаунта за отведенное время.');
        getMeOk = true;
        const health = await withTimeout(
            userbotService.inspectAccountHealth(client, { userbotId: account.id }),
            getInspectTimeoutMs(),
            'Telegram health-check завис на SpamBot/profile check.'
        );
        return {
            status: health.status || 'error',
            reason: health.reason || null,
            details: health.details || null,
            me
        };
    } catch (error) {
        // Как в ручной проверке: сессия отвечает, но SpamBot/profile check не
        // успел — деградация, а не смерть. Аккаунт считаем живым, safe-mode
        // остаётся, в следующий заход джоба дозаполнит health.
        if (getMeOk) {
            return { status: 'online', reason: null, details: null, me };
        }
        const classified = classifyCheckFailure(error, connectOk);
        return { ...classified, details: null, me: null };
    } finally {
        await client.disconnect().catch(() => {});
    }
}

export async function runIntakeRestingCheck(supabase, userbotService, { checkFn = checkIntakeAccount, sleepFn = null } = {}) {
    const accounts = await loadPendingActivationAccounts(supabase);
    if (!accounts.length) return;

    const minCheckAgeMs = 60 * 60 * 1000;
    const nowMs = Date.now();
    const targets = accounts.filter(account => {
        const checkedAt = account.last_checked_at ? new Date(account.last_checked_at).getTime() : 0;
        return !checkedAt || (nowMs - checkedAt) >= minCheckAgeMs;
    });
    if (!targets.length) return;

    const doSleep = sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    console.log('[IntakeResting] run', { accounts: targets.length });

    for (const [targetIndex, account] of targets.entries()) {
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

            // Identity: getMe ответил — знаем, кто это. До записи — страж от
            // дублей: тот же Telegram-аккаунт уже подключен у владельца.
            const identityPatch = result.me
                ? buildTelegramProfilePatch(result.me)
                : {};

            if (result.me?.id) {
                const { data: duplicates } = await supabase
                    .from('tg_accounts')
                    .select('id')
                    .eq('owner_id', account.owner_id)
                    .eq('account_type', 'userbot')
                    .eq('tg_account_id', result.me.id.toString())
                    .neq('id', account.id)
                    .limit(1);
                const duplicate = duplicates?.[0] || null;
                if (duplicate) {
                    await supabase
                        .from('tg_accounts')
                        .update({
                            runtime_status: 'error',
                            runtime_error: 'Дубликат: этот Telegram-аккаунт уже подключен в системе.',
                            last_checked_at: checkedAt,
                            health_summary: buildHealthSummary({ status: 'duplicate', reason: 'Дубликат: этот Telegram-аккаунт уже подключен в системе.' }, checkedAt)
                        })
                        .eq('id', account.id)
                        .eq('owner_id', account.owner_id);
                    console.error('[IntakeResting] duplicate — аккаунт помечен ошибкой:', {
                        account_id: account.id,
                        tg_account_id: result.me.id.toString()
                    });
                    continue;
                }
            }

            const baseUpdate = {
                ...identityPatch,
                last_checked_at: checkedAt,
                health_summary: buildHealthSummary(result, checkedAt)
            };

            if (status === 'online') {
                // Safe-mode сохраняем: pending_activation не «активируется» тут —
                // только вручную живой проверкой с activate=true. Guard по статусу
                // не даёт джобе откатить параллельную ручную активацию.
                await supabase
                    .from('tg_accounts')
                    .update({
                        ...baseUpdate,
                        runtime_status: 'pending_activation',
                        runtime_error: null
                    })
                    .eq('id', account.id)
                    .eq('owner_id', account.owner_id)
                    .eq('runtime_status', 'pending_activation');
                console.log('[IntakeResting] ok', {
                    account_id: account.id,
                    tg_account_id: account.tg_account_id || baseUpdate.tg_account_id || null
                });
            } else if (status === 'restricted') {
                await supabase
                    .from('tg_accounts')
                    .update({ ...baseUpdate, runtime_status: 'restricted', runtime_error: result.reason || null })
                    .eq('id', account.id)
                    .eq('owner_id', account.owner_id);
                await logTelegramErrorEvent(supabase, {
                    owner_id: account.owner_id,
                    userbot_id: account.id,
                    event_source: 'intake_resting',
                    event_type: 'health_check',
                    restriction_kind: 'account_restricted',
                    severity: 'danger',
                    is_restriction: true,
                    happened_at: checkedAt,
                    error_message: result.reason || 'Аккаунт ограничен Telegram (отстой приёмки).'
                });
                await unpublishRestrictedUserbotListings(supabase, account.owner_id, account.id, result.reason || 'account_restricted');
                await cleanupRestrictedUserbotProxy(supabase, new ManagedProxyService(), account.owner_id, account);
                console.error('[IntakeResting] restricted — аккаунт отправлен в карантин:', {
                    account_id: account.id,
                    reason: result.reason
                });
            } else if (status === 'frozen') {
                // Заморозка: сессию и прокси храним (идёт апелляция), пуржа для
                // frozen не существует — снимаем только с витрины.
                await supabase
                    .from('tg_accounts')
                    .update({ ...baseUpdate, runtime_status: 'frozen', runtime_error: result.reason || null })
                    .eq('id', account.id)
                    .eq('owner_id', account.owner_id);
                await logTelegramErrorEvent(supabase, {
                    owner_id: account.owner_id,
                    userbot_id: account.id,
                    event_source: 'intake_resting',
                    event_type: 'health_check',
                    restriction_kind: 'account_frozen',
                    severity: 'danger',
                    is_restriction: false,
                    happened_at: checkedAt,
                    error_message: result.reason || 'Аккаунт заморожен Telegram (отстой приёмки).'
                });
                await unpublishRestrictedUserbotListings(supabase, account.owner_id, account.id, result.reason || 'account_frozen');
                console.error('[IntakeResting] frozen — аккаунт сохранён для апелляции:', {
                    account_id: account.id,
                    reason: result.reason
                });
            } else {
                // expired/dead_proxy/error: честный статус и причина, прокси и
                // аккаунт не трогаем — владелец разбирается руками.
                await supabase
                    .from('tg_accounts')
                    .update({ ...baseUpdate, runtime_status: status, runtime_error: result.reason || null })
                    .eq('id', account.id)
                    .eq('owner_id', account.owner_id);
                console.error('[IntakeResting] problem', {
                    account_id: account.id,
                    status,
                    reason: result.reason
                });
            }
        } catch (error) {
            console.error('[IntakeResting] account check failed:', {
                account_id: account.id,
                error: error?.message || error
            });
        }

        if (targetIndex < targets.length - 1) {
            await doSleep(getSleepMs());
        }
    }
}

export const startIntakeRestingCheck = (supabase, { userbotService } = {}) => {
    if (!userbotService) {
        console.error('[IntakeResting] disabled: userbotService is required');
        return;
    }
    if (!intakeRestingEnabled()) {
        console.log('[IntakeResting] disabled by USERBOT_INTAKE_RESTING_ENABLED flag');
        return;
    }

    const intervalMs = getIntervalMs();
    console.log('[IntakeResting] started', { interval_ms: intervalMs });

    let running = false;
    const run = () => {
        if (running) return;
        running = true;
        runIntakeRestingCheck(supabase, userbotService)
            .catch(error => {
                console.error('[IntakeResting] run failed:', error?.message || error);
            })
            .finally(() => {
                running = false;
            });
    };

    run();
    setInterval(run, intervalMs);
};
