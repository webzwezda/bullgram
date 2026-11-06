// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import { runIntakeRestingCheck } from '../../jobs/intake-resting.job.js';
import { makeMockSupabase, assert, restingTables, ME_ONLINE, ONLINE_DETAILS, noSleep, UB_ID, DUPLICATE_ID, OWNER } from './shared.js';

export async function runRestingRestrictedFrozenExpiredDuplicate() {
console.log('— runIntakeRestingCheck: restricted / frozen / expired / дубликат —');

{
    const supabase = makeMockSupabase(restingTables());
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => ({ status: 'restricted', reason: 'SpamBot подтвердил блокировку.', details: ONLINE_DETAILS, me: ME_ONLINE }),
        sleepFn: noSleep
    });

    const account = supabase._tables.tg_accounts[0];
    assert(account.runtime_status === 'restricted', 'статус restricted');
    const events = supabase._tables.telegram_error_events;
    assert(events.length === 1 && events[0].is_restriction === true, 'restriction-событие записано');
    assert(events[0].event_source === 'intake_resting' && events[0].restriction_kind === 'account_restricted', 'event_source/restriction_kind intake_resting/account_restricted');
    assert(supabase._tables.proxies.length === 0, 'прокси почищен как в отстойнике');
    assert(account.proxy_id === null, 'прокси отвязан');
}

{
    const supabase = makeMockSupabase(restingTables());
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => ({ status: 'frozen', reason: 'Аккаунт заморожен Telegram: read-only.', details: ONLINE_DETAILS, me: ME_ONLINE }),
        sleepFn: noSleep
    });

    const account = supabase._tables.tg_accounts[0];
    assert(account.runtime_status === 'frozen', 'статус frozen');
    const events = supabase._tables.telegram_error_events;
    assert(events.length === 1 && events[0].is_restriction === false, 'frozen: не is_restriction (пурж не должен сработать)');
    assert(supabase._tables.proxies.length === 1, 'frozen: прокси сохранён для апелляции');
    assert(supabase._tables.tg_accounts.length === 1, 'frozen: аккаунт сохранён');
}

{
    const supabase = makeMockSupabase(restingTables());
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => ({ status: 'expired', reason: 'Сессия недействительна.', details: null, me: null }),
        sleepFn: noSleep
    });

    const account = supabase._tables.tg_accounts[0];
    assert(account.runtime_status === 'expired', 'статус expired');
    assert(account.runtime_error === 'Сессия недействительна.', 'причина записана');
    assert(supabase._tables.proxies.length === 1, 'expired: прокси остаётся (сессия мертва, не прокси)');
    assert(supabase._tables.telegram_error_events.length === 0, 'expired: без Telegram-события');
}

{
    const supabase = makeMockSupabase(restingTables({
        tg_accounts: [
            ...restingTables().tg_accounts,
            { id: DUPLICATE_ID, owner_id: OWNER, account_type: 'userbot', tg_account_id: '555000111', runtime_status: 'online', proxy_id: null, last_checked_at: null }
        ]
    }));
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => ({ status: 'online', reason: null, details: null, me: ME_ONLINE }),
        sleepFn: noSleep
    });

    const target = supabase._tables.tg_accounts.find((row) => row.id === UB_ID);
    assert(target.runtime_status === 'error', 'дубликат: статус error');
    assert(target.runtime_error === 'Дубликат: этот Telegram-аккаунт уже подключен в системе.', 'дубликат: точное сообщение');
    assert(target.health_summary?.status === 'duplicate', 'дубликат: health_summary.status duplicate');
    assert(supabase._tables.tg_accounts.length === 2, 'дубликат: ничего не удалено');
}
}
