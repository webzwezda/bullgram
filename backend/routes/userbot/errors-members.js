// Журнал Telegram-ошибок и сканер участников (финальная стадия 2b разрезки
// userbot.routes.js).
// Зона: GET /error-events, POST /fetch-members.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { decrypt } from '../../utils/crypto.js';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { loadOperationalUserbot } from './helpers-core.js';

export function registerErrorsMembers(router, ctx) {
    const { supabase, userbotService } = ctx;
    router.get('/error-events', authenticateUser, async (req, res) => {
        try {
            const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
            const userbotId = req.query.userbot_id ? String(req.query.userbot_id) : '';
            const restrictionsOnly = String(req.query.restrictions_only || '').trim().toLowerCase() === 'true';

            let query = supabase
                .from('telegram_error_events')
                .select('id, owner_id, userbot_id, tg_user_id, event_source, event_type, severity, restriction_kind, is_restriction, error_code, error_message, happened_at, meta')
                .eq('owner_id', req.user.id)
                .order('happened_at', { ascending: false })
                .limit(limit);

            if (userbotId) {
                query = query.eq('userbot_id', userbotId);
            }
            if (restrictionsOnly) {
                query = query.eq('is_restriction', true);
            }

            const { data, error } = await query;
            if (error) throw error;

            res.json({
                success: true,
                events: data || []
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Не удалось загрузить журнал Telegram-ошибок.' });
        }
    });

    // =========================================================
    // 6. СКАНЕР УЧАСТНИКОВ (FETCH MEMBERS)
    // =========================================================
    router.post('/fetch-members', authenticateUser, async (req, res) => {
        const { tg_chat_id, userbot_id } = req.body;
        if (!tg_chat_id) return res.status(400).json({ error: 'ID чата не передан' });

        try {
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbot_id ? String(userbot_id) : null, {
                allowFailover: true
            });
            if (!userbot) return res.status(409).json({ error: userbotError || 'У вас не подключен Юзербот.' });

            const { data: channel } = await supabase.from('channels').select('id').eq('tg_chat_id', String(tg_chat_id)).single();

            const proxyData = userbot.proxies ? { proxy_host: userbot.proxies.host, proxy_port: userbot.proxies.port, proxy_username: userbot.proxies.username, proxy_password: userbot.proxies.password } : undefined;
            const { token, fingerprint } = userbotService.parseSessionData(decrypt(userbot.session_data));
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);

            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            try {
                const participants = await client.getParticipants(tg_chat_id, { limit: 300 });

                let activeSubs = [];
                if (channel) {
                    const { data: subs } = await supabase.from('subscriptions').select('*').eq('channel_id', channel.id).eq('status', 'active');
                    if (subs) activeSubs = subs;
                }

                const members = participants.map(p => {
                    const participantIdStr = String(p.id);
                    const sub = activeSubs.find(s => String(s.tg_user_id) === participantIdStr);

                    return {
                        id: participantIdStr,
                        username: p.username || null,
                        first_name: p.firstName || '',
                        last_name: p.lastName || '',
                        is_bot: p.bot || false,
                        is_premium: p.premium || false,
                        has_subscription: !!sub,
                        expires_at: sub ? sub.expires_at : null
                    };
                });

                res.json({ success: true, chat_id: tg_chat_id, count: members.length, members: members });
            } finally { await client.disconnect(); }
        } catch (error) { res.status(500).json({ error: 'Внутренняя ошибка сервера' }); }
    });
}
