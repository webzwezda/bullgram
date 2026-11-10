// Публичная выдача и проверка счетов shop (стадия 2 разрезки shop.routes.js).
// Зона: GET public-view, POST verify-public, GET download (архив аккаунта).
// Guard-состояние (UUID_RE, rate-limit карты, checkRateLimit) приходит из ctx
// фабрики — в прежнем файле блок стоял ровно перед этой зоной.
import { tonToNanoString } from '../../utils/ton.js';
import {
    expireStalePendingPurchases,
    getPendingPurchaseExpiry,
    siteWallet
} from './helpers.js';
import { runShopPurchaseCheck } from './purchase-check.js';
import {
    buildAccountDeliveryView,
    loadAccountLotLabel,
    prepareShopArchiveDelivery
} from '../../services/shop-delivery.service.js';

export function registerDelivery(router, ctx) {
    const {
        supabase,
        checkRateLimit,
        UUID_RE,
        PUBLIC_DOWNLOAD_RATE_LIMIT_RPM,
        publicViewHitsByIp,
        publicVerifyHitsByIp,
        publicDownloadHitsByIp
    } = ctx;

    const BATCH_TOKEN_RE = /^batch_[a-z0-9]{2,20}$/;

    // Счёт пакета (batch): все строки пакета несут общий memo и batch_token в
    // payload. Публичная витрина собирает пакет в один счёт — агрегат статусов
    // как в authed check-batch, выдача пакетов живёт в кабинете (delivery=null).
    async function loadBatchPurchaseRows(batchToken) {
        const { data: rows, error } = await supabase
            .from('shop_purchases')
            .select('*')
            .contains('payload', { batch_token: batchToken })
            .order('created_at', { ascending: true });
        if (error) throw error;
        return rows || [];
    }

    function aggregateBatchStatus(statuses) {
        if (statuses.some((s) => s === 'rejected')) return 'rejected';
        if (statuses.some((s) => s === 'awaiting_receipt')) return 'awaiting_receipt';
        if (statuses.length > 0 && statuses.every((s) => s === 'paid')) return 'paid';
        if (statuses.some((s) => s === 'pending')) return 'pending';
        return 'expired';
    }

    router.get('/public/purchase/:purchaseId/public-view', async (req, res) => {
        const ip = req.ip || 'unknown';
        if (!checkRateLimit(publicViewHitsByIp, ip)) {
            return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
        }

        const { purchaseId } = req.params;
        const isBatchView = BATCH_TOKEN_RE.test(String(purchaseId));
        if (!UUID_RE.test(String(purchaseId)) && !isBatchView) {
            return res.status(400).json({ error: 'Некорректный ID счёта' });
        }

        try {
            if (isBatchView) {
                const rows = await loadBatchPurchaseRows(purchaseId);
                if (!rows.length) return res.status(404).json({ error: 'Счёт не найден' });
                await expireStalePendingPurchases(supabase, rows);

                const status = aggregateBatchStatus(rows.map((row) => row.status));
                const payable = rows.filter((row) => row.status === 'pending');
                const totalTon = payable.reduce((sum, row) => sum + Number(row.amount_ton || 0), 0);
                const first = rows[0];
                const memo = first.payload?.memo || '';
                const wallet = first.payload?.seller_wallet || siteWallet();
                const amountNano = tonToNanoString(totalTon);
                const tonUri = wallet ? `ton://transfer/${wallet}?amount=${amountNano}&text=${encodeURIComponent(memo || '')}` : null;

                const itemIds = Array.from(new Set(rows.map((row) => row.shop_item_id).filter(Boolean)));
                const { data: itemsRes } = await supabase
                    .from('shop_items')
                    .select('id, title')
                    .in('id', itemIds);
                const titleById = new Map((itemsRes || []).map((item) => [String(item.id), item.title]));
                const titles = Array.from(new Set(itemIds.map((id) => titleById.get(String(id))).filter(Boolean)));
                const itemTitle = titles.length === 1
                    ? `${titles[0]} × ${rows.length}`
                    : `Пакет из ${rows.length} лотов`;

                const expiresAtMs = payable.length
                    ? payable
                        .map((row) => getPendingPurchaseExpiry(row.created_at).getTime())
                        .filter(Number.isFinite)
                        .sort((left, right) => left - right)[0]
                    : null;

                return res.json({
                    id: purchaseId,
                    batch: true,
                    status,
                    amount_ton: Number(totalTon || 0),
                    amount_nanoton: amountNano,
                    memo,
                    seller_wallet: wallet,
                    network: first.payload?.network || 'mainnet',
                    expires_at: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
                    item_title: itemTitle,
                    ton_uri: tonUri,
                    ton_qr: first.payload?.ton_qr || null,
                    delivery: null
                });
            }

            const { data: purchase, error } = await supabase
                .from('shop_purchases')
                .select('id, status, amount_ton, created_at, payload, shop_item_id, seller_owner_id, buyer_owner_id, delivered_at')
                .eq('id', purchaseId)
                .maybeSingle();
            if (error) throw error;
            if (!purchase) return res.status(404).json({ error: 'Счёт не найден' });

            // Expire stale pending, then re-read fresh status
            await expireStalePendingPurchases(supabase, [purchase]);
            const { data: fresh } = await supabase
                .from('shop_purchases')
                .select('status')
                .eq('id', purchaseId)
                .maybeSingle();
            if (fresh) {
                purchase.status = fresh.status;
            }

            const { data: itemRes } = await supabase
                .from('shop_items')
                .select('title, item_type, delivery_mode')
                .eq('id', purchase.shop_item_id)
                .maybeSingle();

            // Аккаунт-лоты: публичный блок выдачи (квота/окно/целостность архива).
            let delivery = null;
            if (itemRes?.item_type === 'account') {
                delivery = buildAccountDeliveryView({
                    status: purchase.status,
                    deliveredAt: purchase.delivered_at,
                    itemDeliveryMode: itemRes.delivery_mode,
                    payloadDelivery: purchase.payload?.delivery || null,
                    label: await loadAccountLotLabel(supabase, purchase.shop_item_id)
                });
            }

            const memo = purchase.payload?.memo;
            const amountNano = tonToNanoString(purchase.amount_ton);
            const wallet = purchase.payload?.seller_wallet || siteWallet();
            const network = purchase.payload?.network || 'mainnet';
            const tonUri = wallet ? `ton://transfer/${wallet}?amount=${amountNano}&text=${encodeURIComponent(memo || '')}` : null;
            const expiresAt = purchase.created_at
                ? getPendingPurchaseExpiry(purchase.created_at).toISOString()
                : null;

            return res.json({
                id: purchase.id,
                status: purchase.status,
                amount_ton: Number(purchase.amount_ton || 0),
                amount_nanoton: amountNano,
                memo,
                seller_wallet: wallet,
                network,
                expires_at: expiresAt,
                item_title: itemRes?.title || 'Заказ',
                ton_uri: tonUri,
                ton_qr: purchase.payload?.ton_qr || null,
                delivery
            });
        } catch (error) {
            console.error('Ошибка public-view shop purchase:', error);
            res.status(500).json({ error: 'Ошибка загрузки счёта' });
        }
    });

    router.post('/public/purchase/:purchaseId/verify-public', async (req, res) => {
        const ip = req.ip || 'unknown';
        if (!checkRateLimit(publicVerifyHitsByIp, ip)) {
            return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
        }

        const { purchaseId } = req.params;
        const isBatchVerify = BATCH_TOKEN_RE.test(String(purchaseId));
        if (!UUID_RE.test(String(purchaseId)) && !isBatchVerify) {
            return res.status(400).json({ error: 'Некорректный ID счёта' });
        }

        try {
            if (isBatchVerify) {
                const rows = await loadBatchPurchaseRows(purchaseId);
                if (!rows.length) return res.status(404).json({ error: 'Счёт не найден' });
                await expireStalePendingPurchases(supabase, rows);

                const bodies = [];
                for (const row of rows) {
                    const result = await runShopPurchaseCheck(supabase, row, {
                        senderWallet: typeof req.body?.sender_wallet === 'string' ? req.body.sender_wallet : null
                    });
                    if (!result.ok) {
                        return res.status(result.statusCode || 400).json(result.body || { error: 'Ошибка проверки оплаты' });
                    }
                    bodies.push(result.body || {});
                }

                const statuses = bodies.map((body) => body.status || 'pending');
                const allPaid = statuses.every((status) => status === 'paid');
                return res.json({
                    status: allPaid ? 'paid' : 'pending',
                    success: allPaid,
                    ownership_transfer_status: bodies.every((body) => body.ownership_transfer_status === 'completed')
                        ? 'completed'
                        : 'pending'
                });
            }

            const { data: purchase, error } = await supabase
                .from('shop_purchases')
                .select('*')
                .eq('id', purchaseId)
                .maybeSingle();
            if (error) throw error;
            if (!purchase) return res.status(404).json({ error: 'Счёт не найден' });

            const result = await runShopPurchaseCheck(supabase, purchase, {
                senderWallet: typeof req.body?.sender_wallet === 'string' ? req.body.sender_wallet : null
            });
            const body = result?.body || {};
            return res.status(result?.statusCode || 200).json({
                status: body.status || purchase.status,
                success: body.status === 'paid',
                ownership_transfer_status: body.ownership_transfer_status
            });
        } catch (error) {
            console.error('Ошибка verify-public shop purchase:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Ошибка проверки оплаты' });
        }
    });

    // Выдача архива аккаунта (account shop delivery): публичный роут — bearer
    // здесь сам UUID покупки со страницы оплаты, JWT не нужен. В архиве только
    // содержимое blob'ов восстановления и README — никаких tg_phone/username.
    router.get('/public/purchase/:purchaseId/download', async (req, res) => {
        const { purchaseId } = req.params;
        if (!UUID_RE.test(String(purchaseId))) {
            return res.status(400).json({ error: 'Некорректный ID счёта' });
        }

        try {
            const { data: purchase, error } = await supabase
                .from('shop_purchases')
                .select('id, status, shop_item_id, buyer_owner_id, delivered_at, payload')
                .eq('id', purchaseId)
                .maybeSingle();
            if (error) throw error;
            if (!purchase) return res.status(404).json({ error: 'Счёт не найден' });

            const ip = req.ip || 'unknown';
            const result = await prepareShopArchiveDelivery(supabase, purchase, {
                ip,
                rateCheck: () => checkRateLimit(publicDownloadHitsByIp, ip, PUBLIC_DOWNLOAD_RATE_LIMIT_RPM)
            });

            if (!result.ok) {
                return res.status(result.statusCode).json({ error: result.error });
            }

            const { buffer, basename, sha256 } = result.archive;
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${basename}.zip"`);
            res.setHeader('X-Archive-Sha256', sha256);
            return res.send(buffer);
        } catch (error) {
            console.error('Ошибка выдачи архива shop purchase:', error);
            return res.status(500).json({ error: 'Ошибка выдачи архива' });
        }
    });
}
