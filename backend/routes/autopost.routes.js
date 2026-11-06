import { Router } from 'express';
import { AutopostService } from '../services/autopost.service.js';
import { normalizeSeedEmojiList } from '../services/autopost/handlers/reactions.js';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { enforceAutopostBotQuota } from '../utils/product-tier.js';
import { rateLimit } from '../middlewares/rate-limit.middleware.js';
import { registerAdminRoutes } from './autopost/admin-routes.js';
import { registerChecklistRoutes } from './autopost/checklist-routes.js';
import { registerItemRoutes } from './autopost/item-routes.js';

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

    registerAdminRoutes(router, { supabase, service, findOwnedBot });
    registerChecklistRoutes(router, { supabase, service, findOwnedBot, mapChecklistError });
    registerItemRoutes(router, { supabase, service, findOwnedBot });

    return router;
}
