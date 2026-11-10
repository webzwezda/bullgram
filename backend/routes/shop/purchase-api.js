// Покупательская API-зона shop (стадия 2 разрезки shop.routes.js).
// Зона: POST /public/purchase/cancel, POST /public/purchase/cancel-batch,
// POST /public/purchase, POST /public/purchase-anon.
import { authenticateUser, optionalAuthenticateUser } from '../../middlewares/auth.middleware.js';
import { tonToNanoString } from '../../utils/ton.js';
import {
    buildManualPaymentLinks,
    detectNetwork,
    getPendingPurchaseExpiry,
    isMissingShopTables,
    normalizePaymentMethod
} from './helpers.js';
import {
    assertBuyerOwnershipLimits,
    createOrRefreshBuyerPurchase
} from './purchase-core.js';

export function registerPurchaseApi(router, ctx) {
    const { supabase, checkRateLimit, publicPurchaseHitsByIp } = ctx;

    router.post('/public/purchase/cancel', authenticateUser, async (req, res) => {
        const buyerOwnerId = req.user.id;
        const purchaseId = String(req.body?.purchase_id || '').trim();

        if (!purchaseId) {
            return res.status(400).json({ error: 'Не передан purchase_id' });
        }

        try {
            const { data: purchase, error } = await supabase
                .from('shop_purchases')
                .select('id, status, created_at, buyer_owner_id, ownership_transfer_status')
                .eq('id', purchaseId)
                .eq('buyer_owner_id', buyerOwnerId)
                .maybeSingle();

            if (error) {
                if (isMissingShopTables(error)) {
                    return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                }
                throw error;
            }

            if (!purchase) {
                return res.status(404).json({ error: 'Покупка не найдена.' });
            }

            if (purchase.status === 'paid' || purchase.ownership_transfer_status === 'completed') {
                return res.status(400).json({ error: 'Эту покупку уже нельзя отменить. По ней уже есть оплата или передача прав.' });
            }

            if (purchase.status === 'expired' || purchase.status === 'rejected') {
                return res.json({ success: true, cancelled_purchase_id: purchase.id, already_closed: true });
            }

            const { error: deleteError } = await supabase
                .from('shop_purchases')
                .delete()
                .eq('id', purchase.id)
                .eq('buyer_owner_id', buyerOwnerId)
                .in('status', ['pending', 'awaiting_receipt']);

            if (deleteError) throw deleteError;

            return res.json({ success: true, cancelled_purchase_id: purchase.id });
        } catch (nextError) {
            console.error('Ошибка отмены shop purchase покупателем:', nextError);
            return res.status(500).json({ error: 'Не удалось снять бронь.' });
        }
    });

    // Публичная отмена брони со страницы счёта /pay: покупатель может быть
    // не залогинен, proof — memo счёта (известен только открывшему страницу).
    // Семантика та же, что в /cancel: paid/переданные права не трогаем.
    router.post('/public/purchase/cancel-public', async (req, res) => {
        const ip = req.ip || 'unknown';
        if (!checkRateLimit(publicPurchaseHitsByIp, ip)) {
            return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
        }

        const purchaseId = String(req.body?.purchase_id || '').trim();
        const memoProof = String(req.body?.memo || '').trim();
        if (!purchaseId || !memoProof) {
            return res.status(400).json({ error: 'Не передан purchase_id или memo' });
        }

        try {
            const { data: purchase, error } = await supabase
                .from('shop_purchases')
                .select('id, status, payload, ownership_transfer_status')
                .eq('id', purchaseId)
                .maybeSingle();

            if (error) {
                if (isMissingShopTables(error)) {
                    return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                }
                throw error;
            }
            if (!purchase) {
                return res.status(404).json({ error: 'Покупка не найдена.' });
            }
            if (String(purchase.payload?.memo || '').trim() !== memoProof) {
                return res.status(403).json({ error: 'Memo счёта не совпал — отмена отклонена.' });
            }
            if (purchase.status === 'paid' || purchase.ownership_transfer_status === 'completed') {
                return res.status(400).json({ error: 'Эту покупку уже нельзя отменить. По ней уже есть оплата или передача прав.' });
            }
            if (purchase.status === 'expired' || purchase.status === 'rejected') {
                return res.json({ success: true, cancelled_purchase_id: purchase.id, already_closed: true });
            }

            const { error: deleteError } = await supabase
                .from('shop_purchases')
                .delete()
                .eq('id', purchase.id)
                .in('status', ['pending', 'awaiting_receipt']);

            if (deleteError) throw deleteError;

            return res.json({ success: true, cancelled_purchase_id: purchase.id });
        } catch (error) {
            console.error('Ошибка публичной отмены shop purchase:', error);
            return res.status(500).json({ error: 'Не удалось снять бронь.' });
        }
    });

    router.post('/public/purchase/cancel-batch', authenticateUser, async (req, res) => {
        const buyerOwnerId = req.user.id;
        const purchaseIds = Array.isArray(req.body?.purchase_ids) ? req.body.purchase_ids.map((value) => String(value || '').trim()).filter(Boolean) : [];

        if (!purchaseIds.length) {
            return res.status(400).json({ error: 'Не передан список purchase_ids' });
        }

        try {
            const { data: purchases, error } = await supabase
                .from('shop_purchases')
                .select('id, status, buyer_owner_id, ownership_transfer_status')
                .eq('buyer_owner_id', buyerOwnerId)
                .in('id', purchaseIds);

            if (error) throw error;
            if ((purchases || []).length !== purchaseIds.length) {
                return res.status(404).json({ error: 'Часть покупок уже недоступна.' });
            }

            const blocked = (purchases || []).find((purchase) =>
                purchase.status === 'paid' || purchase.ownership_transfer_status === 'completed'
            );
            if (blocked) {
                return res.status(400).json({ error: 'Одна из покупок уже оплачена. Такой пакет отменить нельзя.' });
            }

            const deletableIds = (purchases || [])
                .filter((purchase) => purchase.status === 'pending' || purchase.status === 'awaiting_receipt')
                .map((purchase) => purchase.id);

            if (deletableIds.length) {
                const { error: deleteError } = await supabase
                    .from('shop_purchases')
                    .delete()
                    .eq('buyer_owner_id', buyerOwnerId)
                    .in('id', deletableIds);
                if (deleteError) throw deleteError;
            }

            return res.json({ success: true, cancelled_purchase_ids: deletableIds });
        } catch (error) {
            console.error('Ошибка отмены batch shop purchase:', error);
            return res.status(500).json({ error: 'Не удалось снять общий резерв.' });
        }
    });

    router.post('/public/purchase', authenticateUser, async (req, res) => {
        const buyerOwnerId = req.user.id;
        const { item_id, payment_method } = req.body;

        if (!item_id) {
            return res.status(400).json({ error: 'Не передан item_id' });
        }

        try {
            const { data: itemsForLimit, error: limitItemError } = await supabase
                .from('shop_items')
                .select('id, item_type')
                .eq('id', item_id)
                .limit(1);
            if (limitItemError) throw limitItemError;
            await assertBuyerOwnershipLimits({
                supabase,
                profile: req.profile,
                buyerOwnerId,
                items: itemsForLimit || []
            });

            const paymentMethod = normalizePaymentMethod(payment_method);
            const {
                purchase,
                item,
                wallet,
                amountTon,
                memo
            } = await createOrRefreshBuyerPurchase({
                supabase,
                buyerOwnerId,
                itemId: item_id,
                paymentMethod
            });

            res.json({
                success: true,
                purchase_id: purchase.id,
                amount_ton: amountTon,
                amount_nanoton: tonToNanoString(amountTon),
                payment_method: paymentMethod,
                seller_wallet: wallet,
                memo,
                item_type: item.item_type,
                expires_at: getPendingPurchaseExpiry(purchase.created_at).toISOString(),
                network: detectNetwork(),
                ...(await buildManualPaymentLinks(wallet, amountTon, memo))
            });
        } catch (error) {
            console.error('Ошибка создания shop purchase:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Ошибка создания покупки' });
        }
    });

    // Анонимная покупка лота (публичная витрина сайта, без регистрации):
    // JWT опционален — есть покупатель, пишем buyer_owner_id, нет — null
    // (такая покупка при оплате останется files-delivery, даже если лот hybrid).
    router.post('/public/purchase-anon', optionalAuthenticateUser, async (req, res) => {
        const ip = req.ip || 'unknown';
        if (!checkRateLimit(publicPurchaseHitsByIp, ip)) {
            return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
        }

        const buyerOwnerId = req.user?.id ?? null;
        const { item_id } = req.body || {};

        if (!item_id) {
            return res.status(400).json({ error: 'Не передан item_id' });
        }

        try {
            // Анонимная витрина волны 2 продаёт только аккаунты: files/hybrid
            // выдача построена вокруг архивов. Не-аккаунтный лот без JWT упал бы
            // в трансфер на buyer_owner_id=NULL (ревью: P0) — гейтим заранее.
            const { data: anonItem, error: anonItemError } = await supabase
                .from('shop_items')
                .select('item_type, status, visibility')
                .eq('id', item_id)
                .maybeSingle();
            if (anonItemError) throw anonItemError;
            if (!anonItem || anonItem.status !== 'published' || !['public', 'unlisted'].includes(anonItem.visibility || '')) {
                return res.status(400).json({ error: 'Лот не найден или уже не продаётся' });
            }
            if (anonItem.item_type !== 'account') {
                return res.status(400).json({ error: 'Сейчас без регистрации продаются только аккаунты. Прокси и паки — из кабинета /userbot.' });
            }

            const paymentMethod = normalizePaymentMethod(null);
            const {
                purchase,
                item,
                wallet,
                amountTon,
                memo
            } = await createOrRefreshBuyerPurchase({
                supabase,
                buyerOwnerId,
                itemId: item_id,
                paymentMethod
            });

            res.json({
                success: true,
                purchase_id: purchase.id,
                amount_ton: amountTon,
                amount_nanoton: tonToNanoString(amountTon),
                payment_method: paymentMethod,
                seller_wallet: wallet,
                memo,
                item_type: item.item_type,
                expires_at: getPendingPurchaseExpiry(purchase.created_at).toISOString(),
                network: detectNetwork(),
                ...(await buildManualPaymentLinks(wallet, amountTon, memo))
            });
        } catch (error) {
            console.error('Ошибка создания анонимной shop purchase:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Ошибка создания покупки' });
        }
    });
}
