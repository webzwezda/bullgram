export function registerAdminRoutes(router, deps) {
    const { supabase, service, findOwnedBot } = deps;

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

    // Статистика бота
    router.get('/bots/:botId/stats', async (req, res) => {
        try {
            if (!(await findOwnedBot(req.params.botId, req.user.id))) {
                return res.status(403).json({ error: 'Нет доступа' });
            }
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
                .select('id, target_channel_id, updated_at, error_message')
                .eq('bot_id', botId)
                .eq('status', 'failed')
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            res.json({
                bot: {
                    id: bot.id,
                    username: bot.username,
                    isActive: bot.is_active,
                    // is_active в БД не означает, что бот реально опрашивает Telegram.
                    // Этот флаг проверяет именно in-memory реестр bot-lifecycle — если он false,
                    // публикации не идут, scheduler попытается авто-restart на следующем тике.
                    isRunning: Boolean(service.getBot(bot.id))
                },
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
            if (!(await findOwnedBot(req.params.botId, req.user.id))) {
                return res.status(403).json({ error: 'Нет доступа' });
            }
            const count = await service.scheduleNextBatch(req.params.botId);
            res.json({ scheduled: count });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Ручной restart polling'а. PATCH с is_active коротит по has(botId) в
    // startAutopostBot, поэтому для зависшего в Map бота нужен явный stop+start.
    router.post('/bots/:botId/restart', async (req, res) => {
        try {
            const { data: bot, error } = await supabase
                .from('autopost_bots')
                .select('id, bot_token, is_active')
                .eq('id', req.params.botId)
                .eq('owner_id', req.user.id)
                .single();
            if (error || !bot) return res.status(404).json({ error: 'Бот не найден' });

            service.stopBot(bot.id);
            if (bot.is_active) {
                service.startBot(bot.id, bot.bot_token);
            }
            res.json({
                ok: true,
                isRunning: bot.is_active ? Boolean(service.getBot(bot.id)) : false
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Список постов бота
    router.get('/bots/:botId/items', async (req, res) => {
        try {
            if (!(await findOwnedBot(req.params.botId, req.user.id))) {
                return res.status(403).json({ error: 'Нет доступа' });
            }
            const { status } = req.query;
            let query = supabase
                .from('autopost_items')
                .select('*', { count: 'exact' })
                .eq('bot_id', req.params.botId)
                .order('sort_order', { ascending: true })
                .limit(500);
            if (status) query = query.eq('status', status);
            const { data, error, count } = await query;
            if (error) throw error;
            res.json({ items: data, total: count ?? (data || []).length });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
}
