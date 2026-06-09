import { Router } from 'express';
import { AutopostService } from '../services/autopost.service.js';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import crypto from 'crypto';

export default function autopostRoutes(supabase) {
    const service = new AutopostService(supabase);
    const router = Router();

    // Все эндпоинты требуют авторизацию
    router.use(authenticateUser);

    // Список ботов
    router.get('/bots', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('autopost_bots')
                .select('*')
                .eq('owner_id', req.user.id)
                .order('created_at', { ascending: false });
            if (error) throw error;
            res.json({ bots: data });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Инициализация бота — валидация токена + создание + запуск
    router.post('/bots/init', async (req, res) => {
        try {
            const { botToken, adminTgId } = req.body;
            if (!botToken?.trim()) return res.status(400).json({ error: 'Токен обязателен' });

            const bot = await service.validateAndCreateBot({
                ownerId: req.user.id,
                botToken: botToken.trim(),
                adminTgId: adminTgId || undefined
            });
            res.json({ bot });
        } catch (err) {
            console.error('[Autopost] Ошибка init:', err.message);
            if (err.message.includes('401') || err.message.includes('unauthorized')) {
                return res.status(400).json({ error: 'Неверный токен бота' });
            }
            res.status(500).json({ error: err.message });
        }
    });

    // Обновление бота (канал, расписание)
    router.patch('/bots/:botId', async (req, res) => {
        try {
            const { targetChannelTgId, postsPerDay, postingTimes, adminTgId, is_active } = req.body;
            const updates = {};
            if (targetChannelTgId !== undefined) updates.target_channel_tg_id = targetChannelTgId;
            if (postsPerDay !== undefined) updates.posts_per_day = postsPerDay;
            if (postingTimes !== undefined) updates.posting_times = postingTimes;
            if (is_active !== undefined) updates.is_active = is_active;
            
            // Если adminTgId передан, синхронизируем с admin_tg_ids массивом
            if (adminTgId !== undefined) {
                updates.admin_tg_id = adminTgId || null;
                if (adminTgId) {
                    updates.admin_tg_ids = [Number(adminTgId)];
                } else {
                    updates.admin_tg_ids = [];
                }
            }

            // Проверяем владельца
            const { data: existing } = await supabase
                .from('autopost_bots')
                .select('owner_id')
                .eq('id', req.params.botId)
                .single();
            if (!existing || existing.owner_id !== req.user.id) {
                return res.status(403).json({ error: 'Нет доступа' });
            }

            const bot = await service.updateBot(req.params.botId, updates);
            
            // Если бот был остановлен/запущен
            if (is_active === false) {
                service.stopBot(bot.id);
            } else if (is_active === true) {
                service.startBot(bot.id, bot.bot_token);
            }
            
            res.json({ bot });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Каналы, привязанные к боту
    router.get('/bots/:botId/channels', async (req, res) => {
        try {
            const channels = await service.getBotChannels(req.params.botId);
            res.json({ channels });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Изменение настроек конкретного канала
    router.patch('/bots/:botId/channels/:channelId', async (req, res) => {
        try {
            const { auto_accept_suggestions, buttons_config, posts_per_day, posting_times } = req.body;
            
            // Проверяем владельца бота
            const { data: bot, error: botErr } = await supabase
                .from('autopost_bots')
                .select('id')
                .eq('id', req.params.botId)
                .eq('owner_id', req.user.id)
                .single();
            if (botErr || !bot) return res.status(403).json({ error: 'Нет доступа или бот не найден' });
            
            const updates = {};
            if (auto_accept_suggestions !== undefined) updates.auto_accept_suggestions = auto_accept_suggestions;
            if (buttons_config !== undefined) updates.buttons_config = buttons_config;
            if (posts_per_day !== undefined) updates.posts_per_day = Number(posts_per_day);
            if (posting_times !== undefined) updates.posting_times = posting_times;
            
            const { data: channel, error } = await supabase
                .from('channels')
                .update(updates)
                .eq('id', req.params.channelId)
                .eq('autopost_bot_id', req.params.botId)
                .select()
                .single();
                
            if (error) throw error;
            res.json({ channel });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Получить список администраторов бота и инвайт-ссылку
    router.get('/bots/:botId/admins', async (req, res) => {
        try {
            const { data: bot, error } = await supabase
                .from('autopost_bots')
                .select('admin_tg_ids, username')
                .eq('id', req.params.botId)
                .eq('owner_id', req.user.id)
                .single();
            if (error) throw error;
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });
            
            const inviteCode = crypto.createHash('sha256').update(req.params.botId).digest('hex').substring(0, 12);
            const inviteLink = bot.username ? `https://t.me/${bot.username}?start=add_admin_${inviteCode}` : null;
            
            res.json({
                admin_tg_ids: bot.admin_tg_ids || [],
                invite_link: inviteLink
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Добавить администратора вручную по Telegram ID
    router.post('/bots/:botId/admins', async (req, res) => {
        try {
            const { adminTgId } = req.body;
            if (!adminTgId) return res.status(400).json({ error: 'ID администратора обязателен' });
            
            const { data: bot, error } = await supabase
                .from('autopost_bots')
                .select('admin_tg_ids')
                .eq('id', req.params.botId)
                .eq('owner_id', req.user.id)
                .single();
            if (error) throw error;
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });
            
            const currentAdmins = bot.admin_tg_ids || [];
            const newAdmin = Number(adminTgId);
            if (isNaN(newAdmin)) return res.status(400).json({ error: 'ID должен быть числовым' });
            
            if (!currentAdmins.includes(newAdmin)) {
                currentAdmins.push(newAdmin);
                const { error: updateErr } = await supabase
                    .from('autopost_bots')
                    .update({ admin_tg_ids: currentAdmins })
                    .eq('id', req.params.botId);
                if (updateErr) throw updateErr;
            }
            res.json({ ok: true, admin_tg_ids: currentAdmins });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Удалить администратора из списка
    router.delete('/bots/:botId/admins/:tgId', async (req, res) => {
        try {
            const { data: bot, error } = await supabase
                .from('autopost_bots')
                .select('admin_tg_ids')
                .eq('id', req.params.botId)
                .eq('owner_id', req.user.id)
                .single();
            if (error) throw error;
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });
            
            const targetId = Number(req.params.tgId);
            const currentAdmins = (bot.admin_tg_ids || []).filter(id => Number(id) !== targetId);
            
            const { error: updateErr } = await supabase
                .from('autopost_bots')
                .update({ admin_tg_ids: currentAdmins })
                .eq('id', req.params.botId);
            if (updateErr) throw updateErr;
            
            res.json({ ok: true, admin_tg_ids: currentAdmins });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Создать бота (legacy — полный набор полей)
    router.post('/bots', async (req, res) => {
        try {
            const { botToken, targetChannelTgId, postsPerDay, postingTimes } = req.body;
            const bot = await service.createBot({
                ownerId: req.user.id,
                botToken,
                targetChannelTgId,
                postsPerDay: postsPerDay || 1,
                postingTimes: postingTimes || ['10:00']
            });
            res.json({ bot });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Статистика бота
    router.get('/bots/:botId/stats', async (req, res) => {
        try {
            const stats = await service.getStats(req.params.botId);
            res.json(stats);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Запустить планирование
    router.post('/bots/:botId/schedule', async (req, res) => {
        try {
            const count = await service.scheduleNextBatch(req.params.botId);
            res.json({ scheduled: count });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Список постов бота
    router.get('/bots/:botId/items', async (req, res) => {
        try {
            const { status } = req.query;
            let query = supabase
                .from('autopost_items')
                .select('*')
                .eq('bot_id', req.params.botId)
                .order('sort_order', { ascending: true });
            if (status) query = query.eq('status', status);
            const { data, error } = await query;
            if (error) throw error;
            res.json({ items: data });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Удалить пост из очереди
    router.delete('/items/:itemId', async (req, res) => {
        try {
            const { error } = await supabase
                .from('autopost_items')
                .delete()
                .eq('id', req.params.itemId);
            if (error) throw error;
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Удалить бота
    router.delete('/bots/:botId', async (req, res) => {
        try {
            const { data: existing } = await supabase
                .from('autopost_bots')
                .select('owner_id')
                .eq('id', req.params.botId)
                .single();
            if (!existing || existing.owner_id !== req.user.id) {
                return res.status(403).json({ error: 'Нет доступа' });
            }
            const { error } = await supabase
                .from('autopost_bots')
                .delete()
                .eq('id', req.params.botId);
            if (error) throw error;
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}
