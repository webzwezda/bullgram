// Повторное скачивание архива покупки владельцем из кабинета
// (стадия 2 разрезки shop.routes.js; выделено из catalog-public.js, чтобы не
// выводить тот файл за лимит pre-commit 20КБ).
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { prepareShopArchiveDelivery } from '../../services/shop-delivery.service.js';

export function registerMyPurchasesDownload(router, ctx) {
    const { supabase, checkRateLimit, UUID_RE, PUBLIC_DOWNLOAD_RATE_LIMIT_RPM, ownerDownloadHitsByIp } = ctx;

    // В отличие от публичного роута в delivery.js UUID здесь просто адрес:
    // доступ ограничен покупателем (buyer_owner_id), чужие покупки отвечают
    // 404 — существование счёта не раскрываем. Гейты окна/квоты/purge и
    // инкремент счётчика — те же, в prepareShopArchiveDelivery.
    router.get('/public/my-purchases/:purchaseId/download', authenticateUser, async (req, res) => {
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
            if (!purchase || purchase.buyer_owner_id !== req.user.id) {
                return res.status(404).json({ error: 'Счёт не найден' });
            }

            const ip = req.ip || 'unknown';
            const result = await prepareShopArchiveDelivery(supabase, purchase, {
                ip,
                rateCheck: () => checkRateLimit(ownerDownloadHitsByIp, ip, PUBLIC_DOWNLOAD_RATE_LIMIT_RPM)
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
            console.error('Ошибка выдачи архива покупки владельцу:', error);
            return res.status(500).json({ error: 'Ошибка выдачи архива' });
        }
    });
}
