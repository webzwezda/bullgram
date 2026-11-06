// Сценарий из test/test-shop-delivery.js (разрезка под лимит pre-commit; хост — test/test-shop-delivery.js).
import { createAccountLotsBatch } from '../../routes/shop.routes.js';
import { ACCOUNT_LOT_NOT_READY_MESSAGE } from '../../services/shop-delivery.service.js';
import { assert, makeMockSupabase, baseTables, accountRow, restoreSourceRow, OWNER, ACC1, ACC2, ACC3, ACC_BAD } from './shared.js';

export async function runBatchCreateLots() {
console.log('— Batch-выставление аккаунтов —');

{
    const supabase = makeMockSupabase(baseTables({
        tg_accounts: [
            accountRow({ id: ACC1 }),
            accountRow({ id: ACC2, custom_label: '+44…777' }),
            accountRow({ id: ACC3, custom_label: '+66…333' }),
            accountRow({ id: ACC_BAD, custom_label: '+55…111', runtime_status: 'frozen' })
        ],
        shop_items: [],
        shop_item_assets: [],
        // Правило продажи: tdata-блоб обязателен — у ACC3 источника нет.
        userbot_restore_sources: [
            restoreSourceRow({ account_id: ACC1 }),
            restoreSourceRow({ account_id: ACC2 })
        ]
    }));
    const result = await createAccountLotsBatch(supabase, {
        ownerId: OWNER,
        assetIds: [ACC1, ACC2, ACC3, ACC_BAD],
        priceTon: 5,
        title: 'Аккаунт из приёмки',
        deliveryMode: 'hybrid'
    });
    assert(result.created === 2, 'batch: создано 2 лота, упавший аккаунт не помешал');
    const statusByAsset = Object.fromEntries(result.results.map((row) => [row.asset_id, row.status]));
    assert(statusByAsset[ACC1] === 'ok' && statusByAsset[ACC2] === 'ok' && statusByAsset[ACC_BAD] === 'failed', 'batch: ok/ok/failed по активам');
    assert(result.results.find((row) => row.asset_id === ACC_BAD).error === ACCOUNT_LOT_NOT_READY_MESSAGE, 'batch: frozen дал ошибку гейта');
    assert(statusByAsset[ACC3] === 'failed', 'batch: без restore source выставить нельзя');
    assert(result.results.find((row) => row.asset_id === ACC3).error === 'Нет tdata-архива', 'batch: без tdata — честная причина «Нет tdata-архива»');
    const items = supabase._tables.shop_items;
    assert(items.length === 2, 'batch: ровно 2 лота в БД');
    assert(items.every((item) =>
        item.item_type === 'account'
        && item.status === 'published'
        && item.visibility === 'public'
        && item.sales_channel === 'both'
        && item.transfer_mode === 'ownership_transfer'
        && item.delivery_mode === 'hybrid'
    ), 'batch: лоты опубликованы как account/hybrid');
    assert(supabase._tables.shop_item_assets.length === 2, 'batch: у каждого лота свой userbot-актив');
}
}
