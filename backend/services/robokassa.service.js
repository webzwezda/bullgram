import crypto from 'crypto';

const ROBOKASSA_PAYMENT_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx';

function md5(value) {
    return crypto.createHash('md5').update(String(value), 'utf8').digest('hex');
}

function envFlag(name, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    return String(raw).trim().toLowerCase() === 'true';
}

export function formatRobokassaAmount(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '0.00';
    return number.toFixed(2);
}

export function getRobokassaConfig() {
    const merchantLogin = String(process.env.ROBOKASSA_MERCHANT_LOGIN || '').trim();
    const password1 = String(process.env.ROBOKASSA_PASSWORD_1 || '').trim();
    const password2 = String(process.env.ROBOKASSA_PASSWORD_2 || '').trim();

    return {
        enabled: envFlag('ROBOKASSA_ENABLED', false),
        testMode: envFlag('ROBOKASSA_TEST_MODE', true),
        merchantLogin,
        password1,
        password2,
        configured: Boolean(merchantLogin && password1 && password2)
    };
}

function encodeReceipt(receipt) {
    if (!receipt) return '';
    return encodeURIComponent(JSON.stringify(receipt));
}

function receiptAmount(value) {
    return Number(formatRobokassaAmount(value));
}

export function buildRobokassaReceipt({ order, itemName, paymentMethod = 'full_payment', paymentObject = 'service' }) {
    const name = String(itemName || 'BullRun Normal access').replace(/[^\p{L}\p{N}\s._-]/gu, '').trim().slice(0, 128);
    const sum = receiptAmount(order.amount_rub);
    return {
        items: [
            {
                name: name || 'BullRun Normal access',
                quantity: 1,
                sum,
                cost: sum,
                payment_method: paymentMethod,
                payment_object: paymentObject,
                tax: 'none'
            }
        ]
    };
}

export function buildRobokassaPaymentUrl({ order, description }) {
    const config = getRobokassaConfig();
    if (!config.enabled || !config.configured) {
        const error = new Error('Robokassa еще не настроена.');
        error.statusCode = 503;
        throw error;
    }

    const outSum = formatRobokassaAmount(order.amount_rub);
    const invId = String(order.provider_invoice_id);
    const receipt = buildRobokassaReceipt({
        order,
        itemName: description
    });
    const encodedReceipt = encodeReceipt(receipt);
    const signature = md5(`${config.merchantLogin}:${outSum}:${invId}:${encodedReceipt}:${config.password1}`);
    const params = new URLSearchParams({
        MerchantLogin: config.merchantLogin,
        OutSum: outSum,
        InvId: invId,
        Description: description,
        SignatureValue: signature,
        Receipt: encodedReceipt,
        Culture: 'ru',
        Encoding: 'utf-8'
    });

    if (config.testMode) {
        params.set('IsTest', '1');
    }

    return `${ROBOKASSA_PAYMENT_URL}?${params.toString()}`;
}

export function collectRobokassaParams(req) {
    return {
        ...(req.query || {}),
        ...(req.body || {})
    };
}

export function verifyRobokassaCallback(params, password) {
    const outSum = String(params.OutSum ?? params.out_sum ?? '').trim();
    const invId = String(params.InvId ?? params.inv_id ?? '').trim();
    const received = String(params.SignatureValue ?? params.signature_value ?? '').trim().toLowerCase();
    if (!outSum || !invId || !received || !password) return false;

    const expected = md5(`${outSum}:${invId}:${password}`).toLowerCase();
    return expected === received;
}
