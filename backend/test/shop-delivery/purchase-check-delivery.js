// Сценарий из test/test-shop-delivery.js (разрезка под лимит pre-commit; хост — test/test-shop-delivery.js).
import { runShopPurchaseCheck } from '../../routes/shop.routes.js';
import { assert, makeMockSupabase, baseTables, accountItemRow, pendingPurchase, filesDelivery, BUYER, OWNER } from './shared.js';

export async function runPurchaseCheckDelivery() {
console.log('— Выдача при оплате (runShopPurchaseCheck) —');

{
    const supabase = makeMockSupabase(baseTables({
        shop_items: [accountItemRow({ delivery_mode: 'files' })],
        shop_purchases: [pendingPurchase({ buyer_owner_id: null })]
    }));
    let paymentCalls = 0;
    const result = await runShopPurchaseCheck(supabase, supabase._tables.shop_purchases[0], {
        paymentCheckFn: async () => { paymentCalls += 1; return true; }
    });
    assert(result.ok === true && result.body.status === 'paid', 'files: оплата зачтена');
    const purchaseRow = supabase._tables.shop_purchases[0];
    assert(Boolean(purchaseRow.delivered_at), 'files: delivered_at проставлен');
    assert(purchaseRow.payload.delivery?.mode === 'files' && Array.isArray(purchaseRow.payload.delivery.downloads), 'files: payload.delivery оформлен');
    assert(purchaseRow.payload.delivery.downloads_max === 10 && purchaseRow.payload.delivery.window_hours === 168, 'files: квота/окно по дефолтам');
    assert(purchaseRow.ownership_transfer_status === 'pending', 'files: transfer-статус не completed (пурж имеет право сработать)');
    assert(supabase._tables.shop_items[0].status === 'sold' && supabase._tables.shop_items[0].visibility === 'private', 'files: лот закрыт');
    assert(supabase._tables.tg_accounts[0].owner_id === OWNER, 'files: аккаунт НЕ передан покупателю');
    assert(supabase._tables.proxies[0].owner_id === OWNER, 'files: прокси НЕ передан');
}
{
    const supabase = makeMockSupabase(baseTables({
        shop_items: [accountItemRow({ delivery_mode: 'hybrid' })],
        shop_purchases: [pendingPurchase({ buyer_owner_id: BUYER })]
    }));
    const result = await runShopPurchaseCheck(supabase, supabase._tables.shop_purchases[0], {
        paymentCheckFn: async () => true
    });
    assert(result.ok === true && result.body.ownership_transfer_status === 'completed', 'hybrid+buyer: трансфер проведён');
    const purchaseRow = supabase._tables.shop_purchases[0];
    assert(Boolean(purchaseRow.delivered_at), 'hybrid+buyer: delivered_at проставлен');
    assert(purchaseRow.payload.delivery?.mode === 'hybrid' && purchaseRow.payload.delivery?.transferred === true, 'hybrid+buyer: payload.delivery гибрид');
    assert(supabase._tables.tg_accounts[0].owner_id === BUYER, 'hybrid+buyer: аккаунт передан покупателю');
    assert(supabase._tables.tg_accounts[0].proxy_id === null && supabase._tables.proxies[0].owner_id === OWNER, 'hybrid+buyer: прокси без актива в лоте отвязан и остаётся у продавца (легаси-семантика transferShopAssets)');
    assert(supabase._tables.shop_items[0].status === 'sold', 'hybrid+buyer: лот продан');
}
{
    const supabase = makeMockSupabase(baseTables({
        shop_items: [accountItemRow({ delivery_mode: 'hybrid' })],
        shop_purchases: [pendingPurchase({ buyer_owner_id: null })]
    }));
    const result = await runShopPurchaseCheck(supabase, supabase._tables.shop_purchases[0], {
        paymentCheckFn: async () => true
    });
    assert(result.ok === true, 'hybrid+anon: оплата зачтена');
    assert(supabase._tables.shop_purchases[0].payload.delivery?.mode === 'files', 'hybrid+anon: выдача осталась files');
    assert(supabase._tables.tg_accounts[0].owner_id === OWNER, 'hybrid+anon: аккаунт не передан');
}
{
    const nowIso = new Date().toISOString();
    const supabase = makeMockSupabase(baseTables({
        shop_items: [accountItemRow({ status: 'sold', visibility: 'private', delivery_mode: 'files' })],
        shop_purchases: [pendingPurchase({
            status: 'paid',
            delivered_at: nowIso,
            payload: { payment_method: 'ton', memo: 'shop_x', seller_wallet: 'UQtestwalletforrunittests000', delivery: filesDelivery(nowIso) }
        })]
    }));
    let paymentCalls = 0;
    const result = await runShopPurchaseCheck(supabase, supabase._tables.shop_purchases[0], {
        paymentCheckFn: async () => { paymentCalls += 1; return true; }
    });
    assert(result.ok === true && result.body.status === 'paid', 'files re-check: ранний выход, sold-race не срабатывает');
    assert(paymentCalls === 0, 'files re-check: повторная проверка платежа не нужна');
}
}
