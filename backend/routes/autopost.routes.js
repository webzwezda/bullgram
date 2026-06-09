import { Router } from 'express';
import { AutopostService } from '../services/autopost.service.js';
import { authenticateUser } from '../middlewares/auth.middleware.js';

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
            const { targetChannelTgId, postsPerDay, postingTimes, adminTgId } = req.body;
            const updates = {};
            if (targetChannelTgId !== undefined) updates.target_channel_tg_id = targetChannelTgId;
            if (postsPerDay !== undefined) updates.posts_per_day = postsPerDay;
            if (postingTimes !== undefined) updates.posting_times = postingTimes;
            if (adminTgId !== undefined) updates.admin_tg_id = adminTgId;

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
