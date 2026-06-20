import express from 'express';
import QRCode from 'qrcode';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { loadReservedAssetMap } from '../utils/shop-reservations.js';
import { ensureShopSellerAllowed, getTierRules } from '../utils/product-tier.js';
import { parsePdfReceipt } from '../services/receipt-parser.service.js';
import { normalizeSbpBankSelection } from '../utils/payment-settings.js';

const SHOP_PENDING_PURCHASE_TTL_MINUTES = 30;
const SHOP_RECEIPTS_DIR = path.join(process.cwd(), 'uploads', 'shop-receipts');

fs.mkdirSync(SHOP_RECEIPTS_DIR, { recursive: true });

const receiptUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, SHOP_RECEIPTS_DIR),
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname || '').slice(0, 10).toLowerCase() || '.bin';
            cb(null, `receipt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`);
        }
    }),
    limits: {
        fileSize: 8 * 1024 * 1024
    }
});

function isAdminSeller(profile) {
    return profile?.role === 'admin';
}

function isTextServiceItem(itemOrType, transferMode = null) {
    const itemType = typeof itemOrType === 'string'
        ? itemOrType
        : itemOrType?.item_type;
    const mode = transferMode || (typeof itemOrType === 'object' ? itemOrType?.transfer_mode : null);

    return itemType === 'text_offer' || mode === 'post_purchase_message';
}

function isMissingShopTables(error) {
    const code = error?.code || '';
    const message = error?.message || '';
    if (code === '42P01' || code === '42703' || code === 'PGRST204') {
        return true;
    }

    return (
        (message.includes('relation') || message.includes('column')) &&
        (
            message.includes('shop_items') ||
            message.includes('shop_item_assets') ||
            message.includes('shop_purchases') ||
            message.includes('post_purchase_message') ||
            message.includes('offer_code')
        )
    );
}

function normalizeOfferCode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['trial', 'normal', 'p2p', 'seller'].includes(normalized)) {
        return normalized;
    }
    return null;
}

function inferOfferCodeFromLegacyItem(row) {
    const title = String(row?.title || '').toLowerCase();
    const preview = String(row?.preview_text || '').toLowerCase();
    const description = String(row?.description || '').toLowerCase();
    const text = [title, preview, description].join(' ');

    if (text.includes('normal')) return 'normal';
    if (text.includes('trial')) return 'trial';
    if (text.includes('seller')) return 'seller';
    if (row?.item_type === 'text_offer') return 'p2p';
    return null;
}

function normalizeItem(row) {
    return {
        id: row.id,
        owner_id: row.owner_id,
        title: row.title,
        description: row.description || '',
        post_purchase_message: row.post_purchase_message || '',
        item_type: row.item_type,
        price_ton: Number(row.price_ton || 0),
        price_rub: Number(row.price_rub || 0),
        status: row.status || 'draft',
        visibility: row.visibility || 'public',
        sales_channel: normalizeSalesChannel(row?.sales_channel, row?.item_type),
        preview_text: row.preview_text || '',
        payment_methods: normalizePaymentMethods(row?.payment_methods),
        offer_code: normalizeOfferCode(row.offer_code) || inferOfferCodeFromLegacyItem(row),
        transfer_mode: row.transfer_mode || 'ownership_transfer',
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

function defaultSalesChannelForItemType(itemType) {
    return itemType === 'text_offer' ? 'site' : 'admin_only';
}

function normalizeSalesChannel(value, itemType = null) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'admin_only' || normalized === 'site' || normalized === 'both') {
        return normalized;
    }
    return defaultSalesChannelForItemType(itemType);
}

function normalizePaymentMethods(value) {
    const source = Array.isArray(value)
        ? value
        : String(value || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);

    const methods = Array.from(new Set(source
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => item === 'ton' || item === 'p2p')));

    return methods.length ? methods : ['ton', 'p2p'];
}

function buildAvailablePaymentMethods(item, settings) {
    const allowed = normalizePaymentMethods(item?.payment_methods);
    const methods = allowed.filter((method) => {
        if (method === 'ton') return !!settings?.ton_wallet;
        if (method === 'p2p') return !!settings?.sbp_phone;
        return false;
    });

    return Array.from(new Set(methods));
}

function isMissingPaymentMethodsColumn(error) {
    const message = error?.message || '';
    return message.includes('payment_methods');
}

function isMissingPriceRubColumn(error) {
    const message = error?.message || '';
    return message.includes('price_rub');
}

function isMissingSalesChannelColumn(error) {
    const message = error?.message || '';
    return message.includes('sales_channel');
}

function buildShopMemo() {
    return 'shop_' + Math.random().toString(36).slice(2, 10);
}

function buildTonUri(wallet, amountTon, memo) {
    return `ton://transfer/${wallet}?amount=${Number(amountTon || 0) * 1000000000}&text=${encodeURIComponent(memo)}`;
}

function buildTrustWalletTonUri(wallet, amountTon, memo) {
    const params = new URLSearchParams({
        asset: 'c607',
        address: String(wallet || '').trim()
    });

    if (Number(amountTon || 0) > 0) {
        params.set('amount', String(Number(amountTon || 0)));
    }

    if (String(memo || '').trim()) {
        params.set('memo', String(memo || '').trim());
    }

    return `https://link.trustwallet.com/send?${params.toString()}`;
}

function normalizePaymentMethod(value) {
    return value === 'p2p' ? 'p2p' : 'ton';
}

function isVisibleInSalesChannel(item, channel = 'site') {
    const salesChannel = normalizeSalesChannel(item?.sales_channel, item?.item_type);
    if (channel === 'app') {
        return salesChannel === 'admin_only' || salesChannel === 'both';
    }
    return salesChannel === 'site' || salesChannel === 'both';
}

async function buildTonQrDataUrl(wallet, amountTon, memo) {
    const tonUri = buildTonUri(wallet, amountTon, memo);
    const qrCode = await QRCode.toDataURL(tonUri, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 360
    });

    return {
        tonUri,
        qrCode
    };
}

async function buildTrustWalletQrDataUrl(wallet, amountTon, memo) {
    const trustWalletUri = buildTrustWalletTonUri(wallet, amountTon, memo);
    const qrCode = await QRCode.toDataURL(trustWalletUri, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 360
    });

    return {
        trustWalletUri,
        qrCode
    };
}

function getPendingPurchaseExpiry(createdAt) {
    const created = new Date(createdAt).getTime();
    return new Date(created + SHOP_PENDING_PURCHASE_TTL_MINUTES * 60 * 1000);
}

function isPendingPurchaseExpired(purchase) {
    if (!purchase?.created_at) return false;
    return getPendingPurchaseExpiry(purchase.created_at).getTime() <= Date.now();
}

async function expireStalePendingPurchases(supabase, purchases) {
    const staleIds = (purchases || [])
        .filter(purchase => purchase.status === 'pending' && isPendingPurchaseExpired(purchase))
        .map(purchase => purchase.id);

    if (staleIds.length === 0) {
        return [];
    }

    const { error } = await supabase
        .from('shop_purchases')
        .update({
            status: 'expired',
            updated_at: new Date().toISOString()
        })
        .in('id', staleIds);

    if (error) throw error;
    return staleIds;
}

async function checkTonPayment(memo, expectedAmount, wallet) {
    if (!wallet) return false;

    try {
        const response = await fetch(`https://tonapi.io/v2/blockchain/accounts/${wallet}/transactions?limit=30`);
        const data = await response.json();
        const transactions = data.transactions || [];

        for (const tx of transactions) {
            const bodyText = tx?.in_msg?.decoded_body?.text;
            const amountTon = Number(tx?.in_msg?.value || 0) / 1000000000;
            if (bodyText === memo && amountTon >= Number(expectedAmount || 0)) {
                return true;
            }
        }

        return false;
    } catch (error) {
        console.error('Ошибка проверки TON shop-платежа:', error.message);
        return false;
    }
}



async function createOrRefreshBuyerPurchase({
    supabase,
    buyerOwnerId,
    itemId,
    paymentMethod,
    memoOverride = null,
    batchToken = null
}) {
    const { data: itemPurchases, error: itemPurchasesError } = await supabase
        .from('shop_purchases')
        .select('id, buyer_owner_id, status, created_at, payload')
        .eq('shop_item_id', itemId)
        .order('created_at', { ascending: false });

    if (itemPurchasesError) {
        if (isMissingShopTables(itemPurchasesError)) {
            throw new Error('Сначала примени SQL под shop foundation');
        }
        throw itemPurchasesError;
    }

    await expireStalePendingPurchases(supabase, itemPurchases || []);

    const { data: item, error: itemError } = await supabase
        .from('shop_items')
        .select('*')
        .eq('id', itemId)
        .eq('status', 'published')
        .in('visibility', ['public', 'unlisted'])
        .single();

    if (itemError) {
        if (isMissingShopTables(itemError)) {
            throw new Error('Сначала примени SQL под shop foundation');
        }
        throw itemError;
    }

    if (!item) {
        const missing = new Error('Лот не найден или уже недоступен');
        missing.statusCode = 404;
        throw missing;
    }

    if (String(item.owner_id) === String(buyerOwnerId)) {
        const ownItem = new Error('Свой собственный лот покупать не надо');
        ownItem.statusCode = 400;
        throw ownItem;
    }

    const textServiceItem = isTextServiceItem(item);

    if (!textServiceItem) {
        const liveForeignPending = (itemPurchases || []).find(purchase =>
            String(purchase.buyer_owner_id) !== String(buyerOwnerId) &&
            purchase.status === 'pending' &&
            !isPendingPurchaseExpired(purchase)
        );

        const liveForeignPaid = (itemPurchases || []).find(purchase =>
            String(purchase.buyer_owner_id) !== String(buyerOwnerId) &&
            purchase.status === 'paid'
        );

        if (liveForeignPending) {
            const expiresAt = getPendingPurchaseExpiry(liveForeignPending.created_at);
            const busy = new Error(`Лот уже забронирован другим покупателем до ${expiresAt.toLocaleString('ru-RU')}`);
            busy.statusCode = 400;
            throw busy;
        }

        if (liveForeignPaid) {
            const paid = new Error('Этот лот уже оплачен другим покупателем и ждет передачи прав.');
            paid.statusCode = 400;
            throw paid;
        }
    }

    const { data: existingPurchase } = await supabase
        .from('shop_purchases')
        .select('id, status, created_at, payload')
        .eq('shop_item_id', item.id)
        .eq('buyer_owner_id', buyerOwnerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    const { data: settingsData, error: settingsError } = await supabase
        .from('payment_settings')
        .select('ton_wallet, sbp_phone, sbp_bank, sbp_fio')
        .eq('owner_id', item.owner_id)
        .maybeSingle();
    if (settingsError) throw settingsError;
    const settings = settingsData
        ? {
            ...settingsData,
            sbp_bank: normalizeSbpBankSelection(settingsData.sbp_bank, { fallbackToDefault: false })
        }
        : null;

    const availablePaymentMethods = buildAvailablePaymentMethods(item, settings);
    if (!availablePaymentMethods.includes(paymentMethod)) {
        const methodError = new Error('Этот способ оплаты для лота недоступен');
        methodError.statusCode = 400;
        throw methodError;
    }

    if (paymentMethod === 'ton' && !settings?.ton_wallet) {
        const walletError = new Error('У продавца не настроен TON-кошелек');
        walletError.statusCode = 400;
        throw walletError;
    }

    if (paymentMethod === 'p2p' && !settings?.sbp_phone) {
        const p2pError = new Error('У продавца не настроены реквизиты P2P / СБП');
        p2pError.statusCode = 400;
        throw p2pError;
    }

    const memo = String(memoOverride || buildShopMemo()).trim();
    const amountTon = Number(item.price_ton || 0);
    const amountRub = Number(item.price_rub || 0);

    const payloadPatch = {
        payment_method: paymentMethod,
        memo,
        amount_rub: paymentMethod === 'p2p' ? amountRub : null,
        seller_wallet: settings?.ton_wallet || null,
        sbp_phone: settings?.sbp_phone || null,
        sbp_bank: settings?.sbp_bank || null,
        sbp_fio: settings?.sbp_fio || null,
        post_purchase_message: item.post_purchase_message || null,
        batch_token: batchToken || null
    };

    if (existingPurchase?.status === 'paid') {
        const paidExists = new Error('У тебя уже есть открытая покупка по этому лоту. Сначала добей ее.');
        paidExists.statusCode = 400;
        throw paidExists;
    }

    let purchase = null;

    if (existingPurchase?.status === 'pending' && !isPendingPurchaseExpired(existingPurchase)) {
        const nextPayload = {
            ...(existingPurchase.payload || {}),
            ...payloadPatch,
            receipt_note: null,
            receipt_marked_at: null,
            receipt_file_name: null,
            receipt_file_url: null
        };

        const { data: updatedPurchase, error: updatePurchaseError } = await supabase
            .from('shop_purchases')
            .update({
                amount_ton: amountTon,
                payload: nextPayload,
                updated_at: new Date().toISOString()
            })
            .eq('id', existingPurchase.id)
            .select('*')
            .single();

        if (updatePurchaseError) throw updatePurchaseError;
        purchase = updatedPurchase;
    } else {
        const { data: createdPurchase, error: purchaseError } = await supabase
            .from('shop_purchases')
            .insert({
                shop_item_id: item.id,
                seller_owner_id: item.owner_id,
                buyer_owner_id: buyerOwnerId,
                status: 'pending',
                amount_ton: amountTon,
                ownership_transfer_status: 'pending',
                payload: payloadPatch
            })
            .select('*')
            .single();

        if (purchaseError) {
            if (isMissingShopTables(purchaseError)) {
                throw new Error('Сначала примени SQL под shop foundation');
            }
            throw purchaseError;
        }
        purchase = createdPurchase;
    }

    return {
        purchase,
        item,
        settings,
        amountTon,
        amountRub,
        memo,
        paymentMethod
    };
}

function parsePurchaseIdsInput(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => String(entry || '').trim()).filter(Boolean);
    }
    return String(value || '')
        .split(',')
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
}

function ensureSingleBatchContext(purchases) {
    if (!Array.isArray(purchases) || purchases.length <= 1) return;
    const batchTokens = Array.from(new Set(
        purchases
            .map((purchase) => String(purchase?.payload?.batch_token || '').trim())
            .filter(Boolean)
    ));
    if (batchTokens.length !== 1) {
        const error = new Error('Для batch-действия нужен один общий счет');
        error.statusCode = 400;
        throw error;
    }
}

async function summarizeIncomingOwnedAssets(supabase, items = []) {
    const itemIds = items.map((item) => item?.id).filter(Boolean);
    if (!itemIds.length) {
        return { proxyCount: 0, userbotCount: 0 };
    }

    const { data: assetRows, error } = await supabase
        .from('shop_item_assets')
        .select('shop_item_id, asset_type')
        .in('shop_item_id', itemIds);
    if (error) throw error;

    const assetsByItem = new Map();
    for (const asset of assetRows || []) {
        const bucket = assetsByItem.get(asset.shop_item_id) || [];
        bucket.push(asset);
        assetsByItem.set(asset.shop_item_id, bucket);
    }

    let proxyCount = 0;
    let userbotCount = 0;

    for (const item of items) {
        const assetList = assetsByItem.get(item.id) || [];
        if (assetList.length) {
            proxyCount += assetList.filter((asset) => asset.asset_type === 'proxy').length;
            userbotCount += assetList.filter((asset) => asset.asset_type === 'userbot').length;
            continue;
        }

        if (item.item_type === 'proxy') proxyCount += 1;
        if (item.item_type === 'userbot') userbotCount += 1;
    }

    return { proxyCount, userbotCount };
}

async function assertBuyerOwnershipLimits({ supabase, profile, buyerOwnerId, items = [] }) {
    const rules = getTierRules(profile);
    if (!Number.isFinite(rules.maxOwnedProxies) && !Number.isFinite(rules.maxUserbots)) {
        return;
    }

    const { proxyCount: incomingProxyCount, userbotCount: incomingUserbotCount } = await summarizeIncomingOwnedAssets(supabase, items);
    if (!incomingProxyCount && !incomingUserbotCount) {
        return;
    }

    if (Number.isFinite(rules.maxOwnedProxies) && incomingProxyCount > 0) {
        const { count, error } = await supabase
            .from('proxies')
            .select('id', { count: 'exact', head: true })
            .eq('owner_id', buyerOwnerId);
        if (error) throw error;

        if ((Number(count || 0) + incomingProxyCount) > rules.maxOwnedProxies) {
            const limitError = new Error('На Trial можно владеть только одним прокси. Сначала перейди на Normal или освободи текущий proxy.');
            limitError.statusCode = 400;
            throw limitError;
        }
    }

    if (Number.isFinite(rules.maxUserbots) && incomingUserbotCount > 0) {
        const { count, error } = await supabase
            .from('tg_accounts')
            .select('id', { count: 'exact', head: true })
            .eq('owner_id', buyerOwnerId)
            .eq('account_type', 'userbot');
        if (error) throw error;

        if ((Number(count || 0) + incomingUserbotCount) > rules.maxUserbots) {
            const limitError = new Error('На Trial можно владеть только одним юзерботом. Сначала перейди на Normal или удали текущий.');
            limitError.statusCode = 400;
            throw limitError;
        }
    }
}

async function approveSellerPurchaseRecord(supabase, purchase) {
    if (normalizePaymentMethod(purchase.payload?.payment_method) !== 'p2p') {
        const error = new Error('Это действие только для P2P-счетов');
        error.statusCode = 400;
        throw error;
    }

    if (!['awaiting_receipt', 'pending'].includes(purchase.status)) {
        const error = new Error('Этот счет уже обработан');
        error.statusCode = 400;
        throw error;
    }

    const { data: item, error: itemError } = await supabase
        .from('shop_items')
        .select('*')
        .eq('id', purchase.shop_item_id)
        .single();
    if (itemError) throw itemError;

    const textServiceItem = isTextServiceItem(item);
    const { data: assets, error: assetsError } = await supabase
        .from('shop_item_assets')
        .select('*')
        .eq('shop_item_id', purchase.shop_item_id)
        .order('sort_order', { ascending: true });
    if (assetsError) throw assetsError;

    await supabase
        .from('shop_purchases')
        .update({
            status: 'paid',
            ownership_transfer_status: textServiceItem ? 'completed' : (purchase.ownership_transfer_status || 'pending'),
            ownership_transfer_error: null,
            updated_at: new Date().toISOString()
        })
        .eq('id', purchase.id);

    if (!textServiceItem) {
        try {
            await transferShopAssets(supabase, purchase, item, assets || []);
            await supabase
                .from('shop_purchases')
                .update({
                    ownership_transfer_status: 'completed',
                    ownership_transfer_error: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', purchase.id);
        } catch (transferError) {
            console.error('Ошибка P2P handoff shop purchase:', transferError);
            await supabase
                .from('shop_purchases')
                .update({
                    ownership_transfer_status: 'failed',
                    ownership_transfer_error: transferError.message || 'Неизвестная ошибка',
                    updated_at: new Date().toISOString()
                })
                .eq('id', purchase.id);
            const error = new Error('Оплата подтверждена, но передача прав сломалась');
            error.statusCode = 500;
            throw error;
        }
    }

    await applyShopOfferUnlock(supabase, purchase, item);
}

export async function confirmShopP2pPayment(supabase, {
    sellerOwnerId,
    purchaseIds = [],
    batchToken = null,
    confirmSource = 'manual',
    bankEventId = null,
    allowPending = false
} = {}) {
    const sellerId = String(sellerOwnerId || '').trim();
    const ids = parsePurchaseIdsInput(purchaseIds);
    const token = String(batchToken || '').trim();

    if (!sellerId) {
        const error = new Error('Не найден продавец для подтверждения P2P');
        error.statusCode = 400;
        throw error;
    }

    let query = supabase
        .from('shop_purchases')
        .select('*')
        .eq('seller_owner_id', sellerId);

    if (ids.length) {
        query = query.in('id', ids);
    } else if (token) {
        query = query.contains('payload', { batch_token: token });
    } else {
        const error = new Error('Нужно передать purchase_ids или batch_token');
        error.statusCode = 400;
        throw error;
    }

    const { data: purchases, error: purchasesError } = await query;
    if (purchasesError) throw purchasesError;

    if (ids.length && (purchases || []).length !== ids.length) {
        const error = new Error('Часть продаж уже недоступна');
        error.statusCode = 404;
        throw error;
    }

    if (!(purchases || []).length) {
        const error = new Error('Покупки для подтверждения не найдены');
        error.statusCode = 404;
        throw error;
    }

    ensureSingleBatchContext(purchases || []);

    const allowedStatuses = allowPending ? ['awaiting_receipt', 'pending'] : ['awaiting_receipt'];
    for (const purchase of purchases || []) {
        if (normalizePaymentMethod(purchase.payload?.payment_method) !== 'p2p') {
            const error = new Error('Это действие только для P2P-счетов');
            error.statusCode = 400;
            throw error;
        }

        if (purchase.status === 'paid') {
            continue;
        }

        if (!allowedStatuses.includes(purchase.status)) {
            const error = new Error(allowPending ? 'Этот счет уже обработан' : 'Автосверка подтверждает только счета после “Я оплатил”');
            error.statusCode = 400;
            throw error;
        }

        if (purchase.status === 'pending' && isPendingPurchaseExpired(purchase)) {
            await supabase
                .from('shop_purchases')
                .update({ status: 'expired', updated_at: new Date().toISOString() })
                .eq('id', purchase.id);
            const error = new Error('Время на оплату истекло. Создай покупку заново.');
            error.statusCode = 400;
            throw error;
        }
    }

    const buyerOwnerId = purchases?.[0]?.buyer_owner_id;
    const { data: buyerProfile, error: buyerProfileError } = await supabase
        .from('profiles')
        .select('product_tier')
        .eq('id', buyerOwnerId)
        .maybeSingle();
    if (buyerProfileError) throw buyerProfileError;

    const itemIds = Array.from(new Set((purchases || []).map((purchase) => purchase.shop_item_id).filter(Boolean)));
    const { data: itemsForLimit, error: itemsForLimitError } = await supabase
        .from('shop_items')
        .select('id, item_type')
        .in('id', itemIds);
    if (itemsForLimitError) throw itemsForLimitError;

    await assertBuyerOwnershipLimits({
        supabase,
        profile: buyerProfile || {},
        buyerOwnerId,
        items: itemsForLimit || []
    });

    const confirmedAt = new Date().toISOString();
    const completedPurchaseIds = [];
    let transferFailed = false;
    let transferErrorMessage = '';

    for (const purchase of purchases || []) {
        if (purchase.status === 'paid' && purchase.ownership_transfer_status === 'completed') {
            completedPurchaseIds.push(purchase.id);
            continue;
        }

        const { data: item, error: itemError } = await supabase
            .from('shop_items')
            .select('*')
            .eq('id', purchase.shop_item_id)
            .single();
        if (itemError) throw itemError;

        const textServiceItem = isTextServiceItem(item);
        if (!textServiceItem && item.status === 'sold' && purchase.ownership_transfer_status !== 'completed') {
            const error = new Error('Лот уже ушел другому покупателю. Этот заказ больше нельзя завершить.');
            error.statusCode = 409;
            throw error;
        }

        const claimPayload = {
            ...(purchase.payload || {}),
            confirmed_at: confirmedAt,
            confirm_source: confirmSource,
            bank_event_id: bankEventId || purchase.payload?.bank_event_id || null
        };

        const { data: claimedRows, error: claimError } = await supabase
            .from('shop_purchases')
            .update({
                status: 'paid',
                ownership_transfer_status: textServiceItem ? 'completed' : (purchase.ownership_transfer_status || 'pending'),
                ownership_transfer_error: null,
                payload: claimPayload,
                updated_at: confirmedAt
            })
            .eq('id', purchase.id)
            .in('status', purchase.status === 'paid' ? ['paid'] : allowedStatuses)
            .select('*');

        if (claimError) throw claimError;
        const claimed = (claimedRows || [])[0];
        if (!claimed) {
            const error = new Error('Счет уже обработан параллельно');
            error.statusCode = 409;
            throw error;
        }

        if (textServiceItem) {
            await applyShopOfferUnlock(supabase, claimed, item);
            completedPurchaseIds.push(claimed.id);
            continue;
        }

        const { data: assets, error: assetsError } = await supabase
            .from('shop_item_assets')
            .select('*')
            .eq('shop_item_id', purchase.shop_item_id)
            .order('sort_order', { ascending: true });
        if (assetsError) throw assetsError;

        try {
            await transferShopAssets(supabase, claimed, item, assets || []);
            await supabase
                .from('shop_purchases')
                .update({
                    ownership_transfer_status: 'completed',
                    ownership_transfer_error: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', claimed.id);
            completedPurchaseIds.push(claimed.id);
        } catch (transferError) {
            console.error('Ошибка P2P confirm handoff shop purchase:', transferError);
            transferFailed = true;
            transferErrorMessage = transferError.message || 'Неизвестная ошибка';
            await supabase
                .from('shop_purchases')
                .update({
                    ownership_transfer_status: 'failed',
                    ownership_transfer_error: transferErrorMessage,
                    updated_at: new Date().toISOString()
                })
                .eq('id', claimed.id);
        }
    }

    if (transferFailed) {
        const error = new Error('Оплата подтверждена, но передача прав сломалась');
        error.statusCode = 500;
        error.completedPurchaseIds = completedPurchaseIds;
        error.transferErrorMessage = transferErrorMessage;
        throw error;
    }

    return {
        success: true,
        status: 'paid',
        ownership_transfer_status: 'completed',
        purchase_ids: completedPurchaseIds,
        batch_token: token || purchases?.[0]?.payload?.batch_token || null
    };
}

async function processPdfAutoConfirmation(supabase, { purchases, file, sellerOwnerId, currentPayload }) {
    if (!file || !file.path || !file.originalname?.toLowerCase().endsWith('.pdf')) {
        return { autoConfirmed: false, payload: currentPayload };
    }

    try {
        // 1. Check if PDF auto-confirm is enabled
        const { data: settings } = await supabase
            .from('p2p_webhook_settings')
            .select('pdf_auto_confirm_enabled, match_clock_skew_minutes')
            .eq('owner_id', sellerOwnerId)
            .maybeSingle();

        if (settings?.pdf_auto_confirm_enabled === false) {
            return { autoConfirmed: false, payload: currentPayload };
        }

        // 2. Parse PDF
        const parsed = await parsePdfReceipt(file.path);
        if (!parsed.success) {
            const nextPayload = {
                ...currentPayload,
                parsed_receipt_metadata: {
                    success: false,
                    reason: parsed.reason,
                    parsed_at: new Date().toISOString()
                }
            };
            return { autoConfirmed: false, payload: nextPayload };
        }

        const parsedMetadata = {
            success: true,
            amount_rub: parsed.amountRub,
            event_time: parsed.eventTime,
            transaction_id: parsed.transactionId || null,
            bank_name: parsed.bankName || 'Unknown',
            parsed_at: new Date().toISOString(),
            is_pdf: true
        };

        // 3. Ensure the amount in the PDF matches the total purchase amount expected
        const expectedTotalRub = purchases.reduce((sum, p) => sum + Number(p.payload?.amount_rub || p.amount_rub || 0), 0);
        if (Math.abs(parsed.amountRub - expectedTotalRub) >= 0.01) {
            const nextPayload = {
                ...currentPayload,
                parsed_receipt_metadata: {
                    ...parsedMetadata,
                    match_failed_reason: `Сумма в чеке (${parsed.amountRub}) не совпадает с суммой заказа (${expectedTotalRub})`
                }
            };
            return { autoConfirmed: false, payload: nextPayload };
        }

        const nextPayload = {
            ...currentPayload,
            parsed_receipt_metadata: parsedMetadata
        };

        // 4. Try to find a matching bank event
        // Look for received/unmatched events with the exact amount and within skew
        const skewMinutes = settings?.match_clock_skew_minutes || 10;
        const skewMs = skewMinutes * 60 * 1000;
        const parsedTimeMs = parsed.eventTime ? new Date(parsed.eventTime).getTime() : new Date().getTime();

        const { data: bankEvents, error: eventsError } = await supabase
            .from('p2p_bank_events')
            .select('*')
            .eq('owner_id', sellerOwnerId)
            .eq('amount_rub', parsed.amountRub)
            .in('status', ['received', 'unmatched', 'ambiguous', 'auto_confirm_failed']);

        if (eventsError) throw eventsError;

        let bestMatch = null;
        if (bankEvents && bankEvents.length > 0) {
            // Filter by time window
            const timedEvents = bankEvents.filter(event => {
                if (!event.event_time && !event.received_at) return false;
                const eventMs = new Date(event.event_time || event.received_at).getTime();
                return Math.abs(eventMs - parsedTimeMs) <= skewMs;
            });

            // If we have a transaction ID in the PDF, try to match it directly
            if (parsed.transactionId) {
                const idMatch = timedEvents.find(event => {
                    const cleanText = String(event.raw_text || event.redacted_text || '').toLowerCase();
                    return cleanText.includes(parsed.transactionId.toLowerCase());
                });
                if (idMatch) {
                    bestMatch = idMatch;
                }
            }

            // Fallback to time matching if there's exactly one timed event and no transaction ID mismatch
            if (!bestMatch && timedEvents.length === 1) {
                bestMatch = timedEvents[0];
            }
        }

        if (bestMatch) {
            const now = new Date().toISOString();
            const finalPayload = {
                ...nextPayload,
                parsed_receipt_metadata: {
                    ...parsedMetadata,
                    matched_event_id: bestMatch.id,
                    matched_at: now
                }
            };

            // Update the purchases in database with finalPayload first, so confirmShopP2pPayment gets it
            const purchaseIds = purchases.map(p => p.id);
            for (const p of purchases) {
                await supabase
                    .from('shop_purchases')
                    .update({
                        payload: {
                            ...(p.payload || {}),
                            ...finalPayload
                        },
                        updated_at: now
                    })
                    .eq('id', p.id);
            }

            // Confirm payment!
            await confirmShopP2pPayment(supabase, {
                sellerOwnerId,
                purchaseIds,
                batchToken: purchases[0]?.payload?.batch_token || null,
                confirmSource: 'receipt_pdf_matched',
                bankEventId: bestMatch.id,
                allowPending: true
            });

            // Update bank event
            await supabase
                .from('p2p_bank_events')
                .update({
                    status: 'confirmed',
                    matched_purchase_ids: purchaseIds,
                    matched_batch_token: purchases[0]?.payload?.batch_token || null,
                    resolution_type: 'auto_confirmed',
                    resolved_at: now,
                    confirm_source: 'receipt_pdf_matched',
                    updated_at: now
                })
                .eq('id', bestMatch.id);

            return { autoConfirmed: true, payload: finalPayload };
        }

        return { autoConfirmed: false, payload: nextPayload };
    } catch (err) {
        console.error('Error in processPdfAutoConfirmation:', err);
        return {
            autoConfirmed: false,
            payload: {
                ...currentPayload,
                parsed_receipt_metadata: {
                    success: false,
                    reason: `Auto-reconciliation error: ${err.message}`,
                    parsed_at: new Date().toISOString()
                }
            }
        };
    }
}

async function rejectSellerPurchaseRecord(supabase, purchase, reason) {
    const payload = {
        ...(purchase.payload || {}),
        rejection_reason: reason
    };

    const { error: updateError } = await supabase
        .from('shop_purchases')
        .update({
            status: 'rejected',
            payload,
            updated_at: new Date().toISOString()
        })
        .eq('id', purchase.id);
    if (updateError) throw updateError;
}

async function transferShopAssets(supabase, purchase, item, assets) {
    const buyerOwnerId = purchase.buyer_owner_id;
    const sellerOwnerId = purchase.seller_owner_id;

    const includedProxyIds = new Set(
        assets.filter(asset => asset.asset_type === 'proxy').map(asset => String(asset.asset_id))
    );

    for (const asset of assets) {
        if (asset.asset_type === 'proxy') {
            const updatePayload = { owner_id: buyerOwnerId };
            const { error: supportError } = await supabase
                .from('proxies')
                .select('provision_source')
                .limit(1);
            if (!supportError) {
                updatePayload.provision_source = 'purchased';
            }

            const { error } = await supabase
                .from('proxies')
                .update(updatePayload)
                .eq('id', asset.asset_id)
                .eq('owner_id', sellerOwnerId);
            if (error) throw error;
            continue;
        }

        if (asset.asset_type === 'userbot') {
            const { data: account, error: accountError } = await supabase
                .from('tg_accounts')
                .select('id, proxy_id')
                .eq('id', asset.asset_id)
                .eq('owner_id', sellerOwnerId)
                .eq('account_type', 'userbot')
                .single();
            if (accountError) throw accountError;

            const updatePayload = {
                owner_id: buyerOwnerId
            };

            if (account.proxy_id && !includedProxyIds.has(String(account.proxy_id))) {
                updatePayload.proxy_id = null;
            }

            const { error } = await supabase
                .from('tg_accounts')
                .update(updatePayload)
                .eq('id', account.id);
            if (error) throw error;
            continue;
        }

        if (asset.asset_type === 'customer_base_asset') {
            const { error: baseError } = await supabase
                .from('customer_bases')
                .update({ owner_id: buyerOwnerId })
                .eq('id', asset.asset_id)
                .eq('owner_id', sellerOwnerId);
            if (baseError) throw baseError;

            const { error: membersError } = await supabase
                .from('customer_base_members')
                .update({ owner_id: buyerOwnerId })
                .eq('base_id', asset.asset_id)
                .eq('owner_id', sellerOwnerId);
            if (membersError && !(membersError.message || '').includes('customer_base_members')) {
                throw membersError;
            }
        }
    }

    await supabase
        .from('shop_items')
        .update({
            status: 'sold',
            visibility: 'private',
            updated_at: new Date().toISOString()
        })
        .eq('id', item.id);
}

async function applyShopOfferUnlock(supabase, purchase, item) {
    const offerCode = normalizeOfferCode(item?.offer_code) || inferOfferCodeFromLegacyItem(item);
    if (!offerCode) return;

    const ownerId = purchase?.buyer_owner_id;
    if (!ownerId) return;

    const now = new Date();

    if (offerCode === 'normal') {
        console.warn('[Shop] Игнорируем Normal unlock из Shop. Normal теперь выдается только через BullRun billing.');
        return;
    }

    if (offerCode === 'trial') {
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, product_tier, trial_started_at, trial_ends_at')
            .eq('id', ownerId)
            .single();

        if (profileError) {
            if (String(profileError.message || '').includes('product_tier')) return;
            throw profileError;
        }

        if (String(profile?.product_tier || '').toLowerCase() === 'normal' || String(profile?.product_tier || '').toLowerCase() === 'pro') {
            return;
        }

        const startedAt = profile?.trial_started_at || now.toISOString();
        const endsAt = profile?.trial_ends_at || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const { error } = await supabase
            .from('profiles')
            .update({
                product_tier: 'trial',
                trial_started_at: startedAt,
                trial_ends_at: endsAt
            })
            .eq('id', ownerId);

        if (error && !String(error.message || '').includes('product_tier')) throw error;
    }
}

async function loadOwnerUserbotProxyUsage(supabase, ownerId) {
    const { data, error } = await supabase
        .from('tg_accounts')
        .select('id, tg_account_id, tg_username, proxy_id')
        .eq('owner_id', ownerId)
        .eq('account_type', 'userbot');

    if (error) throw error;

    const rows = data || [];
    const usage = new Map();
    for (const row of rows) {
        if (!row.proxy_id) continue;
        const key = String(row.proxy_id);
        const bucket = usage.get(key) || [];
        bucket.push(row);
        usage.set(key, bucket);
    }
    return { rows, usage };
}

function proxyHasMultipleUserbots(usageMap, proxyId) {
    return (usageMap.get(String(proxyId)) || []).length > 1;
}

async function runShopPurchaseCheck(supabase, purchase, { enforceBuyerOwnerId = null, enforceSellerOwnerId = null } = {}) {
    if (!purchase) {
        return {
            ok: false,
            statusCode: 404,
            body: { error: 'Покупка не найдена' }
        };
    }

    if (enforceBuyerOwnerId && String(purchase.buyer_owner_id) !== String(enforceBuyerOwnerId)) {
        return {
            ok: false,
            statusCode: 404,
            body: { error: 'Покупка не найдена' }
        };
    }

    if (enforceSellerOwnerId && String(purchase.seller_owner_id) !== String(enforceSellerOwnerId)) {
        return {
            ok: false,
            statusCode: 404,
            body: { error: 'Покупка не найдена' }
        };
    }

    if (purchase.status === 'expired' || isPendingPurchaseExpired(purchase)) {
        await supabase
            .from('shop_purchases')
            .update({
                status: 'expired',
                updated_at: new Date().toISOString()
            })
            .eq('id', purchase.id);

        return {
            ok: false,
            statusCode: 400,
            body: {
                error: 'Время на оплату истекло. Создай покупку заново.',
                status: 'expired',
                ownership_transfer_status: 'pending'
            }
        };
    }

    if (purchase.status === 'paid' && purchase.ownership_transfer_status === 'completed') {
        return {
            ok: true,
            statusCode: 200,
            body: {
                success: true,
                status: 'paid',
                ownership_transfer_status: 'completed'
            }
        };
    }

    const paymentMethod = normalizePaymentMethod(purchase.payload?.payment_method);

    if (paymentMethod === 'p2p') {
        if (purchase.status === 'awaiting_receipt') {
            return {
                ok: true,
                statusCode: 200,
                body: {
                    success: true,
                    status: 'awaiting_receipt',
                    ownership_transfer_status: purchase.ownership_transfer_status || 'pending'
                }
            };
        }

        if (purchase.status === 'rejected') {
            return {
                ok: true,
                statusCode: 200,
                body: {
                    success: true,
                    status: 'rejected',
                    ownership_transfer_status: purchase.ownership_transfer_status || 'pending'
                }
            };
        }
    }

    const memo = purchase.payload?.memo;
    const wallet = purchase.payload?.seller_wallet;
    const isPaid = paymentMethod === 'p2p'
        ? false
        : await checkTonPayment(memo, purchase.amount_ton, wallet);

    if (!isPaid) {
        return {
            ok: true,
            statusCode: 200,
            body: {
                success: true,
                status: 'pending',
                ownership_transfer_status: purchase.ownership_transfer_status || 'pending'
            }
        };
    }

    const { data: item, error: itemError } = await supabase
        .from('shop_items')
        .select('*')
        .eq('id', purchase.shop_item_id)
        .single();
    if (itemError) throw itemError;
    const textServiceItem = isTextServiceItem(item);

    if (!textServiceItem && item.status === 'sold' && purchase.ownership_transfer_status !== 'completed') {
        return {
            ok: false,
            statusCode: 400,
            body: {
                error: 'Лот уже ушел другому покупателю. Этот заказ больше нельзя завершить.',
                status: 'failed',
                ownership_transfer_status: 'failed'
            }
        };
    }

    const { data: assets, error: assetsError } = await supabase
        .from('shop_item_assets')
        .select('*')
        .eq('shop_item_id', purchase.shop_item_id)
        .order('sort_order', { ascending: true });
    if (assetsError) throw assetsError;

    await supabase
        .from('shop_purchases')
        .update({
            status: 'paid',
            ownership_transfer_status: textServiceItem ? 'completed' : (purchase.ownership_transfer_status || 'pending'),
            ownership_transfer_error: null,
            updated_at: new Date().toISOString()
        })
        .eq('id', purchase.id);

    if (textServiceItem) {
        await applyShopOfferUnlock(supabase, purchase, item);
        return {
            ok: true,
            statusCode: 200,
            body: {
                success: true,
                status: 'paid',
                ownership_transfer_status: 'completed'
            }
        };
    }

    try {
        await transferShopAssets(supabase, purchase, item, assets || []);

        await supabase
            .from('shop_purchases')
            .update({
                ownership_transfer_status: 'completed',
                ownership_transfer_error: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', purchase.id);

        return {
            ok: true,
            statusCode: 200,
            body: {
                success: true,
                status: 'paid',
                ownership_transfer_status: 'completed'
            }
        };
    } catch (transferError) {
        console.error('Ошибка перевода прав shop purchase:', transferError);
        await supabase
            .from('shop_purchases')
            .update({
                ownership_transfer_status: 'failed',
                ownership_transfer_error: transferError.message || 'Неизвестная ошибка',
                updated_at: new Date().toISOString()
            })
            .eq('id', purchase.id);

        return {
            ok: false,
            statusCode: 500,
            body: {
                error: 'Оплата найдена, но перевод прав сломался',
                status: 'paid',
                ownership_transfer_status: 'failed'
            }
        };
    }
}


export default function shopRoutes(supabase) {
    const router = express.Router();

    router.get(['/admin/assets', '/seller/assets'], authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const adminSeller = isAdminSeller(req.profile);

        try {
            if (!adminSeller) {
                const { data: settings } = await supabase
                    .from('payment_settings')
                    .select('ton_wallet')
                    .eq('owner_id', ownerId)
                    .maybeSingle();

                return res.json({
                    proxies: [],
                    userbots: [],
                    customer_bases: [],
                    seller_wallet: settings?.ton_wallet || null,
                    seller_role: req.profile?.role || null,
                    seller_mode: 'text_service',
                    support: {
                        customer_bases: false,
                        asset_marketplace: false,
                        text_service: true
                    }
                });
            }

            const [proxiesResp, userbotsResp, basesResp, settingsResp] = await Promise.all([
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
                    .from('customer_bases')
                    .select('id, title, description, channel_count, members_count, updated_at')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('payment_settings')
                    .select('ton_wallet')
                    .eq('owner_id', ownerId)
                    .maybeSingle()
            ]);

            const joinedError = [
                proxiesResp.error?.message || '',
                userbotsResp.error?.message || '',
                basesResp.error?.message || ''
            ].join(' ');
            const customerBasesUnavailable = joinedError.includes('customer_bases');

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
                customer_bases: customerBasesUnavailable ? [] : (basesResp.data || []),
                seller_wallet: settingsResp.data?.ton_wallet || null,
                seller_role: req.profile?.role || null,
                seller_mode: 'asset_marketplace',
                stats: {
                    proxies: proxyStats
                },
                support: {
                    customer_bases: !customerBasesUnavailable,
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

    router.get(['/admin/items', '/seller/items'], authenticateUser, async (req, res) => {
        const ownerId = req.user.id;

        try {
            const { data: items, error: itemsError } = await supabase
                .from('shop_items')
                .select('*')
                .eq('owner_id', ownerId)
                .order('created_at', { ascending: false });

            if (itemsError) {
                if (isMissingShopTables(itemsError)) {
                    return res.json({ items: [], support: { shop: false } });
                }
                throw itemsError;
            }

            const itemIds = (items || []).map(item => item.id);
            let assets = [];
            let purchases = [];

            if (itemIds.length > 0) {
                const [assetsResp, purchasesResp] = await Promise.all([
                    supabase
                        .from('shop_item_assets')
                        .select('*')
                        .in('shop_item_id', itemIds)
                        .order('sort_order', { ascending: true }),
                    supabase
                        .from('shop_purchases')
                        .select('id, shop_item_id, status, ownership_transfer_status, amount_ton, created_at, buyer_owner_id')
                        .eq('seller_owner_id', ownerId)
                        .in('shop_item_id', itemIds)
                        .order('created_at', { ascending: false })
                ]);

                if (assetsResp.error) {
                    if (isMissingShopTables(assetsResp.error)) {
                        return res.json({ items: (items || []).map(normalizeItem), support: { shop: false } });
                    }
                    throw assetsResp.error;
                }

                if (purchasesResp.error) throw purchasesResp.error;

                assets = assetsResp.data || [];
                purchases = purchasesResp.data || [];
                await expireStalePendingPurchases(supabase, purchases);
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

            const purchasesByItem = new Map();
            for (const purchase of purchases) {
                const bucket = purchasesByItem.get(purchase.shop_item_id) || [];
                bucket.push(purchase);
                purchasesByItem.set(purchase.shop_item_id, bucket);
            }

            const buyerIds = Array.from(new Set((purchases || []).map((purchase) => String(purchase.buyer_owner_id || '')).filter(Boolean)));
            let buyerProfilesById = new Map();
            if (buyerIds.length) {
                const { data: buyerProfiles, error: buyerProfilesError } = await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .in('id', buyerIds);

                if (buyerProfilesError) throw buyerProfilesError;
                buyerProfilesById = new Map((buyerProfiles || []).map((profile) => [String(profile.id), profile]));
            }

            const visibleSellerItems = (items || []).filter((item) => {
                const normalized = normalizeItem(item);
                if (isTextServiceItem(normalized)) return true;
                return (assetsByItem.get(item.id) || []).length > 0;
            });

            res.json({
                items: visibleSellerItems.map(item => ({
                    ...normalizeItem(item),
                    assets: assetsByItem.get(item.id) || [],
                    stats: {
                        total_purchases: (purchasesByItem.get(item.id) || []).length,
                        pending_purchases: (purchasesByItem.get(item.id) || []).filter(purchase =>
                            purchase.status === 'pending' && !isPendingPurchaseExpired(purchase)
                        ).length,
                        expired_purchases: (purchasesByItem.get(item.id) || []).filter(purchase =>
                            purchase.status === 'expired' || (purchase.status === 'pending' && isPendingPurchaseExpired(purchase))
                        ).length,
                        paid_purchases: (purchasesByItem.get(item.id) || []).filter(purchase => purchase.status === 'paid').length,
                        completed_transfers: (purchasesByItem.get(item.id) || []).filter(purchase => purchase.ownership_transfer_status === 'completed').length,
                        failed_transfers: (purchasesByItem.get(item.id) || []).filter(purchase => purchase.ownership_transfer_status === 'failed').length
                    },
                    recent_purchase: (() => {
                        const purchase = (purchasesByItem.get(item.id) || [])[0] || null;
                        if (!purchase) return null;
                        const buyerProfile = buyerProfilesById.get(String(purchase.buyer_owner_id || '')) || null;
                        return {
                            ...purchase,
                            expires_at: purchase.status === 'pending' ? getPendingPurchaseExpiry(purchase.created_at).toISOString() : null,
                            buyer_name: buyerProfile?.full_name?.trim() || null
                        };
                    })()
                })),
                seller_role: req.profile?.role || null,
                seller_mode: isAdminSeller(req.profile) ? 'asset_marketplace' : 'text_service',
                support: {
                    shop: true,
                    asset_marketplace: isAdminSeller(req.profile),
                    text_service: true
                }
            });
        } catch (error) {
            console.error('Ошибка загрузки shop items:', error);
            res.status(500).json({ error: 'Ошибка загрузки лотов' });
        }
    });

    router.get(['/admin/purchases', '/seller/purchases'], authenticateUser, async (req, res) => {
        const ownerId = req.user.id;

        try {
            const { data: purchases, error } = await supabase
                .from('shop_purchases')
                .select('id, shop_item_id, buyer_owner_id, status, amount_ton, ownership_transfer_status, ownership_transfer_error, created_at, payload, shop_items(id, title, item_type, price_ton, price_rub)')
                .eq('seller_owner_id', ownerId)
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) {
                if (isMissingShopTables(error)) {
                    return res.json({ purchases: [], support: { shop: false } });
                }
                throw error;
            }

            await expireStalePendingPurchases(supabase, purchases || []);
            const itemIds = (purchases || [])
                .map(row => row.shop_items?.id)
                .filter(Boolean);

            let assetRows = [];
            if (itemIds.length > 0) {
                const { data, error: assetsError } = await supabase
                    .from('shop_item_assets')
                    .select('shop_item_id, asset_type, asset_id, label')
                    .in('shop_item_id', itemIds)
                    .order('sort_order', { ascending: true });

                if (assetsError) throw assetsError;
                assetRows = data || [];
            }

            const assetsByItem = new Map();
            for (const asset of assetRows) {
                const bucket = assetsByItem.get(asset.shop_item_id) || [];
                bucket.push({
                    asset_type: asset.asset_type,
                    asset_id: asset.asset_id,
                    label: asset.label || ''
                });
                assetsByItem.set(asset.shop_item_id, bucket);
            }

            res.json({
                purchases: (purchases || []).map(row => ({
                    id: row.id,
                    shop_item_id: row.shop_item_id,
                    buyer_owner_id: row.buyer_owner_id,
                    status: row.status === 'pending' && isPendingPurchaseExpired(row) ? 'expired' : row.status,
                    amount_ton: Number(row.amount_ton || 0),
                    amount_rub: Number(row.payload?.amount_rub || row.shop_items?.price_rub || 0),
                    ownership_transfer_status: row.ownership_transfer_status || 'pending',
                    ownership_transfer_error: row.ownership_transfer_error || null,
                    created_at: row.created_at,
                    expires_at: row.status === 'pending' ? getPendingPurchaseExpiry(row.created_at).toISOString() : null,
                    payload: row.payload || {},
                    item: row.shop_items ? {
                        id: row.shop_items.id,
                        title: row.shop_items.title,
                        item_type: row.shop_items.item_type,
                        price_ton: Number(row.shop_items.price_ton || 0),
                        price_rub: Number(row.shop_items.price_rub || 0),
                        assets: assetsByItem.get(row.shop_items.id) || []
                    } : null
                })),
                support: {
                    shop: true
                }
            });
        } catch (error) {
            console.error('Ошибка загрузки shop purchases для продавца:', error);
            res.status(500).json({ error: 'Ошибка загрузки продаж shop' });
        }
    });

    router.post(['/admin/purchases/:id/check', '/seller/purchases/:id/check'], authenticateUser, async (req, res) => {
        const sellerOwnerId = req.user.id;
        const purchaseId = req.params.id;

        try {
            const { data: purchase, error: purchaseError } = await supabase
                .from('shop_purchases')
                .select('*')
                .eq('id', purchaseId)
                .eq('seller_owner_id', sellerOwnerId)
                .single();
            if (purchaseError) throw purchaseError;

            const result = await runShopPurchaseCheck(supabase, purchase, {
                enforceSellerOwnerId: sellerOwnerId
            });

            return res.status(result.statusCode).json(result.body);
        } catch (error) {
            console.error('Ошибка проверки shop purchase продавцом:', error);
            res.status(500).json({ error: 'Ошибка проверки оплаты продавцом' });
        }
    });

    router.post(['/admin/purchases/check-batch', '/seller/purchases/check-batch'], authenticateUser, async (req, res) => {
        const sellerOwnerId = req.user.id;
        const purchaseIds = parsePurchaseIdsInput(req.body?.purchase_ids);

        if (!purchaseIds.length) {
            return res.status(400).json({ error: 'Не передан список purchase_ids' });
        }

        try {
            const { data: purchases, error } = await supabase
                .from('shop_purchases')
                .select('*')
                .eq('seller_owner_id', sellerOwnerId)
                .in('id', purchaseIds);

            if (error) throw error;
            if ((purchases || []).length !== purchaseIds.length) {
                return res.status(404).json({ error: 'Часть продаж уже недоступна' });
            }

            ensureSingleBatchContext(purchases || []);

            for (const purchase of purchases || []) {
                const result = await runShopPurchaseCheck(supabase, purchase, {
                    enforceSellerOwnerId: sellerOwnerId
                });
                if (!String(result.statusCode || '').startsWith('2')) {
                    return res.status(result.statusCode).json(result.body);
                }
            }

            return res.json({ success: true, status: 'paid' });
        } catch (error) {
            console.error('Ошибка batch-проверки shop purchase продавцом:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Ошибка batch-проверки оплаты продавцом' });
        }
    });

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
            price_rub,
            status,
            visibility,
            preview_text,
            transfer_mode,
            payment_methods,
            sales_channel,
            assets = []
        } = req.body;
        const normalizedItemType = String(item_type || '').trim();
        const normalizedOfferCode = normalizeOfferCode(offer_code);
        const adminSeller = isAdminSeller(req.profile);
        const textServiceItem = isTextServiceItem(normalizedItemType, transfer_mode);

        if (!title || !String(title).trim()) {
            return res.status(400).json({ error: 'Название лота обязательно' });
        }

        if (!['proxy', 'userbot', 'bundle', 'customer_base_asset', 'text_offer'].includes(normalizedItemType)) {
            return res.status(400).json({ error: 'Неверный тип товара' });
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
                const itemPayload = {
                    owner_id: ownerId,
                    title: String(title).trim(),
                    description: description || null,
                    post_purchase_message: post_purchase_message || null,
                    item_type: 'text_offer',
                    price_ton: Number(price_ton || 0),
                    price_rub: Number(price_rub || 0),
                    status: status || 'draft',
                    visibility: visibility || 'public',
                    sales_channel: normalizedSalesChannel,
                    preview_text: preview_text || null,
                    payment_methods: normalizedPaymentMethods,
                    offer_code: normalizedOfferCode,
                    transfer_mode: 'post_purchase_message'
                };

                let savedItem = null;
                if (id) {
                    const { data, error } = await supabase
                        .from('shop_items')
                        .update(itemPayload)
                        .eq('id', id)
                        .eq('owner_id', ownerId)
                        .select('*')
                        .single();
                    if (error) {
                        if (isMissingPaymentMethodsColumn(error) || isMissingPriceRubColumn(error) || isMissingSalesChannelColumn(error)) {
                            const legacyPayload = { ...itemPayload };
                            delete legacyPayload.payment_methods;
                            delete legacyPayload.price_rub;
                            delete legacyPayload.sales_channel;
                            const legacy = await supabase
                                .from('shop_items')
                                .update(legacyPayload)
                                .eq('id', id)
                                .eq('owner_id', ownerId)
                                .select('*')
                                .single();
                            if (legacy.error) throw legacy.error;
                            savedItem = { ...legacy.data, payment_methods: normalizedPaymentMethods };
                        } else if (isMissingShopTables(error)) {
                            return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                        } else {
                            throw error;
                        }
                    } else {
                        savedItem = data;
                    }

                    await supabase
                        .from('shop_item_assets')
                        .delete()
                        .eq('shop_item_id', id);
                } else {
                    const { data, error } = await supabase
                        .from('shop_items')
                        .insert(itemPayload)
                        .select('*')
                        .single();
                    if (error) {
                        if (isMissingPaymentMethodsColumn(error) || isMissingPriceRubColumn(error) || isMissingSalesChannelColumn(error)) {
                            const legacyPayload = { ...itemPayload };
                            delete legacyPayload.payment_methods;
                            delete legacyPayload.price_rub;
                            delete legacyPayload.sales_channel;
                            const legacy = await supabase
                                .from('shop_items')
                                .insert(legacyPayload)
                                .select('*')
                                .single();
                            if (legacy.error) throw legacy.error;
                            savedItem = { ...legacy.data, payment_methods: normalizedPaymentMethods };
                        } else if (isMissingShopTables(error)) {
                            return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                        } else {
                            throw error;
                        }
                    } else {
                        savedItem = data;
                    }
                }

                return res.json({
                    success: true,
                    item: normalizeItem(savedItem)
                });
            }

            const { usage: proxyUsageMap } = await loadOwnerUserbotProxyUsage(supabase, ownerId);
            const proxyIds = assets.filter(asset => asset.asset_type === 'proxy').map(asset => asset.asset_id);
            const userbotIds = assets.filter(asset => asset.asset_type === 'userbot').map(asset => asset.asset_id);
            const baseIds = assets.filter(asset => asset.asset_type === 'customer_base_asset').map(asset => asset.asset_id);
            const assetKeys = assets.map(asset => `${asset.asset_type}:${asset.asset_id}`);

            if (proxyIds.length > 0) {
                const { data: rows, error } = await supabase
                    .from('proxies')
                    .select('id')
                    .eq('owner_id', ownerId)
                    .in('id', proxyIds);
                if (error) throw error;
                if ((rows || []).length !== proxyIds.length) {
                    return res.status(400).json({ error: 'В лоте есть чужие или несуществующие прокси' });
                }

                const sharedProxy = proxyIds.find(proxyId => proxyHasMultipleUserbots(proxyUsageMap, proxyId));
                if (sharedProxy) {
                    return res.status(400).json({ error: 'Прокси, на котором сидит больше одного юзербота, нельзя выставлять на продажу.' });
                }
            }

            if (userbotIds.length > 0) {
                const { data: rows, error } = await supabase
                    .from('tg_accounts')
                    .select('id, proxy_id')
                    .eq('owner_id', ownerId)
                    .eq('account_type', 'userbot')
                    .in('id', userbotIds);
                if (error) throw error;
                if ((rows || []).length !== userbotIds.length) {
                    return res.status(400).json({ error: 'В лоте есть чужие или несуществующие юзерботы' });
                }

                const sharedUserbot = (rows || []).find(row => row.proxy_id && proxyHasMultipleUserbots(proxyUsageMap, row.proxy_id));
                if (sharedUserbot) {
                    return res.status(400).json({ error: 'Нельзя продавать юзербота, если его прокси одновременно висит еще на другом юзерботе.' });
                }
            }

            if (baseIds.length > 0) {
                const { data: rows, error } = await supabase
                    .from('customer_bases')
                    .select('id')
                    .eq('owner_id', ownerId)
                    .in('id', baseIds);
                if (error && !(error.message || '').includes('customer_bases')) throw error;
                if (error && (error.message || '').includes('customer_bases')) {
                    return res.status(400).json({ error: 'Таблица customer_bases недоступна. Базы пока нельзя продавать.' });
                }
                if ((rows || []).length !== baseIds.length) {
                    return res.status(400).json({ error: 'В лоте есть чужие или несуществующие базы' });
                }
            }

            const { data: existingItems, error: existingItemsError } = await supabase
                .from('shop_items')
                .select('id, title, status')
                .eq('owner_id', ownerId)
                .in('status', ['draft', 'published']);

            if (existingItemsError) {
                if (isMissingShopTables(existingItemsError)) {
                    return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                }
                throw existingItemsError;
            }

            const candidateItems = (existingItems || []).filter(item => String(item.id) !== String(id || ''));
            if (candidateItems.length > 0) {
                const { data: existingAssets, error: existingAssetsError } = await supabase
                    .from('shop_item_assets')
                    .select('shop_item_id, asset_type, asset_id')
                    .in('shop_item_id', candidateItems.map(item => item.id));

                if (existingAssetsError) {
                    if (isMissingShopTables(existingAssetsError)) {
                        return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                    }
                    throw existingAssetsError;
                }

                const duplicateAsset = (existingAssets || []).find(asset =>
                    assetKeys.includes(`${asset.asset_type}:${asset.asset_id}`)
                );

                if (duplicateAsset) {
                    const ownerItem = candidateItems.find(item => String(item.id) === String(duplicateAsset.shop_item_id));
                    return res.status(400).json({
                        error: `Этот актив уже выставлен в другом лоте${ownerItem?.title ? `: ${ownerItem.title}` : ''}`
                    });
                }
            }

            const itemPayload = {
                owner_id: ownerId,
                title: String(title).trim(),
                description: description || null,
                post_purchase_message: post_purchase_message || null,
                item_type: normalizedItemType,
                price_ton: Number(price_ton || 0),
                price_rub: Number(price_rub || 0),
                status: status || 'draft',
                visibility: visibility || 'public',
                sales_channel: normalizedSalesChannel,
                preview_text: preview_text || null,
                payment_methods: normalizedPaymentMethods,
                offer_code: normalizedOfferCode,
                transfer_mode: transfer_mode || 'ownership_transfer'
            };

            let savedItem = null;
            if (id) {
                const { data, error } = await supabase
                    .from('shop_items')
                    .update(itemPayload)
                    .eq('id', id)
                    .eq('owner_id', ownerId)
                    .select('*')
                    .single();
                if (error) {
                    if (isMissingPaymentMethodsColumn(error) || isMissingPriceRubColumn(error) || isMissingSalesChannelColumn(error)) {
                        const legacyPayload = { ...itemPayload };
                        delete legacyPayload.payment_methods;
                        delete legacyPayload.price_rub;
                        delete legacyPayload.sales_channel;
                        const legacy = await supabase
                            .from('shop_items')
                            .update(legacyPayload)
                            .eq('id', id)
                            .eq('owner_id', ownerId)
                            .select('*')
                            .single();
                        if (legacy.error) throw legacy.error;
                        savedItem = { ...legacy.data, payment_methods: normalizedPaymentMethods };
                    } else if (isMissingShopTables(error)) {
                        return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                    } else {
                        throw error;
                    }
                } else {
                    savedItem = data;
                }

                const { error: deleteAssetsError } = await supabase
                    .from('shop_item_assets')
                    .delete()
                    .eq('shop_item_id', id);
                if (deleteAssetsError) throw deleteAssetsError;
            } else {
                const { data, error } = await supabase
                    .from('shop_items')
                    .insert(itemPayload)
                    .select('*')
                    .single();
                if (error) {
                    if (isMissingPaymentMethodsColumn(error) || isMissingPriceRubColumn(error) || isMissingSalesChannelColumn(error)) {
                        const legacyPayload = { ...itemPayload };
                        delete legacyPayload.payment_methods;
                        delete legacyPayload.price_rub;
                        delete legacyPayload.sales_channel;
                        const legacy = await supabase
                            .from('shop_items')
                            .insert(legacyPayload)
                            .select('*')
                            .single();
                        if (legacy.error) throw legacy.error;
                        savedItem = { ...legacy.data, payment_methods: normalizedPaymentMethods };
                    } else if (isMissingShopTables(error)) {
                        return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                    } else {
                        throw error;
                    }
                } else {
                    savedItem = data;
                }
            }

            const assetRows = assets.map((asset, index) => ({
                shop_item_id: savedItem.id,
                asset_type: asset.asset_type,
                asset_id: asset.asset_id,
                label: asset.label || null,
                sort_order: index
            }));

            const { error: assetInsertError } = await supabase
                .from('shop_item_assets')
                .insert(assetRows);
            if (assetInsertError) throw assetInsertError;

            res.json({
                success: true,
                item: normalizeItem(savedItem)
            });
        } catch (error) {
            console.error('Ошибка сохранения shop item:', error);
            res.status(500).json({ error: 'Ошибка сохранения лота' });
        }
    });

    router.post('/p2p/items', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const {
            id,
            title,
            description,
            post_purchase_message,
            price_ton,
            price_rub,
            status,
            visibility,
            preview_text,
            payment_methods,
            sales_channel
        } = req.body;

        if (!title || !String(title).trim()) {
            return res.status(400).json({ error: 'Название оффера обязательно' });
        }

        if (!String(post_purchase_message || '').trim()) {
            return res.status(400).json({ error: 'Для P2P-оффера нужно заполнить скрытое сообщение после оплаты.' });
        }

        try {
            const normalizedPaymentMethods = normalizePaymentMethods(payment_methods);
            const normalizedSalesChannel = normalizeSalesChannel(sales_channel, 'text_offer');
            const itemPayload = {
                owner_id: ownerId,
                title: String(title).trim(),
                description: description || null,
                post_purchase_message: post_purchase_message || null,
                item_type: 'text_offer',
                price_ton: Number(price_ton || 0),
                price_rub: Number(price_rub || 0),
                status: status || 'draft',
                visibility: visibility || 'public',
                sales_channel: normalizedSalesChannel,
                preview_text: preview_text || null,
                payment_methods: normalizedPaymentMethods,
                offer_code: 'p2p',
                transfer_mode: 'post_purchase_message'
            };

            let savedItem = null;
            if (id) {
                const { data, error } = await supabase
                    .from('shop_items')
                    .update(itemPayload)
                    .eq('id', id)
                    .eq('owner_id', ownerId)
                    .select('*')
                    .single();
                if (error) {
                    if (isMissingPaymentMethodsColumn(error) || isMissingPriceRubColumn(error) || isMissingSalesChannelColumn(error)) {
                        const legacyPayload = { ...itemPayload };
                        delete legacyPayload.payment_methods;
                        delete legacyPayload.price_rub;
                        delete legacyPayload.sales_channel;
                        const legacy = await supabase
                            .from('shop_items')
                            .update(legacyPayload)
                            .eq('id', id)
                            .eq('owner_id', ownerId)
                            .select('*')
                            .single();
                        if (legacy.error) throw legacy.error;
                        savedItem = { ...legacy.data, payment_methods: normalizedPaymentMethods };
                    } else if (isMissingShopTables(error)) {
                        return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                    } else {
                        throw error;
                    }
                } else {
                    savedItem = data;
                }

                await supabase
                    .from('shop_item_assets')
                    .delete()
                    .eq('shop_item_id', id);
            } else {
                const { data, error } = await supabase
                    .from('shop_items')
                    .insert(itemPayload)
                    .select('*')
                    .single();
                if (error) {
                    if (isMissingPaymentMethodsColumn(error) || isMissingPriceRubColumn(error) || isMissingSalesChannelColumn(error)) {
                        const legacyPayload = { ...itemPayload };
                        delete legacyPayload.payment_methods;
                        delete legacyPayload.price_rub;
                        delete legacyPayload.sales_channel;
                        const legacy = await supabase
                            .from('shop_items')
                            .insert(legacyPayload)
                            .select('*')
                            .single();
                        if (legacy.error) throw legacy.error;
                        savedItem = { ...legacy.data, payment_methods: normalizedPaymentMethods };
                    } else if (isMissingShopTables(error)) {
                        return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                    } else {
                        throw error;
                    }
                } else {
                    savedItem = data;
                }
            }

            return res.json({
                success: true,
                item: normalizeItem(savedItem)
            });
        } catch (error) {
            console.error('Ошибка сохранения P2P-оффера:', error);
            res.status(500).json({ error: 'Ошибка сохранения P2P-оффера' });
        }
    });

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
            const { error } = await supabase
                .from('shop_items')
                .update({
                    status: 'draft',
                    visibility: 'private',
                    updated_at: new Date().toISOString()
                })
                .eq('id', itemId)
                .eq('owner_id', ownerId);

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

    async function listVisibleShopItems(req, res, { channel = 'site' } = {}) {
        try {
            const sellerId = req.query.seller ? String(req.query.seller) : null;
            const itemId = req.query.item ? String(req.query.item) : null;

            let itemsQuery = supabase
                .from('shop_items')
                .select('*')
                .eq('status', 'published')
                .order('created_at', { ascending: false });

            if (itemId) {
                itemsQuery = itemsQuery
                    .eq('id', itemId)
                    .in('visibility', ['public', 'unlisted']);
            } else {
                itemsQuery = itemsQuery.eq('visibility', 'public');
                if (sellerId) {
                    itemsQuery = itemsQuery.eq('owner_id', sellerId);
                }
            }

            const { data: items, error: itemsError } = await itemsQuery;

            if (itemsError) {
                if (isMissingShopTables(itemsError)) {
                    return res.json({ items: [], support: { shop: false } });
                }
                throw itemsError;
            }

            const itemIds = (items || []).map(item => item.id);
            let assets = [];
            let purchases = [];

            if (itemIds.length > 0) {
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

                assets = assetsResp.data || [];
                purchases = purchasesResp.data || [];
                await expireStalePendingPurchases(supabase, purchases);
            }

            const assetsByItem = new Map();
            for (const asset of assets) {
                const bucket = assetsByItem.get(asset.shop_item_id) || [];
                bucket.push({
                    asset_type: asset.asset_type,
                    asset_id: asset.asset_id,
                    label: asset.label || ''
                });
                assetsByItem.set(asset.shop_item_id, bucket);
            }

            const reservationByItem = new Map();
            for (const purchase of purchases) {
                const sourceItem = (items || []).find(item => String(item.id) === String(purchase.shop_item_id));
                if (isTextServiceItem(sourceItem)) continue;
                if (purchase.status !== 'pending' || isPendingPurchaseExpired(purchase)) continue;
                if (!reservationByItem.has(purchase.shop_item_id)) {
                    reservationByItem.set(purchase.shop_item_id, {
                        buyer_owner_id: purchase.buyer_owner_id,
                        expires_at: getPendingPurchaseExpiry(purchase.created_at).toISOString()
                    });
                }
            }

            const publicItems = (items || []).filter((item) => isVisibleInSalesChannel(item, channel));

            const visibleItems = publicItems.filter((item) => {
                if (isTextServiceItem(item)) return true;
                return !reservationByItem.has(item.id);
            });

            const resolvedSellerId = sellerId || (visibleItems[0]?.owner_id ? String(visibleItems[0].owner_id) : null);
            let sellerProfile = null;
            let sellerStats = null;
            let sellerCards = [];

            const sellerOwnerIds = Array.from(new Set(visibleItems.map(item => item.owner_id).filter(Boolean).map(String)));
            let paymentSettingsByOwnerId = new Map();

            if (sellerOwnerIds.length) {
                const [{ data: sellerProfiles }, { data: paymentSettings }] = await Promise.all([
                    supabase
                        .from('profiles')
                        .select('id, full_name, role')
                        .in('id', sellerOwnerIds),
                    supabase
                        .from('payment_settings')
                        .select('owner_id, ton_wallet, sbp_phone')
                        .in('owner_id', sellerOwnerIds)
                ]);

                const profileByOwnerId = new Map((sellerProfiles || []).map(profile => [String(profile.id), profile]));
                paymentSettingsByOwnerId = new Map((paymentSettings || []).map((row) => [String(row.owner_id), row]));
                const sellerBuckets = new Map();

                for (const item of visibleItems) {
                    if (!item.owner_id) continue;
                    const ownerKey = String(item.owner_id);
                    const bucket = sellerBuckets.get(ownerKey) || {
                        owner_id: ownerKey,
                        total: 0,
                        bundles: 0,
                        text_offers: 0,
                        reserved: 0
                    };

                    bucket.total += 1;
                    if (item.item_type === 'bundle') bucket.bundles += 1;
                    if (item.item_type === 'text_offer') bucket.text_offers += 1;
                    sellerBuckets.set(ownerKey, bucket);
                }

                sellerCards = Array.from(sellerBuckets.values())
                    .sort((left, right) => right.total - left.total)
                    .slice(0, 3)
                    .map(bucket => {
                        const profile = profileByOwnerId.get(bucket.owner_id);
                        const sellerName = profile?.full_name?.trim() || `Продавец ${bucket.owner_id.slice(0, 8)}`;
                        return {
                            owner_id: bucket.owner_id,
                            seller_name: sellerName,
                            seller_mode: profile?.role === 'admin' ? 'asset_marketplace' : 'text_service',
                            total: bucket.total,
                            bundles: bucket.bundles,
                            text_offers: bucket.text_offers,
                            reserved: bucket.reserved
                        };
                    });
            }

            if (resolvedSellerId) {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .eq('id', resolvedSellerId)
                    .maybeSingle();

                sellerProfile = {
                    id: resolvedSellerId,
                    name: profile?.full_name || `Продавец ${String(resolvedSellerId).slice(0, 8)}`,
                    mode: profile?.role === 'admin' ? 'asset_marketplace' : 'text_service'
                };

                sellerStats = {
                    total_items: visibleItems.length,
                    bundles: visibleItems.filter(item => item.item_type === 'bundle').length,
                    reserved: Array.from(reservationByItem.keys()).length,
                    proxies: visibleItems.filter(item => item.item_type === 'proxy').length,
                    userbots: visibleItems.filter(item => item.item_type === 'userbot').length,
                    customer_bases: visibleItems.filter(item => item.item_type === 'customer_base_asset').length,
                    text_offers: visibleItems.filter(item => item.item_type === 'text_offer').length
                };
            }

            res.json({
                items: visibleItems.map(item => ({
                    ...normalizeItem(item),
                    assets: assetsByItem.get(item.id) || [],
                    available_payment_methods: buildAvailablePaymentMethods(item, paymentSettingsByOwnerId.get(String(item.owner_id))),
                    active_reservation: reservationByItem.get(item.id) || null
                })),
                seller_cards: sellerCards,
                seller_id: resolvedSellerId,
                seller_profile: sellerProfile,
                seller_stats: sellerStats,
                focused_item_id: itemId,
                support: {
                    shop: true
                }
            });
        } catch (error) {
            console.error('Ошибка публичной витрины shop:', error);
            res.status(500).json({ error: 'Ошибка загрузки витрины' });
        }
    }

    router.get('/public/items', async (req, res) => {
        return listVisibleShopItems(req, res, { channel: 'site' });
    });

    router.get('/app/items', authenticateUser, async (req, res) => {
        return listVisibleShopItems(req, res, { channel: 'app' });
    });

    router.get('/public/my-purchases', authenticateUser, async (req, res) => {
        const buyerOwnerId = req.user.id;

        try {
            const { data: purchases, error } = await supabase
                .from('shop_purchases')
                .select('*, shop_items(id, title, description, post_purchase_message, item_type, price_ton, price_rub, preview_text, payment_methods)')
                .eq('buyer_owner_id', buyerOwnerId)
                .order('created_at', { ascending: false });

            if (error) {
                if (isMissingShopTables(error)) {
                    return res.json({ purchases: [], support: { shop: false } });
                }
                throw error;
            }

            const itemIds = (purchases || [])
                .map(row => row.shop_items?.id)
                .filter(Boolean);

            let assetRows = [];
            if (itemIds.length > 0) {
                const { data, error: assetsError } = await supabase
                    .from('shop_item_assets')
                    .select('shop_item_id, asset_type, asset_id, label')
                    .in('shop_item_id', itemIds)
                    .order('sort_order', { ascending: true });

                if (assetsError) throw assetsError;
                assetRows = data || [];
            }

            const assetsByItem = new Map();
            for (const asset of assetRows) {
                const bucket = assetsByItem.get(asset.shop_item_id) || [];
                bucket.push({
                    asset_type: asset.asset_type,
                    asset_id: asset.asset_id,
                    label: asset.label || ''
                });
                assetsByItem.set(asset.shop_item_id, bucket);
            }

            const normalizedPurchases = await Promise.all((purchases || []).map(async row => {
                const tonUri = row.status === 'pending' && row.payload?.seller_wallet && row.payload?.memo
                    ? buildTonUri(row.payload.seller_wallet, row.amount_ton, row.payload.memo)
                    : null;
                const trustWalletUri = row.status === 'pending' && row.payload?.seller_wallet && row.payload?.memo
                    ? buildTrustWalletTonUri(row.payload.seller_wallet, row.amount_ton, row.payload.memo)
                    : null;
                const trustWalletQr = trustWalletUri ? await QRCode.toDataURL(trustWalletUri, {
                    errorCorrectionLevel: 'H',
                    margin: 2,
                    width: 360
                }) : null;
                const tonQr = tonUri ? await QRCode.toDataURL(tonUri, {
                    errorCorrectionLevel: 'H',
                    margin: 2,
                    width: 360
                }) : null;

                return {
                    id: row.id,
                    status: row.status === 'pending' && isPendingPurchaseExpired(row) ? 'expired' : row.status,
                    amount_ton: Number(row.amount_ton || 0),
                    amount_rub: Number(row.payload?.amount_rub || row.shop_items?.price_rub || 0),
                    ownership_transfer_status: row.ownership_transfer_status || 'pending',
                    ownership_transfer_error: row.ownership_transfer_error || null,
                    created_at: row.created_at,
                    expires_at: row.status === 'pending' ? getPendingPurchaseExpiry(row.created_at).toISOString() : null,
                    payload: {
                        ...(row.payload || {}),
                        ton_uri: tonUri,
                        trust_wallet_uri: trustWalletUri,
                        trust_wallet_qr: trustWalletQr,
                        ton_qr: tonQr
                    },
                    item: row.shop_items
                        ? {
                            id: row.shop_items.id,
                            title: row.shop_items.title,
                            description: row.shop_items.description || '',
                            post_purchase_message: row.shop_items.post_purchase_message || '',
                            item_type: row.shop_items.item_type,
                            price_ton: Number(row.shop_items.price_ton || 0),
                            price_rub: Number(row.shop_items.price_rub || 0),
                            preview_text: row.shop_items.preview_text || '',
                            payment_methods: normalizePaymentMethods(row.shop_items.payment_methods)
                        }
                        : null,
                    assets: row.shop_items?.id ? (assetsByItem.get(row.shop_items.id) || []) : []
                };
            }));

            res.json({
                purchases: normalizedPurchases,
                support: {
                    shop: true
                }
            });
        } catch (error) {
            console.error('Ошибка загрузки моих покупок shop:', error);
            res.status(500).json({ error: 'Ошибка загрузки покупок' });
        }
    });

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
                settings,
                amountTon,
                amountRub,
                memo
            } = await createOrRefreshBuyerPurchase({
                supabase,
                buyerOwnerId,
                itemId: item_id,
                paymentMethod
            });

            const tonData = paymentMethod === 'ton'
                ? await buildTonQrDataUrl(settings.ton_wallet, amountTon, memo)
                : { tonUri: null, qrCode: null };
            const trustWalletData = paymentMethod === 'ton' && settings?.ton_wallet
                ? await buildTrustWalletQrDataUrl(settings.ton_wallet, amountTon, memo)
                : { trustWalletUri: null, qrCode: null };

            res.json({
                success: true,
                purchase_id: purchase.id,
                amount_ton: amountTon,
                amount_rub: paymentMethod === 'p2p' ? amountRub : null,
                payment_url: null,
                provider_invoice_id: null,
                payment_method: paymentMethod,
                seller_wallet: settings?.ton_wallet || null,
                sbp_phone: settings?.sbp_phone || null,
                sbp_bank: settings?.sbp_bank || null,
                sbp_fio: settings?.sbp_fio || null,
                memo,
                ton_uri: tonData.tonUri,
                trust_wallet_uri: trustWalletData.trustWalletUri,
                trust_wallet_qr: trustWalletData.qrCode,
                ton_qr: tonData.qrCode,
                item_type: item.item_type,
                expires_at: getPendingPurchaseExpiry(purchase.created_at).toISOString()
            });
        } catch (error) {
            console.error('Ошибка создания shop purchase:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Ошибка создания покупки' });
        }
    });

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
            const totalRub = created.reduce((sum, row) => sum + Number(row.amountRub || 0), 0);

            const tonData = paymentMethod === 'ton'
                ? await buildTonQrDataUrl(first.settings.ton_wallet, totalTon, memo)
                : { tonUri: null, qrCode: null };
            const trustWalletData = paymentMethod === 'ton' && first.settings?.ton_wallet
                ? await buildTrustWalletQrDataUrl(first.settings.ton_wallet, totalTon, memo)
                : { trustWalletUri: null, qrCode: null };
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
                amount_rub: paymentMethod === 'p2p' ? totalRub : null,
                payment_url: null,
                provider_invoice_id: null,
                payment_method: paymentMethod,
                seller_wallet: first.settings?.ton_wallet || null,
                sbp_phone: first.settings?.sbp_phone || null,
                sbp_bank: first.settings?.sbp_bank || null,
                sbp_fio: first.settings?.sbp_fio || null,
                memo,
                ton_uri: tonData.tonUri,
                trust_wallet_uri: trustWalletData.trustWalletUri,
                trust_wallet_qr: trustWalletData.qrCode,
                ton_qr: tonData.qrCode,
                item_type: 'proxy_batch',
                expires_at: expiresAt ? new Date(expiresAt).toISOString() : null
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

    router.post('/public/purchase/mark-paid', authenticateUser, receiptUpload.single('receipt_file'), async (req, res) => {
        const buyerOwnerId = req.user.id;
        const { purchase_id, receipt_note } = req.body;

        if (!purchase_id) {
            if (req.file?.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
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

            if (normalizePaymentMethod(purchase.payload?.payment_method) !== 'p2p') {
                return res.status(400).json({ error: 'Этот счет не относится к P2P-оплате' });
            }

            if (purchase.status !== 'pending') {
                return res.status(400).json({ error: 'Этот счет уже переведен в другой статус' });
            }

            if (isPendingPurchaseExpired(purchase)) {
                await supabase
                    .from('shop_purchases')
                    .update({ status: 'expired', updated_at: new Date().toISOString() })
                    .eq('id', purchase.id);
                return res.status(400).json({ error: 'Время на оплату истекло. Создай покупку заново.' });
            }

            const initialPayload = {
                ...(purchase.payload || {}),
                receipt_note: String(receipt_note || '').trim() || null,
                receipt_marked_at: new Date().toISOString(),
                receipt_file_name: req.file?.originalname || null,
                receipt_file_url: req.file ? `/uploads/shop-receipts/${path.basename(req.file.path)}` : (purchase.payload?.receipt_file_url || null)
            };

            // Call processPdfAutoConfirmation to parse PDF and try to match with bank webhook events
            const autoConfirmResult = await processPdfAutoConfirmation(supabase, {
                purchases: [purchase],
                file: req.file,
                sellerOwnerId: purchase.seller_owner_id,
                currentPayload: initialPayload
            });

            // If auto-confirmed, tryAutoConfirm already marked status as paid and handled handoff
            if (autoConfirmResult.autoConfirmed) {
                return res.json({ success: true, status: 'paid', auto_confirmed: true });
            }

            // Otherwise, update purchase to awaiting_receipt with the parsed/initial payload
            const { error: updateError } = await supabase
                .from('shop_purchases')
                .update({
                    status: 'awaiting_receipt',
                    payload: autoConfirmResult.payload,
                    updated_at: new Date().toISOString()
                })
                .eq('id', purchase.id);
            if (updateError) throw updateError;

            res.json({ success: true, status: 'awaiting_receipt', auto_confirmed: false });
        } catch (error) {
            if (req.file?.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            console.error('Ошибка перевода P2P shop purchase в awaiting_receipt:', error);
            res.status(500).json({ error: 'Ошибка подтверждения P2P-оплаты' });
        }
    });

    router.post('/public/purchase/mark-paid-batch', authenticateUser, receiptUpload.single('receipt_file'), async (req, res) => {
        const buyerOwnerId = req.user.id;
        const purchaseIds = Array.isArray(req.body?.purchase_ids)
            ? req.body.purchase_ids.map((value) => String(value || '').trim()).filter(Boolean)
            : String(req.body?.purchase_ids || '')
                .split(',')
                .map((value) => String(value || '').trim())
                .filter(Boolean);
        const receiptNote = req.body?.receipt_note;

        if (!purchaseIds.length) {
            if (req.file?.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
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

            for (const purchase of purchases) {
                if (normalizePaymentMethod(purchase.payload?.payment_method) !== 'p2p') {
                    return res.status(400).json({ error: 'Этот счет не относится к P2P-оплате' });
                }
                if (purchase.status !== 'pending') {
                    return res.status(400).json({ error: 'Одна из покупок уже переведена в другой статус' });
                }
                if (isPendingPurchaseExpired(purchase)) {
                    await supabase
                        .from('shop_purchases')
                        .update({
                            status: 'expired',
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', purchase.id);
                    return res.status(400).json({ error: 'Одна из броней уже истекла. Создай ее заново.' });
                }
            }

            const receiptPayload = {
                ...(req.file ? {
                    receipt_file_name: req.file.originalname,
                    receipt_file_url: `/uploads/shop-receipts/${path.basename(req.file.path)}`
                } : {}),
                receipt_note: String(receiptNote || '').trim() || null,
                receipt_marked_at: new Date().toISOString()
            };

            // Call processPdfAutoConfirmation to parse PDF and try to match with bank webhook events
            const autoConfirmResult = await processPdfAutoConfirmation(supabase, {
                purchases,
                file: req.file,
                sellerOwnerId: purchases[0].seller_owner_id,
                currentPayload: receiptPayload
            });

            // If auto-confirmed, tryAutoConfirm already marked status as paid and handled handoff
            if (autoConfirmResult.autoConfirmed) {
                return res.json({ success: true, status: 'paid', auto_confirmed: true });
            }

            // Otherwise, update purchases to awaiting_receipt with the parsed/initial payload
            for (const purchase of purchases) {
                const { error: updateError } = await supabase
                    .from('shop_purchases')
                    .update({
                        status: 'awaiting_receipt',
                        payload: {
                            ...(purchase.payload || {}),
                            ...autoConfirmResult.payload
                        },
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', purchase.id)
                    .eq('buyer_owner_id', buyerOwnerId);

                if (updateError) throw updateError;
            }

            return res.json({ success: true, status: 'awaiting_receipt', auto_confirmed: false });
        } catch (error) {
            console.error('Ошибка отправки batch P2P receipt:', error);
            res.status(500).json({ error: 'Ошибка отправки общего чека' });
        }
    });

    router.post(['/admin/purchases/:id/approve', '/seller/purchases/:id/approve'], authenticateUser, async (req, res) => {
        const sellerOwnerId = req.user.id;
        const purchaseId = req.params.id;

        try {
            const { data: purchase, error: purchaseError } = await supabase
                .from('shop_purchases')
                .select('*')
                .eq('id', purchaseId)
                .eq('seller_owner_id', sellerOwnerId)
                .single();
            if (purchaseError) throw purchaseError;

            const result = await confirmShopP2pPayment(supabase, {
                sellerOwnerId,
                purchaseIds: [purchase.id],
                confirmSource: 'manual',
                allowPending: true
            });

            res.json(result);
        } catch (error) {
            console.error('Ошибка approve P2P shop purchase:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Ошибка подтверждения P2P-платежа' });
        }
    });

    router.post(['/admin/purchases/approve-batch', '/seller/purchases/approve-batch'], authenticateUser, async (req, res) => {
        const sellerOwnerId = req.user.id;
        const purchaseIds = parsePurchaseIdsInput(req.body?.purchase_ids);

        if (!purchaseIds.length) {
            return res.status(400).json({ error: 'Не передан список purchase_ids' });
        }

        try {
            const { data: purchases, error } = await supabase
                .from('shop_purchases')
                .select('*')
                .eq('seller_owner_id', sellerOwnerId)
                .in('id', purchaseIds);

            if (error) throw error;
            if ((purchases || []).length !== purchaseIds.length) {
                return res.status(404).json({ error: 'Часть продаж уже недоступна' });
            }

            ensureSingleBatchContext(purchases || []);

            const result = await confirmShopP2pPayment(supabase, {
                sellerOwnerId,
                purchaseIds,
                confirmSource: 'manual_batch',
                allowPending: true
            });

            res.json(result);
        } catch (error) {
            console.error('Ошибка batch approve P2P shop purchase:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Ошибка batch-подтверждения P2P-платежа' });
        }
    });

    router.post(['/admin/purchases/:id/reject', '/seller/purchases/:id/reject'], authenticateUser, async (req, res) => {
        const sellerOwnerId = req.user.id;
        const purchaseId = req.params.id;
        const reason = String(req.body?.reason || '').trim() || null;

        try {
            const { data: purchase, error: purchaseError } = await supabase
                .from('shop_purchases')
                .select('*')
                .eq('id', purchaseId)
                .eq('seller_owner_id', sellerOwnerId)
                .single();
            if (purchaseError) throw purchaseError;

            await rejectSellerPurchaseRecord(supabase, purchase, reason);

            res.json({ success: true, status: 'rejected' });
        } catch (error) {
            console.error('Ошибка reject P2P shop purchase:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Ошибка отклонения P2P-платежа' });
        }
    });

    router.post(['/admin/purchases/reject-batch', '/seller/purchases/reject-batch'], authenticateUser, async (req, res) => {
        const sellerOwnerId = req.user.id;
        const purchaseIds = parsePurchaseIdsInput(req.body?.purchase_ids);
        const reason = String(req.body?.reason || '').trim() || null;

        if (!purchaseIds.length) {
            return res.status(400).json({ error: 'Не передан список purchase_ids' });
        }

        try {
            const { data: purchases, error } = await supabase
                .from('shop_purchases')
                .select('*')
                .eq('seller_owner_id', sellerOwnerId)
                .in('id', purchaseIds);

            if (error) throw error;
            if ((purchases || []).length !== purchaseIds.length) {
                return res.status(404).json({ error: 'Часть продаж уже недоступна' });
            }

            ensureSingleBatchContext(purchases || []);

            for (const purchase of purchases || []) {
                await rejectSellerPurchaseRecord(supabase, purchase, reason);
            }

            res.json({ success: true, status: 'rejected' });
        } catch (error) {
            console.error('Ошибка batch reject P2P shop purchase:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Ошибка batch-отклонения P2P-платежа' });
        }
    });

    return router;
}
