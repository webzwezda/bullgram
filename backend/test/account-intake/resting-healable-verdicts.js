// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import { runIntakeRestingCheck } from '../../jobs/intake-resting.job.js';
import { makeMockSupabase, assert, OWNER, ONLINE_DETAILS, noSleep } from './shared.js';

export async function runRestingHealableVerdicts() {
console.log('— runIntakeRestingCheck: error/dead_proxy дочекиваются и лечатся, restricted/expired — нет —');

{
    // Регрессия paintsmall (2026-11-04): флакнувшая проверка ставила error,
    // джоба цели больше не видела — статус консервировался до ручного скана.
    // Лечимые сетевые вердикты (error/dead_proxy) должны дочекиваться и
    // подниматься живой проверкой; односторонние (restricted/expired) — нет.
    const ERR_ID = '33333333-3333-4333-8333-333333333301';
    const DEAD_PROXY_ID = '33333333-3333-4333-8333-333333333302';
    const RESTRICTED_ID = '33333333-3333-4333-8333-333333333303';
    const EXPIRED_ID = '33333333-3333-4333-8333-333333333304';
    const makeStockAccount = (id, runtimeStatus) => ({
        id,
        owner_id: OWNER,
        account_type: 'userbot',
        tg_account_id: '900000001',
        tg_username: 'stockacc',
        runtime_status: runtimeStatus,
        session_data: 'enc',
        proxy_id: null,
        last_checked_at: null
    });
    const tables = {
        profiles: [{ id: OWNER, role: 'admin' }],
        userbot_restore_sources: [ERR_ID, DEAD_PROXY_ID, RESTRICTED_ID, EXPIRED_ID].map((id) => ({ account_id: id, intake_batch_id: 'batch-1' })),
        tg_accounts: [
            makeStockAccount(ERR_ID, 'error'),
            makeStockAccount(DEAD_PROXY_ID, 'dead_proxy'),
            makeStockAccount(RESTRICTED_ID, 'restricted'),
            makeStockAccount(EXPIRED_ID, 'expired')
        ],
        proxies: [],
        telegram_error_events: []
    };
    const supabase = makeMockSupabase(tables);
    const checkedIds = [];
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async (_supabase, _service, account) => {
            checkedIds.push(account.id);
            return { status: 'online', reason: null, details: ONLINE_DETAILS, me: null };
        },
        sleepFn: noSleep
    });

    assert(checkedIds.length === 2, 'дочекиваются ровно два аккаунта (error + dead_proxy)');
    assert(checkedIds.includes(ERR_ID) && checkedIds.includes(DEAD_PROXY_ID), 'цели — error и dead_proxy');
    const errRow = supabase._tables.tg_accounts.find((row) => row.id === ERR_ID);
    const deadRow = supabase._tables.tg_accounts.find((row) => row.id === DEAD_PROXY_ID);
    const restrictedRow = supabase._tables.tg_accounts.find((row) => row.id === RESTRICTED_ID);
    const expiredRow = supabase._tables.tg_accounts.find((row) => row.id === EXPIRED_ID);
    assert(errRow.runtime_status === 'online' && errRow.runtime_error === null, 'error вылечен в online живой проверкой');
    assert(errRow.health_summary?.status === 'online' && errRow.last_checked_at, 'error: health и свежесть обновлены');
    assert(deadRow.runtime_status === 'online' && deadRow.runtime_error === null, 'dead_proxy вылечен в online');
    assert(restrictedRow.runtime_status === 'restricted', 'restricted не трогается (односторонний)');
    assert(expiredRow.runtime_status === 'expired', 'expired не трогается (сессия мертва)');
}
}
