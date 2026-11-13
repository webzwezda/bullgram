// Сценарий: прокси следует за аккаунтом при трансфере (решение владельца
// 2026-11-13 — продажа всегда «аккаунт + его прокси»; пачковые лоты прокси-
// ассет не добавляют, поэтому трансфер переводит владение сам). Хост —
// test/shop-delivery.test.js; фикстуры — shared.js.
import { transferShopAssets } from '../../services/shop-transfer.service.js';
import { assert, BUYER, OWNER, ACC1, ACC2, PROXY_ID, ITEM_HYBRID, PURCHASE_HYBRID_ID, makeMockSupabase, accountRow, baseTables, pendingPurchase } from './shared.js';

const HYBRID_PURCHASE = () => pendingPurchase({
    id: PURCHASE_HYBRID_ID,
    buyer_owner_id: BUYER,
    status: 'paid'
});
const USERBOT_ONLY_ASSETS = [{ asset_type: 'userbot', asset_id: ACC1, sort_order: 0 }];

export async function runTransferProxyFollows() {
console.log('— Прокси следует за аккаунтом при трансфере —');

{
    // Главный кейс: hybrid-лот без proxy-ассета (как их создаёт пачка) —
    // владение прокси переходит покупателю, отклейки нет.
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [HYBRID_PURCHASE()]
    }));
    await transferShopAssets(supabase, supabase._tables.shop_purchases[0], { id: ITEM_HYBRID }, USERBOT_ONLY_ASSETS);
    const account = supabase._tables.tg_accounts.find((row) => row.id === ACC1);
    const proxy = supabase._tables.proxies.find((row) => row.id === PROXY_ID);
    assert(account.owner_id === BUYER, 'proxy follows: аккаунт передан покупателю');
    assert(account.proxy_id === PROXY_ID, 'proxy follows: proxy_id сохранён (без отклейки)');
    assert(proxy.owner_id === BUYER, 'proxy follows: владение прокси у покупателя');
    assert(proxy.provision_source === 'purchased', 'proxy follows: provision_source=purchased');
}
{
    // Аккаунт без прокси — трансфер проходит, отклеивать нечего.
    const supabase = makeMockSupabase(baseTables({
        tg_accounts: [accountRow({ proxy_id: null })],
        shop_purchases: [HYBRID_PURCHASE()]
    }));
    await transferShopAssets(supabase, supabase._tables.shop_purchases[0], { id: ITEM_HYBRID }, USERBOT_ONLY_ASSETS);
    const account = supabase._tables.tg_accounts.find((row) => row.id === ACC1);
    assert(account.owner_id === BUYER && account.proxy_id === null, 'proxy follows: без прокси — трансфер ок, proxy_id null');
    const proxy = supabase._tables.proxies.find((row) => row.id === PROXY_ID);
    assert(proxy.owner_id === OWNER && proxy.provision_source === 'manual_admin', 'proxy follows: чужой прокси не тронут');
}
{
    // Изоляционный фолбэк: прокси разделяется другим аккаунтом — отклейка,
    // владение прокси остаётся у продавца.
    const supabase = makeMockSupabase(baseTables({
        tg_accounts: [accountRow(), accountRow({ id: ACC2, proxy_id: PROXY_ID })],
        shop_purchases: [HYBRID_PURCHASE()]
    }));
    await transferShopAssets(supabase, supabase._tables.shop_purchases[0], { id: ITEM_HYBRID }, USERBOT_ONLY_ASSETS);
    const account = supabase._tables.tg_accounts.find((row) => row.id === ACC1);
    const proxy = supabase._tables.proxies.find((row) => row.id === PROXY_ID);
    assert(account.proxy_id === null, 'proxy follows: разделяемый прокси — отклейка (изоляция)');
    assert(proxy.owner_id === OWNER && proxy.provision_source === 'manual_admin', 'proxy follows: разделяемый прокси остаётся у продавца');
}
{
    // Прокси из ассетов лота — прежний путь не сломан: ассет передан, аккаунт
    // ссылку сохранил.
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [HYBRID_PURCHASE()]
    }));
    const assets = [
        { asset_type: 'userbot', asset_id: ACC1, sort_order: 0 },
        { asset_type: 'proxy', asset_id: PROXY_ID, sort_order: 1 }
    ];
    await transferShopAssets(supabase, supabase._tables.shop_purchases[0], { id: ITEM_HYBRID }, assets);
    const account = supabase._tables.tg_accounts.find((row) => row.id === ACC1);
    const proxy = supabase._tables.proxies.find((row) => row.id === PROXY_ID);
    assert(account.proxy_id === PROXY_ID && proxy.owner_id === BUYER, 'proxy follows: явный proxy-ассет — прежний путь работает');
}
}
