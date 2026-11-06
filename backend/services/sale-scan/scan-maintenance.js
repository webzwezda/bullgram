// Обслуживание sale scan: обогащение GET-скана публичными лотами
// (attachListedItemIds) и свип зависших processing-строк (sweepStaleScans;
// isScanStale нужен свипу, поэтому тоже здесь). Вынесено дословно из
// sale-scan.service.js (behavior-preserving разрезка под pre-commit лимит
// 20000 байт); внешние импортёры продолжают импортировать из
// sale-scan.service.js — там named реэкспорт.
// processing-строка, которую не трогали дольше часа — скан умер вместе с
// перезапуском сервера (fire-and-forget): свип помечает его failed.
const SCAN_STALE_AFTER_MS = 60 * 60 * 1000;

export function isScanStale(row, nowMs = Date.now()) {
    if (!row || row.status !== 'processing') return false;
    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    return !updatedAt || (nowMs - updatedAt) > SCAN_STALE_AFTER_MS;
}

function isMissingShopTablesError(error) {
    const code = error?.code || '';
    const message = String(error?.message || error || '');
    return code === '42P01' || message.includes('shop_items') || message.includes('shop_item_assets');
}

// Обогащение GET-скана: каждому айтему — listed_item_id (id его ПУБЛИЧНОГО
// лота, status='published'). Карточка по нему показывает кнопку «Снять» и
// прячет строки, чей лот уже снят/продан: после «Снять» лот уходит в draft
// (unpublish-эндпоинт), refreshed GET приходит без listed_item_id — строка
// исчезает из «Уже на витрине» без нового скана. Черновики — не витрина,
// поэтому enrich именно по published, а не по всем активным лотам.
// БД без shop-таблиц — скан отдаём как есть (обогащать нечем).
export async function attachListedItemIds(supabase, ownerId, scan) {
    if (!scan || !Array.isArray(scan.items) || !scan.items.length) return scan;

    const { data: publishedItems, error: itemsError } = await supabase
        .from('shop_items')
        .select('id')
        .eq('owner_id', ownerId)
        .eq('item_type', 'account')
        .eq('status', 'published');
    if (itemsError) {
        if (!isMissingShopTablesError(itemsError)) throw itemsError;
        return scan;
    }
    const itemIds = (publishedItems || []).map((row) => row.id);

    const listedByAssetId = new Map();
    if (itemIds.length) {
        const { data: assets, error: assetsError } = await supabase
            .from('shop_item_assets')
            .select('shop_item_id, asset_id')
            .eq('asset_type', 'userbot')
            .in('shop_item_id', itemIds);
        if (assetsError) {
            if (!isMissingShopTablesError(assetsError)) throw assetsError;
            return scan;
        }
        for (const asset of assets || []) {
            listedByAssetId.set(String(asset.asset_id), asset.shop_item_id);
        }
    }

    return {
        ...scan,
        items: scan.items.map((item) => ({
            ...item,
            listed_item_id: listedByAssetId.get(String(item.account_id)) || null
        }))
    };
}

// Свип зависших processing-сканов владельца: старше часа без обновлений —
// failed с честной причиной. Мутирует переданные rows (status/error), чтобы
// вызывающий увидел свежее состояние без перечитывания.
export async function sweepStaleScans(supabase, ownerId, rows = []) {
    const nowMs = Date.now();
    for (const row of rows) {
        if (!isScanStale(row, nowMs)) continue;
        const { error } = await supabase
            .from('account_sale_scans')
            .update({ status: 'failed', error: 'Прерван перезапуском сервера.', updated_at: new Date().toISOString() })
            .eq('id', row.id)
            .eq('owner_id', ownerId)
            .eq('status', 'processing');
        if (error) throw error;
        row.status = 'failed';
        row.error = 'Прерван перезапуском сервера.';
    }
}
