export function registerItemRoutes(router, deps) {
    const { supabase, service, findOwnedBot } = deps;

    // Удалить пост из очереди
    router.delete('/items/:itemId', async (req, res) => {
        try {
            // Сначала узнаём bot_id поста и проверяем владельца бота:
            // сервисный ключ обходит RLS, поэтому проверка в коде обязательна.
            const { data: item, error: itemErr } = await supabase
                .from('autopost_items')
                .select('id, bot_id')
                .eq('id', req.params.itemId)
                .maybeSingle();
            if (itemErr) throw itemErr;
            if (!item) return res.status(404).json({ error: 'Пост не найден' });

            if (!(await findOwnedBot(item.bot_id, req.user.id))) {
                return res.status(403).json({ error: 'Нет доступа' });
            }

            const { error } = await supabase
                .from('autopost_items')
                .delete()
                .eq('id', req.params.itemId)
                .eq('bot_id', item.bot_id);
            if (error) throw error;
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Очистить журнал от провалившихся публикаций (записи в Bullgram, не посты в Telegram)
    router.delete('/bots/:botId/items/failed', async (req, res) => {
        try {
            if (!(await findOwnedBot(req.params.botId, req.user.id))) {
                return res.status(403).json({ error: 'Нет доступа или бот не найден' });
            }
            const { data, error } = await supabase
                .from('autopost_items')
                .delete()
                .eq('bot_id', req.params.botId)
                .eq('status', 'failed')
                .select('id');
            if (error) throw error;
            res.json({ ok: true, deleted: data?.length || 0 });
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

    // Обновить метаданные канала (title, username, visibility) через getChat.
    // Если бот больше не админ в канале — авто-отвязываем (связь протухла).
    router.post('/bots/:botId/channels/:channelId/refresh', async (req, res) => {
        try {
            const { data: bot, error: botErr } = await supabase
                .from('autopost_bots')
                .select('id')
                .eq('id', req.params.botId)
                .eq('owner_id', req.user.id)
                .single();
            if (botErr || !bot) return res.status(403).json({ error: 'Нет доступа или бот не найден' });

            const { data: channel, error: chErr } = await supabase
                .from('channels')
                .select('id, tg_chat_id')
                .eq('id', req.params.channelId)
                .eq('autopost_bot_id', req.params.botId)
                .single();
            if (chErr || !channel) return res.status(404).json({ error: 'Канал не найден' });

            const tgBot = service.getBot(req.params.botId);
            if (!tgBot) return res.status(503).json({ error: 'Бот не запущен' });

            let chat;
            try {
                chat = await tgBot.telegram.getChat(channel.tg_chat_id);
            } catch (e) {
                await supabase.from('channels')
                    .update({ autopost_bot_id: null })
                    .eq('id', channel.id);
                return res.json({ unbound: true, reason: 'Бот больше не админ в этом канале' });
            }

            const visibility = chat.username ? 'public' : 'private';
            const { data: updated, error: updErr } = await supabase.from('channels').update({
                title: chat.title || String(chat.id),
                username: chat.username || null,
                visibility,
                last_visibility_check_at: new Date().toISOString()
            }).eq('id', channel.id).select().single();

            if (updErr) throw updErr;
            res.json({ channel: updated, unbound: false });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Удалить бота
    router.delete('/bots/:botId', async (req, res) => {
        try {
            // maybeSingle: несуществующий бот → 404, чужой → 403.
            const { data: existing, error: probeErr } = await supabase
                .from('autopost_bots')
                .select('owner_id')
                .eq('id', req.params.botId)
                .maybeSingle();
            if (probeErr) throw probeErr;
            if (!existing) return res.status(404).json({ error: 'Бот не найден' });
            if (existing.owner_id !== req.user.id) {
                return res.status(403).json({ error: 'Нет доступа' });
            }
            // Останавливаем polling ДО удаления строки — иначе Telegraf-инстанс
            // остаётся в реестре bot-lifecycle и отвечает юзерам ошибками до рестарта.
            // stopBot идемпотентен: нет бота в Map — просто return.
            service.stopBot(req.params.botId);
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
}
