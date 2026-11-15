// Одноразовый синк лейбла tdata-импортов при первом заполнении идентичности:
// «account-1-tdata (3)» → '+79…567'. Ручные переименования и не-tdata импорты
// не трогаем (запрос владельца 2026-11-15: в селекторе неудобно видеть имена
// папок/архивов).
import { runIntakeRestingCheck } from '../../jobs/intake-resting.job.js';
import { encrypt } from '../../utils/crypto.js';
import { tdataIdentityLabel } from '../../utils/telegram-profile.js';
import { makeMockSupabase, assert, restingTables, realService, ME_ONLINE, ONLINE_DETAILS, noSleep } from './shared.js';

function tdataSessionData() {
    // Настоящая форма session_data tdata-импорта (validateTdataPack)
    return encrypt(realService.stringifySessionData('1TDATA', { source: 'tdata_import' }, 'tdata_import'));
}

const serviceStub = {
    parseSessionData: (raw) => realService.parseSessionData(raw)
};

export async function runRestingTdataLabelSync() {
console.log('— runIntakeRestingCheck: tdata-лейбл → идентичность при первой проверке —');

{
    // Первый живой ответ: tg_account_id был пуст → лейбл = маскированный телефон
    const supabase = makeMockSupabase(restingTables({
        tg_accounts: [{
            id: '11111111-1111-4111-8111-111111111111',
            owner_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            account_type: 'userbot',
            tg_account_id: null,
            tg_username: null,
            custom_label: 'account-1-tdata (3)',
            runtime_status: 'pending_activation',
            session_data: tdataSessionData(),
            proxy_id: '22222222-2222-4222-8222-222222222222',
            last_checked_at: null
        }]
    }));
    await runIntakeRestingCheck(supabase, serviceStub, {
        checkFn: async () => ({ status: 'online', reason: null, details: ONLINE_DETAILS, me: ME_ONLINE }),
        sleepFn: noSleep
    });
    const account = supabase._tables.tg_accounts[0];
    assert(account.custom_label === '+79…567', `лейбл стал телефоном (${account.custom_label})`);
}

{
    // Второй прогон (id уже заполнен, оператор переименовал руками) — не трогаем
    const supabase = makeMockSupabase(restingTables({
        tg_accounts: [{
            id: '11111111-1111-4111-8111-111111111111',
            owner_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            account_type: 'userbot',
            tg_account_id: '555000111',
            tg_username: 'freshacc',
            custom_label: 'Мой лейбл',
            runtime_status: 'pending_activation',
            session_data: tdataSessionData(),
            proxy_id: '22222222-2222-4222-8222-222222222222',
            last_checked_at: null
        }]
    }));
    await runIntakeRestingCheck(supabase, serviceStub, {
        checkFn: async () => ({ status: 'online', reason: null, details: ONLINE_DETAILS, me: ME_ONLINE }),
        sleepFn: noSleep
    });
    assert(supabase._tables.tg_accounts[0].custom_label === 'Мой лейбл', 'ручной лейбл не перезаписан');
}

{
    // Не-tdata импорт (фальшивая session_data как в легаси-фикстурах) — не трогаем
    const supabase = makeMockSupabase(restingTables());
    await runIntakeRestingCheck(supabase, serviceStub, {
        checkFn: async () => ({ status: 'online', reason: null, details: ONLINE_DETAILS, me: ME_ONLINE }),
        sleepFn: noSleep
    });
    const account = supabase._tables.tg_accounts[0];
    assert(account.custom_label === undefined, 'лейбл обычного импорта не назначается');
}

{
    // tdata без телефона в getMe → фолбэк @username
    const supabase = makeMockSupabase(restingTables({
        tg_accounts: [{
            id: '11111111-1111-4111-8111-111111111111',
            owner_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            account_type: 'userbot',
            tg_account_id: null,
            tg_username: null,
            custom_label: 'account-2-tdata',
            runtime_status: 'pending_activation',
            session_data: tdataSessionData(),
            proxy_id: '22222222-2222-4222-8222-222222222222',
            last_checked_at: null
        }]
    }));
    await runIntakeRestingCheck(supabase, serviceStub, {
        checkFn: async () => ({ status: 'online', reason: null, details: ONLINE_DETAILS, me: { ...ME_ONLINE, phone: '' } }),
        sleepFn: noSleep
    });
    assert(supabase._tables.tg_accounts[0].custom_label === '@freshacc', 'без телефона — @username');
}

{
    // Чистый билдер (общий для отлёжки и restore-активации)
    assert(tdataIdentityLabel({ phone: '+56 979 373 849', id: 1 }) === '+56…849', 'телефон → маска');
    assert(tdataIdentityLabel({ phone: '', username: 'clara', id: 2 }) === '@clara', 'фолбэк username');
    assert(tdataIdentityLabel({ phone: '123', id: 9082082481 }) === 'ID 9082082481', 'фолбэк ID (короткий «телефон» не считается)');
}
}
