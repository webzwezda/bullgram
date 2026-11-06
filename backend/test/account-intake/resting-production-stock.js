// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import { runIntakeRestingCheck } from '../../jobs/intake-resting.job.js';
import { makeMockSupabase, assert, restingTables, ME_ONLINE, ONLINE_DETAILS, noSleep } from './shared.js';

export async function runRestingProductionStock() {
console.log('— runIntakeRestingCheck: боевой intake-сток остаётся боевым, чек обновляется —');

{
    const tables = restingTables();
    tables.tg_accounts[0].runtime_status = 'online';
    tables.tg_accounts[0].tg_account_id = '555000111';
    const supabase = makeMockSupabase(tables);
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => ({ status: 'online', reason: null, details: ONLINE_DETAILS, me: ME_ONLINE }),
        sleepFn: noSleep
    });

    const account = supabase._tables.tg_accounts[0];
    assert(account.runtime_status === 'online', 'боевой не откатывается в safe-mode');
    assert(account.last_checked_at, 'свежесть обновлена — витрина не протухает');
    assert(account.health_summary?.status === 'online', 'health_summary обновлён');
    assert(supabase._tables.proxies.length === 1, 'прокси не тронут');
}
}
