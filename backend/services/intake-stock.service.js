// Общая складская проверка юзербот-стока (intake stock service).
// Единый путь «connect через прокси → getMe → inspectAccountHealth → применить
// вердикт с карантинными эффектами», который зовут двое: джоба отлёжки приёмки
// (jobs/intake-resting.job.js) и скан «Найти аккаунты для продажи»
// (services/sale-scan.service.js) — код проверки и применения результата ровно
// один, «поменял в одном месте».
//
// Правила применения вердикта (applyStockVerdict):
//   - online: прежний статус СОХРАНЯЕМ (safe-mode не превращается в online —
//     активация только вручную; optimistic guard по исходному статусу не даёт
//     откатить параллельную ручную активацию);
//   - restricted: статус + событие + снятие с витрины + чистка прокси;
//   - frozen: статус + событие + снятие с витрины, прокси и аккаунт храним
//     (идёт апелляция, пуржа для frozen нет);
//   - expired/dead_proxy/error: статус + причина, прокси и аккаунт не трогаем;
//   - дубликат (такой же tg_account_id уже есть у владельца) — error, health
//     не пишем;
//   - НИЧЕГО не удаляем и не публикуем здесь (чистка прокси на restricted —
//     единственное исключение, как в отстойнике магазина).
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { decrypt } from '../utils/crypto.js';
import { logTelegramErrorEvent } from '../utils/telegram-error-events.js';
import { cleanupRestrictedUserbotProxy, unpublishRestrictedUserbotListings } from '../utils/restricted-userbot-ops.js';
import { buildHealthSummary, buildTelegramProfilePatch } from '../utils/telegram-profile.js';
import { ManagedProxyService } from './managed-proxy.service.js';

export const INTAKE_RESTING_DEFAULT_SLEEP_MS = 25_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 25_000;
const DEFAULT_INSPECT_TIMEOUT_MS = 35_000;

// Статусы карантина: всё, что не «здоровый сток» (online / safe-mode с чистой
// проверкой). Скан продажи этими же статусом группирует «Проблемные».
export const QUARANTINE_STATUSES = ['restricted', 'frozen', 'expired', 'dead_proxy', 'error'];

// Анти-флуд пауза между проверками (общая с джобой отлёжки, новых env нет).
export function getIntakeRestingSleepMs() {
    const raw = Number(process.env.USERBOT_INTAKE_RESTING_SLEEP_MS || INTAKE_RESTING_DEFAULT_SLEEP_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : INTAKE_RESTING_DEFAULT_SLEEP_MS;
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

// Живая проверка сессии аккаунта на месте: connect через его прокси → getMe →
// inspectAccountHealth (frozen-проба → SpamBot). Та же проверка, что и у
// ручной «Проверить Telegram». Деградация: если getMe ответил, но SpamBot/
// profile check завис — считаем аккаунт живым, дозаполним в следующий заход.
export async function checkStockAccount(supabase, userbotService, account, proxy) {
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
        // getMe иногда флакует таймаутом на живой сессии (QA-прогон sale-scan:
        // 1 из 2 сканов дал ложный error; paintsmall циклил error→online→error,
        // 2026-11-04). Ретрай на НОВОМ соединении: таймаут почти всегда значит,
        // что коннект через прокси подгнил, и второй getMe по тому же сокету
        // флакует так же.
        try {
            me = await withTimeout(client.getMe(), getInspectTimeoutMs(), 'Telegram не отдал профиль аккаунта за отведенное время.');
        } catch (getMeError) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            await client.disconnect().catch(() => {});
            await withTimeout(
                userbotService.connectWithProxyFallback(client, proxyData),
                getConnectTimeoutMs(),
                'Telegram не ответил на подключение за отведенное время.'
            );
            me = await withTimeout(client.getMe(), getInspectTimeoutMs(), 'Telegram не отдал профиль аккаунта за отведенное время.');
        }
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
        // остаётся, в следующий заход дозаполнится health.
        if (getMeOk) {
            return { status: 'online', reason: null, details: null, me };
        }
        const classified = classifyCheckFailure(error, connectOk);
        return { ...classified, details: null, me: null };
    } finally {
        await client.disconnect().catch(() => {});
    }
}

// Применяет результат checkStockAccount к строке tg_accounts: identity-патч из
// getMe, страж от дублей, запись runtime_status/health_summary с карантинными
// эффектами (restricted → событие + снятие с витрины + чистка прокси; frozen →
// событие + снятие с витрины). Возвращает { verdictStatus, quarantined }.
// eventSource различает, кто проверял: 'intake_resting' (джоба отлёжки) или
// 'sale_scan' (скан продажи) — идёт в telegram_error_events.
export async function applyStockVerdict(supabase, userbotService, {
    account,
    result,
    checkedAt,
    eventSource = 'intake_resting',
    managedProxyService = null
} = {}) {
    const status = String(result.status || 'error');

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
            console.error('[IntakeStock] duplicate — аккаунт помечен ошибкой:', {
                account_id: account.id,
                tg_account_id: result.me.id.toString()
            });
            return { verdictStatus: 'error', quarantined: true };
        }
    }

    const baseUpdate = {
        ...identityPatch,
        last_checked_at: checkedAt,
        health_summary: buildHealthSummary(result, checkedAt)
    };

    if (status === 'online') {
        // Живая проверка доказала, что сессия отвечает — статус становится
        // правдивым: safe-mode сохраняется (активация только вручную),
        // всё остальное (в т.ч. «выздоровевший» error от флакнувшей проверки)
        // поднимается в online, иначе восстановление невозможно навсегда
        // (QA-прогон sale-scan 2026-11-01: error-снапшот консервировался).
        // Guard по исходному статусу не даёт перезаписать параллельную смену.
        const healthyStatus = account.runtime_status === 'pending_activation'
            ? 'pending_activation'
            : 'online';
        await supabase
            .from('tg_accounts')
            .update({
                ...baseUpdate,
                runtime_status: healthyStatus,
                runtime_error: null
            })
            .eq('id', account.id)
            .eq('owner_id', account.owner_id)
            .eq('runtime_status', account.runtime_status);
        console.log('[IntakeStock] ok', {
            account_id: account.id,
            verdict_status: healthyStatus
        });
        return { verdictStatus: healthyStatus, quarantined: false };
    }

    if (status === 'restricted') {
        await supabase
            .from('tg_accounts')
            .update({ ...baseUpdate, runtime_status: 'restricted', runtime_error: result.reason || null })
            .eq('id', account.id)
            .eq('owner_id', account.owner_id);
        await logTelegramErrorEvent(supabase, {
            owner_id: account.owner_id,
            userbot_id: account.id,
            event_source: eventSource,
            event_type: 'health_check',
            restriction_kind: 'account_restricted',
            severity: 'danger',
            is_restriction: true,
            happened_at: checkedAt,
            error_message: result.reason || 'Аккаунт ограничен Telegram (проверка стока).'
        });
        await unpublishRestrictedUserbotListings(supabase, account.owner_id, account.id, result.reason || 'account_restricted');
        await cleanupRestrictedUserbotProxy(
            supabase,
            managedProxyService || new ManagedProxyService(),
            account.owner_id,
            account
        );
        console.error('[IntakeStock] restricted — аккаунт отправлен в карантин:', {
            account_id: account.id,
            reason: result.reason
        });
        return { verdictStatus: 'restricted', quarantined: true };
    }

    if (status === 'frozen') {
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
            event_source: eventSource,
            event_type: 'health_check',
            restriction_kind: 'account_frozen',
            severity: 'danger',
            is_restriction: false,
            happened_at: checkedAt,
            error_message: result.reason || 'Аккаунт заморожен Telegram (проверка стока).'
        });
        await unpublishRestrictedUserbotListings(supabase, account.owner_id, account.id, result.reason || 'account_frozen');
        console.error('[IntakeStock] frozen — аккаунт сохранён для апелляции:', {
            account_id: account.id,
            reason: result.reason
        });
        return { verdictStatus: 'frozen', quarantined: true };
    }

    // expired/dead_proxy/error: честный статус и причина, прокси и
    // аккаунт не трогаем — владелец разбирается руками.
    await supabase
        .from('tg_accounts')
        .update({ ...baseUpdate, runtime_status: status, runtime_error: result.reason || null })
        .eq('id', account.id)
        .eq('owner_id', account.owner_id);
    console.error('[IntakeStock] problem', {
        account_id: account.id,
        status,
        reason: result.reason
    });
    return { verdictStatus: status, quarantined: true };
}
