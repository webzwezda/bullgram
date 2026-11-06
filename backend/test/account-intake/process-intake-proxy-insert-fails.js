// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import { makeMockSupabase, assert, runIntake, makePackFixture } from './shared.js';

export async function runProcessIntakeProxyInsertFails() {
console.log('— processIntakeBatch: упавший insert прокси → всё освобождено —');

{
    const supabase = makeMockSupabase(
        { proxies: [], tg_accounts: [], account_import_batches: [] },
        { tableErrors: { proxies: { insert: { message: 'duplicate key value violates unique constraint' } } } }
    );
    const { batch, proxy } = await runIntake(supabase, [makePackFixture('79000000004')]);

    assert(supabase._tables.tg_accounts.length === 0, 'без аккаунтов при упавшем прокси-insert');
    assert(proxy.released.length === 1, 'поднятый прокси возвращён в инвентарь');
    assert(batch.status === 'failed', 'батч failed');
    assert(String(batch.items[0].error).includes('прокси'), 'айтем с ошибкой про прокси');
}
}
