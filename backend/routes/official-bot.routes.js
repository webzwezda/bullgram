import express from 'express';
import { Telegraf } from 'telegraf';
import { OfficialBotService } from '../services/official-bot.service.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { authenticateUser } from '../middlewares/auth.middleware.js';

const officialBotService = new OfficialBotService(null); // Supabase будет установлен позже через init

/**
 * Роуты для официальных ботов
 */
export default function (supabase) {
    const router = express.Router();

    // Устанавливаем supabase в сервис
    officialBotService.supabase = supabase;

    // ==========================================
    // ДОБАВЛЕНИЕ БОТА ПО ТОКЕНУ
    // ==========================================
    router.post('/add', authenticateUser, async (req, res) => {
        const { botToken, botRole, admin_tg_id } = req.body;
        if (!botToken) return res.status(400).json({ error: 'Токен не передан' });

        try {
            const bot = new Telegraf(botToken);
            const botInfo = await bot.telegram.getMe();
            const encryptedToken = encrypt(botToken);
            const normalizedRole = botRole === 'ops' ? 'ops' : 'sales';
            const normalizedAdminTgId = String(admin_tg_id || '').trim() || null;

            const { data: insertedAccount, error } = await supabase.from('tg_accounts').upsert({
                owner_id: req.user.id,
                account_type: 'bot',
                tg_account_id: botInfo.id.toString(),
                tg_username: botInfo.username,
                session_data: encryptedToken,
                bot_role: normalizedRole,
                admin_tg_id: normalizedAdminTgId
            }, { onConflict: 'owner_id, tg_account_id' }).select().single();

            if (error) throw error;

            officialBotService.stopBot(insertedAccount.id);
            officialBotService.startBot(insertedAccount.id, botToken, botInfo.username, normalizedRole);

            res.status(200).json({ success: true, bot: botInfo });
        } catch (err) {
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
                .select('id')
                .eq('id', account_id)
                .eq('owner_id', req.user.id)
                .eq('account_type', 'bot')
                .single();

            if (accountError || !account) {
                return res.status(404).json({ error: 'Бот не найден' });
            }

            const { error: updateError } = await supabase
                .from('tg_accounts')
                .update({ admin_tg_id: normalizedAdminTgId })
                .eq('id', account.id)
                .eq('owner_id', req.user.id);

            if (updateError) throw updateError;

            res.json({ success: true, admin_tg_id: normalizedAdminTgId });
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
            officialBotService.startBot(account.id, token, account.tg_username, normalizedRole);

            res.json({ success: true, bot_role: normalizedRole });
        } catch (error) {
            console.error('Ошибка смены роли бота:', error.message);
            res.status(500).json({ error: 'Не получилось сменить роль бота' });
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
            const token = decrypt(account.session_data);
            officialBotService.startBot(account.id, token, account.tg_username, account.bot_role || 'sales');
        } catch (err) { console.error(`Не удалось запустить бота:`, err.message); }
    }
}
