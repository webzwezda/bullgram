import { Router } from 'express';
import { AutopostService } from '../services/autopost.service.js';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { enforceAutopostBotQuota } from '../utils/product-tier.js';
import { rateLimit } from '../middlewares/rate-limit.middleware.js';

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
    // Rate-limit: 5 попыток в час с одного IP (защита от брутфорса токенов)
    router.post('/bots/init', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }), async (req, res) => {
        try {
            const { botToken, adminTgId } = req.body;
            if (!botToken?.trim()) return res.status(400).json({ error: 'Токен обязателен' });

            await enforceAutopostBotQuota({
                supabase,
                ownerId: req.user.id,
                profile: req.profile
            });

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
            if (err.message.startsWith('На тарифе')) {
                return res.status(403).json({ error: err.message });
            }
            res.status(500).json({ error: err.message });
        }
    });

    // Обновление бота (расписание, статус, админы)
    router.patch('/bots/:botId', async (req, res) => {
        try {
            const { postsPerDay, postingTimes, adminTgId, is_active } = req.body;
            const updates = {};
            if (postsPerDay !== undefined) updates.posts_per_day = postsPerDay;
            if (postingTimes !== undefined) updates.posting_times = postingTimes;
            if (is_active !== undefined) updates.is_active = is_active;

            // Если adminTgId передан, синхронизируем с admin_tg_ids массивом
            if (adminTgId !== undefined) {
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
            const { auto_accept_suggestions, buttons_config, posts_per_day, posting_times, timezone, suggestion_posts_per_day, suggestion_posting_times, suggest_button_enabled, max_suggestions_per_day } = req.body;
            
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
            if (timezone !== undefined) updates.timezone = timezone;
            if (suggestion_posts_per_day !== undefined) updates.suggestion_posts_per_day = Number(suggestion_posts_per_day);
            if (suggestion_posting_times !== undefined) updates.suggestion_posting_times = suggestion_posting_times;
            if (suggest_button_enabled !== undefined) updates.suggest_button_enabled = suggest_button_enabled;
            if (max_suggestions_per_day !== undefined) updates.max_suggestions_per_day = Number(max_suggestions_per_day);
            
            const { data: channel, error } = await supabase
                .from('channels')
                .update(updates)
                .eq('id', req.params.channelId)
                .eq('autopost_bot_id', req.params.botId)
                .select()
                .single();
                
            if (error) throw error;
            
            // Пересобираем очередь при смене лимитов, времени или таймзоны
            if (
                posts_per_day !== undefined || 
                posting_times !== undefined || 
                timezone !== undefined || 
                suggestion_posts_per_day !== undefined || 
                suggestion_posting_times !== undefined
            ) {
                if (channel.tg_chat_id) {
                    await service.collapseQueue(req.params.botId, channel.tg_chat_id);
                }
            }
            
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
                .select('admin_tg_ids, username, invite_secret')
                .eq('id', req.params.botId)
                .eq('owner_id', req.user.id)
                .single();
            if (error) throw error;
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });

            const inviteLink = (bot.username && bot.invite_secret)
                ? `https://t.me/${bot.username}?start=add_admin_${bot.invite_secret}`
                : null;

            res.json({
                admin_tg_ids: bot.admin_tg_ids || [],
                invite_link: inviteLink
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Сгенерировать новый инвайт-ссылку (старая перестанет работать)
    router.post('/bots/:botId/admins/regenerate-invite', async (req, res) => {
        try {
            const { data: bot, error } = await supabase
                .from('autopost_bots')
                .select('username')
                .eq('id', req.params.botId)
                .eq('owner_id', req.user.id)
                .single();
            if (error) throw error;
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });

            const updated = await service.regenerateInviteSecret(req.params.botId);
            const inviteLink = bot.username
                ? `https://t.me/${bot.username}?start=add_admin_${updated.invite_secret}`
                : null;

            res.json({ invite_link: inviteLink });
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

    // Создать бота (legacy — полный набор полей; без валидации токена)
    router.post('/bots', async (req, res) => {
        try {
            const { botToken, postsPerDay, postingTimes } = req.body;
            const bot = await service.createBot({
                ownerId: req.user.id,
                botToken,
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

    // Метрики для оператора: состояние очереди, channels, health-флаги.
    // Отличается от /stats тем, что показывает per-channel breakdown и флаг здоровья.
    router.get('/bots/:botId/metrics', async (req, res) => {
        try {
            const botId = req.params.botId;
            const { data: bot, error: botErr } = await supabase
                .from('autopost_bots')
                .select('id, username, is_active, created_at')
                .eq('id', botId)
                .eq('owner_id', req.user.id)
                .maybeSingle();
            if (botErr) throw botErr;
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });

            const [stats, channels] = await Promise.all([
                service.getStats(botId),
                supabase
                    .from('channels')
                    .select('id, tg_chat_id, title, visibility, posts_per_day, posting_times')
                    .eq('autopost_bot_id', botId)
            ]);

            const { data: perChannel } = await supabase
                .from('autopost_items')
                .select('target_channel_id, status, is_suggestion')
                .eq('bot_id', botId)
                .in('status', ['queued', 'scheduled']);

            const byChannel = {};
            for (const row of perChannel || []) {
                const key = String(row.target_channel_id);
                byChannel[key] = byChannel[key] || { queued: 0, scheduled: 0, suggestion: 0 };
                if (row.status === 'queued') byChannel[key].queued++;
                if (row.status === 'scheduled') byChannel[key].scheduled++;
                if (row.is_suggestion) byChannel[key].suggestion++;
            }

            const lastFailure = await supabase
                .from('autopost_items')
                .select('id, target_channel_id, updated_at')
                .eq('bot_id', botId)
                .eq('status', 'failed')
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            res.json({
                bot: { id: bot.id, username: bot.username, isActive: bot.is_active },
                totals: stats,
                channels: (channels.data || []).map(ch => ({
                    id: ch.id,
                    tgChatId: String(ch.tg_chat_id),
                    title: ch.title,
                    visibility: ch.visibility,
                    postsPerDay: ch.posts_per_day,
                    postingTimes: ch.posting_times,
                    pending: byChannel[String(ch.tg_chat_id)] || { queued: 0, scheduled: 0, suggestion: 0 }
                })),
                lastFailure: lastFailure.data || null,
                healthy: Boolean(bot.is_active) && !(stats.failed > 0 && stats.queued === 0 && stats.scheduled === 0)
            });
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

    // Отвязать канал от бота автопостера
    router.delete('/bots/:botId/channels/:channelId', async (req, res) => {
        try {
            // Проверяем владельца бота
            const { data: bot, error: botErr } = await supabase
                .from('autopost_bots')
                .select('id')
                .eq('id', req.params.botId)
                .eq('owner_id', req.user.id)
                .single();
            if (botErr || !bot) return res.status(403).json({ error: 'Нет доступа или бот не найден' });
            
            const { data: channel, error } = await supabase
                .from('channels')
                .update({ autopost_bot_id: null })
                .eq('id', req.params.channelId)
                .eq('autopost_bot_id', req.params.botId)
                .select()
                .single();
                
            if (error) throw error;
            res.json({ success: true, channel });
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
