import express from 'express';
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

function shouldStartOfficialBotRuntime(botKind) {
    return normalizeBotKind(botKind, { allowMissing: true }) !== 'template';
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

            const { data: insertedAccount, error } = await supabase.from('tg_accounts').upsert({
                owner_id: req.user.id,
                account_type: 'bot',
                tg_account_id: botInfo.id.toString(),
                tg_username: botInfo.username,
                session_data: encryptedToken,
                bot_role: normalizedRole,
                bot_kind: normalizedKind,
                admin_tg_id: normalizedAdminTgId,
                admin_tg_username: adminTgUsername
            }, { onConflict: 'owner_id, tg_account_id' }).select().single();

            if (error) throw error;

            officialBotService.stopBot(insertedAccount.id);
            if (shouldStartOfficialBotRuntime(normalizedKind)) {
                officialBotService.startBot(insertedAccount.id, botToken, botInfo.username, normalizedRole);
            }

            res.status(200).json({
                success: true,
                bot: botInfo,
                account_id: insertedAccount.id,
                bot_role: normalizedRole,
                bot_kind: normalizedKind,
                runtime_started: shouldStartOfficialBotRuntime(normalizedKind)
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
            if (shouldStartOfficialBotRuntime(account.bot_kind)) {
                officialBotService.startBot(account.id, token, account.tg_username, normalizedRole);
            }

            res.json({
                success: true,
                bot_role: normalizedRole,
                bot_kind: normalizeBotKind(account.bot_kind, { allowMissing: true }) || 'sales',
                runtime_started: shouldStartOfficialBotRuntime(account.bot_kind)
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

            if (shouldStartOfficialBotRuntime(normalizedKind)) {
                const token = decrypt(account.session_data);
                officialBotService.startBot(account.id, token, account.tg_username, account.bot_role || 'sales');
            }

            res.json({
                success: true,
                bot_kind: normalizedKind,
                bot_role: account.bot_role || 'sales',
                runtime_started: shouldStartOfficialBotRuntime(normalizedKind)
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
                .select('id, owner_id, bot_id, tg_chat_id, title, chat_type')
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

            res.json({ success: true, channel: data });
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

            if ((contourUsages || []).some((contour) => String(contour.paid_channel_id || '') === channelId)) {
                throw new SalesContourError(
                    'Нельзя удалить площадку, пока она выбрана как закрытый канал контура. Сначала выберите другой закрытый канал.',
                    409,
                    'channel_used_as_paid_channel'
                );
            }

            for (const field of ['public_channel_id', 'public_chat_id', 'paid_chat_id']) {
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
            if (!shouldStartOfficialBotRuntime(account.bot_kind || 'sales')) {
                officialBotService.stopBot(account.id);
                continue;
            }
            const token = decrypt(account.session_data);
            officialBotService.startBot(account.id, token, account.tg_username, account.bot_role || 'sales');
        } catch (err) { console.error(`Не удалось запустить бота:`, err.message); }
    }
}
