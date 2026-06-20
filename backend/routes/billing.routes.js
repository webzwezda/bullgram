import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import {
    createNormalCheckoutOrder,
    getCurrentBillingState
} from '../services/bullrun-billing.service.js';

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

    return router;
}
