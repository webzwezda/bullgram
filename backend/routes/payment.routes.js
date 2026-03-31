import express from 'express';
import { OfficialBotService } from '../services/official-bot.service.js';
import { authenticateUser } from '../middlewares/auth.middleware.js';

function normalizeWebhookPayload(provider, body = {}) {
    const payload = body || {};
    const status = String(
        payload.status ||
        payload.payment_status ||
        payload.state ||
        payload.result ||
        ''
    ).toLowerCase();

    const invoiceMemo = payload.memo ||
        payload.order_id ||
        payload.invoice_id ||
        payload.uuid ||
        payload.comment ||
        payload.txid ||
        null;

    return {
        provider,
        status,
        invoiceMemo: invoiceMemo ? String(invoiceMemo) : null,
        externalPaymentId: String(payload.uuid || payload.invoice_id || payload.payment_id || payload.txid || payload.hash || ''),
        amount: payload.amount || payload.value || null,
        currency: payload.currency || payload.asset || null,
        raw: payload
    };
}

function isPaidStatus(status) {
    return ['paid', 'paid_over', 'confirmed', 'success', 'succeeded', 'complete', 'completed'].includes(status);
}

export default function paymentRoutes(supabase, getBotById) {
    const router = express.Router();
    const officialBotService = new OfficialBotService(supabase);

    router.get('/health', authenticateUser, async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('payment_settings')
                .select('billing_provider, billing_mode, billing_shop_id, billing_webhook_secret')
                .eq('owner_id', req.user.id)
                .maybeSingle();

            if (error) throw error;

            res.json({
                success: true,
                settings: data || {},
                webhook_url: 'https://bullrun.ru/api/payment/webhook/generic'
            });
        } catch (error) {
            res.status(500).json({ error: 'Не удалось загрузить настройки кассы' });
        }
    });

    router.post('/test-webhook', authenticateUser, async (req, res) => {
        try {
            const { provider = 'generic' } = req.body || {};
            const { data: invoices, error: invoicesError } = await supabase
                .from('invoices')
                .select('id, tariffs(owner_id)')
                .in('status', ['pending', 'awaiting_receipt', 'wait_admin', 'paid'])
                .order('created_at', { ascending: false })
                .limit(50);

            if (invoicesError) throw invoicesError;

            const invoice = (invoices || []).find((item) => item.tariffs?.owner_id === req.user.id) || null;

            if (!invoice) {
                return res.status(400).json({ error: 'Нет счетов для теста webhook-а. Сначала создай хотя бы один invoice.' });
            }

            await supabase.from('payment_events').insert({
                owner_id: req.user.id,
                invoice_id: invoice.id,
                provider,
                event_type: 'webhook_test',
                status: 'ok',
                payload: {
                    source: 'admin_panel',
                    tested_at: new Date().toISOString()
                }
            });

            res.json({ success: true });
        } catch (error) {
            if ((error.message || '').includes('payment_events')) {
                return res.status(400).json({ error: 'Таблица payment_events еще не создана' });
            }
            res.status(500).json({ error: 'Не удалось записать тестовое webhook-событие' });
        }
    });

    router.post('/webhook/:provider', async (req, res) => {
        const provider = req.params.provider;

        try {
            const event = normalizeWebhookPayload(provider, req.body);
            if (!event.invoiceMemo) {
                return res.status(400).json({ error: 'Не найден invoice memo / order id' });
            }

            const { data: invoice, error: invoiceError } = await supabase
                .from('invoices')
                .select('*, tariffs(id, owner_id, channel_id, title)')
                .eq('memo', event.invoiceMemo)
                .maybeSingle();

            if (invoiceError) throw invoiceError;
            if (!invoice) {
                return res.status(404).json({ error: 'Счет по этому memo не найден' });
            }

            const ownerId = invoice.tariffs?.owner_id;
            if (!ownerId) {
                return res.status(400).json({ error: 'У счета не найден владелец тарифа' });
            }

            const { data: paymentSettings } = await supabase
                .from('payment_settings')
                .select('billing_provider, billing_webhook_secret')
                .eq('owner_id', ownerId)
                .single();

            const providedSecret = req.headers['x-bullrun-webhook-secret'] || req.query.secret;
            const expectedSecret = paymentSettings?.billing_webhook_secret;

            if (expectedSecret && String(providedSecret || '') !== String(expectedSecret)) {
                await supabase.from('payment_events').insert({
                    owner_id: ownerId,
                    invoice_id: invoice.id,
                    provider,
                    external_payment_id: event.externalPaymentId || null,
                    event_type: 'rejected_secret',
                    status: event.status,
                    payload: event.raw
                });

                return res.status(403).json({ error: 'Неверный webhook secret' });
            }

            await supabase.from('payment_events').insert({
                owner_id: ownerId,
                invoice_id: invoice.id,
                provider,
                external_payment_id: event.externalPaymentId || null,
                event_type: 'webhook_received',
                status: event.status,
                payload: event.raw
            });

            if (!isPaidStatus(event.status)) {
                return res.json({ success: true, ignored: true, reason: 'status_not_paid' });
            }

            if (invoice.status === 'paid') {
                return res.json({ success: true, ignored: true, reason: 'already_paid' });
            }

            const { data: primaryChannel } = await supabase
                .from('channels')
                .select('bot_id')
                .eq('id', invoice.tariffs.channel_id)
                .single();

            const bot = primaryChannel?.bot_id ? getBotById(primaryChannel.bot_id) : null;
            if (!bot) {
                return res.status(409).json({ error: 'Официальный бот для тарифа не запущен' });
            }

            await supabase
                .from('invoices')
                .update({
                    status: 'paid',
                    paid_at: new Date().toISOString()
                })
                .eq('id', invoice.id);

            await officialBotService.activateSubscription(bot, invoice);

            await supabase.from('payment_events').insert({
                owner_id: ownerId,
                invoice_id: invoice.id,
                provider,
                external_payment_id: event.externalPaymentId || null,
                event_type: 'invoice_completed',
                status: event.status,
                payload: {
                    amount: event.amount,
                    currency: event.currency
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Ошибка webhook кассы:', error);
            res.status(500).json({ error: 'Ошибка обработки webhook' });
        }
    });

    return router;
}
