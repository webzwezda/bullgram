// Сценарий из test/test-shop-delivery.js (разрезка под лимит pre-commit; хост — test/test-shop-delivery.js).
import { transferShopAssets } from '../../services/shop-transfer.service.js';
import { assert, capture, makeMockSupabase, baseTables, accountRow, BUYER, OWNER, ITEM_ID, ACC1, STALE_ISO } from './shared.js';

export async function runTransferSoftenedGuard() {
console.log('— transferShopAssets: ослабленный guard для intake-стока —');

{
    const supabase = makeMockSupabase(baseTables());
    const error = await capture(transferShopAssets(
        supabase,
        { buyer_owner_id: BUYER, seller_owner_id: OWNER },
        { id: ITEM_ID },
        [{ asset_type: 'userbot', asset_id: ACC1 }]
    ));
    assert(!error, 'pending_activation свежий+online: трансфер проходит');
    assert(supabase._tables.tg_accounts[0].owner_id === BUYER, 'владелец сменился на покупателя');
}
{
    const supabase = makeMockSupabase(baseTables({
        tg_accounts: [accountRow({ last_checked_at: STALE_ISO })]
    }));
    const error = await capture(transferShopAssets(
        supabase,
        { buyer_owner_id: BUYER, seller_owner_id: OWNER },
        { id: ITEM_ID },
        [{ asset_type: 'userbot', asset_id: ACC1 }]
    ));
    assert(error && error.quarantinedAssetId === ACC1, 'pending_activation устаревший: трансфер отменён');
    assert(supabase._tables.tg_accounts[0].owner_id === OWNER, 'владелец не сменился');
}
{
    const supabase = makeMockSupabase(baseTables({
        tg_accounts: [accountRow({ runtime_status: 'frozen' })]
    }));
    const error = await capture(transferShopAssets(
        supabase,
        { buyer_owner_id: BUYER, seller_owner_id: OWNER },
        { id: ITEM_ID },
        [{ asset_type: 'userbot', asset_id: ACC1 }]
    ));
    assert(error, 'frozen: трансфер отменён');
}
}
