import { Router } from 'express';
import { AutopostService } from '../services/autopost.service.js';

export default function autopostRoutes(supabase) {
    const service = new AutopostService(supabase);
    const router = Router();

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

    // Создать бота
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

    return router;
}
