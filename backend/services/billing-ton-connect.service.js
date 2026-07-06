import crypto from 'crypto';
import {
    NORMAL_PLAN,
    activateNormalForOrder,
    recordBillingEvent
} from './bullrun-billing.service.js';
import { verifyTonConnectPayment } from './ton-connect-verify.service.js';

const TON_SCALE = 9n;
const TON_RUB_RATE_DEFAULT = 200;
const ORDER_TTL_MINUTES = 60 * 24;

function envNumber(name, fallback) {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function tonToNano(tonAmount) {
    const [whole, frac = ''] = String(tonAmount).split('.');
    const fracPadded = (frac + '0'.repeat(Number(TON_SCALE))).slice(0, Number(TON_SCALE));
    return BigInt(whole || '0') * (10n ** TON_SCALE) + BigInt(fracPadded || '0');
}

function computeTonAmount(rubAmount) {
    const rate = envNumber('TON_TON_RUB_RATE', TON_RUB_RATE_DEFAULT);
    const ton = Number(rubAmount) / rate;
    return {
        ton: ton.toFixed(2),
        nano: tonToNano(ton.toFixed(Number(TON_SCALE)))
    };
}

function generateTierMemo() {
    const suffix = crypto.randomBytes(5).toString('hex');
    return `tier_${suffix}`;
}

function detectNetwork() {
    const base = String(process.env.TONCONNECT_TONAPI_BASE || '').toLowerCase();
    if (base.includes('testnet')) return 'testnet';
    return 'mainnet';
}

function addMinutes(date, minutes) {
    return new Date(date.getTime() + Number(minutes) * 60_000).toISOString();
}

export async function createTonConnectOrder(supabase, ownerId) {
    const merchantWallet = String(process.env.PLATFORM_TON_WALLET || '').trim();
    if (!merchantWallet) {
        const error = new Error('PLATFORM_TON_WALLET не настроен');
        error.statusCode = 503;
        throw error;
    }

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('product_tier')
        .eq('id', ownerId)
        .maybeSingle();

    if (profileError) throw profileError;
    if (String(profile?.product_tier || 'trial').toLowerCase() === 'pro') {
        const error = new Error('Тариф Pro активен — обновление недоступно');
        error.statusCode = 409;
        throw error;
    }

    const memo = generateTierMemo();
    const { ton, nano } = computeTonAmount(NORMAL_PLAN.amountRub);
    const expiresAt = addMinutes(new Date(), ORDER_TTL_MINUTES);

    const { data: order, error: insertError } = await supabase
        .from('billing_orders')
        .insert({
            owner_id: ownerId,
            plan_code: NORMAL_PLAN.code,
            status: 'pending',
            amount_rub: NORMAL_PLAN.amountRub,
            currency: 'RUB',
            duration_days: NORMAL_PLAN.durationDays,
            provider: 'ton_connect',
            provider_invoice_id: memo,
            expires_at: expiresAt,
            payload: {
                merchant_wallet: merchantWallet,
                memo,
                expected_nanoton: nano.toString(),
                ton_amount: ton,
                sender_wallet: null
            }
        })
        .select('*')
        .single();

    if (insertError) throw insertError;

    await recordBillingEvent(supabase, {
        billing_order_id: order.id,
        owner_id: ownerId,
        event_type: 'ton_connect_order_created',
        provider: 'ton_connect',
        amount_rub: NORMAL_PLAN.amountRub,
        payload: { memo, ton_amount: ton, merchant_wallet: merchantWallet }
    });

    return {
        success: true,
        order_id: order.id,
        memo,
        merchant_wallet: merchantWallet,
        amount_ton: ton,
        amount_nanoton: nano.toString(),
        amount_rub: NORMAL_PLAN.amountRub,
        duration_days: NORMAL_PLAN.durationDays,
        expires_at: expiresAt,
        network: detectNetwork()
    };
}

export async function getTonConnectOrder(supabase, orderId, ownerId) {
    const { data: order, error } = await supabase
        .from('billing_orders')
        .select('*')
        .eq('id', orderId)
        .eq('owner_id', ownerId)
        .maybeSingle();

    if (error) throw error;
    return order || null;
}

export async function verifyAndActivateTonConnectOrder(supabase, orderId, senderWallet, ownerId) {
    const order = await getTonConnectOrder(supabase, orderId, ownerId);
    if (!order) {
        const error = new Error('Заказ не найден');
        error.statusCode = 404;
        throw error;
    }

    if (order.status === 'paid') {
        return { success: true, status: 'paid', already: true };
    }
    if (order.status === 'expired' || (order.expires_at && new Date(order.expires_at) < new Date())) {
        const error = new Error('Заказ просрочен');
        error.statusCode = 410;
        throw error;
    }

    const payload = order.payload || {};
    const merchantWallet = payload.merchant_wallet || process.env.PLATFORM_TON_WALLET;
    const memo = payload.memo || order.provider_invoice_id;
    const expectedNano = payload.expected_nanoton;

    if (!merchantWallet || !memo || !expectedNano) {
        const error = new Error('Некорректные данные заказа');
        error.statusCode = 500;
        throw error;
    }

    const result = await verifyTonConnectPayment({
        merchantWallet,
        memo,
        expectedNanoTon: expectedNano,
        senderWallet
    });

    if (!result.ok) {
        return { success: false, status: 'pending', retry: true, attempt: result.attempt };
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
        .from('billing_orders')
        .update({
            status: 'paid',
            paid_at: nowIso,
            updated_at: nowIso,
            provider_payment_id: result.txHash || null,
            payload: {
                ...payload,
                sender_wallet: result.matchedSender || senderWallet || null,
                matched_amount_nanoton: result.matchedAmountNano || null,
                tx_hash: result.txHash || null,
                verified_at: nowIso
            }
        })
        .eq('id', orderId)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
        // Race: another worker processed it. Treat as success since it's paid.
        return { success: true, status: 'paid', already: true };
    }

    await recordBillingEvent(supabase, {
        billing_order_id: updated.id,
        owner_id: updated.owner_id,
        event_type: 'ton_connect_payment_verified',
        provider: 'ton_connect',
        amount_rub: Number(updated.amount_rub || 0),
        payload: {
            memo,
            tx_hash: result.txHash || null,
            sender_wallet: result.matchedSender || senderWallet || null,
            matched_amount_nanoton: result.matchedAmountNano || null
        }
    });

    const profile = await activateNormalForOrder(supabase, updated);

    return { success: true, status: 'paid', profile };
}
