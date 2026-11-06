// Сценарий из test/test-sale-scan.js (разрезка под лимит pre-commit; хост — test/test-sale-scan.js).
import { runSaleScan } from '../../services/sale-scan.service.js';
import { assert, makeMockSupabase, makeAccountFixture, makeMockManagedProxy, OWNER } from './shared.js';

export async function runScanRecoveredOnline() {
console.log('— runSaleScan: выздоровевший error-сток поднимается в online (регрессия run-2 2026-11-01) —');

{
    // Живая проверка доказала жизнь — статус становится правдивым, а не
    // консервирует error от флакнувшего предыдущего чека.
    const supabase = makeMockSupabase({
        userbot_restore_sources: [
            { account_id: 'acc-recovered', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' }
        ],
        tg_accounts: [
            makeAccountFixture('acc-recovered', { runtime_status: 'error', custom_label: '+79…002', proxy_id: 'px-9', runtime_error: 'Telegram не отдал профиль аккаунта за отведенное время.' })
        ],
        proxies: [
            { id: 'px-9', owner_id: OWNER, host: '10.0.0.9', port: 40009, username: 'mp_9', password: 'p', is_working: true, last_check_ip: '10.0.0.9', provision_source: 'manual_admin', inventory_group: 'self_use' }
        ],
        telegram_error_events: [],
        shop_items: [],
        shop_item_assets: [],
        account_sale_scans: []
    });
    const mockProxy = makeMockManagedProxy();

    const { data: scanRow } = await supabase
        .from('account_sale_scans')
        .insert({ owner_id: OWNER, status: 'processing', total: 1, processed: 0, failed: 0, items: [] })
        .select('id')
        .single();

    const result = await runSaleScan(supabase, {}, {
        ownerId: OWNER,
        scanId: scanRow.id,
        managedProxyService: mockProxy,
        deps: {
            checkFn: async () => ({
                status: 'online',
                reason: 'Аккаунт живой, сессия отвечает.',
                details: { session: 'alive', restriction: 'clear', spambot: { state: 'clear' } },
                me: { id: 555000999, username: 'recovered_acc', firstName: 'R', lastName: '', phone: '+79990000009' }
            }),
            sleepFn: async () => {}
        }
    });

    const scan = supabase._tables.account_sale_scans.find((r) => r.id === scanRow.id);
    assert(scan.status === 'completed' && scan.processed === 1, 'скан завершён, 1/1');
    const item = scan.items[0];
    assert(item.verdict === 'online' && item.sellable === true, 'выздоровевший: вердикт online, sellable');
    assert(item.in_quarantine === false, 'выздоровевший: не карантин');
    assert(String(item.reason || '').includes('живой'), 'reason из живого результата');
    const accountRow = supabase._tables.tg_accounts.find((r) => r.id === 'acc-recovered');
    assert(accountRow.runtime_status === 'online', 'error-статус поднят в online живой проверкой');
    assert(accountRow.runtime_error === null, 'runtime_error очищен');
    assert(supabase._tables.proxies.length === 1, 'прокси не тронут');
}
}
