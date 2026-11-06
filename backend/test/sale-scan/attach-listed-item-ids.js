// Сценарий из test/test-sale-scan.js (разрезка под лимит pre-commit; хост — test/test-sale-scan.js).
import { attachListedItemIds } from '../../services/sale-scan.service.js';
import { assert, makeMockSupabase, OWNER } from './shared.js';

export async function runAttachListedItemIds() {
console.log('— attachListedItemIds: public-лот → listed_item_id, draft/продан → null —');

{
    const supabase = makeMockSupabase({
        shop_items: [
            // item_type: 'account' обязателен — attachListedItemIds фильтрует
            // .eq('item_type', 'account') (report-only, aef6973): резать
            // listed_item_id теперь имеют право только аккаунт-лоты.
            { id: 'item-pub', owner_id: OWNER, item_type: 'account', status: 'published' },
            { id: 'item-draft', owner_id: OWNER, item_type: 'account', status: 'draft' }
        ],
        shop_item_assets: [
            { shop_item_id: 'item-pub', asset_type: 'userbot', asset_id: 'acc-live' },
            { shop_item_id: 'item-draft', asset_type: 'userbot', asset_id: 'acc-drafted' }
        ]
    });
    const scanRow = {
        id: 'scan-1',
        items: [
            { account_id: 'acc-live', sellable: true },
            { account_id: 'acc-drafted', sellable: false },
            { account_id: 'acc-free', sellable: false }
        ]
    };
    const enriched = await attachListedItemIds(supabase, OWNER, scanRow);
    const byId = Object.fromEntries(enriched.items.map((item) => [item.account_id, item.listed_item_id]));
    assert(byId['acc-live'] === 'item-pub', 'public-лот: listed_item_id проставлен');
    assert(byId['acc-drafted'] === null, 'draft-лот — не витрина: listed_item_id null');
    assert(byId['acc-free'] === null, 'без лота: listed_item_id null');
    assert(enriched.items[0].sellable === true, 'обогащение не теряет поля айтемов');
    assert(await attachListedItemIds(supabase, OWNER, null) === null, 'пустой скан проходит насквозь');
}
}
