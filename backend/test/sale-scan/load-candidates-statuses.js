// Сценарий из test/test-sale-scan.js (разрезка под лимит pre-commit; хост — test/test-sale-scan.js).
import { loadScanCandidates } from '../../services/sale-scan.service.js';
import { assert, makeMockSupabase, makeAccountFixture, OWNER, OTHER } from './shared.js';

export async function runLoadCandidatesStatuses() {
console.log('— loadScanCandidates: все статусы, QR-импорты без source, orphan, чужие владельцы —');

{
    const supabase = makeMockSupabase({
        userbot_restore_sources: [
            { account_id: 'acc-online', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' },
            { account_id: 'acc-safe', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' },
            { account_id: 'acc-restricted', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: null },
            { account_id: 'acc-frozen', owner_id: OWNER, intake_batch_id: null, tdata_blob_encrypted: 'enc-tdata' },
            { account_id: 'acc-orphan', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' },
            { account_id: 'acc-other', owner_id: OTHER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' }
        ],
        tg_accounts: [
            makeAccountFixture('acc-online', { runtime_status: 'online' }),
            makeAccountFixture('acc-safe', { runtime_status: 'pending_activation' }),
            makeAccountFixture('acc-restricted', { runtime_status: 'restricted' }),
            makeAccountFixture('acc-frozen', { runtime_status: 'frozen' }),
            // Рабочий QR-импорт без restore source: кандидат с has_tdata=false.
            makeAccountFixture('acc-nosource', { runtime_status: 'online' }),
            makeAccountFixture('acc-other', { owner_id: OTHER, runtime_status: 'online' })
        ]
    });

    const { accounts, orphanCount } = await loadScanCandidates(supabase, OWNER);
    const ids = accounts.map((row) => row.id).sort();
    assert(ids.length === 5, 'кандидаты: 5 аккаунтов владельца (с restore source и без)');
    assert(ids.join(',') === 'acc-frozen,acc-nosource,acc-online,acc-restricted,acc-safe', 'все статусы в кандидатах (online/safe/restricted/frozen + QR-импорт)');
    assert(orphanCount === 1, 'orphan: restore source без tg_accounts учтён один раз');
    assert(!ids.includes('acc-other'), 'чужой владелец не в кандидатах');

    const hasTdataById = Object.fromEntries(accounts.map((row) => [row.id, row.has_tdata]));
    assert(hasTdataById['acc-online'] === true && hasTdataById['acc-safe'] === true, 'has_tdata=true у источников с tdata-блобом');
    assert(hasTdataById['acc-restricted'] === false, 'has_tdata=false у источника с пустым tdata-блобом');
    assert(hasTdataById['acc-nosource'] === false, 'QR-импорт без restore source: has_tdata=false для правила');
    assert(ids.includes('acc-nosource') && orphanCount === 1, 'QR-импорт без source — кандидат, а НЕ orphan');

    const { accounts: otherAccounts, orphanCount: otherOrphans } = await loadScanCandidates(supabase, OTHER);
    assert(otherAccounts.length === 1 && otherAccounts[0].id === 'acc-other', 'скан другого владельца видит только своё');
    assert(otherOrphans === 0, 'чужой orphan не попадает в чужой скан');
}
}
