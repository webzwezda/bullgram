// Сценарий из test/test-sale-scan.js (разрезка под лимит pre-commit; хост — test/test-sale-scan.js).
import { runSaleScan } from '../../services/sale-scan.service.js';
import { assert, makeMockSupabase, makeAccountFixture, makeMockManagedProxy, OWNER } from './shared.js';

export async function runScanQrReportOnly() {
console.log('— runSaleScan: QR-кандидат без restore source — report-only —');

{
    // Боевой импорт без блобов: вердикт показываем в списке, но статусы в базе
    // не трогаем — флак таймаута не должен помечать рабочий аккаунт error'ом.
    const supabase = makeMockSupabase({
        userbot_restore_sources: [],
        tg_accounts: [
            makeAccountFixture('acc-boevoi', { runtime_status: 'online', custom_label: '+79…003', proxy_id: 'px-7' })
        ],
        proxies: [
            { id: 'px-7', owner_id: OWNER, host: '10.0.0.7', port: 40007, username: 'mp_7', password: 'p', is_working: true, last_check_ip: '10.0.0.7', provision_source: 'manual_admin', inventory_group: 'self_use' }
        ],
        telegram_error_events: [],
        shop_items: [],
        shop_item_assets: [],
        account_sale_scans: []
    });
    const mockProxy = makeMockManagedProxy();

    const { data: scanRow } = await supabase
        .from('account_sale_scans')
        .insert({ owner_id: OWNER, scope: 'unlisted', status: 'processing', total: 1, processed: 0, failed: 0, items: [] })
        .select('id')
        .single();

    let applyCalls = 0;
    const result = await runSaleScan(supabase, {}, {
        ownerId: OWNER,
        scanId: scanRow.id,
        managedProxyService: mockProxy,
        deps: {
            checkFn: async () => ({ status: 'online', reason: 'Аккаунт живой, сессия отвечает.', details: null, me: { id: 555000777 } }),
            sleepFn: async () => {},
            applyVerdictFn: async () => { applyCalls += 1; return { verdictStatus: 'online', quarantined: false }; }
        }
    });

    const scan = supabase._tables.account_sale_scans.find((r) => r.id === scanRow.id);
    const item = scan.items[0];
    assert(applyCalls === 0, 'applyStockVerdict не звался (report-only)');
    assert(item.verdict === 'online' && item.sellable === false, 'вердикт виден, но не sellable (нет tdata)');
    const accountRow = supabase._tables.tg_accounts.find((r) => r.id === 'acc-boevoi');
    assert(accountRow.runtime_status === 'online' && accountRow.last_checked_at === null, 'боевой статус в базе не тронут');
    assert(supabase._tables.telegram_error_events.length === 0, 'без событий');
}
}
