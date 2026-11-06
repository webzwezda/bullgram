// Сценарий из test/test-sale-scan.js (разрезка под лимит pre-commit; хост — test/test-sale-scan.js).
import { runSaleScan } from '../../services/sale-scan.service.js';
import { assert, makeMockSupabase, makeAccountFixture, OWNER, noSleep } from './shared.js';

export async function runScanAllFailed() {
console.log('— runSaleScan: всё упало → статус failed —');

{
    const supabase = makeMockSupabase({
        userbot_restore_sources: [{ account_id: 'acc-boom', owner_id: OWNER, intake_batch_id: 'b1' }],
        tg_accounts: [makeAccountFixture('acc-boom', { proxy_id: 'px-b' })],
        proxies: [
            { id: 'px-b', owner_id: OWNER, host: '10.0.0.3', port: 40003, username: 'mp_3', password: 'p', is_working: true, last_check_ip: '10.0.0.3', provision_source: 'manual_admin', inventory_group: 'self_use' }
        ],
        telegram_error_events: [],
        shop_items: [],
        shop_item_assets: [],
        account_sale_scans: []
    });

    const { data: scanRow } = await supabase
        .from('account_sale_scans')
        .insert({ owner_id: OWNER, status: 'processing', total: 1, processed: 0, failed: 0, orphans: 0, items: [] })
        .select('id')
        .single();

    const result = await runSaleScan(supabase, {}, {
        ownerId: OWNER,
        scanId: scanRow.id,
        deps: {
            checkFn: async () => { throw new Error('взрыв соединения'); },
            sleepFn: noSleep
        }
    });

    const scan = supabase._tables.account_sale_scans.find((r) => r.id === scanRow.id);
    assert(result.status === 'failed' && scan.status === 'failed', 'все айтемы упали → скан failed');
    assert(scan.processed === 0 && scan.failed === 1, 'прогресс 0/1');
    const item = scan.items[0];
    assert(item.status === 'failed' && item.reason === 'взрыв соединения', 'айтем failed с текстом ошибки');
    assert(item.sellable === false, 'упавший айтем не sellable');
    assert(item.in_quarantine === false, 'ошибка проверки — не карантин: аккаунт в базе не тронут');
    assert(supabase._tables.tg_accounts[0].runtime_status === 'pending_activation', 'упавший чек не трогает статус аккаунта');
    assert(supabase._tables.proxies.length === 1, 'упавший чек не трогает прокси');
}
}
