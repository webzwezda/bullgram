// Сценарий из test/test-sale-scan.js (разрезка под лимит pre-commit; хост — test/test-sale-scan.js).
import { runSaleScan } from '../../services/sale-scan.service.js';
import { ACCOUNT_NO_TDATA_MESSAGE } from '../../utils/account-sale-rules.js';
import { assert, makeMockSupabase, makeAccountFixture, makeMockManagedProxy, OWNER, noSleep } from './shared.js';

export async function runScanRuleReasons() {
console.log('— runSaleScan: живой вердикт, но правило продажи не пройдено (tdata/отлёжка) —');

{
    // Живая проверка чистая, но продавать нельзя: у одного нет tdata-блоба,
    // второй импортирован 5ч назад (отлёжка 5 из 48). Честные причины в
    // «Проблемных», карантин не трогается.
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase({
        userbot_restore_sources: [
            { account_id: 'acc-notdata', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: null },
            { account_id: 'acc-resting', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' }
        ],
        tg_accounts: [
            makeAccountFixture('acc-notdata', { custom_label: '+19…332', proxy_id: 'px-1' }),
            makeAccountFixture('acc-resting', { custom_label: '+20…443', proxy_id: 'px-2', created_at: fiveHoursAgo })
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
        .insert({ owner_id: OWNER, status: 'processing', total: 2, processed: 0, failed: 0, orphans: 0, items: [] })
        .select('id')
        .single();

    let ruleMeSeq = 555000100;
    await runSaleScan(supabase, {}, {
        ownerId: OWNER,
        scanId: scanRow.id,
        managedProxyService: mockProxy,
        deps: {
            // me.id уникальный по счётчику: одинаковый id у двух аккаунтов
            // ловит real-guard дублей в applyStockVerdict (вердикт — реальный код).
            checkFn: async () => {
                ruleMeSeq += 1;
                return {
                    status: 'online',
                    reason: 'Аккаунт живой, сессия отвечает.',
                    details: { session: 'alive', restriction: 'clear', spambot: { state: 'clear' } },
                    me: { id: ruleMeSeq, username: `rule_${ruleMeSeq}`, firstName: 'R', lastName: '', phone: '+79990000123' }
                };
            },
            sleepFn: noSleep
        }
    });

    const scan = supabase._tables.account_sale_scans.find((r) => r.id === scanRow.id);
    assert(scan.status === 'completed' && scan.processed === 2 && scan.failed === 0, 'скан завершён 2/0 — правило не ломает обход');
    const [noTdataItem, restingItem] = scan.items;
    assert(noTdataItem.verdict === 'pending_activation' && noTdataItem.status === 'ok', 'без tdata: вердикт живой (safe-mode сохраняется), айтем ok');
    assert(noTdataItem.sellable === false && noTdataItem.in_quarantine === false, 'без tdata: не sellable и не карантин');
    assert(noTdataItem.reason === ACCOUNT_NO_TDATA_MESSAGE, 'без tdata: причина — «Нет tdata-архива», не текст проверки');
    assert(noTdataItem.has_tdata === false, 'без tdata: has_tdata=false на айтеме');
    assert(restingItem.sellable === false && restingItem.reason === 'Отлёжка 5ч из 48ч — дай аккаунту отлежаться', 'свежий импорт: причина «Отлёжка 5ч из 48ч — дай аккаунту отлежаться»');
    assert(Number.isFinite(restingItem.rest_hours) && restingItem.rest_hours > 4 && restingItem.rest_hours < 6, 'свежий импорт: rest_hours ~5ч');
    const notDataRow = supabase._tables.tg_accounts.find((r) => r.id === 'acc-notdata');
    assert(notDataRow.runtime_status === 'pending_activation' && notDataRow.health_summary?.status === 'online', 'правило не переписывает статус аккаунта в базе (health записан)');
    assert(supabase._tables.proxies.length === 2 && mockProxy.calls.length === 0, 'правило не трогает прокси');
}
}
