// Ручная отправка в ЛС, массовый импорт из сканера и проверка присутствия
// в группах (финальная стадия 2b разрезки userbot.routes.js).
// Зона: POST /send-message, POST /crm/import, GET /crm/presence.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { decrypt } from '../../utils/crypto.js';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { isUserbotDmEnabled, loadOperationalUserbot } from './helpers-core.js';

export function registerMessaging(router, ctx) {
    const { supabase, userbotService } = ctx;
    // =========================================================
    // 9. ОТПРАВКА СООБЩЕНИЯ В ЛИЧКУ
    // =========================================================
    router.post('/send-message', authenticateUser, async (req, res) => {
        if (!isUserbotDmEnabled()) {
            return res.status(403).json({
                error: 'Ручная отправка в ЛС через юзербота сейчас отключена в конфиге.'
            });
        }
        if (req.body?.manual_confirmed !== true) {
            return res.status(403).json({
                error: 'ЛС через юзербота теперь отправляются только после явного подтверждения из интерфейса.'
            });
        }
        const { tg_user_id, message, userbot_id, common_chat_id, known_dialog } = req.body;
        if (!tg_user_id || !message) return res.status(400).json({ error: 'Не указан ID пользователя или текст' });
        if (!/^\d+$/.test(String(tg_user_id).trim())) {
            return res.status(400).json({ error: 'TG ID должен быть числовым.' });
        }
        if (String(message).trim().length > 4000) {
            return res.status(400).json({ error: 'Сообщение слишком длинное. Оставь до 4000 символов.' });
        }
        if (!String(common_chat_id || '').trim() && known_dialog !== true) {
            return res.status(400).json({
                error: 'Для ручной отправки по TG ID теперь нужен явный общий чат. Если диалог уже открыт в центре, отвечай из существующей переписки.'
            });
        }

        try {
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbot_id ? String(userbot_id) : null, {
                allowFailover: true
            });
            if (!userbot) return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });

            await userbotService.sendMessage(userbot, tg_user_id, String(message).trim(), {
                common_chat_id: common_chat_id ? String(common_chat_id).trim() : ''
            });
            res.json({ success: true });
        } catch (error) {
            const text = String(error?.message || '');
            const status = (
                text.includes('Юзербот не знает этот TG ID')
                || text.includes('заблокировал юзербота')
                || text.includes('приватность')
                || text.includes('flood wait')
                || text.includes('не может писать')
                || text.includes('Сессия юзербота сдохла')
            ) ? 400 : 500;
            res.status(status).json({ error: text || 'Внутренняя ошибка сервера' });
        }
    });

    // =========================================================
    // 10. МАССОВЫЙ ИМПОРТ ИЗ СКАНЕРА
    // =========================================================
    router.post('/crm/import', authenticateUser, async (req, res) => {
        const { tg_user_ids, days, channel_id } = req.body;

        if (!tg_user_ids || !Array.isArray(tg_user_ids) || tg_user_ids.length === 0) {
            return res.status(400).json({ error: 'Не переданы пользователи' });
        }

        if (!channel_id) {
            return res.status(400).json({ error: 'Не передан канал для импорта' });
        }

        try {
            const { data: channel } = await supabase
                .from('channels')
                .select('*')
                .eq('id', channel_id)
                .eq('owner_id', req.user.id)
                .single();

            if (!channel) return res.status(400).json({ error: 'Канал не найден или недоступен' });

            let expiresAt = null;
            if (days !== 'forever') {
                const date = new Date();
                date.setDate(date.getDate() + parseInt(days));
                expiresAt = date.toISOString();
            }

            const upsertData = tg_user_ids.map(uid => ({
                tg_user_id: String(uid),
                                                       channel_id: channel.id,
                                                       status: 'active',
                                                       expires_at: expiresAt
            }));

            const { error: insertError } = await supabase.from('subscriptions').upsert(upsertData, { onConflict: 'tg_user_id, channel_id' });
            if (insertError) throw insertError;

            res.json({ success: true, imported_count: tg_user_ids.length });
        } catch (error) { res.status(500).json({ error: 'Ошибка БД при импорте' }); }
    });

    // =========================================================
    // 11. ПРОВЕРКА НАЛИЧИЯ ПОЛЬЗОВАТЕЛЕЙ В ГРУППАХ
    // =========================================================
    router.get('/crm/presence', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId);
            if (!userbot) return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });

            const { data: channels } = await supabase.from('channels').select('*').eq('owner_id', req.user.id);
            if (!channels || channels.length === 0) return res.json({ presence: {} });

            const proxyData = userbot.proxies ? { proxy_host: userbot.proxies.host, proxy_port: userbot.proxies.port, proxy_username: userbot.proxies.username, proxy_password: userbot.proxies.password } : undefined;
            const { token, fingerprint } = userbotService.parseSessionData(decrypt(userbot.session_data));
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);

            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            const presenceMap = {};

            try {
                for (const channel of channels) {
                    try {
                        const participants = await client.getParticipants(channel.tg_chat_id, { limit: 5000 });
                        presenceMap[channel.id] = participants.map(p => String(p.id));
                    } catch (e) {
                        presenceMap[channel.id] = [];
                    }
                }
                res.json({ success: true, presence: presenceMap });
            } finally { await client.disconnect(); }
        } catch (error) { res.status(500).json({ error: 'Внутренняя ошибка сервера при проверке присутствия' }); }
    });
}
