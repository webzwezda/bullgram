// Сценарий из test/test-sale-scan.js (разрезка под лимит pre-commit; хост — test/test-sale-scan.js).
import { runSaleScan } from '../../services/sale-scan.service.js';
import { assert, makeMockSupabase, makeAccountFixture, makeMockManagedProxy, OWNER, noSleep } from './shared.js';

export async function runScanRestrictedQuarantine() {
console.log('— runSaleScan: restricted применяет карантин с event_source sale_scan —');

{
    const supabase = makeMockSupabase({
        userbot_restore_sources: [{ account_id: 'acc-restricted', owner_id: OWNER, intake_batch_id: 'b1' }],
        tg_accounts: [makeAccountFixture('acc-restricted', { proxy_id: 'px-r' })],
        proxies: [
            { id: 'px-r', owner_id: OWNER, host: '10.0.0.9', port: 40009, username: 'mp_r', password: 'p', is_working: true, last_check_ip: '10.0.0.9', provision_source: 'manual_admin', inventory_group: 'self_use' }
        ],
        telegram_error_events: [],
        shop_items: [],
        shop_item_assets: [],
        account_sale_scans: []
    });
    const mockProxy = makeMockManagedProxy();

    const { data: scanRow } = await supabase
        .from('account_sale_scans')
        .insert({ owner_id: OWNER, status: 'processing', total: 1, processed: 0, failed: 0, orphans: 0, items: [] })
        .select('id')
        .single();

    await runSaleScan(supabase, {}, {
        ownerId: OWNER,
        scanId: scanRow.id,
        managedProxyService: mockProxy,
        deps: {
            checkFn: async () => ({
                status: 'restricted',
                reason: 'SpamBot подтвердил блокировку.',
                details: { session: 'alive', restriction: 'restricted', spambot: { state: 'restricted' } },
                me: { id: 777000111, username: 'badacc', firstName: 'B', lastName: '', phone: '+79990000009' }
            }),
            sleepFn: noSleep
        }
    });

    const scan = supabase._tables.account_sale_scans.find((r) => r.id === scanRow.id);
    const account = supabase._tables.tg_accounts[0];
    const events = supabase._tables.telegram_error_events;

    assert(account.runtime_status === 'restricted', 'статус restricted записан');
    assert(account.proxy_id === null, 'прокси отвязан');
    assert(supabase._tables.proxies.length === 0, 'прокси удалён как в отстойнике');
    assert(mockProxy.calls.length === 1 && mockProxy.calls[0].port === 40009, 'release уходит в ManagedProxyService');
    assert(events.length === 1 && events[0].event_source === 'sale_scan', 'событие с event_source sale_scan');
    assert(events[0].is_restriction === true && events[0].restriction_kind === 'account_restricted', 'restriction-событие честное');
    assert(scan.status === 'completed' && scan.processed === 1 && scan.failed === 0, 'скан завершён (проблемный айтем — не failure скана)');
    const item = scan.items[0];
    assert(item.verdict === 'restricted' && item.in_quarantine === true && item.sellable === false, 'айтем restricted: карантин, не sellable');
    assert(item.reason === 'SpamBot подтвердил блокировку.', 'айтем: причина из проверки');
    assert(item.checked_at, 'айтем: checked_at записан');
}
}
