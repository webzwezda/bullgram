// Сценарий из test/test-shop-delivery.js (разрезка под лимит pre-commit; хост — test/test-shop-delivery.js).
import { createOrRefreshBuyerPurchase } from '../../routes/shop.routes.js';
import { assert, capture, makeMockSupabase, baseTables, accountItemRow, BUYER, ITEM_ID } from './shared.js';

export async function runPurchaseKindAwareQuarantine() {
console.log('— Kind-aware отстойник при брони —');

{
    const supabase = makeMockSupabase(baseTables({
        shop_items: [accountItemRow({ item_type: 'userbot', delivery_mode: null })]
    }));
    const error = await capture(createOrRefreshBuyerPurchase({
        supabase,
        buyerOwnerId: BUYER,
        itemId: ITEM_ID,
        paymentMethod: 'ton'
    }));
    assert(error?.statusCode === 400, 'userbot-лот: pending_activation брони не получает (легаси-блоклист)');
}
{
    const supabase = makeMockSupabase(baseTables({
        shop_items: [accountItemRow({ delivery_mode: 'hybrid' })]
    }));
    const { purchase } = await createOrRefreshBuyerPurchase({
        supabase,
        buyerOwnerId: BUYER,
        itemId: ITEM_ID,
        paymentMethod: 'ton'
    });
    assert(purchase.buyer_owner_id === BUYER, 'account-лот: свежий pending_activation бронируется');
}
}
