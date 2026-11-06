// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import { makeMockSupabase, assert, runIntake, makePackFixture, sqliteHeaderFixture } from './shared.js';

export async function runProcessIntakeFailedPack() {
console.log('— processIntakeBatch: упавшая пачка освобождает ровно свой прокси —');

{
    const supabase = makeMockSupabase({ proxies: [], tg_accounts: [], account_import_batches: [] });
    const { batch, proxy } = await runIntake(
        supabase,
        [makePackFixture('79000000001'), makePackFixture('79000000002')],
        {
            validatePackFn: async (pack) => pack.key === '79000000001'
                ? { ok: false, error: 'битая сессия', fingerprint: null, sessionBuffer: null, sessionString: null }
                : { ok: true, fingerprint: { api_id: 6, api_hash: 'h' }, sessionBuffer: sqliteHeaderFixture(), sessionString: 'SESS' }
        }
    );

    assert(supabase._tables.tg_accounts.length === 1, 'вставлен только валидный аккаунт');
    assert(supabase._tables.proxies.length === 1, 'прокси упавшей пачки удалён из proxies');
    assert(proxy.released.length === 1, 'упавшая пачка освободила ровно свой прокси');
    assert(batch.status === 'completed', 'батч завершён (не всё упало)');
    assert(batch.processed === 1 && batch.failed === 1, 'прогресс 1 ok / 1 failed');
    assert(batch.items[0].status === 'failed' && batch.items[0].error === 'битая сессия', 'айтем failed с ошибкой валидации');
    assert(batch.items[1].status === 'ok', 'вторая пачка не пострадала');
}
}
