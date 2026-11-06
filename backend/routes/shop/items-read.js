// Чтение лотов и продаж shop (стадия 2 разрезки shop.routes.js).
// Зона: GET /admin/items + /seller/items, GET /admin/purchases + /seller/purchases,
// POST /admin/purchases/:id/check + /seller/..., POST /admin/purchases/check-batch + /seller/...
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import {
    expireStalePendingPurchases,
    getPendingPurchaseExpiry,
    isAdminSeller,
    isMissingShopTables,
    isPendingPurchaseExpired,
    isTextServiceItem,
    normalizeItem
} from './helpers.js';
import { ensureSingleBatchContext, parsePurchaseIdsInput } from './purchase-core.js';
import { runShopPurchaseCheck } from './purchase-check.js';

export function registerItemsRead(router, ctx) {
    const { supabase } = ctx;

    router.get(['/admin/items', '/seller/items'], authenticateUser, async (req, res) => {
        const ownerId = req.user.id;

        try {
            const { data: items, error: itemsError } = await supabase
                .from('shop_items')
                .select('*')
                .eq('owner_id', ownerId)
                .order('created_at', { ascending: false });

            if (itemsError) {
                if (isMissingShopTables(itemsError)) {
                    return res.json({ items: [], support: { shop: false } });
                }
                throw itemsError;
            }

            const itemIds = (items || []).map(item => item.id);
            let assets = [];
            let purchases = [];

            if (itemIds.length > 0) {
                const [assetsResp, purchasesResp] = await Promise.all([
                    supabase
                        .from('shop_item_assets')
                        .select('*')
                        .in('shop_item_id', itemIds)
                        .order('sort_order', { ascending: true }),
                    supabase
                        .from('shop_purchases')
                        .select('id, shop_item_id, status, ownership_transfer_status, amount_ton, created_at, buyer_owner_id')
                        .eq('seller_owner_id', ownerId)
                        .in('shop_item_id', itemIds)
                        .order('created_at', { ascending: false })
                ]);

                if (assetsResp.error) {
                    if (isMissingShopTables(assetsResp.error)) {
                        return res.json({ items: (items || []).map(normalizeItem), support: { shop: false } });
                    }
                    throw assetsResp.error;
                }

                if (purchasesResp.error) throw purchasesResp.error;

                assets = assetsResp.data || [];
                purchases = purchasesResp.data || [];
                await expireStalePendingPurchases(supabase, purchases);
            }

            const assetsByItem = new Map();
            for (const asset of assets) {
                const bucket = assetsByItem.get(asset.shop_item_id) || [];
                bucket.push({
                    id: asset.id,
                    asset_type: asset.asset_type,
                    asset_id: asset.asset_id,
                    label: asset.label || ''
                });
                assetsByItem.set(asset.shop_item_id, bucket);
            }

            const purchasesByItem = new Map();
            for (const purchase of purchases) {
                const bucket = purchasesByItem.get(purchase.shop_item_id) || [];
                bucket.push(purchase);
                purchasesByItem.set(purchase.shop_item_id, bucket);
            }

            const buyerIds = Array.from(new Set((purchases || []).map((purchase) => String(purchase.buyer_owner_id || '')).filter(Boolean)));
            let buyerProfilesById = new Map();
            if (buyerIds.length) {
                const { data: buyerProfiles, error: buyerProfilesError } = await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .in('id', buyerIds);

                if (buyerProfilesError) throw buyerProfilesError;
                buyerProfilesById = new Map((buyerProfiles || []).map((profile) => [String(profile.id), profile]));
            }

            const visibleSellerItems = (items || []).filter((item) => {
                const normalized = normalizeItem(item);
                if (isTextServiceItem(normalized)) return true;
                return (assetsByItem.get(item.id) || []).length > 0;
            });

            res.json({
                items: visibleSellerItems.map(item => ({
                    ...normalizeItem(item),
                    assets: assetsByItem.get(item.id) || [],
                    stats: {
                        total_purchases: (purchasesByItem.get(item.id) || []).length,
                        pending_purchases: (purchasesByItem.get(item.id) || []).filter(purchase =>
                            purchase.status === 'pending' && !isPendingPurchaseExpired(purchase)
                        ).length,
                        expired_purchases: (purchasesByItem.get(item.id) || []).filter(purchase =>
                            purchase.status === 'expired' || (purchase.status === 'pending' && isPendingPurchaseExpired(purchase))
                        ).length,
                        paid_purchases: (purchasesByItem.get(item.id) || []).filter(purchase => purchase.status === 'paid').length,
                        completed_transfers: (purchasesByItem.get(item.id) || []).filter(purchase => purchase.ownership_transfer_status === 'completed').length,
                        failed_transfers: (purchasesByItem.get(item.id) || []).filter(purchase => purchase.ownership_transfer_status === 'failed').length
                    },
                    recent_purchase: (() => {
                        const purchase = (purchasesByItem.get(item.id) || [])[0] || null;
                        if (!purchase) return null;
                        const buyerProfile = buyerProfilesById.get(String(purchase.buyer_owner_id || '')) || null;
                        return {
                            ...purchase,
                            expires_at: purchase.status === 'pending' ? getPendingPurchaseExpiry(purchase.created_at).toISOString() : null,
                            buyer_name: buyerProfile?.full_name?.trim() || null
                        };
                    })()
                })),
                seller_role: req.profile?.role || null,
                seller_mode: isAdminSeller(req.profile) ? 'asset_marketplace' : 'text_service',
                support: {
                    shop: true,
                    asset_marketplace: isAdminSeller(req.profile),
                    text_service: true
                }
            });
        } catch (error) {
            console.error('Ошибка загрузки shop items:', error);
            res.status(500).json({ error: 'Ошибка загрузки лотов' });
        }
    });

    router.get(['/admin/purchases', '/seller/purchases'], authenticateUser, async (req, res) => {
        const ownerId = req.user.id;

        try {
            const { data: purchases, error } = await supabase
                .from('shop_purchases')
                .select('id, shop_item_id, buyer_owner_id, status, amount_ton, ownership_transfer_status, ownership_transfer_error, created_at, payload, shop_items(id, title, item_type, price_ton)')
                .eq('seller_owner_id', ownerId)
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) {
                if (isMissingShopTables(error)) {
                    return res.json({ purchases: [], support: { shop: false } });
                }
                throw error;
            }

            await expireStalePendingPurchases(supabase, purchases || []);
            const itemIds = (purchases || [])
                .map(row => row.shop_items?.id)
                .filter(Boolean);

            let assetRows = [];
            if (itemIds.length > 0) {
                const { data, error: assetsError } = await supabase
                    .from('shop_item_assets')
                    .select('shop_item_id, asset_type, asset_id, label')
                    .in('shop_item_id', itemIds)
                    .order('sort_order', { ascending: true });

                if (assetsError) throw assetsError;
                assetRows = data || [];
            }

            const assetsByItem = new Map();
            for (const asset of assetRows) {
                const bucket = assetsByItem.get(asset.shop_item_id) || [];
                bucket.push({
                    asset_type: asset.asset_type,
                    asset_id: asset.asset_id,
                    label: asset.label || ''
                });
                assetsByItem.set(asset.shop_item_id, bucket);
            }

            res.json({
                purchases: (purchases || []).map(row => ({
                    id: row.id,
                    shop_item_id: row.shop_item_id,
                    buyer_owner_id: row.buyer_owner_id,
                    status: row.status === 'pending' && isPendingPurchaseExpired(row) ? 'expired' : row.status,
                    amount_ton: Number(row.amount_ton || 0),                    ownership_transfer_status: row.ownership_transfer_status || 'pending',
                    ownership_transfer_error: row.ownership_transfer_error || null,
                    created_at: row.created_at,
                    expires_at: row.status === 'pending' ? getPendingPurchaseExpiry(row.created_at).toISOString() : null,
                    payload: row.payload || {},
                    item: row.shop_items ? {
                        id: row.shop_items.id,
                        title: row.shop_items.title,
                        item_type: row.shop_items.item_type,
                        price_ton: Number(row.shop_items.price_ton || 0),                        assets: assetsByItem.get(row.shop_items.id) || []
                    } : null
                })),
                support: {
                    shop: true
                }
            });
        } catch (error) {
            console.error('Ошибка загрузки shop purchases для продавца:', error);
            res.status(500).json({ error: 'Ошибка загрузки продаж shop' });
        }
    });

    router.post(['/admin/purchases/:id/check', '/seller/purchases/:id/check'], authenticateUser, async (req, res) => {
        const sellerOwnerId = req.user.id;
        const purchaseId = req.params.id;

        try {
            const { data: purchase, error: purchaseError } = await supabase
                .from('shop_purchases')
                .select('*')
                .eq('id', purchaseId)
                .eq('seller_owner_id', sellerOwnerId)
                .single();
            if (purchaseError) throw purchaseError;

            const result = await runShopPurchaseCheck(supabase, purchase, {
                enforceSellerOwnerId: sellerOwnerId
            });

            return res.status(result.statusCode).json(result.body);
        } catch (error) {
            console.error('Ошибка проверки shop purchase продавцом:', error);
            res.status(500).json({ error: 'Ошибка проверки оплаты продавцом' });
        }
    });

    router.post(['/admin/purchases/check-batch', '/seller/purchases/check-batch'], authenticateUser, async (req, res) => {
        const sellerOwnerId = req.user.id;
        const purchaseIds = parsePurchaseIdsInput(req.body?.purchase_ids);

        if (!purchaseIds.length) {
            return res.status(400).json({ error: 'Не передан список purchase_ids' });
        }

        try {
            const { data: purchases, error } = await supabase
                .from('shop_purchases')
                .select('*')
                .eq('seller_owner_id', sellerOwnerId)
                .in('id', purchaseIds);

            if (error) throw error;
            if ((purchases || []).length !== purchaseIds.length) {
                return res.status(404).json({ error: 'Часть продаж уже недоступна' });
            }

            ensureSingleBatchContext(purchases || []);

            for (const purchase of purchases || []) {
                const result = await runShopPurchaseCheck(supabase, purchase, {
                    enforceSellerOwnerId: sellerOwnerId
                });
                if (!String(result.statusCode || '').startsWith('2')) {
                    return res.status(result.statusCode).json(result.body);
                }
            }

            return res.json({ success: true, status: 'paid' });
        } catch (error) {
            console.error('Ошибка batch-проверки shop purchase продавцом:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Ошибка batch-проверки оплаты продавцом' });
        }
    });
}
