// Жизненный цикл лотов shop (стадия 2 разрезки shop.routes.js).
// Зона: DELETE /admin/items/:id + /seller/items/:id,
// POST /admin/items/:id/unpublish + /seller/items/:id/unpublish.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import {
    expireStalePendingPurchases,
    isMissingShopTables,
    isPendingPurchaseExpired
} from './helpers.js';

export function registerItemsLifecycle(router, ctx) {
    const { supabase } = ctx;

    router.delete(['/admin/items/:id', '/seller/items/:id'], authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const itemId = req.params.id;

        try {
            const { data: purchaseRows, error: purchasesError } = await supabase
                .from('shop_purchases')
                .select('id, status, created_at')
                .eq('shop_item_id', itemId)
                .eq('seller_owner_id', ownerId)
                .order('created_at', { ascending: false });

            if (purchasesError) {
                if (isMissingShopTables(purchasesError)) {
                    return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                }
                throw purchasesError;
            }

            await expireStalePendingPurchases(supabase, purchaseRows || []);

            const blockingPurchases = (purchaseRows || []).filter(purchase => {
                if (purchase.status === 'paid') return true;
                if (purchase.status === 'expired') return false;
                return purchase.status === 'pending' && !isPendingPurchaseExpired(purchase);
            });

            const stalePendingIds = (purchaseRows || [])
                .filter(purchase => purchase.status === 'pending' && isPendingPurchaseExpired(purchase))
                .map(purchase => purchase.id);

            if (stalePendingIds.length > 0) {
                const { error: deleteExpiredError } = await supabase
                    .from('shop_purchases')
                    .delete()
                    .in('id', stalePendingIds);
                if (deleteExpiredError) throw deleteExpiredError;
            }

            if (blockingPurchases.length > 0) {
                return res.status(400).json({
                    error: 'По лоту есть активная покупка или уже была оплата. Его нельзя удалить, только снять с продажи или оставить в истории.'
                });
            }

            const { error: assetsError } = await supabase
                .from('shop_item_assets')
                .delete()
                .eq('shop_item_id', itemId);

            if (assetsError) {
                if (isMissingShopTables(assetsError)) {
                    return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                }
                throw assetsError;
            }

            const { data: deletedItem, error } = await supabase
                .from('shop_items')
                .delete()
                .eq('id', itemId)
                .eq('owner_id', ownerId)
                .select('id')
                .maybeSingle();

            if (error) {
                if (isMissingShopTables(error)) {
                    return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                }
                throw error;
            }

            if (!deletedItem?.id) {
                return res.status(404).json({ error: 'Лот не найден или уже удален' });
            }

            res.json({ success: true, deleted_item_id: deletedItem.id });
        } catch (error) {
            console.error('Ошибка удаления shop item:', error);
            res.status(500).json({ error: 'Ошибка удаления лота' });
        }
    });

    router.post(['/admin/items/:id/unpublish', '/seller/items/:id/unpublish'], authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const itemId = req.params.id;

        try {
            let unpublishQuery = supabase
                .from('shop_items')
                .update({
                    status: 'draft',
                    visibility: 'private',
                    updated_at: new Date().toISOString()
                })
                .eq('id', itemId);
            if (req.profile?.role !== 'admin') {
                unpublishQuery = unpublishQuery.eq('owner_id', ownerId);
            }

            const { error } = await unpublishQuery;

            if (error) {
                if (isMissingShopTables(error)) {
                    return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                }
                throw error;
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Ошибка снятия shop item с продажи:', error);
            res.status(500).json({ error: 'Ошибка снятия лота с продажи' });
        }
    });
}
