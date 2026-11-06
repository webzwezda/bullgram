import { Telegraf } from 'telegraf';
import { SalesContourError, isSalesContourFoundationError } from '../../services/sales-contour.service.js';
import { createContourAdminRightsService } from '../../services/contour-admin-rights.service.js';
import { decrypt } from '../../utils/crypto.js';
import { authenticateUser } from '../../middlewares/auth.middleware.js';

export function registerContourRoutes(router, ctx) {
    const { supabase, salesContourService, buildActorRightsByTarget, sendOfficialBotError } = ctx;

    const CONTOUR_ACTOR_RIGHTS_SELECT = 'bot_id, actor_type, actor_id, target, state, is_admin, checked_at';

    // Права акторов контура по площадкам (official bot + юзерботы) для ботов владельца.
    async function loadContourActorRights(supabase, ownerId, botIds) {
        const ids = Array.from(new Set((botIds || []).map((id) => String(id)).filter(Boolean)));
        if (!ids.length) return [];
        const { data, error } = await supabase
            .from('sales_contour_actor_rights')
            .select(CONTOUR_ACTOR_RIGHTS_SELECT)
            .eq('owner_id', ownerId)
            .in('bot_id', ids);
        if (error) throw error;
        return data || [];
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

    // Права всех акторов контура (official bot + юзерботы) по площадкам, из
    // sales_contour_actor_rights. Таблицы может не быть (SQL не применён) или она пуста —
    // тогда отдаём пустой объект, ничего не ломая в основном ответе.
    router.get('/contours', authenticateUser, async (req, res) => {
        try {
            const data = await salesContourService.getContoursOverview(req.user.id);
            const bots = Array.isArray(data?.bots) ? data.bots : [];
            let actorRows = [];
            try {
                actorRows = await loadContourActorRights(supabase, req.user.id, bots.map((bot) => bot.id));
            } catch (actorError) {
                console.warn('[contours] actor rights load failed (fail-soft):', actorError?.message || actorError);
            }
            const actorRowsByBotId = new Map();
            for (const row of actorRows) {
                const botKey = String(row?.bot_id || '');
                if (!botKey) continue;
                if (!actorRowsByBotId.has(botKey)) actorRowsByBotId.set(botKey, []);
                actorRowsByBotId.get(botKey).push(row);
            }
            data.bots = bots.map((bot) => ({
                ...bot,
                actor_rights_by_target: buildActorRightsByTarget(actorRowsByBotId.get(String(bot.id)) || [])
            }));
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

    router.post('/contours/check-rights', authenticateUser, async (req, res) => {
        try {
            const botApi = await createSalesContourBotApi(req.user.id, req.body?.bot_id ?? req.body?.account_id);
            const data = await salesContourService.getBotChatRights(req.user.id, req.body || {}, botApi);
            res.json({ success: true, ...data });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось проверить права бота в Telegram');
        }
    });

    // ensure-admin: проверяет и выдаёт админ-права official-боту и юзерботам по всем
    // площадкам контура. Синхронный ответ: results по каждой ячейке (target × actor).
    router.post('/contours/ensure-admin', authenticateUser, async (req, res) => {
        try {
            const botId = req.body?.bot_id ?? req.body?.account_id;
            if (!botId) {
                return res.status(400).json({ error: 'Не передан bot_id' });
            }
            const botApi = await createSalesContourBotApi(req.user.id, botId);
            const adminRightsService = createContourAdminRightsService(supabase, {
                botApiFactory: async () => botApi
            });
            const data = await adminRightsService.ensureAll(req.user.id, { botId, autoJoin: true });
            res.json({ success: true, results: data.results, summary: data.summary });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось выдать права в контуре');
        }
    });

    router.post('/contours/join-all', authenticateUser, async (req, res) => {
        try {
            const botApi = await createSalesContourBotApi(req.user.id, req.body?.bot_id ?? req.body?.account_id);
            const { UserbotService } = await import('../../services/userbot.service.js');
            const userbotService = new UserbotService(supabase);
            await salesContourService.startJoinAll(req.user.id, req.body || {}, botApi, userbotService);
            res.status(202).json({ success: true, status: 'running' });
        } catch (error) {
            console.error('[join-all] FAILED:', error);
            return sendOfficialBotError(res, error, 'Не получилось подключить юзербота ко всем площадкам');
        }
    });

    router.get('/contours/join-all/status', authenticateUser, async (req, res) => {
        try {
            const data = await salesContourService.getJoinAllStatus(req.user.id, req.query || {});
            res.json(data);
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось получить статус вступления в площадки');
        }
    });

    router.patch('/contours/userbot-active', authenticateUser, async (req, res) => {
        try {
            const data = await salesContourService.toggleUserbotBinding(
                req.user.id,
                req.body?.bot_id,
                req.body?.userbot_id,
                !!req.body?.is_active
            );
            res.json({ success: true, ...data });
        } catch (error) {
            return sendOfficialBotError(res, error, 'Не получилось переключить статус юзербота');
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
                .maybeSingle();

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
                .select('id, owner_id, bot_id, tg_chat_id, title, chat_type, visibility')
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

            // Ребаланс контура: если канал привязан к слоту, который не соответствует
            // текущей видимости, переносим в правильный слот.
            // Старый обитатель целевого слота (если был) падает в «Свободные площадки».
            // Проверка идёт всегда (даже без смены visibility) — чтобы чинить связи,
            // оставшиеся с предыдущих refresh-ов до того, как логика ребаланса появилась.
            let contourChange = null;
            if (visibility === 'public' || visibility === 'private') {
                const { data: contours } = await supabase
                    .from('sales_bot_contours')
                    .select('bot_id, public_channel_id, paid_channel_id, public_chat_id, paid_chat_id')
                    .or(`public_channel_id.eq.${channel.id},paid_channel_id.eq.${channel.id},public_chat_id.eq.${channel.id},paid_chat_id.eq.${channel.id}`)
                    .eq('owner_id', req.user.id);

                const c = (contours || [])[0];
                if (c) {
                    const isChannel = chatType === 'channel';
                    const targetField = isChannel
                        ? (visibility === 'public' ? 'public_channel_id' : 'paid_channel_id')
                        : (visibility === 'public' ? 'public_chat_id' : 'paid_chat_id');

                    const contourFields = ['public_channel_id', 'paid_channel_id', 'public_chat_id', 'paid_chat_id'];
                    const currentField = contourFields.find((f) => c[f] === channel.id);

                    if (currentField && currentField !== targetField) {
                        const displacedChannelId = c[targetField] || null;
                        const { error: updErr } = await supabase
                            .from('sales_bot_contours')
                            .update({
                                [currentField]: null,
                                [targetField]: channel.id
                            })
                            .eq('bot_id', c.bot_id)
                            .eq('owner_id', req.user.id);
                        if (updErr) throw updErr;
                        contourChange = {
                            from: currentField,
                            to: targetField,
                            displacedChannelId
                        };
                    }
                }
            }

            res.json({ success: true, channel: data, contourChange });
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

            for (const field of ['public_channel_id', 'paid_channel_id', 'public_chat_id', 'paid_chat_id']) {
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
}
