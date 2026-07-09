import express from 'express';
import { OfficialBotService } from '../services/official-bot.service.js';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { rateLimit } from '../middlewares/rate-limit.middleware.js';
import { verifyTonConnectPayment } from '../services/ton-connect-verify.service.js';

const publicAppOrigin = String(process.env.PUBLIC_APP_ORIGIN || 'https://bullgram.xyz').replace(/\/$/, '');

const TON_NANO = 1_000_000_000n;

function tonToNano(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0n;
    return BigInt(Math.round(numeric * Number(TON_NANO)));
}

function getManifestUrl() {
    const siteUrl = String(process.env.PUBLIC_SITE_URL || publicAppOrigin).replace(/\/$/, '');
    return `${siteUrl}/api/tonconnect/tonconnect-manifest.json`;
}

function getNetwork() {
    const base = String(process.env.TONCONNECT_TONAPI_BASE || 'https://tonapi.io').toLowerCase();
    return base.includes('testnet') ? 'testnet' : 'mainnet';
}

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
                webhook_url: `${publicAppOrigin}/api/payment/webhook/generic`
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
                .select('*, tariffs(id, owner_id, channel_id, bot_id, title)')
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

            const tariffBotId = invoice.tariffs.bot_id || null;
            let bot = tariffBotId ? getBotById(tariffBotId) : null;

            if (!bot) {
                const { data: primaryChannel } = await supabase
                    .from('channels')
                    .select('bot_id')
                    .eq('id', invoice.tariffs.channel_id)
                    .single();

                bot = primaryChannel?.bot_id ? getBotById(primaryChannel.bot_id) : null;
            }
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

    // ===== Public endpoints for the TON Connect WebApp (no auth) =====
    // WebApp reads network + manifest URL so it doesn't hardcode testnet/mainnet.
    router.get('/public/config', (_req, res) => {
        res.json({
            network: getNetwork(),
            manifestUrl: getManifestUrl()
        });
    });

    // Returns the invoice payload for the WebApp.
    // Memo is only exposed while status='pending' (avoids leaking inactive memos).
    // invite_link is only returned when status='paid' so the WebApp can render the "open channel" button.
    router.get('/public/invoice/:id', async (req, res) => {
        try {
            const invoiceId = String(req.params.id || '').trim();
            if (!invoiceId) return res.status(400).json({ error: 'id required' });

            const { data: invoice, error } = await supabase
                .from('invoices')
                .select('id, amount, currency, memo, status, expires_at, tariff_id')
                .eq('id', invoiceId)
                .maybeSingle();

            if (error) throw error;
            if (!invoice) return res.status(404).json({ error: 'Счёт не найден' });

            const { data: tariff, error: tariffError } = await supabase
                .from('tariffs')
                .select('title, duration_days, owner_id')
                .eq('id', invoice.tariff_id)
                .maybeSingle();

            if (tariffError) throw tariffError;

            const { data: settings } = await supabase
                .from('payment_settings')
                .select('ton_wallet')
                .eq('owner_id', tariff?.owner_id)
                .maybeSingle();

            const status = String(invoice.status || 'pending');
            const isPending = status === 'pending';

            const payload = {
                id: invoice.id,
                amount: invoice.amount,
                currency: invoice.currency,
                status,
                seller_wallet: settings?.ton_wallet || null,
                tariff_title: tariff?.title || 'Тариф',
                duration_days: tariff?.duration_days || 0,
                expires_at: invoice.expires_at || null
            };

            if (isPending) {
                payload.memo = invoice.memo;
            }

            if (status === 'paid') {
                const { data: invite } = await supabase
                    .from('access_invites')
                    .select('invite_link, channels(title)')
                    .eq('invoice_id', invoice.id)
                    .order('issued_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (invite) {
                    payload.invite_link = invite.invite_link;
                    payload.invite_channel_title = invite.channels?.title || null;
                }
            }

            res.json(payload);
        } catch (error) {
            console.error('Public invoice error:', error);
            res.status(500).json({ error: 'Не удалось загрузить счёт' });
        }
    });

    // WebApp polls this after sending a TON Connect transaction.
    // Single-attempt verify against TonAPI; cron Phase 0 handles late confirmations.
    router.post('/public/verify-ton-connect',
        rateLimit({ windowMs: 60_000, max: 20, message: 'Слишком много запросов' }),
        async (req, res) => {
            try {
                const invoiceId = String(req.body?.invoice_id || '').trim();
                const senderWallet = String(req.body?.sender_wallet || '').trim();

                if (!invoiceId) return res.status(400).json({ error: 'invoice_id required' });

                const { data: invoice, error } = await supabase
                    .from('invoices')
                    .select('id, amount, currency, memo, status, tariff_id, expires_at')
                    .eq('id', invoiceId)
                    .maybeSingle();

                if (error) throw error;
                if (!invoice) return res.status(404).json({ error: 'Счёт не найден' });

                // Idempotent: if already paid, return current state.
                if (invoice.status === 'paid') {
                    return res.json({ status: 'paid', already_paid: true });
                }
                if (invoice.status === 'expired') {
                    return res.json({ status: 'expired' });
                }
                if (invoice.status !== 'pending') {
                    return res.json({ status: invoice.status });
                }

                const { data: tariff } = await supabase
                    .from('tariffs')
                    .select('owner_id, bot_id')
                    .eq('id', invoice.tariff_id)
                    .maybeSingle();

                const { data: settings } = await supabase
                    .from('payment_settings')
                    .select('ton_wallet')
                    .eq('owner_id', tariff?.owner_id)
                    .maybeSingle();

                if (!settings?.ton_wallet) {
                    return res.status(400).json({ error: 'У продавца не настроен TON-кошелёк' });
                }

                const expectedNano = tonToNano(invoice.amount);
                if (String(invoice.currency || '').toUpperCase() !== 'TON' || expectedNano <= 0n) {
                    return res.status(400).json({ error: 'Этот счёт нельзя оплатить через TON Connect' });
                }

                const result = await verifyTonConnectPayment({
                    merchantWallet: settings.ton_wallet,
                    memo: invoice.memo,
                    expectedNanoTon: expectedNano.toString(),
                    senderWallet: senderWallet || null,
                    maxAttempts: 1
                });

                if (!result.ok) {
                    return res.json({ status: 'pending' });
                }

                // Atomic claim — race-safe against cron and manual «Проверить оплату».
                const { data: claimed, error: claimError } = await supabase
                    .from('invoices')
                    .update({
                        status: 'paid',
                        paid_at: new Date().toISOString(),
                        verified_at: new Date().toISOString(),
                        tx_hash: result.txHash || null
                    })
                    .eq('id', invoice.id)
                    .eq('status', 'pending')
                    .select()
                    .maybeSingle();

                if (claimError) throw claimError;

                if (!claimed) {
                    // Someone else already claimed it.
                    return res.json({ status: 'paid', already_paid: true });
                }

                await officialBotService.logPaymentEvent({
                    ownerId: tariff?.owner_id,
                    invoiceId: invoice.id,
                    provider: 'ton_connect',
                    eventType: 'tonconnect_confirmed',
                    status: 'paid',
                    payload: { memo: invoice.memo, tx_hash: result.txHash }
                });

                const tariffBotId = tariff?.bot_id || null;
                const bot = tariffBotId ? getBotById(tariffBotId) : null;
                if (bot) {
                    try {
                        await officialBotService.activateSubscription(bot, claimed);
                    } catch (activateErr) {
                        console.error('Public verify: activateSubscription failed:', activateErr.message || activateErr);
                    }
                } else {
                    console.warn(`Public verify: bot not running for invoice ${invoice.id}; cron will retry`);
                }

                return res.json({ status: 'paid', tx_hash: result.txHash || null });
            } catch (error) {
                console.error('Public verify error:', error);
                res.status(500).json({ error: 'Не удалось проверить оплату' });
            }
        });

    return router;
}
