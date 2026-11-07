// CRM-синхронизация каналов и аудит админских прав юзербота
// (финальная стадия 2b разрезки userbot.routes.js).
// Зона: POST /sync-channels, GET /admin-audit.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { decrypt } from '../../utils/crypto.js';
import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { FRESH_IMPORT_RUNTIME_REASON, isFreshImportedUserbot } from '../../utils/ops-center-selection.js';
import { getDeadProxyMessage, isUserbotOnDeadProxy, loadOperationalUserbot } from './helpers-core.js';

export function registerSyncAudit(router, ctx) {
    const { supabase, userbotService } = ctx;
    // =========================================================
    // 5. CRM И СИНХРОНИЗАЦИЯ КАНАЛОВ
    // =========================================================
    router.post('/sync-channels', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) return res.status(409).json({ error: userbotError || 'Подключите Юзербота.' });
            const { data: myBots } = await supabase.from('tg_accounts').select('*').eq('owner_id', req.user.id).eq('account_type', 'bot');
            if (!myBots || myBots.length === 0) return res.status(400).json({ error: 'У вас нет официальных ботов.' });

            const proxyData = userbot.proxies ? { proxy_host: userbot.proxies.host, proxy_port: userbot.proxies.port, proxy_username: userbot.proxies.username, proxy_password: userbot.proxies.password } : undefined;
            const { token, fingerprint } = userbotService.parseSessionData(decrypt(userbot.session_data));
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            const syncResults = [];
            try {
                const dialogs = await client.getDialogs({ limit: 50 });
                for (const dialog of dialogs) {
                    if (dialog.isChannel || dialog.isGroup) {
                        try {
                            const admins = await client.getParticipants(dialog.entity, { filter: new Api.ChannelParticipantsAdmins() });
                            for (const admin of admins) {
                                const matchedBot = myBots.find(b => String(b.tg_account_id) === String(admin.id));
                                if (matchedBot) {
                                    const chatIdStr = String(dialog.id);
                                    const channelPayload = {
                                        owner_id: req.user.id,
                                        bot_id: matchedBot.id,
                                        tg_chat_id: chatIdStr,
                                        title: dialog.title,
                                        chat_type: dialog.isGroup ? 'supergroup' : 'channel',
                                        username: String(dialog.entity?.username || '').trim().replace(/^@/, '') || null,
                                        visibility: dialog.entity?.username ? 'public' : 'private',
                                        last_visibility_check_at: new Date().toISOString()
                                    };

                                    // channels.tg_chat_id глобально уникален на всех тенантов.
                                    // Guard тенантный: свою строку (в т.ч. мерж-строку того же
                                    // владельца) вставляем/обновляем, чужую (другой owner_id)
                                    // не крадём.
                                    const { data: existingChannel } = await supabase
                                        .from('channels')
                                        .select('id, owner_id')
                                        .eq('tg_chat_id', chatIdStr)
                                        .maybeSingle();

                                    let synced = true;
                                    if (!existingChannel) {
                                        await supabase.from('channels').insert(channelPayload);
                                    } else if (existingChannel.owner_id === req.user.id) {
                                        await supabase.from('channels').update(channelPayload).eq('id', existingChannel.id);
                                    } else {
                                        console.warn(`[sync-channels] Канал ${chatIdStr} принадлежит другому владельцу (${existingChannel.owner_id}), пропуск для бота ${matchedBot.id}`);
                                        synced = false;
                                    }

                                    if (synced && !syncResults.find(r => r.chat_id === chatIdStr)) syncResults.push({ chat_id: chatIdStr, chat_name: dialog.title, bot_name: matchedBot.tg_username });
                                }
                            }
                        } catch (e) {}
                    }
                }
                res.json({ success: true, count: syncResults.length, results: syncResults });
            } finally { await client.disconnect(); }
        } catch (error) { res.status(500).json({ error: 'Ошибка синхронизации' }); }
    });

    router.get('/admin-audit', authenticateUser, async (req, res) => {
        try {
            const requestedUserbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const runScan = String(req.query.scan || '').trim().toLowerCase() === 'true';

            const { data: userbots } = await supabase
                .from('tg_accounts')
                .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'userbot')
                .order('created_at', { ascending: false });

            if (!userbots || userbots.length === 0) {
                return res.status(404).json({ error: 'Подключите Юзербота.' });
            }

            const preferredAuditableUserbots = userbots.filter(item => !isFreshImportedUserbot(item));
            const userbot = requestedUserbotId
                ? userbots.find(item => String(item.id) === requestedUserbotId)
                : preferredAuditableUserbots[0] || userbots[0];

            if (!userbot) {
                return res.status(404).json({ error: 'Выбранный юзербот не найден' });
            }

            if (isFreshImportedUserbot(userbot)) {
                return res.status(409).json({ error: FRESH_IMPORT_RUNTIME_REASON });
            }

            if (isUserbotOnDeadProxy(userbot)) {
                return res.status(409).json({ error: getDeadProxyMessage() });
            }

            if (!runScan) {
                return res.json({
                    success: true,
                    scan_required: true,
                    selected_userbot_id: userbot.id,
                    selected_userbot_username: userbot.tg_username || userbot.tg_account_id || null,
                    userbots: userbots.map(item => ({
                        id: item.id,
                        tg_username: item.tg_username || null,
                        tg_account_id: item.tg_account_id || null
                    })),
                    audits: []
                });
            }

            const { data: myBots } = await supabase
                .from('tg_accounts')
                .select('id, tg_account_id, tg_username')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'bot');

            const { data: linkedChannels } = await supabase
                .from('channels')
                .select('id, tg_chat_id, title, bot_id')
                .eq('owner_id', req.user.id);

            const proxyData = userbot.proxies
                ? {
                    proxy_host: userbot.proxies.host,
                    proxy_port: userbot.proxies.port,
                    proxy_username: userbot.proxies.username,
                    proxy_password: userbot.proxies.password
                }
                : undefined;

            const { token, fingerprint } = userbotService.parseSessionData(decrypt(userbot.session_data));
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            try {
                const me = await client.getMe();
                const dialogs = await client.getDialogs({ limit: 70 });
                const audits = [];

                for (const dialog of dialogs) {
                    if (!dialog.isChannel && !dialog.isGroup) continue;

                    const chatIdStr = String(dialog.id);
                    const linkedChannel = (linkedChannels || []).find(channel => String(channel.tg_chat_id) === chatIdStr);

                    try {
                        let adminIds = [];
                        let userbotAdmin = false;
                        let adminCheckSkipped = false;

                        if (linkedChannel) {
                            const admins = await client.getParticipants(dialog.entity, { filter: new Api.ChannelParticipantsAdmins() });
                            adminIds = admins.map(admin => String(admin.id));
                            userbotAdmin = adminIds.includes(String(me.id));
                        } else {
                            adminCheckSkipped = true;
                        }

                        const matchedBots = (myBots || []).filter(bot => adminIds.includes(String(bot.tg_account_id)));

                        audits.push({
                            chat_id: chatIdStr,
                            title: dialog.title,
                            userbot_admin: userbotAdmin,
                            admin_check_skipped: adminCheckSkipped,
                            official_bot_admin: matchedBots.length > 0,
                            official_bot_usernames: matchedBots.map(bot => bot.tg_username).filter(Boolean),
                            linked_channel_id: linkedChannel ? linkedChannel.id : null,
                            linked_bot_id: linkedChannel ? linkedChannel.bot_id : null
                        });
                    } catch (e) {
                        audits.push({
                            chat_id: chatIdStr,
                            title: dialog.title,
                            userbot_admin: false,
                            admin_check_skipped: false,
                            official_bot_admin: false,
                            official_bot_usernames: [],
                            linked_channel_id: linkedChannel ? linkedChannel.id : null,
                            linked_bot_id: linkedChannel ? linkedChannel.bot_id : null,
                            error: 'Не удалось проверить админов'
                        });
                    }
                }

                res.json({
                    success: true,
                    selected_userbot_id: userbot.id,
                    selected_userbot_username: userbot.tg_username || userbot.tg_account_id || null,
                    userbots: userbots.map(item => ({
                        id: item.id,
                        tg_username: item.tg_username || null,
                        tg_account_id: item.tg_account_id || null
                    })),
                    audits
                });
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            res.status(500).json({ error: 'Ошибка проверки админских прав' });
        }
    });
}
