// Лента рабочего центра: тред диалога, отметка прочтения, вход по инвайту
// и управление активными сессиями (финальная стадия 2b разрезки userbot.routes.js).
// Зона: GET /ops-center/thread, POST /ops-center/mark-read, POST /ops-center/join-invite,
// GET /ops-center/authorizations, POST /ops-center/authorizations/reset-others,
// POST /ops-center/authorizations/reset-one.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { Api } from 'telegram';
import { loadOperationalUserbot, normalizeMessageDate, parseTelegramInvite } from './helpers-core.js';

export function registerOpsCenterFeed(router, ctx) {
    const { supabase, userbotService } = ctx;
    router.get('/ops-center/thread', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const tgUserId = req.query.tg_user_id ? String(req.query.tg_user_id) : null;

            if (!tgUserId) {
                return res.status(400).json({ error: 'Не передан TG ID диалога' });
            }

            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId);
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            const client = await userbotService.createAuthorizedClient(userbot, 1);
            try {
                let peer = null;

                try {
                    peer = await client.getInputEntity(tgUserId);
                } catch {
                    peer = null;
                }

                if (!peer) {
                    try {
                        const dialogs = await client.getDialogs({ limit: 70 });
                        for (const dialog of dialogs) {
                            if (String(dialog.id) === tgUserId || (dialog.entity && String(dialog.entity.id) === tgUserId)) {
                                peer = dialog.entity;
                                break;
                            }
                        }
                    } catch {}
                }

                if (!peer) {
                    return res.json({
                        success: true,
                        messages: [],
                        unavailable_reason: 'Юзербот не нашёл диалог с этим пользователем.'
                    });
                }

                const messages = await client.getMessages(peer, { limit: 20 });
                const rows = (messages || [])
                    .map(message => ({
                        id: String(message.id),
                        outgoing: !!message.out,
                        text: String(message.message || '').trim(),
                        date: normalizeMessageDate(message.date)
                    }))
                    .filter(message => message.text || message.date)
                    .reverse();

                res.json({ success: true, messages: rows, unavailable_reason: null });
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            console.error('Ошибка загрузки треда юзербота:', error);
            res.status(500).json({ error: 'Ошибка загрузки переписки' });
        }
    });

    router.post('/ops-center/mark-read', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const tgUserId = req.body?.tg_user_id ? String(req.body.tg_user_id) : null;

            if (!tgUserId) {
                return res.status(400).json({ error: 'Не передан TG ID диалога' });
            }

            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            await userbotService.markDialogAsRead(userbot, tgUserId);
            res.json({ success: true });
        } catch (error) {
            console.error('Ошибка отметки диалога как прочитанного:', error);
            res.status(500).json({ error: error?.message || 'Не получилось отметить диалог как прочитанный' });
        }
    });

    router.post('/ops-center/join-invite', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const inviteLink = String(req.body?.invite_link || '').trim();
            if (!inviteLink) {
                return res.status(400).json({ error: 'Не вставлена пригласительная ссылка' });
            }

            const parsedInvite = parseTelegramInvite(inviteLink);
            if (!parsedInvite) {
                return res.status(400).json({ error: 'Ссылка кривовата. Поддерживаются: t.me/+hash, t.me/joinchat/hash, t.me/username, @username.' });
            }
            if (parsedInvite.kind === 'private_permalink') {
                return res.status(400).json({
                    error: 'Это ссылка на сообщение в приватном канале (t.me/c/<id>). Чтобы зайти в приватный канал/группу, нужна пригласительная ссылка (t.me/+hash или t.me/joinchat/hash).'
                });
            }

            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            const client = await userbotService.createAuthorizedClient(userbot, 1);
            try {
                let title = 'Неизвестная группа';
                let chatId = null;

                if (parsedInvite.kind === 'invite_hash') {
                    const result = await client.invoke(new Api.messages.ImportChatInvite({
                        hash: parsedInvite.value
                    }));
                    const chat = result?.chats?.[0] || null;
                    title = chat?.title || title;
                    chatId = chat?.id ? String(chat.id) : null;
                } else {
                    const entity = await client.getEntity(parsedInvite.value);
                    await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
                    title = entity?.title || entity?.username || title;
                    chatId = entity?.id ? String(entity.id) : null;
                }

                res.json({
                    success: true,
                    title,
                    chat_id: chatId,
                    userbot_id: userbot.id
                });
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            console.error('Ошибка входа по инвайту:', error);
            res.status(500).json({ error: 'Не получилось зайти по ссылке этим юзерботом' });
        }
    });

    router.get('/ops-center/authorizations', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId);
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            const authorizations = await userbotService.getAccountAuthorizations(userbot);
            res.json({ success: true, authorizations });
        } catch (error) {
            console.error('Ошибка загрузки активных сессий юзербота:', error);
            res.status(500).json({ error: error?.message || 'Не получилось загрузить активные сессии' });
        }
    });

    router.post('/ops-center/authorizations/reset-others', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            const authorizations = await userbotService.resetOtherAuthorizations(userbot);
            res.json({
                success: true,
                authorizations,
                message: 'Все остальные Telegram-сессии этого аккаунта разлогинены. На сервисе осталась текущая сессия.'
            });
        } catch (error) {
            console.error('Ошибка сброса остальных сессий юзербота:', error);
            res.status(500).json({ error: error?.message || 'Не получилось разлогинить остальные устройства' });
        }
    });

    router.post('/ops-center/authorizations/reset-one', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const hash = req.body?.hash !== undefined && req.body?.hash !== null
                ? String(req.body.hash)
                : '';
            if (!hash) {
                return res.status(400).json({ error: 'Не передан hash сессии' });
            }

            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            const authorizations = await userbotService.resetAuthorization(userbot, hash);
            res.json({
                success: true,
                authorizations,
                message: 'Сессия разлогинена.'
            });
        } catch (error) {
            console.error('Ошибка сброса конкретной сессии юзербота:', error);
            res.status(error?.statusCode || 500).json({ error: error?.message || 'Не получилось разлогинить устройство' });
        }
    });
}
