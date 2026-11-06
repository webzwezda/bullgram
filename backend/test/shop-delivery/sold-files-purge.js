// Сценарий из test/test-shop-delivery.js (разрезка под лимит pre-commit; хост — test/test-shop-delivery.js).
import { runSoldFilesPurge } from '../../jobs/sold-files-purge.job.js';
import { assert, makeMockSupabase, accountRow, accountItemRow, pendingPurchase, filesDelivery, restoreSourceRow, OWNER, BUYER, ACC1, ACC2, PROXY_ID, PROXY2_ID, ITEM_ID, ITEM_HYBRID, PURCHASE_ID, PURCHASE_HYBRID_ID } from './shared.js';

export async function runSoldFilesPurgeScenario() {
console.log('— Пурж files-выдач (sold-files-purge) —');

{
    const oldIso = new Date(Date.now() - 200 * 60 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase({
        tg_accounts: [
            accountRow({ id: ACC1 }),
            accountRow({ id: ACC2, custom_label: '+44…777', proxy_id: PROXY2_ID })
        ],
        proxies: [
            { id: PROXY_ID, owner_id: OWNER, host: '1.2.3.4', port: 1080, username: 'u3p', password: 'pw', provision_source: 'manual_admin' },
            { id: PROXY2_ID, owner_id: OWNER, host: '5.6.7.8', port: 1080, username: 'u4p', password: 'pw', provision_source: 'manual_admin' }
        ],
        shop_items: [accountItemRow(), accountItemRow({ id: ITEM_HYBRID, delivery_mode: 'hybrid' })],
        shop_item_assets: [
            { id: 'sa1', shop_item_id: ITEM_ID, asset_type: 'userbot', asset_id: ACC1, label: null, sort_order: 0 },
            { id: 'sa2', shop_item_id: ITEM_HYBRID, asset_type: 'userbot', asset_id: ACC2, label: null, sort_order: 0 }
        ],
        shop_purchases: [
            pendingPurchase({
                id: PURCHASE_ID,
                status: 'paid',
                delivered_at: oldIso,
                payload: { memo: 'shop_files', delivery: filesDelivery(oldIso) }
            }),
            pendingPurchase({
                id: PURCHASE_HYBRID_ID,
                shop_item_id: ITEM_HYBRID,
                buyer_owner_id: BUYER,
                status: 'paid',
                ownership_transfer_status: 'completed',
                delivered_at: oldIso,
                payload: { memo: 'shop_hybrid', delivery: { mode: 'hybrid', transferred: true } }
            })
        ],
        userbot_restore_sources: [
            restoreSourceRow({ account_id: ACC1 }),
            restoreSourceRow({ account_id: ACC2 })
        ]
    });
    const released = [];
    const proxyStub = {
        releaseManagedProxy: async (args) => { released.push(args.username); return true; }
    };
    await runSoldFilesPurge(supabase, { managedProxyService: proxyStub });

    assert(supabase._tables.tg_accounts.length === 1 && supabase._tables.tg_accounts[0].id === ACC2, 'purge: files-аккаунт удалён, гибридный остался');
    assert(supabase._tables.userbot_restore_sources.length === 1 && supabase._tables.userbot_restore_sources[0].account_id === ACC2, 'purge: restore source удалён только у files');
    assert(supabase._tables.proxies.length === 1 && supabase._tables.proxies[0].id === PROXY2_ID, 'purge: личный прокси files-аккаунта удалён');
    assert(released.length === 1 && released[0] === 'u3p', 'purge: managed-слот освобождён');
    const filesRow = supabase._tables.shop_purchases.find((row) => row.id === PURCHASE_ID);
    assert(Boolean(filesRow.payload.delivery.purged_at), 'purge: purged_at проставлен');
    const hybridRow = supabase._tables.shop_purchases.find((row) => row.id === PURCHASE_HYBRID_ID);
    assert(!hybridRow.payload.delivery.purged_at, 'purge: гибридная покупка не тронута');
}
}
