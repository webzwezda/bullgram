// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import { INTAKE_MISSING_MIGRATION_MESSAGE } from '../../services/account-intake.service.js';
import { makeMockSupabase, assert, runIntake, makePackFixture } from './shared.js';

export async function runProcessIntakeMissingRestoreTable() {
console.log('— processIntakeBatch: нет таблицы восстановления → откат айтема —');

{
    const supabase = makeMockSupabase({ proxies: [], tg_accounts: [], account_import_batches: [] });
    const { batch, proxy } = await runIntake(
        supabase,
        [makePackFixture('79000000003')],
        {
            saveRecoverySource: async () => {
                throw new Error('relation "public.userbot_restore_sources" does not exist');
            }
        }
    );

    assert(supabase._tables.tg_accounts.length === 0, 'свежевставленный аккаунт удалён');
    assert(supabase._tables.proxies.length === 0, 'прокси удалён');
    assert(proxy.released.length === 1, 'прокси освобождён');
    assert(batch.status === 'failed', 'батч failed (всё упало)');
    assert(batch.items[0].status === 'failed' && batch.items[0].error === INTAKE_MISSING_MIGRATION_MESSAGE, 'точное сообщение про SQL-миграцию');
}
}
