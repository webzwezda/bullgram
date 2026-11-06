// Сценарий из test/test-shop-delivery.js (разрезка под лимит pre-commit; хост — test/test-shop-delivery.js).
import { createAccountLotsBatch } from '../../routes/shop.routes.js';
import { assert, makeMockSupabase, baseTables, accountRow, restoreSourceRow, OWNER, ACC1 } from './shared.js';

export async function runBatchAutoTitle() {
console.log('— Batch: автоназвание (страна по телефону + срок отлёжки) —');

{
    // Без явного title сервер сам строит название: страна по tg_phone,
    // отлёжка — сколько дней с импорта (правка владельца 2026-10-31).
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase(baseTables({
        tg_accounts: [
            accountRow({ id: ACC1, tg_phone: '+12125550142', created_at: thirtyDaysAgo })
        ],
        shop_items: [],
        shop_item_assets: [],
        userbot_restore_sources: [restoreSourceRow()]
    }));
    const result = await createAccountLotsBatch(supabase, {
        ownerId: OWNER,
        assetIds: [ACC1],
        priceTon: 5
    });
    assert(result.created === 1, 'auto-title: лот создан без явного названия');
    const item = supabase._tables.shop_items[0];
    assert(/Телеграм аккаунт — страна: США, отлёжка: 30 дней/.test(item.title), `auto-title: страна+отлёжка в названии (${item.title})`);
    assert(item.description === null, 'auto-title: описание пустое');
}
}
