// Покупательские проверки оплаты shop (стадия 2 разрезки shop.routes.js).
// Зона: POST /public/purchase/batch, POST /public/purchase/check,
// POST /public/purchase/verify-ton-connect, POST /public/purchase/check-batch.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { tonToNanoString } from '../../utils/ton.js';
import {
    buildManualPaymentLinks,
    buildShopMemo,
    detectNetwork,
    getPendingPurchaseExpiry,
    normalizePaymentMethod
} from './helpers.js';
import {
    assertBuyerOwnershipLimits,
    createOrRefreshBuyerPurchase
} from './purchase-core.js';
import { runShopPurchaseCheck } from './purchase-check.js';

export function registerPurchaseChecks(router, ctx) {
    const { supabase } = ctx;

    router.post('/public/purchase/batch', authenticateUser, async (req, res) => {
        const buyerOwnerId = req.user.id;
        const itemIds = Array.isArray(req.body?.item_ids) ? req.body.item_ids.map((value) => String(value || '').trim()).filter(Boolean) : [];
        const paymentMethod = normalizePaymentMethod(req.body?.payment_method);

        if (!itemIds.length) {
            return res.status(400).json({ error: 'Не передан список item_ids' });
        }

        try {
            const { data: items, error: itemsError } = await supabase
                .from('shop_items')
                .select('*')
                .in('id', itemIds);

            if (itemsError) throw itemsError;

            if ((items || []).length !== itemIds.length) {
                return res.status(404).json({ error: 'Один из лотов уже недоступен.' });
            }

            await assertBuyerOwnershipLimits({
                supabase,
                profile: req.profile,
                buyerOwnerId,
                items: items || []
            });

            const sellerIds = Array.from(new Set((items || []).map((item) => String(item.owner_id || '')).filter(Boolean)));
            if (sellerIds.length !== 1) {
                return res.status(400).json({ error: 'В один счет можно собрать только лоты одного продавца.' });
            }

            const batchToken = `batch_${Math.random().toString(36).slice(2, 10)}`;
            const memo = buildShopMemo();
            const created = [];

            for (const itemId of itemIds) {
                const result = await createOrRefreshBuyerPurchase({
                    supabase,
                    buyerOwnerId,
                    itemId,
                    paymentMethod,
                    memoOverride: memo,
                    batchToken
                });
                created.push(result);
            }

            const first = created[0];
            const totalTon = created.reduce((sum, row) => sum + Number(row.amountTon || 0), 0);
            const expiresAt = created
                .map((row) => getPendingPurchaseExpiry(row.purchase.created_at).getTime())
                .filter(Number.isFinite)
                .sort((left, right) => left - right)[0];

            res.json({
                success: true,
                batch: true,
                batch_token: batchToken,
                purchase_ids: created.map((row) => row.purchase.id),
                amount_ton: totalTon,
                amount_nanoton: tonToNanoString(totalTon),
                payment_method: paymentMethod,
                seller_wallet: first.wallet || null,
                memo,
                item_type: 'proxy_batch',
                expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
                network: detectNetwork(),
                ...(await buildManualPaymentLinks(first.wallet || '', totalTon, memo))
            });
        } catch (error) {
            console.error('Ошибка создания batch shop purchase:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Ошибка создания общей покупки' });
        }
    });

    router.post('/public/purchase/check', authenticateUser, async (req, res) => {
        const buyerOwnerId = req.user.id;
        const { purchase_id } = req.body;

        if (!purchase_id) {
            return res.status(400).json({ error: 'Не передан purchase_id' });
        }

        try {
            const { data: purchase, error: purchaseError } = await supabase
                .from('shop_purchases')
                .select('*')
                .eq('id', purchase_id)
                .eq('buyer_owner_id', buyerOwnerId)
                .single();
            if (purchaseError) throw purchaseError;
            const result = await runShopPurchaseCheck(supabase, purchase, {
                enforceBuyerOwnerId: buyerOwnerId
            });

            return res.status(result.statusCode).json(result.body);
        } catch (error) {
            console.error('Ошибка проверки shop purchase:', error);
            res.status(500).json({ error: 'Ошибка проверки оплаты shop-покупки' });
        }
    });

    // TON Connect 2.0 verification entrypoint for shop purchases.
    // Same matching logic as /public/purchase/check (memo + amount on merchant wallet),
    // but exposed as a semantically distinct endpoint for the TON Connect UI flow.
    // Accepts either a single purchase_id or a batch of purchase_ids.
    router.post('/public/purchase/verify-ton-connect', authenticateUser, async (req, res) => {
        const buyerOwnerId = req.user.id;
        const { purchase_id, purchase_ids } = req.body || {};

        const isBatch = Array.isArray(purchase_ids) && purchase_ids.length > 0;
        if (!isBatch && !purchase_id) {
            return res.status(400).json({ error: 'purchase_id или purchase_ids обязательны' });
        }

        try {
            if (isBatch) {
                const ids = purchase_ids.map((value) => String(value || '').trim()).filter(Boolean);
                const { data: purchases, error } = await supabase
                    .from('shop_purchases')
                    .select('*')
                    .eq('buyer_owner_id', buyerOwnerId)
                    .in('id', ids);
                if (error) throw error;
                if ((purchases || []).length !== ids.length) {
                    return res.status(404).json({ error: 'Часть покупок уже недоступна.' });
                }

                const results = [];
                for (const purchase of purchases) {
                    const result = await runShopPurchaseCheck(supabase, purchase, {
                        enforceBuyerOwnerId: buyerOwnerId
                    });
                    results.push(result);
                }

                const failures = results.filter((item) => !item.ok);
                if (failures.length) {
                    const first = failures[0];
                    return res.status(first.statusCode || 400).json(first.body);
                }

                const bodies = results.map((item) => item.body || {});
                const allPaid = bodies.every((item) => item.status === 'paid');
                return res.status(allPaid ? 200 : 202).json({
                    success: true,
                    status: allPaid ? 'paid' : 'pending',
                    ownership_transfer_status: bodies.every((item) => item.ownership_transfer_status === 'completed')
                        ? 'completed'
                        : 'pending'
                });
            }

            const { data: purchase, error: purchaseError } = await supabase
                .from('shop_purchases')
                .select('*')
                .eq('id', purchase_id)
                .eq('buyer_owner_id', buyerOwnerId)
                .single();
            if (purchaseError) throw purchaseError;

            const result = await runShopPurchaseCheck(supabase, purchase, {
                enforceBuyerOwnerId: buyerOwnerId
            });

            return res.status(result.statusCode).json(result.body);
        } catch (error) {
            console.error('Ошибка TON Connect проверки shop purchase:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Ошибка проверки оплаты' });
        }
    });

    router.post('/public/purchase/check-batch', authenticateUser, async (req, res) => {
        const buyerOwnerId = req.user.id;
        const purchaseIds = Array.isArray(req.body?.purchase_ids) ? req.body.purchase_ids.map((value) => String(value || '').trim()).filter(Boolean) : [];

        if (!purchaseIds.length) {
            return res.status(400).json({ error: 'Не передан список purchase_ids' });
        }

        try {
            const { data: purchases, error } = await supabase
                .from('shop_purchases')
                .select('*')
                .eq('buyer_owner_id', buyerOwnerId)
                .in('id', purchaseIds);

            if (error) throw error;
            if ((purchases || []).length !== purchaseIds.length) {
                return res.status(404).json({ error: 'Часть покупок уже недоступна.' });
            }

            const results = [];
            for (const purchase of purchases) {
                const result = await runShopPurchaseCheck(supabase, purchase, {
                    enforceBuyerOwnerId: buyerOwnerId
                });
                results.push(result);
            }

            const failures = results.filter((item) => !item.ok);
            if (failures.length) {
                const first = failures[0];
                return res.status(first.statusCode || 400).json(first.body);
            }

            const bodies = results.map((item) => item.body || {});
            const statuses = bodies.map((item) => item.status || 'pending');
            const transferStatuses = bodies.map((item) => item.ownership_transfer_status || 'pending');
            const allPaid = statuses.every((status) => status === 'paid');
            const allCompleted = transferStatuses.every((status) => status === 'completed');
            const hasAwaitingReceipt = statuses.some((status) => status === 'awaiting_receipt');
            const hasRejected = statuses.some((status) => status === 'rejected');
            const hasPending = statuses.some((status) => status === 'pending');
            const hasTransferFailure = transferStatuses.some((status) => status === 'failed');

            let batchStatus = 'pending';
            if (hasRejected) batchStatus = 'rejected';
            else if (hasAwaitingReceipt) batchStatus = 'awaiting_receipt';
            else if (allPaid) batchStatus = 'paid';
            else if (hasPending) batchStatus = 'pending';

            let batchTransferStatus = 'pending';
            if (hasTransferFailure) batchTransferStatus = 'failed';
            else if (allCompleted && allPaid) batchTransferStatus = 'completed';

            return res.json({
                success: true,
                status: batchStatus,
                ownership_transfer_status: batchTransferStatus
            });
        } catch (error) {
            console.error('Ошибка проверки batch shop purchase:', error);
            res.status(500).json({ error: 'Ошибка проверки общей оплаты' });
        }
    });
}
