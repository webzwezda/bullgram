// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import { runIntakeRestingCheck } from '../../jobs/intake-resting.job.js';
import { makeMockSupabase, assert, restingTables, ME_ONLINE, ONLINE_DETAILS, noSleep } from './shared.js';

export async function runRestingOnlineIdentity() {
console.log('— runIntakeRestingCheck: online сохраняет safe-mode и пишет identity —');

{
    const supabase = makeMockSupabase(restingTables());
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => ({ status: 'online', reason: null, details: ONLINE_DETAILS, me: ME_ONLINE }),
        sleepFn: noSleep
    });

    const account = supabase._tables.tg_accounts[0];
    assert(account.runtime_status === 'pending_activation', 'safe-mode сохранён (не online)');
    assert(account.runtime_error === null, 'runtime_error очищен');
    assert(account.tg_account_id === '555000111', 'tg_account_id заполнен из getMe');
    assert(account.tg_username === 'freshacc', 'tg_username заполнен');
    assert(account.tg_first_name === 'Fresh' && account.tg_phone === '+79991234567', 'профиль заполнен');
    assert(account.health_summary?.status === 'online' && account.health_summary?.checked_at, 'health_summary записан');
    assert(account.last_checked_at, 'last_checked_at обновлён');
    assert(supabase._tables.telegram_error_events.length === 0, 'без событий');
    assert(supabase._tables.proxies.length === 1, 'прокси не тронут');
}
}
