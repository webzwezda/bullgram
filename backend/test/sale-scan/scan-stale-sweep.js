// Сценарий из test/test-sale-scan.js (разрезка под лимит pre-commit; хост — test/test-sale-scan.js).
import { findActiveScan, isScanStale, sweepStaleScans } from '../../services/sale-scan.service.js';
import { assert, makeMockSupabase, OWNER } from './shared.js';

export async function runScanStaleSweep() {
console.log('— isScanStale / findActiveScan / sweepStaleScans —');

{
    const nowMs = Date.now();
    const twoHoursAgo = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date(nowMs).toISOString();

    assert(isScanStale({ status: 'processing', updated_at: twoHoursAgo }, nowMs), 'processing старше часа — stale');
    assert(!isScanStale({ status: 'processing', updated_at: nowIso }, nowMs), 'свежий processing — не stale');
    assert(!isScanStale({ status: 'completed', updated_at: twoHoursAgo }, nowMs), 'завершённый скан не stale');
    assert(isScanStale({ status: 'processing', updated_at: null }, nowMs), 'processing без updated_at — stale');
    assert(!isScanStale(null, nowMs), 'нет строки — не stale (guard)');

    const rows = [
        { id: 'done', status: 'completed', updated_at: nowIso },
        { id: 'active', status: 'processing', updated_at: nowIso },
        { id: 'stale', status: 'processing', updated_at: twoHoursAgo }
    ];
    assert(findActiveScan(rows)?.id === 'active', 'findActiveScan находит processing');
    assert(findActiveScan([{ id: 'done', status: 'completed' }]) === null, 'findActiveScan без активных → null');
    // stale-скан НЕ считается активным: свип переводит его в failed ДО проверки,
    // и POST не вечно блокируется после перезапуска сервера.
    const afterSweep = rows.map((row) => isScanStale(row, nowMs) ? { ...row, status: 'failed' } : row);
    assert(findActiveScan(afterSweep.filter((row) => row.id !== 'active')) === null, 'stale после свипа не блокирует новый скан');

    const supabase = makeMockSupabase({
        account_sale_scans: [
            { id: 'scan-stale', owner_id: OWNER, status: 'processing', updated_at: new Date(nowMs - 61 * 60 * 1000).toISOString(), error: null },
            { id: 'scan-fresh', owner_id: OWNER, status: 'processing', updated_at: nowIso, error: null },
            { id: 'scan-done', owner_id: OWNER, status: 'completed', updated_at: twoHoursAgo, error: null }
        ]
    });
    const sweepRows = supabase._tables.account_sale_scans.map((row) => ({ ...row }));
    await sweepStaleScans(supabase, OWNER, sweepRows);

    const staleRow = supabase._tables.account_sale_scans.find((r) => r.id === 'scan-stale');
    const freshRow = supabase._tables.account_sale_scans.find((r) => r.id === 'scan-fresh');
    const doneRow = supabase._tables.account_sale_scans.find((r) => r.id === 'scan-done');
    assert(staleRow.status === 'failed' && staleRow.error === 'Прерван перезапуском сервера.', 'свип: stale processing → failed с причиной');
    assert(freshRow.status === 'processing', 'свип: свежий processing не тронут');
    assert(doneRow.status === 'completed', 'свип: завершённый не тронут');
    assert(sweepRows.find((r) => r.id === 'scan-stale').status === 'failed', 'свип мутирует переданные rows');
}
}
