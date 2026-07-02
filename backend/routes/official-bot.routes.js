import express from 'express';
import { randomBytes } from 'crypto';
import { Telegraf } from 'telegraf';
import { OfficialBotService } from '../services/official-bot.service.js';
import {
    SalesContourError,
    SalesContourService,
    getSalesContourFoundationMessage,
    isSalesContourFoundationError,
    normalizeBotKind
} from '../services/sales-contour.service.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { authenticateUser } from '../middlewares/auth.middleware.js';

const officialBotService = new OfficialBotService(null); // Supabase будет установлен позже через init
const salesContourService = new SalesContourService(null);
const OFFICIAL_BOT_WEBHOOK_ALLOWED_UPDATES = [
    'message',
    'edited_message',
    'channel_post',
    'edited_channel_post',
    'callback_query',
    'pre_checkout_query',
    'my_chat_member',
    'chat_member',
    'chat_join_request'
];

async function resolveBotAdminUsername(botToken, adminTgId) {
    const normalizedAdminTgId = String(adminTgId || '').trim();
    if (!botToken || !normalizedAdminTgId) return null;

    try {
        const bot = new Telegraf(botToken);
        const chat = await bot.telegram.getChat(normalizedAdminTgId);
        return chat?.username ? String(chat.username).replace(/^@/, '') : null;
    } catch (error) {
        console.warn(`Не удалось резолвить username админа ${normalizedAdminTgId}:`, error.message);
        return null;
    }
}

function normalizeWebhookMode(value) {
    return String(value || 'polling').trim().toLowerCase() === 'webhook' ? 'webhook' : 'polling';
}

function shouldStartOfficialBotRuntime(botKind, webhookMode = 'polling') {
    if (normalizeWebhookMode(webhookMode) === 'webhook') return false;
    return normalizeBotKind(botKind, { allowMissing: true }) !== 'template';
}

function isLocalDevelopment() {
    const origin = getOfficialBotWebhookOrigin();
    return origin.includes('localhost') || origin.includes('127.0.0.1');
}

function inferTelegramUpdateType(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'unknown';
    return Object.keys(payload).find((key) => key !== 'update_id') || 'unknown';
}

function isDuplicateUpdateError(error) {
    return error?.code === '23505' || String(error?.message || '').includes('duplicate key');
}

function isOfficialBotWebhookFoundationError(error) {
    return error?.code === '42P01'
        || error?.code === '42703'
        || String(error?.message || '').includes('official_bot_update_queue')
        || String(error?.message || '').includes('webhook_secret')
        || String(error?.message || '').includes('webhook_mode');
}

function getOfficialBotWebhookOrigin() {
    return String(
        process.env.OFFICIAL_BOT_WEBHOOK_ORIGIN
        || process.env.PUBLIC_API_ORIGIN
        || process.env.PUBLIC_APP_ORIGIN
        || 'https://bullrun.ru'
    ).trim().replace(/\/$/, '');
}

function generateOfficialBotWebhookSecret() {
    return randomBytes(32).toString('hex');
}

function buildOfficialBotWebhookUrl(botId, secret) {
    const origin = getOfficialBotWebhookOrigin();
    return `${origin}/api/official-bot/webhook/${encodeURIComponent(botId)}/${encodeURIComponent(secret)}`;
}

async function loadOwnedOfficialBotAccount(supabase, ownerId, accountId) {
    const normalizedAccountId = String(accountId || '').trim();
    if (!normalizedAccountId) {
        throw new SalesContourError('Не передан official-бот.', 400, 'official_bot_missing');
    }

    const { data: account, error } = await supabase
        .from('tg_accounts')
        .select('*')
        .eq('id', normalizedAccountId)
        .eq('owner_id', ownerId)
        .eq('account_type', 'bot')
        .maybeSingle();

    if (error) throw error;
    if (!account) {
        throw new SalesContourError('Official-бот не найден.', 404, 'official_bot_not_found');
    }
    if (!account.session_data) {
        throw new SalesContourError('У official-бота нет сохраненного токена.', 409, 'bot_token_missing');
    }

    return account;
}

function sendOfficialBotError(res, error, fallbackMessage, fallbackStatus = 500) {
    if (error instanceof SalesContourError) {
        return res.status(error.statusCode || 400).json({
            error: error.message,
            code: error.code || 'sales_contour_error'
        });
    }

    if (isSalesContourFoundationError(error)) {
        return res.status(400).json({
            error: getSalesContourFoundationMessage(),
            code: 'sales_contour_sql_missing'
        });
    }

    if (isOfficialBotWebhookFoundationError(error)) {
        return res.status(400).json({
            error: 'Не применена SQL-основа webhook runtime для official-ботов.',
            code: 'official_bot_webhook_sql_missing'
        });
    }

    console.error(fallbackMessage, error?.message || error);
    return res.status(fallbackStatus).json({ error: fallbackMessage });
}

function normalizeChannelChatType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['channel', 'group', 'supergroup'].includes(normalized)) return normalized;
    throw new SalesContourError('Тип площадки должен быть channel, group или supergroup.', 400, 'channel_chat_type_invalid');
}

function normalizeRefreshedChannelChatType(value, fallback = 'channel') {
    const normalized = String(value || '').trim().toLowerCase();
    if (['channel', 'group', 'supergroup'].includes(normalized)) return normalized;
    return normalizeChannelChatType(fallback);
}

async function createSalesContourBotApi(ownerId, botId) {
    const account = await salesContourService.assertOwnedSalesBot(ownerId, botId);
    const token = account.session_data ? decrypt(account.session_data) : '';
    if (!token) {
        throw new SalesContourError('У official-бота нет сохраненного токена.', 409, 'bot_token_missing');
    }

    const bot = new Telegraf(token);
    return bot.telegram;
}

/**
 * Роуты для официальных ботов
 */
export default function (supabase) {
    const router = express.Router();

    // Устанавливаем supabase в сервис
    officialBotService.supabase = supabase;
    salesContourService.supabase = supabase;

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

            if (!account?.webhook_secret || account.webhook_secret !== secret) {
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

    // ==========================================
    // ДОБАВЛЕНИЕ БОТА ПО ТОКЕНУ
    // ==========================================
    router.post('/add', authenticateUser, async (req, res) => {
        const { botToken, botRole, admin_tg_id } = req.body;
        if (!botToken) return res.status(400).json({ error: 'Токен не передан' });

        try {
            const normalizedKind = normalizeBotKind(req.body.bot_kind ?? req.body.botKind, { allowMissing: true }) || 'sales';
            const bot = new Telegraf(botToken);
            const botInfo = await bot.telegram.getMe();
            const encryptedToken = encrypt(botToken);
            const normalizedRole = botRole === 'ops' ? 'ops' : 'sales';
            const normalizedAdminTgId = String(admin_tg_id || '').trim() || null;
            const adminTgUsername = await resolveBotAdminUsername(botToken, normalizedAdminTgId);
            // Seed admin_tg_ids with the creator as owner (first element).
            // admin_tg_id (scalar) stays for backward-compat notification code.
            const seedAdminIds = normalizedAdminTgId
                ? Array.from(new Set([Number(normalizedAdminTgId)].filter((n) => !isNaN(n))))
                : [];

            const { data: insertedAccount, error } = await supabase.from('tg_accounts').upsert({
                owner_id: req.user.id,
                account_type: 'bot',
                tg_account_id: botInfo.id.toString(),
                tg_username: botInfo.username,
                session_data: encryptedToken,
                bot_role: normalizedRole,
                bot_kind: normalizedKind,
                admin_tg_id: normalizedAdminTgId,
                admin_tg_username: adminTgUsername,
                admin_tg_ids: seedAdminIds
            }, { onConflict: 'owner_id, tg_account_id' }).select().single();

            if (error) throw error;

            officialBotService.stopBot(insertedAccount.id);

            if (normalizedKind === 'template') {
                // template — не запускаем runtime
            } else if (isLocalDevelopment()) {
                officialBotService.startBot(insertedAccount.id, botToken, botInfo.username, normalizedRole);
            } else {
                const secret = generateOfficialBotWebhookSecret();
                const webhookUrl = buildOfficialBotWebhookUrl(insertedAccount.id, secret);
                const setupBot = new Telegraf(botToken);
                await setupBot.telegram.setWebhook(webhookUrl, {
                    allowed_updates: OFFICIAL_BOT_WEBHOOK_ALLOWED_UPDATES,
                    secret_token: secret
                });
                const webhookInfo = await setupBot.telegram.getWebhookInfo();
                const now = new Date().toISOString();

                await supabase.from('tg_accounts').update({
                    webhook_mode: 'webhook',
                    webhook_secret: secret,
                    webhook_url: webhookUrl,
                    webhook_set_at: now,
                    webhook_status: webhookInfo?.last_error_message ? 'error' : 'enabled',
                    runtime_status: 'webhook',
                    runtime_error: webhookInfo?.last_error_message || null
                }).eq('id', insertedAccount.id);

                officialBotService.startWebhookBot(insertedAccount.id, botToken, botInfo.username, normalizedRole);
            }

            res.status(200).json({
                success: true,
                bot: botInfo,
                account_id: insertedAccount.id,
                bot_role: normalizedRole,
                bot_kind: normalizedKind,
                runtime_started: normalizedKind !== 'template'
            });
        } catch (err) {
            if (err instanceof SalesContourError || isSalesContourFoundationError(err)) {
                return sendOfficialBotError(res, err, 'Не получилось сохранить official-бота.', 400);
            }
            console.error('Ошибка добавления бота:', err.message);
            res.status(400).json({ error: 'Неверный токен' });
        }
    });

    router.post('/admin', authenticateUser, async (req, res) => {
        const { account_id, admin_tg_id } = req.body;
        if (!account_id) return res.status(400).json({ error: 'Не передан бот для обновления админа' });

        try {
            const normalizedAdminTgId = String(admin_tg_id || '').trim() || null;

            const { data: account, error: accountError } = await supabase
                .from('tg_accounts')
                .select('id, session_data')
                .eq('id', account_id)
                .eq('owner_id', req.user.id)
                .eq('account_type', 'bot')
                .single();

            if (accountError || !account) {
                return res.status(404).json({ error: 'Бот не найден' });
            }

            const botToken = account.session_data ? decrypt(account.session_data) : '';
            const adminTgUsername = await resolveBotAdminUsername(botToken, normalizedAdminTgId);

            const { error: updateError } = await supabase
                .from('tg_accounts')
                .update({
                    admin_tg_id: normalizedAdminTgId,
                    admin_tg_username: normalizedAdminTgId ? adminTgUsername : null
                })
                .eq('id', account.id)
                .eq('owner_id', req.user.id);

            if (updateError) throw updateError;

            res.json({
                success: true,
                admin_tg_id: normalizedAdminTgId,
                admin_tg_username: normalizedAdminTgId ? adminTgUsername : null
            });
        } catch (error) {
            console.error('Ошибка обновления admin_tg_id бота:', error.message);
            res.status(500).json({ error: 'Не получилось обновить Telegram ID админа бота' });
        }
    });

    router.post('/role', authenticateUser, async (req, res) => {
        const { account_id, bot_role } = req.body;
        if (!account_id) return res.status(400).json({ error: 'Не передан бот для смены роли' });

        try {
            const normalizedRole = bot_role === 'ops' ? 'ops' : 'sales';

            const { data: account, error: accountError } = await supabase
                .from('tg_accounts')
                .select('*')
                .eq('id', account_id)
                .eq('owner_id', req.user.id)
                .eq('account_type', 'bot')
                .single();

            if (accountError || !account) {
                return res.status(404).json({ error: 'Бот не найден' });
            }

            const { error: updateError } = await supabase
                .from('tg_accounts')
                .update({ bot_role: normalizedRole })
                .eq('id', account.id)
                .eq('owner_id', req.user.id);

            if (updateError) throw updateError;

            const token = decrypt(account.session_data);
            officialBotService.stopBot(account.id);
            if (shouldStartOfficialBotRuntime(account.bot_kind, account.webhook_mode)) {
                officialBotService.startBot(account.id, token, account.tg_username, normalizedRole);
            }

            res.json({
                success: true,
                bot_role: normalizedRole,
                bot_kind: normalizeBotKind(account.bot_kind, { allowMissing: true }) || 'sales',
                runtime_started: shouldStartOfficialBotRuntime(account.bot_kind, account.webhook_mode)
            });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось сменить роль бота');
        }
    });

    router.post('/type', authenticateUser, async (req, res) => {
        const { account_id } = req.body;
        if (!account_id) return res.status(400).json({ error: 'Не передан бот для смены типа' });

        try {
            const normalizedKind = normalizeBotKind(req.body.bot_kind ?? req.body.botKind);

            const { data: account, error: accountError } = await supabase
                .from('tg_accounts')
                .select('*')
                .eq('id', account_id)
                .eq('owner_id', req.user.id)
                .eq('account_type', 'bot')
                .single();

            if (accountError || !account) {
                return res.status(404).json({ error: 'Бот не найден' });
            }

            const { error: updateError } = await supabase
                .from('tg_accounts')
                .update({ bot_kind: normalizedKind })
                .eq('id', account.id)
                .eq('owner_id', req.user.id);

            if (updateError) throw updateError;

            officialBotService.stopBot(account.id);

            if (shouldStartOfficialBotRuntime(normalizedKind, account.webhook_mode)) {
                const token = decrypt(account.session_data);
                officialBotService.startBot(account.id, token, account.tg_username, account.bot_role || 'sales');
            }

            res.json({
                success: true,
                bot_kind: normalizedKind,
                bot_role: account.bot_role || 'sales',
                runtime_started: shouldStartOfficialBotRuntime(normalizedKind, account.webhook_mode)
            });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось сменить тип бота');
        }
    });

    router.get('/contours', authenticateUser, async (req, res) => {
        try {
            const data = await salesContourService.getContoursOverview(req.user.id);
            res.json(data);
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось загрузить sales contours');
        }
    });

    router.post('/contours', authenticateUser, async (req, res) => {
        try {
            const data = await salesContourService.saveContour(req.user.id, req.body || {});
            res.json({ success: true, ...data });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось сохранить sales contour');
        }
    });

    router.post('/contours/rights', authenticateUser, async (req, res) => {
        try {
            const botApi = await createSalesContourBotApi(req.user.id, req.body?.bot_id ?? req.body?.account_id);
            const data = await salesContourService.getBotChatRights(req.user.id, req.body || {}, botApi);
            res.json({ success: true, ...data });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось проверить права бота в Telegram');
        }
    });

    router.post('/contours/check-rights', authenticateUser, async (req, res) => {
        try {
            const botApi = await createSalesContourBotApi(req.user.id, req.body?.bot_id ?? req.body?.account_id);
            const data = await salesContourService.getBotChatRights(req.user.id, req.body || {}, botApi);
            res.json({ success: true, ...data });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось проверить права бота в Telegram');
        }
    });

    router.post('/contours/prepare-userbot', authenticateUser, async (req, res) => {
        try {
            const botApi = await createSalesContourBotApi(req.user.id, req.body?.bot_id ?? req.body?.account_id);
            const data = await salesContourService.prepareSelectedUserbotAdmin(req.user.id, req.body || {}, botApi);
            res.json({ success: true, ...data });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось подготовить юзербота');
        }
    });

    router.post('/contours/join-all', authenticateUser, async (req, res) => {
        try {
            console.log('[join-all] started for user:', req.user?.id, 'bot_id:', req.body?.bot_id);
            const botApi = await createSalesContourBotApi(req.user.id, req.body?.bot_id ?? req.body?.account_id);
            const { UserbotService } = await import('../services/userbot.service.js');
            const userbotService = new UserbotService(supabase, 4, '014b35b6184100b085b0d0572f9b5103');
            const data = await salesContourService.joinUserbotToAllTargets(req.user.id, req.body || {}, botApi, userbotService);
            console.log('[join-all] completed:', data?.summary);
            res.json({ success: true, ...data });
        } catch (error) {
            console.error('[join-all] FAILED:', error);
            return sendOfficialBotError(res, error, 'Не получилось подключить юзербота ко всем площадкам');
        }
    });

    router.patch('/contours/userbot-active', authenticateUser, async (req, res) => {
        try {
            const data = await salesContourService.toggleUserbotBinding(
                req.user.id,
                req.body?.bot_id,
                req.body?.userbot_id,
                !!req.body?.is_active
            );
            res.json({ success: true, ...data });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось переключить статус юзербота');
        }
    });

    router.patch('/channels/:channelId', authenticateUser, async (req, res) => {
        try {
            const channelId = String(req.params.channelId || '').trim();
            if (!channelId) {
                return res.status(400).json({ error: 'Не передана Telegram-площадка' });
            }

            const chatType = normalizeChannelChatType(req.body?.chat_type ?? req.body?.chatType);

            const { data, error } = await supabase
                .from('channels')
                .update({ chat_type: chatType })
                .eq('id', channelId)
                .eq('owner_id', req.user.id)
                .select('id, owner_id, bot_id, tg_chat_id, title, chat_type, username, visibility, last_visibility_check_at, created_at')
                .single();

            if (error) throw error;
            if (!data) {
                return res.status(404).json({ error: 'Telegram-площадка не найдена' });
            }

            res.json({ success: true, channel: data });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось обновить Telegram-площадку');
        }
    });

    router.post('/channels/:channelId/refresh', authenticateUser, async (req, res) => {
        try {
            const channelId = String(req.params.channelId || '').trim();
            if (!channelId) {
                return res.status(400).json({ error: 'Не передана Telegram-площадка' });
            }

            const { data: channel, error: channelError } = await supabase
                .from('channels')
                .select('id, owner_id, bot_id, tg_chat_id, title, chat_type, visibility')
                .eq('id', channelId)
                .eq('owner_id', req.user.id)
                .maybeSingle();

            if (channelError) throw channelError;
            if (!channel) {
                return res.status(404).json({ error: 'Telegram-площадка не найдена' });
            }
            if (!channel.bot_id) {
                throw new SalesContourError('У площадки не привязан official-бот.', 409, 'channel_bot_missing');
            }

            const { data: account, error: accountError } = await supabase
                .from('tg_accounts')
                .select('id, owner_id, account_type, session_data')
                .eq('id', channel.bot_id)
                .eq('owner_id', req.user.id)
                .eq('account_type', 'bot')
                .maybeSingle();

            if (accountError) throw accountError;
            if (!account?.session_data) {
                throw new SalesContourError('У official-бота нет сохраненного токена.', 409, 'bot_token_missing');
            }

            const bot = new Telegraf(decrypt(account.session_data));
            let chat;
            try {
                chat = await bot.telegram.getChat(channel.tg_chat_id);
            } catch (error) {
                const message = String(error?.response?.description || error?.message || '').trim();
                throw new SalesContourError(
                    message || 'Не получилось обновить площадку из Telegram.',
                    502,
                    'channel_refresh_failed'
                );
            }

            const username = String(chat?.username || '').trim().replace(/^@/, '') || null;
            const title = String(chat?.title || chat?.first_name || channel.title || channel.tg_chat_id || '').trim();
            const chatType = normalizeRefreshedChannelChatType(chat?.type, channel.chat_type);
            const visibility = username ? 'public' : 'private';

            const { data, error } = await supabase
                .from('channels')
                .update({
                    title,
                    chat_type: chatType,
                    username,
                    visibility,
                    last_visibility_check_at: new Date().toISOString()
                })
                .eq('id', channel.id)
                .eq('owner_id', req.user.id)
                .select('id, owner_id, bot_id, tg_chat_id, title, chat_type, username, visibility, last_visibility_check_at, created_at')
                .single();

            if (error) throw error;

            // Ребаланс контура: если канал привязан к слоту, который не соответствует
            // текущей видимости, переносим в правильный слот.
            // Старый обитатель целевого слота (если был) падает в «Свободные площадки».
            // Проверка идёт всегда (даже без смены visibility) — чтобы чинить связи,
            // оставшиеся с предыдущих refresh-ов до того, как логика ребаланса появилась.
            let contourChange = null;
            if (visibility === 'public' || visibility === 'private') {
                const { data: contours } = await supabase
                    .from('sales_bot_contours')
                    .select('bot_id, public_channel_id, paid_channel_id, public_chat_id, paid_chat_id')
                    .or(`public_channel_id.eq.${channel.id},paid_channel_id.eq.${channel.id},public_chat_id.eq.${channel.id},paid_chat_id.eq.${channel.id}`)
                    .eq('owner_id', req.user.id);

                const c = (contours || [])[0];
                if (c) {
                    const isChannel = chatType === 'channel';
                    const targetField = isChannel
                        ? (visibility === 'public' ? 'public_channel_id' : 'paid_channel_id')
                        : (visibility === 'public' ? 'public_chat_id' : 'paid_chat_id');

                    const contourFields = ['public_channel_id', 'paid_channel_id', 'public_chat_id', 'paid_chat_id'];
                    const currentField = contourFields.find((f) => c[f] === channel.id);

                    if (currentField && currentField !== targetField) {
                        const displacedChannelId = c[targetField] || null;
                        const { error: updErr } = await supabase
                            .from('sales_bot_contours')
                            .update({
                                [currentField]: null,
                                [targetField]: channel.id
                            })
                            .eq('bot_id', c.bot_id)
                            .eq('owner_id', req.user.id);
                        if (updErr) throw updErr;
                        contourChange = {
                            from: currentField,
                            to: targetField,
                            displacedChannelId
                        };
                    }
                }
            }

            res.json({ success: true, channel: data, contourChange });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось обновить информацию о Telegram-площадке');
        }
    });

    router.delete('/channels/:channelId', authenticateUser, async (req, res) => {
        try {
            const channelId = String(req.params.channelId || '').trim();
            if (!channelId) {
                return res.status(400).json({ error: 'Не передана Telegram-площадка' });
            }

            const { data: channel, error: channelError } = await supabase
                .from('channels')
                .select('id')
                .eq('id', channelId)
                .eq('owner_id', req.user.id)
                .maybeSingle();

            if (channelError) throw channelError;
            if (!channel) {
                return res.status(404).json({ error: 'Telegram-площадка не найдена' });
            }

            const { data: contourUsages, error: contourUsagesError } = await supabase
                .from('sales_bot_contours')
                .select('bot_id, public_channel_id, paid_channel_id, public_chat_id, paid_chat_id')
                .eq('owner_id', req.user.id)
                .or(`public_channel_id.eq.${channelId},paid_channel_id.eq.${channelId},public_chat_id.eq.${channelId},paid_chat_id.eq.${channelId}`);

            if (contourUsagesError && !isSalesContourFoundationError(contourUsagesError)) {
                throw contourUsagesError;
            }

            for (const field of ['public_channel_id', 'paid_channel_id', 'public_chat_id', 'paid_chat_id']) {
                const { error: clearContourError } = await supabase
                    .from('sales_bot_contours')
                    .update({ [field]: null })
                    .eq('owner_id', req.user.id)
                    .eq(field, channelId);

                if (clearContourError && !isSalesContourFoundationError(clearContourError)) {
                    throw clearContourError;
                }
            }

            const { error } = await supabase
                .from('channels')
                .delete()
                .eq('id', channelId)
                .eq('owner_id', req.user.id);

            if (error) throw error;

            res.json({ success: true });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось удалить Telegram-площадку');
        }
    });

    // ===== Управление администраторами бота (мульти-админка, как в автопостере) =====

    function buildBotAdminInviteLink(tgUsername, secret) {
        if (!tgUsername || !secret) return null;
        return `https://t.me/${tgUsername}?start=add_admin_${secret}`;
    }

    function generateBotAdminInviteSecret() {
        return randomBytes(16).toString('hex');
    }

    async function loadOwnedOfficialBotForAdmins(supabase, ownerId, accountId) {
        const id = String(accountId || '').trim();
        if (!id) return null;
        const { data, error } = await supabase
            .from('tg_accounts')
            .select('id, tg_username, admin_tg_ids, admin_invite_secret')
            .eq('id', id)
            .eq('owner_id', ownerId)
            .eq('account_type', 'bot')
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    // Получить список администраторов бота и инвайт-ссылку
    router.get('/:accountId/admins', authenticateUser, async (req, res) => {
        try {
            const bot = await loadOwnedOfficialBotForAdmins(supabase, req.user.id, req.params.accountId);
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });

            const inviteLink = buildBotAdminInviteLink(bot.tg_username, bot.admin_invite_secret);
            res.json({
                admin_tg_ids: bot.admin_tg_ids || [],
                invite_link: inviteLink
            });
        } catch (err) {
            console.error('Ошибка получения администраторов бота:', err.message);
            res.status(500).json({ error: 'Не получилось получить список администраторов' });
        }
    });

    // Сгенерировать новую инвайт-ссылку (старая перестанет работать)
    router.post('/:accountId/admins/regenerate-invite', authenticateUser, async (req, res) => {
        try {
            const bot = await loadOwnedOfficialBotForAdmins(supabase, req.user.id, req.params.accountId);
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });

            const newSecret = generateBotAdminInviteSecret();
            const { error: updateErr } = await supabase
                .from('tg_accounts')
                .update({ admin_invite_secret: newSecret })
                .eq('id', bot.id)
                .eq('owner_id', req.user.id);
            if (updateErr) throw updateErr;

            res.json({ invite_link: buildBotAdminInviteLink(bot.tg_username, newSecret) });
        } catch (err) {
            console.error('Ошибка регенерации invite-ссылки:', err.message);
            res.status(500).json({ error: 'Не получилось обновить приглашение' });
        }
    });

    // Добавить администратора вручную по Telegram ID
    router.post('/:accountId/admins', authenticateUser, async (req, res) => {
        try {
            const { adminTgId } = req.body;
            const newAdmin = Number(adminTgId);
            if (!adminTgId || isNaN(newAdmin)) {
                return res.status(400).json({ error: 'ID администратора должен быть числовым Telegram ID' });
            }

            const bot = await loadOwnedOfficialBotForAdmins(supabase, req.user.id, req.params.accountId);
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });

            const currentAdmins = (bot.admin_tg_ids || []).map(Number);
            if (currentAdmins.includes(newAdmin)) {
                return res.status(409).json({ error: 'Этот пользователь уже администратор' });
            }
            currentAdmins.push(newAdmin);

            const { error: updateErr } = await supabase
                .from('tg_accounts')
                .update({ admin_tg_ids: currentAdmins })
                .eq('id', bot.id)
                .eq('owner_id', req.user.id);
            if (updateErr) throw updateErr;

            res.json({ ok: true, admin_tg_ids: currentAdmins });
        } catch (err) {
            console.error('Ошибка добавления администратора бота:', err.message);
            res.status(500).json({ error: 'Не получилось добавить администратора' });
        }
    });

    // Удалить администратора из списка (нельзя удалить владельца — admin_tg_ids[0])
    router.delete('/:accountId/admins/:tgId', authenticateUser, async (req, res) => {
        try {
            const bot = await loadOwnedOfficialBotForAdmins(supabase, req.user.id, req.params.accountId);
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });

            const targetId = Number(req.params.tgId);
            const currentAdmins = (bot.admin_tg_ids || []).map(Number);

            if (currentAdmins[0] === targetId) {
                return res.status(400).json({ error: 'Нельзя удалить владельца бота' });
            }

            const nextAdmins = currentAdmins.filter((id) => id !== targetId);
            const { error: updateErr } = await supabase
                .from('tg_accounts')
                .update({ admin_tg_ids: nextAdmins })
                .eq('id', bot.id)
                .eq('owner_id', req.user.id);
            if (updateErr) throw updateErr;

            res.json({ ok: true, admin_tg_ids: nextAdmins });
        } catch (err) {
            console.error('Ошибка удаления администратора бота:', err.message);
            res.status(500).json({ error: 'Не получилось удалить администратора' });
        }
    });

    return router;
}

/**
 * Получить инстанс бота по ID (для использования в jobs)
 */
export function getBotById(botId) {
    return officialBotService.getBot(botId);
}

/**
 * Инициализация всех ботов из БД при запуске сервера
 */
export async function initAllBots(supabase) {
    console.log('🔄 Ищем и запускаем официальных ботов из БД...');
    const { data: bots, error } = await supabase.from('tg_accounts').select('*').eq('account_type', 'bot');
    if (error) return console.error('Ошибка загрузки ботов:', error.message);

    for (const account of bots) {
        try {
            const normalizedKind = normalizeBotKind(account.bot_kind, { allowMissing: true });
            if (normalizedKind === 'template') continue;

            const token = decrypt(account.session_data);
            const mode = normalizeWebhookMode(account.webhook_mode);

            if (isLocalDevelopment()) {
                officialBotService.startBot(account.id, token, account.tg_username, account.bot_role || 'sales');
                continue;
            }

            if (mode === 'polling') {
                const secret = generateOfficialBotWebhookSecret();
                const webhookUrl = buildOfficialBotWebhookUrl(account.id, secret);
                const setupBot = new Telegraf(token);
                await setupBot.telegram.setWebhook(webhookUrl, {
                    allowed_updates: OFFICIAL_BOT_WEBHOOK_ALLOWED_UPDATES,
                    secret_token: secret
                });
                const webhookInfo = await setupBot.telegram.getWebhookInfo();
                const now = new Date().toISOString();

                await supabase.from('tg_accounts').update({
                    webhook_mode: 'webhook',
                    webhook_secret: secret,
                    webhook_url: webhookUrl,
                    webhook_set_at: now,
                    webhook_status: webhookInfo?.last_error_message ? 'error' : 'enabled',
                    runtime_status: 'webhook',
                    runtime_error: webhookInfo?.last_error_message || null
                }).eq('id', account.id);

                console.log(`🔄 Бот @${account.tg_username} мигрирован на webhook`);
            }

            officialBotService.startWebhookBot(account.id, token, account.tg_username, account.bot_role || 'sales');
        } catch (err) { console.error(`Не удалось запустить бота @${account.tg_username}:`, err.message); }
    }
}
