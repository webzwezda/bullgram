import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import QRCode from 'qrcode';
import multer from 'multer';
import { toNano } from '@ton/core';
import { tonToNanoString } from '../../utils/ton.js';

const SHOP_PENDING_PURCHASE_TTL_MINUTES = Number(process.env.SHOP_PENDING_PURCHASE_TTL_MINUTES || 30);
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
        status: row.status || 'draft',
        visibility: row.visibility || 'public',
        sales_channel: normalizeSalesChannel(row?.sales_channel, row?.item_type),
        preview_text: row.preview_text || '',
        payment_methods: normalizePaymentMethods(row?.payment_methods),
        offer_code: normalizeOfferCode(row.offer_code) || inferOfferCodeFromLegacyItem(row),
        transfer_mode: row.transfer_mode || 'ownership_transfer',
        delivery_mode: row.delivery_mode || null,
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

// Все продажи сайта (лоты shop) принимаются на кошелёк платформы.
// payment_settings.ton_wallet остаётся только для счетов /app/sales-bot.
function siteWallet() {
    return String(process.env.PLATFORM_TON_WALLET || '').trim();
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
        .filter((item) => item === 'ton')));

    return methods.length ? methods : ['ton'];
}

function buildAvailablePaymentMethods(item) {
    const allowed = normalizePaymentMethods(item?.payment_methods);
    const methods = allowed.filter((method) => {
        if (method === 'ton') return !!siteWallet();
        return false;
    });

    return Array.from(new Set(methods));
}

function isMissingPaymentMethodsColumn(error) {
    const message = error?.message || '';
    return message.includes('payment_methods');
}

function isMissingSalesChannelColumn(error) {
    const message = error?.message || '';
    return message.includes('sales_channel');
}

function isMissingDeliveryModeColumn(error) {
    const message = error?.message || '';
    return message.includes('delivery_mode');
}

function buildShopMemo() {
    return 'shop_' + crypto.randomBytes(5).toString('hex');
}

function detectNetwork() {
    const base = String(process.env.TONCONNECT_TONAPI_BASE || '').toLowerCase();
    if (base.includes('testnet')) return 'testnet';
    return 'mainnet';
}

function buildTonUri(wallet, amountTon, memo) {
    // tonToNanoString через BigInt: Number * 1e9 даёт дробные нанотонины
    // (1.1 TON -> 1100000000.0000001) и ломает URI/QR для кошельков.
    return `ton://transfer/${wallet}?amount=${tonToNanoString(amountTon)}&text=${encodeURIComponent(memo)}`;
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
    return 'ton';
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

// Ссылки/QR для ручной оплаты (без TonConnect) — отдаются сразу при создании
// покупки, чтобы фронт мог показать полный чекаут без повторного запроса.
async function buildManualPaymentLinks(wallet, amountTon, memo) {
    if (!wallet || !memo) return {};
    const [ton, trust] = await Promise.all([
        buildTonQrDataUrl(wallet, amountTon, memo),
        buildTrustWalletQrDataUrl(wallet, amountTon, memo)
    ]);
    return {
        ton_uri: ton.tonUri,
        ton_qr: ton.qrCode,
        trust_wallet_uri: trust.trustWalletUri,
        trust_wallet_qr: trust.qrCode
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
        .in('id', staleIds)
        // CAS: между селектом и апдейтом покупка могла стать paid — не гасим её.
        .eq('status', 'pending');

    if (error) throw error;
    return staleIds;
}

async function checkShopTonPayment({ memo, expectedAmountTon, wallet, senderWallet = null }) {
    if (!wallet || !memo) return false;
    try {
        const expectedNano = toNano(String(expectedAmountTon)).toString();
        const result = await verifyPaymentOnce({
            merchantWallet: wallet,
            memo,
            expectedNanoTon: expectedNano,
            senderWallet
        });
        return Boolean(result.ok);
    } catch (error) {
        console.error('Ошибка проверки TON shop-платежа:', error.message);
        return false;
    }
}

export {
    isAdminSeller,
    isTextServiceItem,
    isMissingShopTables,
    normalizeOfferCode,
    inferOfferCodeFromLegacyItem,
    normalizeItem,
    defaultSalesChannelForItemType,
    normalizeSalesChannel,
    siteWallet,
    normalizePaymentMethods,
    buildAvailablePaymentMethods,
    isMissingPaymentMethodsColumn,
    isMissingSalesChannelColumn,
    isMissingDeliveryModeColumn,
    buildShopMemo,
    detectNetwork,
    buildTonUri,
    buildTrustWalletTonUri,
    normalizePaymentMethod,
    isVisibleInSalesChannel,
    buildTonQrDataUrl,
    buildTrustWalletQrDataUrl,
    buildManualPaymentLinks,
    getPendingPurchaseExpiry,
    isPendingPurchaseExpired,
    expireStalePendingPurchases,
    checkShopTonPayment
};
