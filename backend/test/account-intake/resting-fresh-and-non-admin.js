// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import { runIntakeRestingCheck } from '../../jobs/intake-resting.job.js';
import { makeMockSupabase, assert, restingTables, noSleep } from './shared.js';

export async function runRestingFreshAndNonAdmin() {
console.log('— runIntakeRestingCheck: свежая проверка и не-админ не трогаются —');

{
    const supabase = makeMockSupabase(restingTables({
        tg_accounts: restingTables().tg_accounts.map((row) => ({ ...row, last_checked_at: new Date().toISOString() }))
    }));
    let checkCalls = 0;
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => { checkCalls += 1; return { status: 'online', reason: null, details: null, me: null }; },
        sleepFn: noSleep
    });
    assert(checkCalls === 0, 'проверка младше часа не повторяется');
}

{
    const supabase = makeMockSupabase(restingTables({
        tg_accounts: restingTables().tg_accounts.map((row) => ({ ...row, owner_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }))
    }));
    let checkCalls = 0;
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => { checkCalls += 1; return { status: 'online', reason: null, details: null, me: null }; },
        sleepFn: noSleep
    });
    assert(checkCalls === 0, 'аккаунт не-платформенного-админа не проверяется');
}
}
