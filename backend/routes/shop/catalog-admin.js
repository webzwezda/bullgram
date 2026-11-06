// Админская каталог-зона shop (стадия 2 разрезки shop.routes.js).
// Зона: GET /admin/assets + /seller/assets, GET /admin/reserved-assets +
// /seller/reserved-assets, GET /admin/market-lots.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { loadReservedAssetMap } from '../../utils/shop-reservations.js';
import {
    expireStalePendingPurchases,
    getPendingPurchaseExpiry,
    isAdminSeller,
    isPendingPurchaseExpired,
    normalizeItem,
    siteWallet
} from './helpers.js';
import { loadOwnerUserbotProxyUsage, proxyHasMultipleUserbots } from './purchase-core.js';

export function registerCatalogAdmin(router, ctx) {
    const { supabase } = ctx;

    router.get(['/admin/assets', '/seller/assets'], authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const adminSeller = isAdminSeller(req.profile);

        try {
            if (!adminSeller) {
                return res.json({
                    proxies: [],
                    userbots: [],
                    channel_audiences: [],
                    seller_wallet: siteWallet() || null,
                    seller_role: req.profile?.role || null,
                    seller_mode: 'text_service',
                    support: {
                        channel_audiences: false,
                        asset_marketplace: false,
                        text_service: true
                    }
                });
            }

            const [proxiesResp, userbotsResp, basesResp] = await Promise.all([
                supabase
                    .from('proxies')
                    .select('id, name, host, port, is_working, last_check_country, last_check_country_code, provision_source, inventory_group')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('tg_accounts')
                    .select('id, tg_account_id, tg_username, proxy_id')
                    .eq('owner_id', ownerId)
                    .eq('account_type', 'userbot')
                    .order('created_at', { ascending: false }),
                supabase
                    .from('channel_audiences')
                    .select('id, title, description, channel_count, members_count, updated_at')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
            ]);

            const joinedError = [
                proxiesResp.error?.message || '',
                userbotsResp.error?.message || '',
                basesResp.error?.message || ''
            ].join(' ');
            const customerBasesUnavailable = joinedError.includes('channel_audiences');

            if (proxiesResp.error) throw proxiesResp.error;
            if (userbotsResp.error) throw userbotsResp.error;
            if (basesResp.error && !customerBasesUnavailable) throw basesResp.error;

            const { usage: proxyUsageMap } = await loadOwnerUserbotProxyUsage(supabase, ownerId);
            const proxies = (proxiesResp.data || [])
                .map(proxy => ({
                    ...proxy,
                    provision_source: proxy.provision_source || 'manual_admin',
                    inventory_group: proxy.inventory_group || 'shop_sale',
                    userbot_count: (proxyUsageMap.get(String(proxy.id)) || []).length,
                    is_safe_single_use: (proxyUsageMap.get(String(proxy.id)) || []).length <= 1,
                    is_ready_for_sale: (proxy.inventory_group || 'shop_sale') === 'shop_sale'
                        && proxy.is_working !== false
                        && (proxyUsageMap.get(String(proxy.id)) || []).length === 0
                }))
                .filter(proxy => proxy.inventory_group === 'shop_sale');
            const userbots = (userbotsResp.data || []).map(userbot => ({
                ...userbot,
                proxy_userbot_count: userbot.proxy_id ? (proxyUsageMap.get(String(userbot.proxy_id)) || []).length : 0,
                proxy_is_shared: userbot.proxy_id ? proxyHasMultipleUserbots(proxyUsageMap, userbot.proxy_id) : false
            }));

            const proxyStats = {
                total: proxies.length,
                ready_for_sale: proxies.filter((proxy) => proxy.is_ready_for_sale).length,
                occupied: proxies.filter((proxy) => Number(proxy.userbot_count || 0) > 0).length,
                broken: proxies.filter((proxy) => proxy.is_working === false).length,
                purchased: proxies.filter((proxy) => proxy.provision_source === 'purchased').length
            };

            res.json({
                proxies,
                userbots,
                channel_audiences: customerBasesUnavailable ? [] : (basesResp.data || []),
                seller_wallet: siteWallet() || null,
                seller_role: req.profile?.role || null,
                seller_mode: 'asset_marketplace',
                stats: {
                    proxies: proxyStats
                },
                support: {
                    channel_audiences: !customerBasesUnavailable,
                    asset_marketplace: true,
                    text_service: true
                }
            });
        } catch (error) {
            console.error('Ошибка загрузки shop assets:', error);
            res.status(500).json({ error: 'Ошибка загрузки активов продавца' });
        }
    });

    router.get(['/admin/reserved-assets', '/seller/reserved-assets'], authenticateUser, async (req, res) => {
        try {
            const reserved = await loadReservedAssetMap(supabase, req.user.id);

            const entries = Array.from(reserved.assetToItem.entries()).map(([key, item]) => ({
                key,
                item_id: item?.id || null,
                item_title: item?.title || ''
            }));

            res.json({
                userbot_ids: Array.from(reserved.userbotIds),
                proxy_ids: Array.from(reserved.proxyIds),
                base_ids: Array.from(reserved.baseIds),
                entries
            });
        } catch (error) {
            console.error('Ошибка загрузки reserved assets shop:', error);
            res.status(500).json({ error: 'Ошибка загрузки резервов shop' });
        }
    });

    router.get('/admin/market-lots', authenticateUser, async (req, res) => {
        if (req.profile?.role !== 'admin') {
            return res.status(403).json({ error: 'Обзор витрины доступен только администратору проекта.' });
        }

        const allowedTypes = ['proxy', 'userbot', 'bundle', 'channel_audience_asset', 'text_offer', 'account'];
        const itemTypes = String(req.query.types || '')
            .split(',')
            .map((value) => value.trim())
            .filter((type) => allowedTypes.includes(type));

        try {
            let itemsQuery = supabase
                .from('shop_items')
                .select('*')
                .eq('status', 'published')
                .order('created_at', { ascending: false })
                .limit(200);
            if (itemTypes.length) {
                itemsQuery = itemsQuery.in('item_type', itemTypes);
            }

            const { data: items, error: itemsError } = await itemsQuery;
            if (itemsError) throw itemsError;

            const itemIds = (items || []).map((item) => item.id);
            let assets = [];
            let purchases = [];

            if (itemIds.length) {
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
                await expireStalePendingPurchases(supabase, purchasesResp.data || []);
                assets = assetsResp.data || [];
                purchases = purchasesResp.data || [];
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

            const activeReservationByItem = new Map();
            for (const purchase of purchases) {
                if (purchase.status !== 'pending' || isPendingPurchaseExpired(purchase)) continue;
                if (activeReservationByItem.has(purchase.shop_item_id)) continue;
                activeReservationByItem.set(purchase.shop_item_id, {
                    buyer_owner_id: purchase.buyer_owner_id,
                    expires_at: getPendingPurchaseExpiry(purchase.created_at).toISOString()
                });
            }

            const ownerIds = Array.from(new Set((items || []).map((item) => String(item.owner_id || '')).filter(Boolean)));
            let ownerNamesById = new Map();
            if (ownerIds.length) {
                const { data: ownerProfiles, error: ownerProfilesError } = await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .in('id', ownerIds);
                if (ownerProfilesError) throw ownerProfilesError;
                ownerNamesById = new Map((ownerProfiles || []).map((profile) => [String(profile.id), profile.full_name?.trim() || '']));
            }

            res.json({
                items: (items || []).map((item) => ({
                    ...normalizeItem(item),
                    assets: assetsByItem.get(item.id) || [],
                    owner_name: ownerNamesById.get(String(item.owner_id)) || null,
                    active_reservation: activeReservationByItem.get(item.id) || null
                }))
            });
        } catch (error) {
            console.error('Ошибка загрузки market lots:', error);
            res.status(500).json({ error: 'Не удалось загрузить лоты витрины' });
        }
    });
}
