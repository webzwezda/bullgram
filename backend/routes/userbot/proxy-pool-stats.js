// Статистика платформенного пула managed-прокси (BACKLOG §32).
// Пул = все строки proxies с username mp_* (источник правды reconcile'а).
// Непересекающиеся состояния слота (в сумме = total):
//   free           — свободен для авто-выдачи (owner NULL, вне магазина);
//   used           — привязан к юзерботу (tg_accounts.proxy_id);
//   shop_listed    — висит в опубликованном лоте магазина;
//   reserved_other — у владельца без привязки и вне магазина (осиротевшие).
// Пересекающиеся (справочные): dead (is_working=false), sold (слот в sold-лоте
// магазина, исторические продажи тоже), purchased_source (закуплен на стороне).
// Удаление: с привязанным юзерботом запрещено (DELETE /proxies/:id), после
// удаления reconcile снимает слушателя и IPv6. Только платформенный админ.
import { authenticateUser } from '../../middlewares/auth.middleware.js';

export function registerProxyPoolStats(router, ctx) {
    const { supabase } = ctx;

    router.get('/proxy-pool/stats', authenticateUser, async (req, res) => {
        if (req.profile?.role !== 'admin') {
            return res.status(403).json({ error: 'Статистика пула доступна только платформенному админу.' });
        }

        const { data: poolRows, error: poolError } = await supabase
            .from('proxies')
            .select('id, owner_id, is_working, provision_source')
            .like('username', 'mp_%');
        if (poolError) throw poolError;

        const { data: boundRows, error: boundError } = await supabase
            .from('tg_accounts')
            .select('proxy_id')
            .not('proxy_id', 'is', null);
        if (boundError) throw boundError;

        // Лоты с прокси-ассетами: published (public/unlisted = «в магазине»)
        // и sold («продано» — исторические продажи тоже считаются).
        const { data: shopItems, error: shopItemsError } = await supabase
            .from('shop_items')
            .select('id, status, visibility')
            .in('status', ['published', 'sold']);
        if (shopItemsError) throw shopItemsError;
        const listedItemIds = (shopItems || [])
            .filter((row) => row.status === 'published' && ['public', 'unlisted'].includes(row.visibility))
            .map((row) => row.id);
        const soldItemIds = (shopItems || []).filter((row) => row.status === 'sold').map((row) => row.id);

        async function proxyAssetsOf(itemIds) {
            if (!itemIds.length) return [];
            const { data: assets, error } = await supabase
                .from('shop_item_assets')
                .select('asset_id')
                .eq('asset_type', 'proxy')
                .in('shop_item_id', itemIds);
            if (error) throw error;
            return (assets || []).map((row) => String(row.asset_id));
        }

        const poolIds = new Set((poolRows || []).map((row) => String(row.id)));
        const usedIds = new Set((boundRows || [])
            .map((row) => String(row.proxy_id))
            .filter((id) => poolIds.has(id)));
        const shopListedIds = new Set((await proxyAssetsOf(listedItemIds)).filter((id) => poolIds.has(id)));
        const soldIds = new Set((await proxyAssetsOf(soldItemIds)).filter((id) => poolIds.has(id)));

        const total = (poolRows || []).length;
        const used = usedIds.size;
        const dead = (poolRows || []).filter((row) => row.is_working === false).length;
        const purchasedSource = (poolRows || []).filter((row) => row.provision_source === 'purchased').length;
        // free = свободен для выдачи: owner NULL и не висит в магазине.
        const free = (poolRows || []).filter((row) => row.owner_id == null && !shopListedIds.has(String(row.id))).length;
        // reserved_other = у владельца без привязки и вне магазина (осиротевшие).
        const reservedOther = Math.max(total - used - shopListedIds.size - free, 0);

        return res.json({
            total,
            used,
            free,
            used_share: total > 0 ? Math.round((used / total) * 100) : 0,
            reserved_other: reservedOther,
            dead,
            shop_listed: shopListedIds.size,
            sold: soldIds.size,
            purchased_source: purchasedSource
        });
    });
}
