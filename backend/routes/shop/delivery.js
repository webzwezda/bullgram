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

    router.get('/public/purchase/:purchaseId/public-view', async (req, res) => {
        const ip = req.ip || 'unknown';
        if (!checkRateLimit(publicViewHitsByIp, ip)) {
            return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
        }

        const { purchaseId } = req.params;
        if (!UUID_RE.test(String(purchaseId))) {
            return res.status(400).json({ error: 'Некорректный ID счёта' });
        }

        try {
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
        if (!UUID_RE.test(String(purchaseId))) {
            return res.status(400).json({ error: 'Некорректный ID счёта' });
        }

        try {
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
