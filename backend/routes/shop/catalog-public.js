// Публичная витрина shop (стадия 2 разрезки shop.routes.js).
// Зона: closure-хелпер listVisibleShopItems (GET /public/items, GET /app/items)
// и GET /public/my-purchases.
import QRCode from 'qrcode';
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { tonToNanoString } from '../../utils/ton.js';
import {
    buildAvailablePaymentMethods,
    buildTonUri,
    buildTrustWalletTonUri,
    detectNetwork,
    expireStalePendingPurchases,
    getPendingPurchaseExpiry,
    isMissingShopTables,
    isPendingPurchaseExpired,
    isTextServiceItem,
    isVisibleInSalesChannel,
    normalizeItem,
    normalizePaymentMethods
} from './helpers.js';

export function registerCatalogPublic(router, ctx) {
    const { supabase } = ctx;

    // Closure-хелпер прежнего главного файла (стоял в середине фабрики):
    // supabase подан первым аргументом, вызовы ниже передают его из ctx.
    async function listVisibleShopItems(supabase, req, res, { channel = 'site' } = {}) {
        try {
            const sellerId = req.query.seller ? String(req.query.seller) : null;
            const itemId = req.query.item ? String(req.query.item) : null;

            let itemsQuery = supabase
                .from('shop_items')
                .select('*')
                .eq('status', 'published')
                .order('created_at', { ascending: false });

            if (itemId) {
                itemsQuery = itemsQuery
                    .eq('id', itemId)
                    .in('visibility', ['public', 'unlisted']);
            } else {
                itemsQuery = itemsQuery.eq('visibility', 'public');
                if (sellerId) {
                    itemsQuery = itemsQuery.eq('owner_id', sellerId);
                }
            }

            const { data: items, error: itemsError } = await itemsQuery;

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
                        .select('id, shop_item_id, buyer_owner_id, status, created_at')
                        .in('shop_item_id', itemIds)
                        .order('created_at', { ascending: false })
                ]);

                if (assetsResp.error) throw assetsResp.error;
                if (purchasesResp.error) throw purchasesResp.error;

                assets = assetsResp.data || [];
                purchases = purchasesResp.data || [];
                await expireStalePendingPurchases(supabase, purchases);
            }

            const assetsByItem = new Map();
            for (const asset of assets) {
                const bucket = assetsByItem.get(asset.shop_item_id) || [];
                bucket.push({
                    asset_type: asset.asset_type,
                    asset_id: asset.asset_id,
                    label: asset.label || ''
                });
                assetsByItem.set(asset.shop_item_id, bucket);
            }

            const reservationByItem = new Map();
            for (const purchase of purchases) {
                const sourceItem = (items || []).find(item => String(item.id) === String(purchase.shop_item_id));
                if (isTextServiceItem(sourceItem)) continue;
                if (purchase.status !== 'pending' || isPendingPurchaseExpired(purchase)) continue;
                if (!reservationByItem.has(purchase.shop_item_id)) {
                    reservationByItem.set(purchase.shop_item_id, {
                        buyer_owner_id: purchase.buyer_owner_id,
                        expires_at: getPendingPurchaseExpiry(purchase.created_at).toISOString()
                    });
                }
            }

            const publicItems = (items || []).filter((item) => isVisibleInSalesChannel(item, channel));

            const visibleItems = publicItems.filter((item) => {
                if (isTextServiceItem(item)) return true;
                return !reservationByItem.has(item.id);
            });

            const resolvedSellerId = sellerId || (visibleItems[0]?.owner_id ? String(visibleItems[0].owner_id) : null);
            let sellerProfile = null;
            let sellerStats = null;
            let sellerCards = [];

            const sellerOwnerIds = Array.from(new Set(visibleItems.map(item => item.owner_id).filter(Boolean).map(String)));

            if (sellerOwnerIds.length) {
                const { data: sellerProfiles } = await supabase
                    .from('profiles')
                    .select('id, full_name, role')
                    .in('id', sellerOwnerIds);

                const profileByOwnerId = new Map((sellerProfiles || []).map(profile => [String(profile.id), profile]));
                const sellerBuckets = new Map();

                for (const item of visibleItems) {
                    if (!item.owner_id) continue;
                    const ownerKey = String(item.owner_id);
                    const bucket = sellerBuckets.get(ownerKey) || {
                        owner_id: ownerKey,
                        total: 0,
                        bundles: 0,
                        text_offers: 0,
                        reserved: 0
                    };

                    bucket.total += 1;
                    if (item.item_type === 'bundle') bucket.bundles += 1;
                    if (item.item_type === 'text_offer') bucket.text_offers += 1;
                    sellerBuckets.set(ownerKey, bucket);
                }

                sellerCards = Array.from(sellerBuckets.values())
                    .sort((left, right) => right.total - left.total)
                    .slice(0, 3)
                    .map(bucket => {
                        const profile = profileByOwnerId.get(bucket.owner_id);
                        const sellerName = profile?.full_name?.trim() || `Продавец ${bucket.owner_id.slice(0, 8)}`;
                        return {
                            owner_id: bucket.owner_id,
                            seller_name: sellerName,
                            seller_mode: profile?.role === 'admin' ? 'asset_marketplace' : 'text_service',
                            total: bucket.total,
                            bundles: bucket.bundles,
                            text_offers: bucket.text_offers,
                            reserved: bucket.reserved
                        };
                    });
            }

            if (resolvedSellerId) {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .eq('id', resolvedSellerId)
                    .maybeSingle();

                sellerProfile = {
                    id: resolvedSellerId,
                    name: profile?.full_name || `Продавец ${String(resolvedSellerId).slice(0, 8)}`,
                    mode: profile?.role === 'admin' ? 'asset_marketplace' : 'text_service'
                };

                sellerStats = {
                    total_items: visibleItems.length,
                    bundles: visibleItems.filter(item => item.item_type === 'bundle').length,
                    reserved: Array.from(reservationByItem.keys()).length,
                    proxies: visibleItems.filter(item => item.item_type === 'proxy').length,
                    userbots: visibleItems.filter(item => item.item_type === 'userbot').length,
                    channel_audiences: visibleItems.filter(item => item.item_type === 'channel_audience_asset').length,
                    text_offers: visibleItems.filter(item => item.item_type === 'text_offer').length
                };
            }

            // Витрина аккаунт-лотов: маска + свежесть последней проверки.
            // Наружу идут только эти поля — никаких tg_phone/username/tg_account_id.
            const accountPreviewByItem = new Map();
            const previewAssetToItem = new Map();
            for (const item of visibleItems) {
                if (item.item_type !== 'account') continue;
                for (const asset of (assetsByItem.get(item.id) || [])) {
                    if (asset.asset_type === 'userbot') {
                        previewAssetToItem.set(String(asset.asset_id), item.id);
                    }
                }
            }
            const previewAccountIds = Array.from(previewAssetToItem.keys());
            if (previewAccountIds.length > 0) {
                const { data: previewAccounts, error: previewError } = await supabase
                    .from('tg_accounts')
                    .select('id, custom_label, runtime_status, last_checked_at, health_summary')
                    .in('id', previewAccountIds);
                if (previewError) throw previewError;
                for (const account of previewAccounts || []) {
                    const itemId = previewAssetToItem.get(String(account.id));
                    if (!itemId) continue;
                    accountPreviewByItem.set(String(itemId), {
                        label: account.custom_label || null,
                        last_checked_at: account.last_checked_at || null,
                        health_status: String(account.runtime_status || '').trim().toLowerCase(),
                        spambot_state: String(account.health_summary?.spambot_state || 'not_checked')
                    });
                }
            }

            res.json({
                items: visibleItems.map(item => ({
                    ...normalizeItem(item),
                    // asset_id аккаунт-лота — это UUID tg_accounts: наружу не отдаём
                    // (ревью P1), карточке хватает account_preview.
                    assets: item.item_type === 'account'
                        ? []
                        : (assetsByItem.get(item.id) || []),
                    ...(item.item_type === 'account'
                        ? { account_preview: accountPreviewByItem.get(item.id) || null }
                        : {}),
                    available_payment_methods: buildAvailablePaymentMethods(item),
                    active_reservation: reservationByItem.get(item.id) || null
                })),
                seller_cards: sellerCards,
                seller_id: resolvedSellerId,
                seller_profile: sellerProfile,
                seller_stats: sellerStats,
                focused_item_id: itemId,
                support: {
                    shop: true
                }
            });
        } catch (error) {
            console.error('Ошибка публичной витрины shop:', error);
            res.status(500).json({ error: 'Ошибка загрузки витрины' });
        }
    }

    router.get('/public/items', async (req, res) => {
        return listVisibleShopItems(supabase, req, res, { channel: 'site' });
    });

    router.get('/app/items', authenticateUser, async (req, res) => {
        return listVisibleShopItems(supabase, req, res, { channel: 'app' });
    });

    router.get('/public/my-purchases', authenticateUser, async (req, res) => {
        const buyerOwnerId = req.user.id;

        try {
            const { data: purchases, error } = await supabase
                .from('shop_purchases')
                .select('*, shop_items(id, title, description, post_purchase_message, item_type, price_ton, preview_text, payment_methods)')
                .eq('buyer_owner_id', buyerOwnerId)
                .order('created_at', { ascending: false });

            if (error) {
                if (isMissingShopTables(error)) {
                    return res.json({ purchases: [], support: { shop: false } });
                }
                throw error;
            }

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

            // Батч оплачивается одним переводом на общую сумму — URI/QR для строк
            // с batch_token строим на сумму пакета, а не одной строки.
            const batchTotals = new Map();
            for (const row of purchases || []) {
                const token = String(row.payload?.batch_token || '').trim();
                if (!token || row.status !== 'pending') continue;
                batchTotals.set(token, Number(batchTotals.get(token) || 0) + Number(row.amount_ton || 0));
            }

            const normalizedPurchases = await Promise.all((purchases || []).map(async row => {
                const batchToken = String(row.payload?.batch_token || '').trim();
                const displayAmountTon = row.status === 'pending' && batchTotals.has(batchToken)
                    ? batchTotals.get(batchToken)
                    : Number(row.amount_ton || 0);
                const tonUri = row.status === 'pending' && row.payload?.seller_wallet && row.payload?.memo
                    ? buildTonUri(row.payload.seller_wallet, displayAmountTon, row.payload.memo)
                    : null;
                const trustWalletUri = row.status === 'pending' && row.payload?.seller_wallet && row.payload?.memo
                    ? buildTrustWalletTonUri(row.payload.seller_wallet, displayAmountTon, row.payload.memo)
                    : null;
                const trustWalletQr = trustWalletUri ? await QRCode.toDataURL(trustWalletUri, {
                    errorCorrectionLevel: 'H',
                    margin: 2,
                    width: 360
                }) : null;
                const tonQr = tonUri ? await QRCode.toDataURL(tonUri, {
                    errorCorrectionLevel: 'H',
                    margin: 2,
                    width: 360
                }) : null;

                return {
                    id: row.id,
                    status: row.status === 'pending' && isPendingPurchaseExpired(row) ? 'expired' : row.status,
                    amount_ton: Number(row.amount_ton || 0),
                    amount_nanoton: tonToNanoString(Number(row.amount_ton || 0)),                    network: detectNetwork(),
                    ownership_transfer_status: row.ownership_transfer_status || 'pending',
                    ownership_transfer_error: row.ownership_transfer_error || null,
                    created_at: row.created_at,
                    expires_at: row.status === 'pending' ? getPendingPurchaseExpiry(row.created_at).toISOString() : null,
                    payload: {
                        ...(row.payload || {}),
                        ton_uri: tonUri,
                        trust_wallet_uri: trustWalletUri,
                        trust_wallet_qr: trustWalletQr,
                        ton_qr: tonQr
                    },
                    item: row.shop_items
                        ? {
                            id: row.shop_items.id,
                            title: row.shop_items.title,
                            description: row.shop_items.description || '',
                            post_purchase_message: row.shop_items.post_purchase_message || '',
                            item_type: row.shop_items.item_type,
                            price_ton: Number(row.shop_items.price_ton || 0),                            preview_text: row.shop_items.preview_text || '',
                            payment_methods: normalizePaymentMethods(row.shop_items.payment_methods)
                        }
                        : null,
                    assets: row.shop_items?.id ? (assetsByItem.get(row.shop_items.id) || []) : []
                };
            }));

            res.json({
                purchases: normalizedPurchases,
                network: detectNetwork(),
                support: {
                    shop: true
                }
            });
        } catch (error) {
            console.error('Ошибка загрузки моих покупок shop:', error);
            res.status(500).json({ error: 'Ошибка загрузки покупок' });
        }
    });
}
