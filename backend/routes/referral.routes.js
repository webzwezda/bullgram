import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import {
    getReferralEconomics,
    loadReferralReserveState
} from '../services/referral-reserve.service.js';
import { OfficialBotService } from '../services/official-bot.service.js';
import { sendReferralPayoutRequest } from '../services/referral-payout-sender.service.js';
import { sendReferralReserveRefund } from '../services/referral-refund-sender.service.js';
import { registerOverviewRoute } from './referral/overview.js';
import {
    cancelReserveRefund,
    markReserveRefundSent,
    requestReserveRefund,
    updateReferralPayoutRequestStatus
} from './referral/reserve-refunds.js';
import { markReferralPayout } from './referral/payout-ops.js';

export default function referralRoutes(supabase) {
    const router = express.Router();
    const officialBotService = new OfficialBotService(supabase);

    registerOverviewRoute(router, { supabase });

    router.post('/settings', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const isProjectAdmin = req.profile?.role === 'admin';
        const {
            referral_enabled,
            referral_reward_percent,
            referral_welcome_text,
            referral_client_discount_percent
        } = req.body;

        try {
            const reserve = await loadReferralReserveState(supabase, ownerId, { ensure: true });
            if (referral_enabled && !reserve.canEnableReferrals && !isProjectAdmin) {
                return res.status(400).json({
                    error: reserve.reason || 'Сначала пополни партнерский резерв, потом включай партнерку.',
                    reserve
                });
            }

            const economics = getReferralEconomics();
            let { error } = await supabase
                .from('payment_settings')
                .upsert({
                    owner_id: ownerId,
                    referral_enabled: !!referral_enabled,
                    referral_reward_percent: Number(referral_reward_percent || 0),
                    referral_client_discount_percent: Number(referral_client_discount_percent || economics.clientDiscountPercent),
                    referral_welcome_text: referral_welcome_text || null
                }, { onConflict: 'owner_id' });

            if (error && (error.message || '').includes('referral_')) {
                return res.status(400).json({ error: 'Сначала примени SQL для рефералки, потом уже настраивай этот экран.' });
            }

            if (error) throw error;
            res.json({ success: true });
        } catch (error) {
            console.error('Ошибка сохранения referral settings:', error);
            res.status(500).json({ error: 'Ошибка сохранения настроек рефералки' });
        }
    });

    router.post('/reserve/refund-request', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const { note, refund_wallet } = req.body || {};

        try {
            const result = await requestReserveRefund(supabase, officialBotService, ownerId, note, refund_wallet);
            if (result.error) {
                return res.status(result.status || 400).json({ error: result.error });
            }
            res.json(result);
        } catch (error) {
            console.error('Ошибка запроса возврата referral reserve:', error);
            res.status(500).json({ error: 'Ошибка запроса возврата резерва' });
        }
    });

    router.post('/reserve/refund-cancel', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const { note } = req.body || {};

        try {
            const result = await cancelReserveRefund(supabase, ownerId, note);
            if (result.error) {
                return res.status(result.status || 400).json({ error: result.error });
            }
            res.json(result);
        } catch (error) {
            console.error('Ошибка отмены возврата referral reserve:', error);
            res.status(500).json({ error: 'Ошибка отмены заявки на возврат' });
        }
    });

    router.post('/reserve/refund-send-auto', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;

        try {
            const result = await sendReferralReserveRefund(supabase, ownerId, { requestedBy: 'admin' });
            if (result.error) {
                return res.status(result.status || 400).json({ error: result.error });
            }
            res.json(result);
        } catch (error) {
            console.error('Ошибка автоматического возврата referral reserve:', error);
            const message = String(error?.message || '');
            if (message.includes('TON provider rate limit')) {
                return res.status(429).json({
                    error: 'TON-провайдер временно ограничил запросы. Деньги не ушли, заявка сохранена. Повтори отправку через минуту.'
                });
            }
            res.status(500).json({ error: 'Не получилось автоматически отправить возврат. Деньги не ушли, заявка сохранена. Можно повторить отправку.' });
        }
    });

    router.post('/reserve/refund-sent', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const { amount_ton, chain_tx_hash, note } = req.body || {};

        try {
            const result = await markReserveRefundSent(supabase, officialBotService, ownerId, amount_ton, chain_tx_hash, note);
            if (result.error) {
                return res.status(result.status || 400).json({ error: result.error });
            }
            res.json(result);
        } catch (error) {
            console.error('Ошибка закрытия возврата referral reserve:', error);
            res.status(500).json({ error: 'Ошибка отметки возврата резерва' });
        }
    });

    router.post('/payout', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const { tg_user_id, currency, amount, note, payout_request_id, chain_tx_hash, network_fee_ton } = req.body;

        try {
            const result = await markReferralPayout(supabase, officialBotService, ownerId, tg_user_id, currency, amount, note, payout_request_id, {
                chain_tx_hash,
                network_fee_ton
            });
            if (result.error) {
                return res.status(result.status || 400).json({ error: result.error });
            }
            res.json(result);
        } catch (error) {
            console.error('Ошибка payout по рефералке:', error);
            res.status(500).json({ error: 'Ошибка отметки выплаты партнеру' });
        }
    });

    router.post('/payout-request-status', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const { payout_request_id, status, note, chain_tx_hash, network_fee_ton } = req.body;

        if (chain_tx_hash || network_fee_ton !== undefined) {
            return res.status(400).json({
                error: 'chain_tx_hash и network_fee_ton пишутся только через ручную отметку выплаты, не через смену статуса.'
            });
        }

        try {
            const result = await updateReferralPayoutRequestStatus(supabase, officialBotService, ownerId, payout_request_id, status, note);
            if (result.error) {
                return res.status(result.status || 400).json({ error: result.error });
            }
            res.json(result);
        } catch (error) {
            console.error('Ошибка статуса referral payout request:', error);
            res.status(500).json({ error: 'Ошибка обновления статуса заявки на выплату' });
        }
    });

    router.post('/payout-request-send', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const { payout_request_id } = req.body;

        try {
            const result = await sendReferralPayoutRequest(supabase, ownerId, payout_request_id, {
                requestedBy: 'admin'
            });
            if (result.error) {
                return res.status(result.status || 400).json({
                    error: result.error,
                    transfer: result.transfer || null
                });
            }
            res.json(result);
        } catch (error) {
            console.error('Ошибка автоматической referral payout отправки:', error);
            res.status(500).json({
                error: 'Не получилось автоматически отправить TON. Заявка оставлена в sending для ручной сверки.'
            });
        }
    });

    router.post('/payout-batch', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const { payouts, note } = req.body;

        if (!Array.isArray(payouts) || payouts.length === 0) {
            return res.status(400).json({ error: 'Не передали список выплат' });
        }

        try {
            let updated = 0;
            const errors = [];

            for (const payout of payouts) {
                const result = await markReferralPayout(
                    supabase,
                    officialBotService,
                    ownerId,
                    payout?.tg_user_id,
                    payout?.currency,
                    payout?.amount,
                    payout?.note || note || null,
                    payout?.payout_request_id || null,
                    {
                        chain_tx_hash: payout?.chain_tx_hash,
                        network_fee_ton: payout?.network_fee_ton
                    }
                );

                if (result.error) {
                    errors.push({
                        tg_user_id: String(payout?.tg_user_id || ''),
                        currency: String(payout?.currency || '').toUpperCase(),
                        error: result.error
                    });
                    continue;
                }

                updated += 1;
            }

            res.json({
                success: true,
                requested: payouts.length,
                updated,
                errors
            });
        } catch (error) {
            console.error('Ошибка batch payout по рефералке:', error);
            res.status(500).json({ error: 'Ошибка пачечной выплаты по рефералке' });
        }
    });

    return router;
}
