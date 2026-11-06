// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import { FRESH_IMPORT_RUNTIME_REASON } from '../../utils/ops-center-selection.js';
import { makeMockSupabase, assert, runIntake, makePackFixture } from './shared.js';

export async function runProcessIntakeOk() {
console.log('— processIntakeBatch: ok-путь —');

{
    const supabase = makeMockSupabase({ proxies: [], tg_accounts: [], account_import_batches: [] });
    const restoreCalls = [];
    const { batch, proxy, launched } = await runIntake(
        supabase,
        [makePackFixture('79001234567')],
        {
            saveRecoverySource: async (args) => { restoreCalls.push(args); }
        }
    );

    const account = supabase._tables.tg_accounts[0];
    assert(account && account.runtime_status === 'pending_activation', 'аккаунт в safe-mode (pending_activation)');
    assert(account.runtime_error === FRESH_IMPORT_RUNTIME_REASON, 'runtime_error = причина safe-mode');
    assert(account.custom_label === '+79…567', 'custom_label = маскированный телефон');
    assert(account.allow_proxy_failover === false, 'failover выключен');
    assert(account.proxy_id, 'прокси привязан');
    assert(supabase._tables.proxies.length === 1, 'один managed-прокси вставлен');
    assert(supabase._tables.proxies[0].provision_source === 'manual_admin', 'provision_source manual_admin');
    assert(supabase._tables.proxies[0].inventory_group === 'self_use', 'inventory_group self_use');
    assert(supabase._tables.proxies[0].is_working === null, 'прокси ждёт фоновой проверки');
    assert(restoreCalls.length === 1, 'recovery source сохранён');
    assert(restoreCalls[0].twoFaSecret === 'Pass42', 'пароль 2FA ушёл в recovery');
    assert(Buffer.isBuffer(restoreCalls[0].tdataZipBuffer) && restoreCalls[0].tdataZipBuffer.length > 0, 'tdata zip собран');
    assert(String(restoreCalls[0].intakeBatchId).length > 0, 'intake_batch_id проброшен в recovery');
    assert(launched === 1, 'фоновая проверка прокси запущена');
    assert(batch.status === 'completed', 'батч завершён');
    assert(batch.processed === 1 && batch.failed === 0, 'прогресс 1/0');
    assert(batch.items[0].status === 'ok' && batch.items[0].account_id === account.id, 'айтем ok с account_id');
    assert(proxy.released.length === 0, 'ничего лишнего не освобождено');
}
}
