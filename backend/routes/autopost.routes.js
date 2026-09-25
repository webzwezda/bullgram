import { Router } from 'express';
import { AutopostService } from '../services/autopost.service.js';
import { validateChecklistInput, renderChecklistSummary } from '../services/autopost/checklist.js';
import { normalizeSeedEmojiList } from '../services/autopost/handlers/reactions.js';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { enforceAutopostBotQuota } from '../utils/product-tier.js';
import { rateLimit } from '../middlewares/rate-limit.middleware.js';
import { isValidUuid } from '../shared/utils.js';

export default function autopostRoutes(supabase) {
    const service = new AutopostService(supabase);
    const router = Router();

    // Owner-probe для бот-scoped маршрутов. RLS не защищает (сервер ходит с сервисным
    // ключом), поэтому каждый маршрут обязан сам проверить владельца в коде — тот же
    // паттерн, что в GET /bots/:botId/metrics: фильтр по owner_id + maybeSingle.
    // Возвращает бота или null (не найден / чужой).
    async function findOwnedBot(botId, ownerId) {
        const { data: bot, error } = await supabase
            .from('autopost_bots')
            .select('id')
            .eq('id', botId)
            .eq('owner_id', ownerId)
            .maybeSingle();
        if (error) throw error;
        return bot || null;
    }

    // Все эндпоинты требуют авторизацию
    router.use(authenticateUser);

    // Маппинг plain-ошибок сервиса чек-листов (NOT_FOUND / ITEM_NOT_FOUND /
    // CHECKLIST_CANCELLED по message) в человеческие HTTP-ответы. Тот же словарь
    // текстов, что в MCP-хендлерах checklist-*.
    function mapChecklistError(err) {
        if (err?.message === 'NOT_FOUND') return { status: 404, error: 'Чек-лист удалён или не существует' };
        if (err?.message === 'ITEM_NOT_FOUND') return { status: 404, error: 'Пункт не найден в этом списке' };
        if (err?.message === 'CHECKLIST_CANCELLED') return { status: 422, error: 'Список закрыт — править нельзя' };
        if (err?.message === 'TOO_MANY_ITEMS') return { status: 422, error: 'В списке максимум 25 пунктов' };
        return null;
    }

    // Список ботов. Секреты не отдаём: bot_token маскируется (token_masked),
    // invite_secret заменяется на boolean-флаг. PATCH-флоу токен из списка
    // не требует — сервер читает его из БД сам (startBot по bot_token из строки).
    function maskBotToken(token) {
        const t = String(token || '');
        const idx = t.indexOf(':');
        // Короткий/битый секрет не раскрываем даже хвостом
        if (idx === -1 || idx < 4 || t.length < idx + 7) return '••••';
        return `${t.slice(0, idx)}:…${t.slice(-3)}`;
    }

    // Единая санитизация бот-строки для ответов API: секреты не покидают сервер
    function sanitizeBot(bot) {
        if (!bot) return bot;
        const { bot_token, invite_secret, ...rest } = bot;
        return { ...rest, token_masked: maskBotToken(bot_token), has_invite_secret: Boolean(invite_secret) };
    }

    router.get('/bots', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('autopost_bots')
                .select('id, owner_id, username, is_active, posts_per_day, posting_times, admin_tg_ids, active_modes, bot_token, invite_secret, created_at')
                .eq('owner_id', req.user.id)
                .order('created_at', { ascending: false });
            if (error) throw error;
            const bots = (data || []).map(({ bot_token, invite_secret, ...rest }) => ({
                ...rest,
                token_masked: maskBotToken(bot_token),
                has_invite_secret: Boolean(invite_secret)
            }));
            res.json({ bots });
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
            res.json({ bot: sanitizeBot(bot) });
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

            // Проверяем владельца. maybeSingle: несуществующий бот → 404, чужой → 403.
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

            const bot = await service.updateBot(req.params.botId, updates);
            
            // Если бот был остановлен/запущен
            if (is_active === false) {
                service.stopBot(bot.id);
            } else if (is_active === true) {
                service.startBot(bot.id, bot.bot_token);
            }
            
            res.json({ bot: sanitizeBot(bot) });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Каналы, привязанные к боту
    router.get('/bots/:botId/channels', async (req, res) => {
        try {
            if (!(await findOwnedBot(req.params.botId, req.user.id))) {
                return res.status(403).json({ error: 'Нет доступа' });
            }
            const channels = await service.getBotChannels(req.params.botId);
            res.json({ channels });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Изменение настроек конкретного канала
    router.patch('/bots/:botId/channels/:channelId', async (req, res) => {
        try {
            const { auto_accept_suggestions, buttons_config, posts_per_day, posting_times, timezone, suggestion_posts_per_day, suggestion_posting_times, suggest_button_enabled, max_suggestions_per_day, seed_reaction_emoji, seed_reaction_premium } = req.body;

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
            if (seed_reaction_emoji !== undefined) {
                // null = выключить. Иначе — до 3 эмодзи через запятую. Прогоняем через
                // нормализацию (❤️ → ❤, trim, dedupe, cap 3): Telegram в setMessageReaction
                // принимает каноничное '❤', с VS16 ('❤️') даёт REACTION_INVALID.
                const ALLOWED = ['❤️', '👍', '👎', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱', '🎉', '🤩', '💯', '💩', '🤣', '⚡'];
                const allowedSet = new Set(ALLOWED.map((x) => x.replace(/\uFE0F/g, '')));
                if (seed_reaction_emoji === null) {
                    updates.seed_reaction_emoji = null;
                } else {
                    const list = String(seed_reaction_emoji).split(',').map((x) => x.trim()).filter(Boolean);
                    const bad = list.filter((x) => !allowedSet.has(x.replace(/\uFE0F/g, '')));
                    if (!list.length || bad.length) {
                        return res.status(400).json({ error: 'Недопустимый эмодзи. Разрешены: ' + ALLOWED.join(' ') });
                    }
                    if (list.length > 3) {
                        return res.status(400).json({ error: 'Максимум 3 реакции' });
                    }
                    updates.seed_reaction_emoji = normalizeSeedEmojiList(seed_reaction_emoji);
                }
            }
            if (seed_reaction_premium !== undefined) {
                // Заявка владельца «у бота есть Telegram Premium». Не верифицируем:
                // если заявка ошибочна, рантайм-фолбэк в publishItem сам деградирует
                // до одиночной реакции.
                updates.seed_reaction_premium = seed_reaction_premium === true;
            }

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

    // --- Чек-листы автопостера ---
    // Thin-ручки над Phase-1 сервисом (services/autopost.service.js): owner-проверка
    // через findOwnedBot, дальше сервис. Те же сценарии, что у MCP-инструментов
    // checklist-* (mcp/tools/autopost/), но под JWT админки (created_by='admin').

    // Список чек-листов бота (фильтр status/limit/cursor)
    router.get('/bots/:botId/checklists', async (req, res) => {
        try {
            if (!(await findOwnedBot(req.params.botId, req.user.id))) {
                return res.status(403).json({ error: 'Нет доступа' });
            }
            const { status, limit, cursor } = req.query;
            const { items, nextCursor } = await service.listChecklists(req.params.botId, {
                status: status || undefined,
                limit: Number(limit) || 20,
                cursor: cursor || undefined
            });
            res.json({ items, next_cursor: nextCursor });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Создать чек-лист и поставить в очередь на каналы бота.
    // Rate-limit: 30 в минуту, один инстанс на create/PATCH/cancel — эти ручки
    // пишут несколько таблиц и дёргают перерисовку клавиатур.
    const checklistRateLimit = rateLimit({ windowMs: 60 * 1000, max: 30 });
    router.post('/bots/:botId/checklists', checklistRateLimit, async (req, res) => {
        try {
            const { items, title, channelIds, expiresAt, dedupKey } = req.body;

            const verdict = validateChecklistInput({ title, items, dedupKey });
            if (!verdict.ok) return res.status(400).json({ error: verdict.error });

            const bot = await findOwnedBot(req.params.botId, req.user.id);
            if (!bot) return res.status(403).json({ error: 'Нет доступа' });

            // Каналы обязаны быть подключены к этому боту (тот же паттерн, что в create-post).
            const ids = [...new Set((Array.isArray(channelIds) ? channelIds : []).map(String))];
            if (ids.length === 0) return res.status(400).json({ error: 'Нужен хотя бы один канал' });
            const { data: channels, error: chErr } = await supabase
                .from('channels')
                .select('id, tg_chat_id')
                .in('tg_chat_id', ids)
                .eq('autopost_bot_id', req.params.botId);
            if (chErr) throw chErr;
            const found = new Set((channels || []).map((c) => String(c.tg_chat_id)));
            const missing = ids.filter((id) => !found.has(id));
            if (missing.length > 0) {
                return res.status(400).json({ error: `Каналы не подключены к боту: ${missing.join(', ')}` });
            }

            let expiresAtValue = null;
            if (expiresAt) {
                const d = new Date(expiresAt);
                if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'expiresAt должен быть ISO 8601 датой' });
                expiresAtValue = d.toISOString();
            }
            const dedupKeyValue = dedupKey ? String(dedupKey).trim() : null;
            const titleValue = String(title || '').trim();

            // dedup: повторное создание с тем же ключом возвращает существующий список.
            if (dedupKeyValue) {
                const { data: existing } = await supabase
                    .from('autopost_checklists')
                    .select('*')
                    .eq('bot_id', req.params.botId)
                    .eq('dedup_key', dedupKeyValue)
                    .maybeSingle();
                if (existing) return res.json({ checklist: existing, already_exists: true });
            }

            const { data: checklist, error: insErr } = await supabase
                .from('autopost_checklists')
                .insert({
                    owner_id: req.user.id,
                    bot_id: req.params.botId,
                    title: titleValue,
                    created_by: 'admin',
                    expires_at: expiresAtValue,
                    dedup_key: dedupKeyValue
                })
                .select()
                .single();
            if (insErr) {
                // Гонка dedup: параллельный create успел — возвращаем существующий.
                if (insErr.code === '23505' && dedupKeyValue) {
                    const { data: existing } = await supabase
                        .from('autopost_checklists')
                        .select('*')
                        .eq('bot_id', req.params.botId)
                        .eq('dedup_key', dedupKeyValue)
                        .maybeSingle();
                    if (existing) return res.json({ checklist: existing, already_exists: true });
                }
                throw insErr;
            }

            const itemTexts = items.map((raw) => String(raw ?? '').trim());
            const { error: itemsErr } = await supabase.from('autopost_checklist_items').insert(
                itemTexts.map((text, idx) => ({ checklist_id: checklist.id, bot_id: req.params.botId, text, position: idx }))
            );
            if (itemsErr) throw itemsErr;

            // Событие created с атрибуцией админа. Best-effort: список уже создан.
            const { error: evErr } = await supabase.from('autopost_checklist_events').insert({
                checklist_id: checklist.id,
                action: 'created',
                actor_source: 'admin'
            });
            if (evErr) console.error('[Autopost] checklist created event failed:', evErr.message);

            // Публикация: строка очереди на каждый канал, ближайшие слоты через collapseQueue.
            await service.addPostItem({
                botId: req.params.botId,
                targetChannelIds: ids,
                fileIds: [],
                caption: titleValue,
                status: 'queued',
                checklistId: checklist.id
            });
            for (const cid of ids) {
                await service.collapseQueue(req.params.botId, cid);
            }

            res.json({ checklist: { ...checklist, items_count: itemTexts.length } });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Состояние чек-листа: пункты + кто отметил + summary
    router.get('/bots/:botId/checklists/:checklistId', async (req, res) => {
        try {
            if (!(await findOwnedBot(req.params.botId, req.user.id))) {
                return res.status(403).json({ error: 'Нет доступа' });
            }
            const state = await service.getChecklistState(req.params.botId, req.params.checklistId);
            res.json({
                checklist: state.checklist,
                items: state.items,
                summary: renderChecklistSummary(state.checklist, state.items)
            });
        } catch (err) {
            const mapped = mapChecklistError(err);
            if (mapped) return res.status(mapped.status).json({ error: mapped.error });
            res.status(500).json({ error: err.message });
        }
    });

    // Правка чек-листа: add/rename/remove/reset без потери отметок
    router.patch('/bots/:botId/checklists/:checklistId', checklistRateLimit, async (req, res) => {
        try {
            if (!(await findOwnedBot(req.params.botId, req.user.id))) {
                return res.status(403).json({ error: 'Нет доступа' });
            }
            const { add, rename, remove, reset } = req.body;
            if (!Array.isArray(add) && !Array.isArray(rename) && !Array.isArray(remove) && reset !== true) {
                return res.status(400).json({ error: 'Нужна хотя бы одна правка: add, rename, remove или reset' });
            }
            if (Array.isArray(add) && add.length > 0) {
                const verdict = validateChecklistInput({ items: add });
                if (!verdict.ok) return res.status(400).json({ error: verdict.error });
            }
            // Per-op валидация — зеркало MCP checklist_update.
            if (Array.isArray(rename)) {
                for (const r of rename) {
                    if (!isValidUuid(r?.item_id)) return res.status(422).json({ error: 'item_id должен быть UUID' });
                    const text = String(r?.text ?? '').trim();
                    if (text.length < 1 || text.length > 100) return res.status(422).json({ error: 'Текст пункта 1–100 символов' });
                }
            }
            if (Array.isArray(remove)) {
                for (const rawId of remove) {
                    if (!isValidUuid(rawId)) return res.status(422).json({ error: 'item_id должен быть UUID' });
                }
            }
            const state = await service.updateChecklist(
                req.params.botId,
                req.params.checklistId,
                { add, rename, remove, reset },
                { source: 'admin' }
            );
            res.json({
                checklist: state.checklist,
                items: state.items,
                summary: renderChecklistSummary(state.checklist, state.items)
            });
        } catch (err) {
            const mapped = mapChecklistError(err);
            if (mapped) return res.status(mapped.status).json({ error: mapped.error });
            res.status(500).json({ error: err.message });
        }
    });

    // Закрыть чек-лист: клавиатуры снимаются, несобранные строки очереди удаляются
    router.post('/bots/:botId/checklists/:checklistId/cancel', checklistRateLimit, async (req, res) => {
        try {
            if (!(await findOwnedBot(req.params.botId, req.user.id))) {
                return res.status(403).json({ error: 'Нет доступа' });
            }
            const state = await service.cancelChecklist(req.params.botId, req.params.checklistId, { source: 'admin' });
            res.json({ checklist: state.checklist });
        } catch (err) {
            const mapped = mapChecklistError(err);
            if (mapped) return res.status(mapped.status).json({ error: mapped.error });
            res.status(500).json({ error: err.message });
        }
    });

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

    return router;
}
