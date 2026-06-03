import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import {
    createNormalCheckoutOrder,
    getCurrentBillingState,
    handleRobokassaResult,
    loadOrderByProviderInvoice,
    recordBillingEvent
} from '../services/bullrun-billing.service.js';
import { collectRobokassaParams } from '../services/robokassa.service.js';
import {
    handleShopRobokassaResult,
    loadShopPurchasesByRobokassaInvoice
} from './shop.routes.js';

function statusFor(error) {
    return Number(error?.statusCode || error?.status || 500);
}

function publicAppOrigin() {
    return String(process.env.PUBLIC_APP_ORIGIN || 'https://bullrun.ru').replace(/\/$/, '');
}

function redirect(res, path, params = {}) {
    const url = new URL(path, publicAppOrigin());
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    }
    return res.redirect(302, url.toString());
}

export default function billingRoutes(supabase) {
    const router = express.Router();
    const robokassaParser = express.urlencoded({ extended: false });

    router.get('/orders/current', authenticateUser, async (req, res) => {
        try {
            const state = await getCurrentBillingState(supabase, req.user.id);
            res.json({ success: true, ...state });
        } catch (error) {
            console.error('[Billing] current state error:', error);
            res.status(statusFor(error)).json({ error: error.message || 'Не удалось загрузить billing.' });
        }
    });

    router.post('/checkout/normal', authenticateUser, async (req, res) => {
        try {
            const checkout = await createNormalCheckoutOrder(supabase, req.user.id);
            res.json({ success: true, ...checkout });
        } catch (error) {
            console.error('[Billing] normal checkout error:', error);
            res.status(statusFor(error)).json({ error: error.message || 'Не удалось создать счет Normal.' });
        }
    });

    router.all('/robokassa/result', robokassaParser, async (req, res) => {
        const params = collectRobokassaParams(req);
        try {
            let result;
            try {
                result = await handleRobokassaResult(supabase, params);
            } catch (error) {
                if (Number(error?.statusCode || error?.status || 500) !== 404) throw error;
                result = await handleShopRobokassaResult(supabase, params);
            }
            res.type('text/plain').send(result.responseText);
        } catch (error) {
            console.error('[Billing] Robokassa result error:', error);
            res.status(statusFor(error)).type('text/plain').send(error.message || 'Billing callback failed');
        }
    });

    router.all('/robokassa/success', robokassaParser, async (req, res) => {
        const params = collectRobokassaParams(req);
        const invoiceId = String(params.InvId ?? params.inv_id ?? '').trim();
        try {
            const order = await loadOrderByProviderInvoice(supabase, invoiceId);
            const shopPurchases = order ? [] : await loadShopPurchasesByRobokassaInvoice(supabase, invoiceId);
            await recordBillingEvent(supabase, {
                billing_order_id: order?.id || null,
                owner_id: shopPurchases[0]?.buyer_owner_id || null,
                event_type: order ? 'robokassa_success_return' : 'shop_robokassa_success_return',
                provider_invoice_id: invoiceId || null,
                amount_rub: params.OutSum ? Number(params.OutSum) : null,
                payload: params
            });
            if (!order && shopPurchases.length) {
                const hasUserbot = shopPurchases.some((purchase) => purchase.shop_items?.item_type === 'userbot' || purchase.shop_items?.item_type === 'bundle');
                redirect(res, hasUserbot ? '/app/userbots' : '/app/proxies', {
                    shop_payment: 'success',
                    inv: invoiceId || ''
                });
                return;
            }
            redirect(res, '/billing/success', {
                order: order?.id || '',
                inv: invoiceId || ''
            });
        } catch (error) {
            console.error('[Billing] Robokassa success redirect error:', error);
            redirect(res, '/billing/fail', { inv: invoiceId || '' });
        }
    });

    router.all('/robokassa/fail', robokassaParser, async (req, res) => {
        const params = collectRobokassaParams(req);
        const invoiceId = String(params.InvId ?? params.inv_id ?? '').trim();
        try {
            const order = await loadOrderByProviderInvoice(supabase, invoiceId);
            const shopPurchases = order ? [] : await loadShopPurchasesByRobokassaInvoice(supabase, invoiceId);
            await recordBillingEvent(supabase, {
                billing_order_id: order?.id || null,
                owner_id: shopPurchases[0]?.buyer_owner_id || null,
                event_type: order ? 'robokassa_fail_return' : 'shop_robokassa_fail_return',
                provider_invoice_id: invoiceId || null,
                amount_rub: params.OutSum ? Number(params.OutSum) : null,
                payload: params
            });
            if (!order && shopPurchases.length) {
                const hasUserbot = shopPurchases.some((purchase) => purchase.shop_items?.item_type === 'userbot' || purchase.shop_items?.item_type === 'bundle');
                redirect(res, hasUserbot ? '/app/userbots' : '/app/proxies', {
                    shop_payment: 'fail',
                    inv: invoiceId || ''
                });
                return;
            }
        } catch (error) {
            console.error('[Billing] Robokassa fail event error:', error);
        }
        redirect(res, '/billing/fail', { inv: invoiceId || '' });
    });

    return router;
}
