// Сценарий из test/test-sale-scan.js (разрезка под лимит pre-commit; хост — test/test-sale-scan.js).
import { runSaleScan } from '../../services/sale-scan.service.js';
import { assert, makeMockSupabase, makeAccountFixture, makeMockManagedProxy, OWNER } from './shared.js';

export async function runScanProgressCompleted() {
console.log('— runSaleScan: прогресс, no_proxy без коннекта, sellable-флаги, completed —');

{
    const supabase = makeMockSupabase({
        userbot_restore_sources: [
            { account_id: 'acc-online', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' },
            { account_id: 'acc-noproxy', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' },
            { account_id: 'acc-safe', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' }
        ],
        tg_accounts: [
            makeAccountFixture('acc-online', { runtime_status: 'online', custom_label: '+79…001', proxy_id: 'px-1' }),
            makeAccountFixture('acc-noproxy', { tg_username: 'noproxy_user' }),
            makeAccountFixture('acc-safe', { proxy_id: 'px-2' })
        ],
        proxies: [
            { id: 'px-1', owner_id: OWNER, host: '10.0.0.1', port: 40001, username: 'mp_1', password: 'p', is_working: true, last_check_ip: '10.0.0.1', provision_source: 'manual_admin', inventory_group: 'self_use' },
            { id: 'px-2', owner_id: OWNER, host: '10.0.0.2', port: 40002, username: 'mp_2', password: 'p', is_working: true, last_check_ip: '10.0.0.2', provision_source: 'manual_admin', inventory_group: 'self_use' }
        ],
        telegram_error_events: [],
        shop_items: [],
        shop_item_assets: [],
        account_sale_scans: []
    });
    const mockProxy = makeMockManagedProxy();

    const { data: scanRow } = await supabase
        .from('account_sale_scans')
        .insert({ owner_id: OWNER, status: 'processing', total: 3, processed: 0, failed: 0, orphans: 1, items: [] })
        .select('id')
        .single();

    let meSeq = 555000111;
    const checkCalls = [];
    const progressSnapshots = [];
    const checkFn = async (_supabase, _service, account) => {
        const row = supabase._tables.account_sale_scans.find((r) => r.id === scanRow.id);
        progressSnapshots.push({ processed: row.processed, okItems: row.items.filter((i) => i.status === 'ok').length });
        checkCalls.push(account.id);
        meSeq += 1;
        return {
            status: 'online',
            reason: null,
            details: { session: 'alive', restriction: 'clear', spambot: { state: 'clear' } },
            me: { id: meSeq, username: `acc_${account.id}`, firstName: 'A', lastName: '', phone: '+79990000001' }
        };
    };
    const sleepDurations = [];
    const sleepFn = async (ms) => { sleepDurations.push(ms); };

    const result = await runSaleScan(supabase, {}, {
        ownerId: OWNER,
        scanId: scanRow.id,
        managedProxyService: mockProxy,
        deps: { checkFn, sleepFn }
    });

    const scan = supabase._tables.account_sale_scans.find((r) => r.id === scanRow.id);
    assert(result.status === 'completed' && scan.status === 'completed', 'финальный статус completed');
    assert(scan.processed === 3 && scan.failed === 0, 'прогресс 3/0');
    assert(scan.orphans === 1, 'orphans из POST не затёрт раннером');
    assert(checkCalls.join(',') === 'acc-online,acc-safe', 'чек вызван только для аккаунтов с прокси (2 раза)');
    assert(progressSnapshots[0].processed === 0 && progressSnapshots[0].okItems === 0, 'первый чек: прогресс ещё 0');
    assert(progressSnapshots[1].processed === 2 && progressSnapshots[1].okItems === 2, 'второй чек: прогресс после КАЖДОГО айтема (2 ok)');
    assert(sleepDurations.length === 2, 'пауза между айтемами (2 паузы на 3 айтема)');
    assert(mockProxy.calls.length === 0, 'без restricted чистки прокси нет');

    const [onlineItem, noProxyItem, safeItem] = scan.items;
    assert(onlineItem.status === 'ok' && onlineItem.verdict === 'online', 'айтем online: вердикт online');
    assert(onlineItem.sellable === true && onlineItem.in_quarantine === false, 'айтем online: sellable, не карантин');
    assert(onlineItem.label === '+79…001', 'айтем online: label из custom_label');
    assert(onlineItem.has_tdata === true && Number.isFinite(onlineItem.rest_hours), 'айтем online: has_tdata + rest_hours для карточки');
    assert(noProxyItem.verdict === 'no_proxy' && noProxyItem.status === 'ok', 'без прокси: вердикт no_proxy без коннекта');
    assert(String(noProxyItem.reason).includes('не привязан прокси'), 'без прокси: причина про прокси');
    assert(noProxyItem.sellable === false && noProxyItem.in_quarantine === false, 'без прокси: не sellable, не карантин');
    assert(noProxyItem.label === 'noproxy_user', 'без прокси: label из юзернейма');
    assert(safeItem.verdict === 'pending_activation', 'safe-mode с чистой проверкой остаётся pending_activation');
    assert(safeItem.sellable === true && safeItem.in_quarantine === false, 'safe-mode с чистой проверкой: sellable');

    const onlineRow = supabase._tables.tg_accounts.find((r) => r.id === 'acc-online');
    const safeRow = supabase._tables.tg_accounts.find((r) => r.id === 'acc-safe');
    const noProxyRow = supabase._tables.tg_accounts.find((r) => r.id === 'acc-noproxy');
    assert(onlineRow.runtime_status === 'online' && onlineRow.health_summary?.status === 'online', 'статусы записаны: online + health');
    assert(safeRow.runtime_status === 'pending_activation' && safeRow.health_summary?.status === 'online', 'safe-mode сохранён, health записан');
    assert(noProxyRow.health_summary === null && noProxyRow.last_checked_at === null, 'без прокси аккаунт не тронут');
    assert(supabase._tables.telegram_error_events.length === 0, 'здоровый сток без событий');
}
}
