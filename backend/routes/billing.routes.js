import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import {
    createNormalCheckoutOrder,
    getCurrentBillingState
} from '../services/bullrun-billing.service.js';
import {
    createTonConnectOrder,
    verifyAndActivateTonConnectOrder
} from '../services/billing-ton-connect.service.js';

function statusFor(error) {
    return Number(error?.statusCode || error?.status || 500);
}

export default function billingRoutes(supabase) {
    const router = express.Router();

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

    router.post('/checkout/ton-connect', authenticateUser, async (req, res) => {
        try {
            const checkout = await createTonConnectOrder(supabase, req.user.id);
            res.json(checkout);
        } catch (error) {
            console.error('[Billing] ton-connect checkout error:', error);
            res.status(statusFor(error)).json({ error: error.message || 'Не удалось создать счет TON Connect.' });
        }
    });

    router.post('/checkout/ton-connect/verify', authenticateUser, async (req, res) => {
        try {
            const { order_id, sender_wallet } = req.body || {};
            if (!order_id) {
                return res.status(400).json({ error: 'order_id required' });
            }
            if (!sender_wallet || typeof sender_wallet !== 'string') {
                return res.status(400).json({ error: 'sender_wallet required' });
            }

            const result = await verifyAndActivateTonConnectOrder(supabase, order_id, sender_wallet, req.user.id);

            if (result.success && result.status === 'paid') {
                res.json(result);
            } else {
                res.status(202).json(result);
            }
        } catch (error) {
            console.error('[Billing] ton-connect verify error:', error);
            res.status(statusFor(error)).json({ error: error.message || 'Не удалось подтвердить оплату.' });
        }
    });

    return router;
}
