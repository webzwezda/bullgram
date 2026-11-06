import { Telegraf } from 'telegraf';
import {
    SalesContourError,
    isSalesContourFoundationError,
    normalizeBotKind
} from '../../services/sales-contour.service.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { authenticateUser } from '../../middlewares/auth.middleware.js';

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

export function registerBotManagementRoutes(router, ctx) {
    const { supabase, officialBotService } = ctx;
    const {
        OFFICIAL_BOT_WEBHOOK_ALLOWED_UPDATES,
        normalizeWebhookMode,
        shouldStartOfficialBotRuntime,
        isLocalDevelopment,
        generateOfficialBotWebhookSecret,
        buildOfficialBotWebhookUrl,
        loadOwnedOfficialBotAccount,
        sendOfficialBotError
    } = ctx;

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

            // Существующий бот: читаем строку до upsert, чтобы при конфликте
            // (owner_id, tg_account_id) не затереть данные повторным добавлением:
            // admin_tg_ids мержим, а webhook-секрет/режим через upsert вообще не трогаем.
            const { data: existingAccount } = await supabase
                .from('tg_accounts')
                .select('id, admin_tg_id, admin_tg_username, admin_tg_ids')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'bot')
                .eq('tg_account_id', botInfo.id.toString())
                .maybeSingle();

            const existingAdminIds = (Array.isArray(existingAccount?.admin_tg_ids) ? existingAccount.admin_tg_ids : [])
                .map(Number)
                .filter((n) => !isNaN(n));
            // Мерж: создатель (seed) первым, затем ранее добавленные админы, без дублей.
            const mergedAdminIds = Array.from(new Set([...seedAdminIds, ...existingAdminIds]));

            const { data: insertedAccount, error } = await supabase.from('tg_accounts').upsert({
                owner_id: req.user.id,
                account_type: 'bot',
                tg_account_id: botInfo.id.toString(),
                tg_username: botInfo.username,
                session_data: encryptedToken,
                bot_role: normalizedRole,
                bot_kind: normalizedKind,
                admin_tg_id: normalizedAdminTgId || existingAccount?.admin_tg_id || null,
                admin_tg_username: adminTgUsername || existingAccount?.admin_tg_username || null,
                admin_tg_ids: mergedAdminIds
            }, { onConflict: 'owner_id, tg_account_id' }).select().single();

            if (error) throw error;

            officialBotService.stopBot(insertedAccount.id);

            if (normalizedKind === 'template') {
                // template — не запускаем runtime
            } else if (isLocalDevelopment()) {
                officialBotService.startBot(insertedAccount.id, botToken, botInfo.username, normalizedRole);
            } else if (existingAccount) {
                // Существующий бот: webhook уже зарегистрирован в Telegram — не ротируем
                // секрет и не сбрасываем webhook-режим/статус, просто поднимаем runtime заново.
                officialBotService.startWebhookBot(insertedAccount.id, botToken, botInfo.username, normalizedRole);
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

    // Замена токена существующего official-бота без пересоздания строки:
    // контур, права, каналы, тарифы и админы ссылаются на tg_accounts.id,
    // поэтому токен обновляем in-place. Простое re-add из /add не годится:
    // оно не отличит токен чужого бота и не перерегистрирует webhook,
    // который BotFather сбрасывает при revoke токена.
    router.post('/:accountId/token', authenticateUser, async (req, res) => {
        const { botToken } = req.body;
        if (!botToken) return res.status(400).json({ error: 'Токен не передан' });

        try {
            const account = await loadOwnedOfficialBotAccount(supabase, req.user.id, req.params.accountId);

            const bot = new Telegraf(botToken);
            let botInfo;
            try {
                botInfo = await bot.telegram.getMe();
            } catch (getMeErr) {
                // До этого места ничего не меняли — бот живёт на старом токене.
                return res.status(400).json({ error: 'Неверный токен — Telegram его не принял: ' + (getMeErr.message || getMeErr) });
            }

            // Токен должен быть от того же бота: у другого бота свой tg_account_id —
            // он не подошёл бы к контуру и вебхуку этой строки.
            if (botInfo.id.toString() !== String(account.tg_account_id)) {
                return res.status(400).json({ error: 'Это токен другого бота. Выпусти новый токен в BotFather у этого же бота: /mybots → API Token → Revoke current token.' });
            }

            const normalizedKind = normalizeBotKind(account.bot_kind, { allowMissing: true }) || 'sales';
            const webhookMode = normalizeWebhookMode(account.webhook_mode);
            const updates = { session_data: encrypt(botToken), tg_username: botInfo.username };
            let saved = false;
            let webhookReregistered = false;
            let webhookWarning = null;

            if (normalizedKind !== 'template' && !isLocalDevelopment() && webhookMode === 'webhook') {
                // Revoke токена сбрасывает webhook на стороне Telegram — проверяем
                // и при необходимости регистрируем заново с тем же секретом,
                // чтобы не ротировать URL и не терять привязку.
                try {
                    const webhookInfo = await bot.telegram.getWebhookInfo();
                    if (!webhookInfo?.url) {
                        const secret = account.webhook_secret || generateOfficialBotWebhookSecret();
                        const webhookUrl = account.webhook_url || buildOfficialBotWebhookUrl(account.id, secret);
                        await bot.telegram.setWebhook(webhookUrl, {
                            allowed_updates: OFFICIAL_BOT_WEBHOOK_ALLOWED_UPDATES,
                            secret_token: secret
                        });
                        updates.webhook_mode = 'webhook';
                        updates.webhook_secret = secret;
                        updates.webhook_url = webhookUrl;
                        updates.webhook_set_at = new Date().toISOString();
                        webhookReregistered = true;
                    }
                    const fresh = await bot.telegram.getWebhookInfo();
                    updates.webhook_status = fresh?.last_error_message ? 'error' : 'enabled';
                    updates.runtime_status = 'webhook';
                    updates.runtime_error = fresh?.last_error_message || null;
                } catch (webhookErr) {
                    // Не молчим: без webhook бот мёртв, честно помечаем строку,
                    // чтобы UI не показывал здорового бота.
                    console.error(`[official-bot] webhook re-register failed для ${account.id}: ${webhookErr.message}`);
                    webhookWarning = 'Webhook перерегистрировать не удалось: ' + (webhookErr.message || webhookErr);
                    updates.webhook_status = 'error';
                    updates.runtime_error = String(webhookErr.message || webhookErr);
                }
            }

            const { error: updateErr } = await supabase
                .from('tg_accounts')
                .update(updates)
                .eq('id', account.id)
                .eq('owner_id', req.user.id);
            if (updateErr) throw updateErr;
            saved = true;

            // Рестарт строго после успешной записи: при ошибке записи бот
            // продолжает работать как работал, ничего не останавливаем.
            // Polling-боты остаются на polling — режим выбран админом явно.
            try {
                officialBotService.stopBot(account.id);
                if (normalizedKind === 'template') {
                    // template — без runtime
                } else if (isLocalDevelopment() || webhookMode !== 'webhook') {
                    officialBotService.startBot(account.id, botToken, botInfo.username, account.bot_role);
                } else {
                    officialBotService.startWebhookBot(account.id, botToken, botInfo.username, account.bot_role);
                }
            } catch (restartErr) {
                console.error(`[official-bot] runtime restart failed для ${account.id}: ${restartErr.message}`);
                return res.status(200).json({
                    success: true,
                    bot: botInfo,
                    webhook_reregistered: webhookReregistered,
                    warning: 'Токен сохранён, но бот не перезапустился — включи его вручную.'
                });
            }

            const payload = { success: true, bot: botInfo, webhook_reregistered: webhookReregistered };
            if (webhookWarning) payload.warning = webhookWarning;
            return res.status(200).json(payload);
        } catch (err) {
            if (err instanceof SalesContourError || isSalesContourFoundationError(err)) {
                return sendOfficialBotError(res, err, 'Не получилось обновить токен.', err.statusCode || 400);
            }
            console.error('Ошибка обновления токена бота:', err.message);
            res.status(500).json({ error: saved
                ? 'Токен сохранён, но при финализации что-то сломалось — проверь статус бота.'
                : 'Не получилось обновить токен, бот не тронут: ' + (err.message || err) });
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
}
