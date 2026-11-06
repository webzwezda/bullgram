// Создание/редактирование лота shop (стадия 2 разрезки shop.routes.js).
// Зона: POST /admin/items + /seller/items — один хендлер ~387 строк.
// Разрезка тела по решению владельца (§7 плана): куски тела вынесены в
// items-create-helpers.js — дословные обёртки function + передача аргументов,
// логика не менялась (отступы кусков сохранены из исходного хендлера).
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { ensureShopSellerAllowed } from '../../utils/product-tier.js';
import {
    isAdminSeller,
    isTextServiceItem,
    normalizeOfferCode,
    normalizePaymentMethods,
    normalizeSalesChannel
} from './helpers.js';
import {
    saveAssetItem,
    saveTextServiceItem,
    validateLotAssets
} from './items-create-helpers.js';

export function registerItemsCreate(router, ctx) {
    const { supabase } = ctx;

    router.post(['/admin/items', '/seller/items'], authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const {
            id,
            title,
            description,
            post_purchase_message,
            offer_code,
            item_type,
            price_ton,
            status,
            visibility,
            preview_text,
            transfer_mode,
            payment_methods,
            sales_channel,
            delivery_mode,
            assets = []
        } = req.body;
        const normalizedItemType = String(item_type || '').trim();
        const normalizedOfferCode = normalizeOfferCode(offer_code);
        const adminSeller = isAdminSeller(req.profile);
        const textServiceItem = isTextServiceItem(normalizedItemType, transfer_mode);
        const isAccountItem = normalizedItemType === 'account';

        if (!title || !String(title).trim()) {
            return res.status(400).json({ error: 'Название лота обязательно' });
        }

        if (!['proxy', 'userbot', 'bundle', 'channel_audience_asset', 'text_offer', 'account'].includes(normalizedItemType)) {
            return res.status(400).json({ error: 'Неверный тип товара' });
        }

        // Аккаунт-лоты: режим выдачи (hybrid по умолчанию; null в БД = легаси-трансфер).
        let normalizedDeliveryMode = null;
        if (isAccountItem) {
            const rawDeliveryMode = String(delivery_mode || '').trim().toLowerCase();
            if (rawDeliveryMode && !['hybrid', 'files', 'transfer'].includes(rawDeliveryMode)) {
                return res.status(400).json({ error: 'Неверный delivery_mode: допускаются hybrid, files, transfer' });
            }
            normalizedDeliveryMode = rawDeliveryMode || 'hybrid';
        }

        if (!adminSeller && normalizedItemType !== 'text_offer') {
            return res.status(403).json({ error: 'Продавать активы платформы может только пользователь с role admin. Для остальных здесь доступен только P2P-оффер с текстом после оплаты.' });
        }

        if (!textServiceItem) {
            try {
                ensureShopSellerAllowed(req.profile);
            } catch (error) {
                return res.status(403).json({ error: error.message });
            }
        }

        if (textServiceItem && !String(post_purchase_message || '').trim()) {
            return res.status(400).json({ error: 'Для P2P-оффера нужно заполнить скрытое сообщение после оплаты.' });
        }

        if (!textServiceItem && (!Array.isArray(assets) || assets.length === 0)) {
            return res.status(400).json({ error: 'Нужно выбрать хотя бы один актив для лота' });
        }

        try {
            const normalizedPaymentMethods = normalizePaymentMethods(payment_methods);
            const normalizedSalesChannel = normalizeSalesChannel(sales_channel, normalizedItemType);
            if (textServiceItem) {
                return await saveTextServiceItem({
                    supabase, res, ownerId, id,
                    title, description, post_purchase_message, price_ton, status, visibility, preview_text,
                    normalizedPaymentMethods, normalizedSalesChannel, normalizedOfferCode
                });
            }

            const blocked = await validateLotAssets({ supabase, res, ownerId, id, assets, status, isAccountItem });
            // blocked = res (Express res.json возвращает res): 400 уже отправлен внутри проверки.
            if (blocked) return blocked;

            await saveAssetItem({
                supabase, res, ownerId, id,
                title, description, post_purchase_message, normalizedItemType, price_ton, status, visibility,
                normalizedSalesChannel, preview_text, normalizedPaymentMethods, normalizedOfferCode,
                transfer_mode, isAccountItem, normalizedDeliveryMode, assets
            });
        } catch (error) {
            console.error('Ошибка сохранения shop item:', error);
            res.status(500).json({ error: 'Ошибка сохранения лота' });
        }
    });
}
