import { timingSafeEqual } from 'crypto';
import { Telegraf } from 'telegraf';
import { decrypt } from '../../utils/crypto.js';
import { authenticateUser } from '../../middlewares/auth.middleware.js';

function inferTelegramUpdateType(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'unknown';
    return Object.keys(payload).find((key) => key !== 'update_id') || 'unknown';
}

function isDuplicateUpdateError(error) {
    return error?.code === '23505' || String(error?.message || '').includes('duplicate key');
}

export function registerWebhookRoutes(router, ctx) {
    const { supabase, officialBotService } = ctx;
    const {
        OFFICIAL_BOT_WEBHOOK_ALLOWED_UPDATES,
        normalizeWebhookMode,
        shouldStartOfficialBotRuntime,
        isOfficialBotWebhookFoundationError,
        generateOfficialBotWebhookSecret,
        buildOfficialBotWebhookUrl,
        loadOwnedOfficialBotAccount,
        sendOfficialBotError
    } = ctx;

    router.post('/webhook/:botId/:secret', async (req, res) => {
        const botId = String(req.params.botId || '').trim();
        const secret = String(req.params.secret || '').trim();

        if (!botId || !secret) {
            return res.status(400).json({ error: 'Webhook route is missing bot id or secret.' });
        }

        try {
            const { data: account, error: accountError } = await supabase
                .from('tg_accounts')
                .select('id, owner_id, account_type, webhook_mode, webhook_secret')
                .eq('id', botId)
                .eq('account_type', 'bot')
                .maybeSingle();

            if (accountError) {
                if (isOfficialBotWebhookFoundationError(accountError)) {
                    return res.status(503).json({
                        error: 'Official bot webhook SQL foundation is not applied.',
                        code: 'official_bot_webhook_sql_missing'
                    });
                }
                throw accountError;
            }

            // Сравнение секрета — constant-time: защита от timing-атак.
            // timingSafeEqual бросает на разной длине буферов, поэтому длину сверяем заранее.
            const expectedSecret = String(account?.webhook_secret || '');
            const providedSecret = String(secret || '');
            const secretMatches = expectedSecret.length > 0
                && expectedSecret.length === providedSecret.length
                && timingSafeEqual(Buffer.from(expectedSecret), Buffer.from(providedSecret));

            if (!secretMatches) {
                return res.status(404).json({ error: 'Webhook not found.' });
            }

            if (normalizeWebhookMode(account.webhook_mode) !== 'webhook') {
                return res.status(409).json({
                    error: 'Official bot is not in webhook mode.',
                    code: 'official_bot_webhook_mode_disabled'
                });
            }

            if (!account.owner_id) {
                return res.status(409).json({
                    error: 'Official bot has no owner.',
                    code: 'official_bot_owner_missing'
                });
            }

            const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
            const telegramUpdateId = Number(payload.update_id);
            if (!Number.isSafeInteger(telegramUpdateId)) {
                return res.status(400).json({
                    error: 'Telegram update_id is required.',
                    code: 'telegram_update_id_missing'
                });
            }

            const { error: insertError } = await supabase
                .from('official_bot_update_queue')
                .insert({
                    bot_id: account.id,
                    owner_id: account.owner_id,
                    telegram_update_id: telegramUpdateId,
                    update_type: inferTelegramUpdateType(payload),
                    payload,
                    status: 'queued'
                });

            if (insertError && !isDuplicateUpdateError(insertError)) {
                if (isOfficialBotWebhookFoundationError(insertError)) {
                    return res.status(503).json({
                        error: 'Official bot webhook SQL foundation is not applied.',
                        code: 'official_bot_webhook_sql_missing'
                    });
                }
                throw insertError;
            }

            const { error: updateError } = await supabase
                .from('tg_accounts')
                .update({
                    last_update_at: new Date().toISOString(),
                    webhook_status: 'receiving'
                })
                .eq('id', account.id);

            if (updateError && !isOfficialBotWebhookFoundationError(updateError)) {
                console.warn('Не получилось обновить статус webhook official-бота:', updateError.message);
            }

            return res.json({ ok: true, duplicate: Boolean(insertError && isDuplicateUpdateError(insertError)) });
        } catch (error) {
            console.error('Ошибка official bot webhook:', error?.message || error);
            return res.status(500).json({ error: 'Official bot webhook failed.' });
        }
    });

    router.post('/webhook-runtime/:accountId/enable', authenticateUser, async (req, res) => {
        try {
            const account = await loadOwnedOfficialBotAccount(supabase, req.user.id, req.params.accountId);
            const token = decrypt(account.session_data);
            const secret = req.body?.rotate_secret || !account.webhook_secret
                ? generateOfficialBotWebhookSecret()
                : account.webhook_secret;
            const webhookUrl = buildOfficialBotWebhookUrl(account.id, secret);
            const bot = new Telegraf(token);

            officialBotService.stopBot(account.id);
            await bot.telegram.setWebhook(webhookUrl, {
                allowed_updates: OFFICIAL_BOT_WEBHOOK_ALLOWED_UPDATES,
                secret_token: secret
            });

            const webhookInfo = await bot.telegram.getWebhookInfo();
            const now = new Date().toISOString();

            const { data: updatedAccount, error: updateError } = await supabase
                .from('tg_accounts')
                .update({
                    webhook_mode: 'webhook',
                    webhook_secret: secret,
                    webhook_url: webhookUrl,
                    webhook_set_at: now,
                    webhook_status: webhookInfo?.last_error_message ? 'error' : 'enabled',
                    runtime_status: 'webhook',
                    runtime_error: webhookInfo?.last_error_message || null
                })
                .eq('id', account.id)
                .eq('owner_id', req.user.id)
                .select('id, tg_username, bot_role, bot_kind, webhook_mode, webhook_url, webhook_set_at, webhook_status, last_update_at, runtime_status, runtime_error')
                .single();

            if (updateError) throw updateError;

            res.json({
                success: true,
                account: updatedAccount,
                webhook: {
                    url: webhookInfo?.url || webhookUrl,
                    pending_update_count: webhookInfo?.pending_update_count ?? 0,
                    last_error_date: webhookInfo?.last_error_date || null,
                    last_error_message: webhookInfo?.last_error_message || null,
                    allowed_updates: webhookInfo?.allowed_updates || OFFICIAL_BOT_WEBHOOK_ALLOWED_UPDATES
                }
            });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось включить webhook official-бота');
        }
    });

    router.post('/webhook-runtime/:accountId/disable', authenticateUser, async (req, res) => {
        try {
            const account = await loadOwnedOfficialBotAccount(supabase, req.user.id, req.params.accountId);
            const token = decrypt(account.session_data);
            const bot = new Telegraf(token);
            const shouldDropPendingUpdates = Boolean(req.body?.drop_pending_updates);

            await bot.telegram.deleteWebhook({ drop_pending_updates: shouldDropPendingUpdates });

            const { data: updatedAccount, error: updateError } = await supabase
                .from('tg_accounts')
                .update({
                    webhook_mode: 'polling',
                    webhook_url: null,
                    webhook_set_at: null,
                    webhook_status: 'disabled',
                    runtime_status: null,
                    runtime_error: null
                })
                .eq('id', account.id)
                .eq('owner_id', req.user.id)
                .select('id, tg_username, bot_role, bot_kind, webhook_mode, webhook_url, webhook_set_at, webhook_status, last_update_at, runtime_status, runtime_error')
                .single();

            if (updateError) throw updateError;

            officialBotService.stopBot(account.id);
            if (shouldStartOfficialBotRuntime(account.bot_kind, 'polling')) {
                officialBotService.startBot(account.id, token, account.tg_username, account.bot_role || 'sales');
            }

            res.json({
                success: true,
                account: updatedAccount,
                runtime_started: shouldStartOfficialBotRuntime(account.bot_kind, 'polling')
            });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось отключить webhook official-бота');
        }
    });

    router.get('/webhook-runtime/:accountId/status', authenticateUser, async (req, res) => {
        try {
            const account = await loadOwnedOfficialBotAccount(supabase, req.user.id, req.params.accountId);
            const token = decrypt(account.session_data);
            const bot = new Telegraf(token);
            const webhookInfo = await bot.telegram.getWebhookInfo();
            const status = webhookInfo?.last_error_message ? 'error' : (webhookInfo?.url ? 'enabled' : 'disabled');

            const { data: updatedAccount, error: updateError } = await supabase
                .from('tg_accounts')
                .update({
                    webhook_status: status,
                    webhook_url: webhookInfo?.url || account.webhook_url || null,
                    runtime_error: webhookInfo?.last_error_message || null
                })
                .eq('id', account.id)
                .eq('owner_id', req.user.id)
                .select('id, tg_username, bot_role, bot_kind, webhook_mode, webhook_url, webhook_set_at, webhook_status, last_update_at, runtime_status, runtime_error')
                .single();

            if (updateError) throw updateError;

            res.json({
                success: true,
                account: updatedAccount,
                webhook: {
                    url: webhookInfo?.url || '',
                    pending_update_count: webhookInfo?.pending_update_count ?? 0,
                    last_error_date: webhookInfo?.last_error_date || null,
                    last_error_message: webhookInfo?.last_error_message || null,
                    max_connections: webhookInfo?.max_connections || null,
                    allowed_updates: webhookInfo?.allowed_updates || []
                }
            });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось проверить webhook official-бота');
        }
    });
}
