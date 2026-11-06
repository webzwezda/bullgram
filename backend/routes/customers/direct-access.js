// POST /direct-access customers (вынесен из customers.routes.js дословно).
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { getBotById } from '../official-bot.routes.js';
import { normalizeUuidLike } from './access-source.js';

export function registerDirectAccessRoute(router, supabase, officialBotService) {
    router.post('/direct-access', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const tgUserId = String(req.body?.tg_user_id || '').trim();
            const channelId = normalizeUuidLike(req.body?.channel_id);
            const durationRaw = String(req.body?.duration_days || '').trim().toLowerCase();

            if (!tgUserId) {
                return res.status(400).json({ error: 'Не передан Telegram ID' });
            }

            if (!channelId) {
                return res.status(400).json({ error: 'Не передан канал для выдачи доступа' });
            }

            const durationDays = durationRaw === 'forever' ? 0 : Number(durationRaw || 0);
            if (!(durationRaw === 'forever' || Number.isFinite(durationDays))) {
                return res.status(400).json({ error: 'Некорректный срок доступа' });
            }

            const { data: channel, error: channelError } = await supabase
                .from('channels')
                .select('id, owner_id, title, tg_chat_id, bot_id, chat_type')
                .eq('id', channelId)
                .eq('owner_id', ownerId)
                .single();

            if (channelError || !channel) {
                return res.status(404).json({ error: 'Канал не найден' });
            }

            if (!channel.bot_id) {
                return res.status(400).json({ error: 'У канала не привязан официальный бот' });
            }

            const bot = getBotById(channel.bot_id);
            if (!bot) {
                return res.status(409).json({ error: 'Официальный бот не запущен. Перезапусти его в BotFather.' });
            }

            const result = await officialBotService.issueDirectChannelAccess({
                bot,
                ownerId,
                targetTgUserId: tgUserId,
                channel,
                durationDays,
                eventSource: 'customers_direct_access',
                accessNote: durationRaw === 'forever'
                    ? 'Доступ выдан вручную из Customers навсегда'
                    : `Доступ выдан вручную из Customers на ${durationDays} дней`,
                payload: {
                    source: 'customers',
                    issued_via: 'customers_direct_access',
                    duration_days: durationRaw === 'forever' ? 'forever' : durationDays
                }
            });

            if (result?.error) {
                return res.status(400).json({ error: result.error });
            }

            let dmSent = false;
            let dmError = null;
            try {
                const durationText = durationRaw === 'forever' ? 'Навсегда' : `${durationDays} дней`;
                const lines = [
                    'Тебе выдали доступ в Bullgram.',
                    '',
                    `Канал: ${channel.title || 'закрытый канал'}`,
                    `Срок: ${durationText}`
                ];

                if (result.expiresAt) {
                    lines.push(`До: ${new Date(result.expiresAt).toLocaleDateString('ru-RU')}`);
                }

                lines.push('', 'Ссылка на вход:', result.inviteLink, '', 'Ссылка работает через запрос на вступление и закреплена за твоим аккаунтом.');

                await bot.telegram.sendMessage(tgUserId, lines.join('\n'), {
                    disable_web_page_preview: true
                });
                dmSent = true;
            } catch (error) {
                dmError = error.message || 'Не удалось отправить ЛС';
            }

            res.json({
                success: true,
                subscription_id: result.subscriptionId || null,
                invite_link: result.inviteLink || null,
                channel_id: channel.id,
                channel_title: channel.title || null,
                expires_at: result.expiresAt || null,
                dm_sent: dmSent,
                dm_error: dmError
            });
        } catch (error) {
            console.error('Ошибка direct access из Customers:', error);
            res.status(500).json({ error: 'Не получилось выдать доступ из Customers' });
        }
    });
}
