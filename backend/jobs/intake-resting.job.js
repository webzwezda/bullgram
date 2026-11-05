// Отстой свежепринятых аккаунтов (account shop intake, Wave 2 — «resting»).
// Брат listed-userbot-health.job.js по структуре, но про приёмку: цели —
// userbot-аккаунты платформенных админов в safe-mode
// (runtime_status='pending_activation'). Джоба по одному подключает аккаунт,
// заполняет tg_account_id/профиль, пишет health и отправляет плохие в карантин.
//
// Сама проверка и применение вердикта живут в services/intake-stock.service.js
// (checkStockAccount + applyStockVerdict) — тот же код зовёт скан «Найти
// аккаунты для продажи». Здесь только расписание и свои цели:
//
//   - цели: приёмочный сток с restore source (intake_batch_id) в статусах
//     pending_activation/online плюс «лечимые» карантинные error/dead_proxy,
//     не проверявшийся последний час;
//   - error/dead_proxy дочекиваем специально: сетевой флак проверки (таймаут
//     getMe на живой сессии) раньше консервировался навсегда — джоба цели
//     больше не видела, аккаунт «отлетал» до ручного скана (paintsmall,
//     регрессия 2026-11-04);
//   - дубликаты, restricted/frozen/expired — см. сервис (односторонние/
//     апелляционные, автоматом не поднимаем);
//   - НИЧЕГО не удаляем и не публикуем здесь.
import { applyStockVerdict, checkStockAccount, getIntakeRestingSleepMs } from '../services/intake-stock.service.js';
import { wrapJobTick } from '../utils/job-runner.js';

const DEFAULT_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 10 * 60 * 1000;

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

// Цели: весь приёмочный сток платформенных админов (restore source с
// intake_batch_id) — safe-mode (pending_activation), активированный ('online')
// и лечимый карантин (error/dead_proxy от флакнувшей проверки или умершего
// прокси — восстанавливаем автоматически, живая проверка поднимет в online).
// restricted/frozen/expired не целим: они односторонние/апелляционные. Витрина
// требует свежую проверку ≤6ч, и «боевой» сток без перепроверки протухал бы в
// карточке продажи навсегда. Ручные dormant-импорты админа без паков джоба не
// трогает. Админ-ids грузим отдельно — джоба ходит по всем владельцам приёмки,
// а не по одному.
const INTAKE_RESTING_TARGET_STATUSES = ['pending_activation', 'online', 'error', 'dead_proxy'];

async function loadIntakeStockAccounts(supabase) {
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
        .in('runtime_status', INTAKE_RESTING_TARGET_STATUSES)
        .in('owner_id', adminIds)
        .in('id', intakeAccountIds);
    if (accountsError) throw accountsError;
    return accounts || [];
}

export async function runIntakeRestingCheck(supabase, userbotService, { checkFn = checkStockAccount, sleepFn = null } = {}) {
    const accounts = await loadIntakeStockAccounts(supabase);
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
            const checkedAt = new Date().toISOString();
            await applyStockVerdict(supabase, userbotService, {
                account,
                result,
                checkedAt,
                eventSource: 'intake_resting'
            });
        } catch (error) {
            console.error('[IntakeResting] account check failed:', {
                account_id: account.id,
                error: error?.message || error
            });
        }

        if (targetIndex < targets.length - 1) {
            await doSleep(getIntakeRestingSleepMs());
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
    setInterval(wrapJobTick('intake-resting', run), intervalMs);
};
