// Статистика платформенного пула managed-прокси (BACKLOG §32).
// Пул = все строки proxies с username mp_* (источник правды reconcile'а).
// Жизненный цикл одного слота: свободен (owner NULL) → занят владельцем
// (резерв, не привязан) → используется (привязан к юзерботу) → может висеть
// в магазине (published-лот с asset_type='proxy') → куплен (доставленная
// покупка такого лота) → удаление: с привязанным юзерботом запрещено
// (роут DELETE /proxies/:id), после удаления reconcile снимает слушателя.
// Только платформенный админ: числа видны изнутри платформы.
import { authenticateUser } from '../../middlewares/auth.middleware.js';

export function registerProxyPoolStats(router, ctx) {
    const { supabase } = ctx;

    router.get('/proxy-pool/stats', authenticateUser, async (req, res) => {
        if (req.profile?.role !== 'admin') {
            return res.status(403).json({ error: 'Статистика пула доступна только платформенному админу.' });
        }

        const { data: poolRows, error: poolError } = await supabase
            .from('proxies')
            .select('id, owner_id, is_working')
            .like('username', 'mp_%');
        if (poolError) throw poolError;

        const { data: boundRows, error: boundError } = await supabase
            .from('tg_accounts')
            .select('proxy_id')
            .not('proxy_id', 'is', null);
        if (boundError) throw boundError;

        // Опубликованные лоты магазинов (публичные + unlisted) с прокси-ассетами.
        const { data: publishedItems, error: itemsError } = await supabase
            .from('shop_items')
            .select('id')
            .eq('status', 'published')
            .in('visibility', ['public', 'unlisted']);
        if (itemsError) throw itemsError;
        const publishedIds = (publishedItems || []).map((row) => row.id);
        let shopProxyAssetIds = [];
        if (publishedIds.length) {
            const { data: assets, error: assetsError } = await supabase
                .from('shop_item_assets')
                .select('asset_id')
                .eq('asset_type', 'proxy')
                .in('shop_item_id', publishedIds);
            if (assetsError) throw assetsError;
            shopProxyAssetIds = (assets || []).map((row) => String(row.asset_id));
        }

        // Куплено: доставленные покупки лотов, в которых есть прокси-ассеты.
        let purchased = 0;
        const { data: proxyAssets, error: proxyAssetsError } = await supabase
            .from('shop_item_assets')
            .select('shop_item_id')
            .eq('asset_type', 'proxy');
        if (proxyAssetsError) throw proxyAssetsError;
        const proxyItemIds = Array.from(new Set((proxyAssets || []).map((row) => row.shop_item_id)));
        if (proxyItemIds.length) {
            const { count, error: purchasesError } = await supabase
                .from('shop_purchases')
                .select('id', { count: 'exact', head: true })
                .in('shop_item_id', proxyItemIds)
                .not('delivered_at', 'is', null);
            if (purchasesError) throw purchasesError;
            purchased = Number(count || 0);
        }

        const poolIds = new Set((poolRows || []).map((row) => String(row.id)));
        const usedIds = new Set((boundRows || [])
            .map((row) => String(row.proxy_id))
            .filter((id) => poolIds.has(id)));
        const shopListedIds = new Set(shopProxyAssetIds.filter((id) => poolIds.has(id)));

        const total = (poolRows || []).length;
        const used = usedIds.size;
        const free = (poolRows || []).filter((row) => row.owner_id == null).length;
        const dead = (poolRows || []).filter((row) => row.is_working === false).length;
        return res.json({
            total,
            used,
            free,
            reserved: Math.max(total - used - free, 0),
            dead,
            shop_listed: shopListedIds.size,
            purchased
        });
    });
}
