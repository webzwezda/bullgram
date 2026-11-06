// Сценарий из test/test-shop-delivery.js (разрезка под лимит pre-commit; хост — test/test-shop-delivery.js).
import { createOrRefreshBuyerPurchase } from '../../routes/shop.routes.js';
import { assert, makeMockSupabase, baseTables, ITEM_ID } from './shared.js';

export async function runPurchaseAnon() {
console.log('— Анонимная покупка (purchase-anon) —');

{
    const supabase = makeMockSupabase(baseTables());
    const { purchase } = await createOrRefreshBuyerPurchase({
        supabase,
        buyerOwnerId: null,
        itemId: ITEM_ID,
        paymentMethod: 'ton'
    });
    assert(purchase.buyer_owner_id === null, 'anon: buyer_owner_id null в ответе');
    assert(supabase._tables.shop_purchases[0].buyer_owner_id === null, 'anon: buyer_owner_id null в БД');
    assert(purchase.status === 'pending', 'anon: бронь создана pending');
}
}
