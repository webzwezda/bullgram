export async function loadReservedAssetMap(supabase, ownerId) {
    try {
        const { data: items, error: itemsError } = await supabase
            .from('shop_items')
            .select('id, title, status, visibility')
            .eq('owner_id', ownerId)
            .eq('status', 'published');

        if (itemsError) {
            const message = itemsError.message || '';
            if (message.includes('shop_items')) {
                return {
                    itemById: new Map(),
                    userbotIds: new Set(),
                    proxyIds: new Set(),
                    baseIds: new Set(),
                    assetToItem: new Map()
                };
            }
            throw itemsError;
        }

        const itemIds = (items || []).map(item => item.id);
        if (itemIds.length === 0) {
            return {
                itemById: new Map(),
                userbotIds: new Set(),
                proxyIds: new Set(),
                baseIds: new Set(),
                assetToItem: new Map()
            };
        }

        const { data: assets, error: assetsError } = await supabase
            .from('shop_item_assets')
            .select('shop_item_id, asset_type, asset_id')
            .in('shop_item_id', itemIds);

        if (assetsError) {
            const message = assetsError.message || '';
            if (message.includes('shop_item_assets')) {
                return {
                    itemById: new Map(),
                    userbotIds: new Set(),
                    proxyIds: new Set(),
                    baseIds: new Set(),
                    assetToItem: new Map()
                };
            }
            throw assetsError;
        }

        const itemById = new Map((items || []).map(item => [String(item.id), item]));
        const userbotIds = new Set();
        const proxyIds = new Set();
        const baseIds = new Set();
        const assetToItem = new Map();

        for (const asset of assets || []) {
            const assetId = String(asset.asset_id);
            const item = itemById.get(String(asset.shop_item_id)) || null;
            assetToItem.set(`${asset.asset_type}:${assetId}`, item);

            if (asset.asset_type === 'userbot') userbotIds.add(assetId);
            if (asset.asset_type === 'proxy') proxyIds.add(assetId);
            if (asset.asset_type === 'customer_base_asset') baseIds.add(assetId);
        }

        return {
            itemById,
            userbotIds,
            proxyIds,
            baseIds,
            assetToItem
        };
    } catch (error) {
        throw error;
    }
}

export async function loadReservedUserbotIds(supabase, ownerId) {
    const reserved = await loadReservedAssetMap(supabase, ownerId);
    return reserved.userbotIds;
}

export async function unpublishShopItemsByUserbotId(supabase, ownerId, userbotId) {
    if (!supabase || !ownerId || !userbotId) {
        return { updatedCount: 0, itemIds: [] };
    }

    const { data: assets, error: assetsError } = await supabase
        .from('shop_item_assets')
        .select('shop_item_id')
        .eq('asset_type', 'userbot')
        .eq('asset_id', String(userbotId));

    if (assetsError) {
        const message = assetsError.message || '';
        if (message.includes('shop_item_assets')) {
            return { updatedCount: 0, itemIds: [] };
        }
        throw assetsError;
    }

    const itemIds = Array.from(new Set((assets || []).map((row) => String(row.shop_item_id || '')).filter(Boolean)));
    if (!itemIds.length) {
        return { updatedCount: 0, itemIds: [] };
    }

    const { data: updatedRows, error: updateError } = await supabase
        .from('shop_items')
        .update({
            status: 'draft',
            visibility: 'private',
            updated_at: new Date().toISOString()
        })
        .eq('owner_id', ownerId)
        .eq('status', 'published')
        .in('id', itemIds)
        .select('id');

    if (updateError) {
        const message = updateError.message || '';
        if (message.includes('shop_items')) {
            return { updatedCount: 0, itemIds: [] };
        }
        throw updateError;
    }

    return {
        updatedCount: (updatedRows || []).length,
        itemIds: (updatedRows || []).map((row) => String(row.id))
    };
}
