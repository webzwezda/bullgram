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
import { decrypt } from '../utils/crypto.js';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { registerWebhookRoutes } from './official-bot/webhook.js';
import { registerBotManagementRoutes } from './official-bot/bot-management.js';
import { registerContourRoutes } from './official-bot/contours.js';

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

function isOfficialBotWebhookFoundationError(error) {
    return error?.code === '42P01'
        || error?.code === '42703'
        || String(error?.message || '').includes('official_bot_update_queue')
        || String(error?.message || '').includes('webhook_secret')
        || String(error?.message || '').includes('webhook_mode');
}

// Чистая группировка: строки sales_contour_actor_rights → { [target]: [{ actor_type,
// actor_id, state, is_admin, checked_at }] }. Внутри площадки official_bot идёт первым,
// дальше юзерботы; внутри одного типа — свежий checked_at первым.
export function buildActorRightsByTarget(rows) {
    const officialBotRank = (type) => (String(type) === 'official_bot' ? 0 : 1);
    const sorted = [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
        const rankDiff = officialBotRank(a?.actor_type) - officialBotRank(b?.actor_type);
        if (rankDiff !== 0) return rankDiff;
        return new Date(b?.checked_at || 0) - new Date(a?.checked_at || 0);
    });

    const byTarget = {};
    for (const row of sorted) {
        const target = String(row?.target || '').trim();
        if (!target) continue;
        if (!byTarget[target]) byTarget[target] = [];
        byTarget[target].push({
            actor_type: String(row.actor_type || ''),
            actor_id: String(row.actor_id || ''),
            state: String(row.state || 'unknown'),
            is_admin: !!row.is_admin,
            checked_at: row.checked_at || null
        });
    }
    return byTarget;
}

function getOfficialBotWebhookOrigin() {
    return String(
        process.env.OFFICIAL_BOT_WEBHOOK_ORIGIN
        || process.env.PUBLIC_API_ORIGIN
        || process.env.PUBLIC_APP_ORIGIN
        || 'https://bullgram.xyz'
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

/**
 * Роуты для официальных ботов
 */
export default function (supabase) {
    const router = express.Router();

    // Устанавливаем supabase в сервис
    officialBotService.supabase = supabase;
    salesContourService.supabase = supabase;

    const ctx = {
        supabase,
        officialBotService,
        salesContourService,
        OFFICIAL_BOT_WEBHOOK_ALLOWED_UPDATES,
        normalizeWebhookMode,
        shouldStartOfficialBotRuntime,
        isLocalDevelopment,
        isOfficialBotWebhookFoundationError,
        generateOfficialBotWebhookSecret,
        buildOfficialBotWebhookUrl,
        loadOwnedOfficialBotAccount,
        sendOfficialBotError,
        buildActorRightsByTarget
    };

    registerWebhookRoutes(router, ctx);

    registerBotManagementRoutes(router, ctx);

    registerContourRoutes(router, ctx);

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

    // Удалить бота целиком: остановка runtime, снятие webhook, detach тарифов,
    // удаление строки tg_accounts. sales_bot_contours / official_bot_userbot_bindings /
    // official_bot_update_queue / channels уходят по cascade.
    router.delete('/:accountId', authenticateUser, async (req, res) => {
        try {
            const account = await loadOwnedOfficialBotAccount(supabase, req.user.id, req.params.accountId);
            if (!account) return res.status(404).json({ error: 'Бот не найден' });

            // 1) Стопаем локальный runtime (polling/webhook service instance).
            officialBotService.stopBot(account.id);

            // 2) Снимаем webhook у Telegram — best effort, не падаем если токен уже невалиден.
            if (account.session_data) {
                try {
                    const token = decrypt(account.session_data);
                    const cleanupBot = new Telegraf(token);
                    await cleanupBot.telegram.deleteWebhook({ drop_pending_updates: false });
                } catch (cleanupErr) {
                    console.warn(`[official-bot] deleteWebhook skip для ${account.id}: ${cleanupErr.message}`);
                }
            }

            // 3) Detach тарифов — tariffs.bot_id имеет NO ACTION, без этого удаление не пройдёт.
            //     Тарифы остаются, просто привязка к боту отваливается.
            const { error: detachTariffsError } = await supabase
                .from('tariffs')
                .update({ bot_id: null })
                .eq('bot_id', account.id)
                .eq('owner_id', req.user.id);
            if (detachTariffsError) throw detachTariffsError;

            // 4) Удаляем сам аккаунт. Cascade почистит sales_bot_contours, channels,
            //    official_bot_userbot_bindings, official_bot_update_queue.
            const { error: deleteError } = await supabase
                .from('tg_accounts')
                .delete()
                .eq('id', account.id)
                .eq('owner_id', req.user.id)
                .eq('account_type', 'bot');
            if (deleteError) throw deleteError;

            res.json({ success: true });
        } catch (err) {
            console.error('Ошибка удаления бота:', err.message);
            res.status(500).json({ error: 'Не получилось удалить бота' });
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
