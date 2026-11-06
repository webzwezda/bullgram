import express from 'express';
import { UserbotService } from '../services/userbot.service.js';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { decrypt } from '../utils/crypto.js';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';
import { ManagedProxyService } from '../services/managed-proxy.service.js';
import {
    FRESH_IMPORT_RUNTIME_REASON,
    isFreshImportedUserbot,
    resolveOpsCenterSelection
} from '../utils/ops-center-selection.js';

const TRIAL_PROXY_LEASE_HOURS = 24;
const USERBOT_CENTER_DIALOG_LIMIT = Number(process.env.USERBOT_CENTER_DIALOG_LIMIT || 80);
const USERBOT_CENTER_ADMIN_CHECK_DELAY_MS = Number(process.env.USERBOT_CENTER_ADMIN_CHECK_DELAY_MS || 350);

// Module-level хелперы вынесены в routes/userbot/ (стадия 1 разрезки монстра),
// общие константы — в routes/userbot/constants.js (helpers и роут-модули импортируют
// оттуда, цикла userbot.routes.js <-> helpers больше нет). Первая половина роут-зон
// вынесена в register-модули (стадия 2a); фабрика ниже зовёт registerXxx(router, ctx)
// строго в исходном порядке регистрации.
import {
    detectSalesSignal,
    getDeadProxyMessage,
    isExpiredUserbotSessionError,
    isMissingRecoveryTable,
    isUserbotDmEnabled,
    isUserbotOnDeadProxy,
    loadOperationalUserbot,
    normalizeMessageDate,
    parseTelegramInvite,
    sleep
} from './userbot/helpers-core.js';
import {
    buildUserbotCenterAccount,
    buildUserbotCenterSignalConfig,
    buildUserbotCenterSummary,
    loadUserbotCenterCache,
    replaceUserbotCenterCache,
    resolveBatchKickCallSource
} from './userbot/helpers-center.js';
import { registerProxiesList } from './userbot/proxies-list.js';
import { registerProxiesCrud } from './userbot/proxies-crud.js';
import { registerProxiesCheck } from './userbot/proxies-check.js';
import { registerBindProxy } from './userbot/bind-proxy.js';
import { registerSessions } from './userbot/sessions.js';
import { registerIntake } from './userbot/intake.js';
import { registerQr } from './userbot/qr.js';
import { registerProfile } from './userbot/profile.js';
import { registerLifecycle } from './userbot/lifecycle.js';
import { registerHealthCheck } from './userbot/health-check.js';
export default function (supabase) {
    const router = express.Router();

    // api_id/api_hash подставляет конструктор UserbotService из дефолтного отпечатка.
    const userbotService = new UserbotService(supabase);
    const managedProxyService = new ManagedProxyService();


    // Единый контекст замыканий фабрики для всех register-модулей стадии 2a.
    const ctx = { supabase, userbotService, managedProxyService };

    // ==========================================
    // 1. УПРАВЛЕНИЕ ПУЛОМ ПРОКСИ
    // ==========================================
    registerProxiesList(router, ctx);
    registerProxiesCrud(router, ctx);
    registerProxiesCheck(router, ctx);
    registerBindProxy(router, ctx);
    registerSessions(router, ctx);
    registerIntake(router, ctx);

    // ==========================================
    // 3. ГЕНЕРАЦИЯ QR (Классический метод)
    // ==========================================
    router.get('/fingerprint-profiles', authenticateUser, async (req, res) => {
        try {
            const profiles = await userbotService.listQrFingerprintProfiles(req.user.id);
            res.json({ profiles });
        } catch (error) {
            console.error('[USERBOT_FINGERPRINT_PROFILES] failed:', error?.message || error);
            res.status(500).json({ error: 'Не удалось загрузить fingerprint-пресеты.' });
        }
    });

    registerQr(router, ctx);

    // ==========================================
    // 4. УДАЛЕНИЕ И ПРОВЕРКА АККАУНТОВ
    // ==========================================
    registerProfile(router, ctx);

    router.get('/recovery-status', authenticateUser, async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('userbot_restore_sources')
                .select('account_id, source_type, session_filename, json_filename, updated_at, last_restored_at, last_restore_status, last_restore_error, intake_batch_id')
                .eq('owner_id', req.user.id);

            if (error) {
                if (isMissingRecoveryTable(error)) {
                    return res.json({ support: { recovery: false }, rows: [] });
                }
                throw error;
            }

            res.json({
                support: { recovery: true },
                rows: data || []
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Ошибка загрузки recovery status' });
        }
    });
    // DELETE /:id, POST /restore/:id, POST /safe-mode/:id, PATCH /custom-label/:id.
    // Должно идти ПОСЛЕ registerProxiesCheck: DELETE /proxies/:id матчится раньше дженерика.
    registerLifecycle(router, ctx);

    registerHealthCheck(router, ctx);

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

    router.get('/ops-center', authenticateUser, async (req, res) => {
        try {
            const requestedUserbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const runScan = String(req.query.scan || '').trim().toLowerCase() === 'true';
            const reservedUserbotIds = await loadReservedUserbotIds(supabase, req.user.id);
            const { data: paymentSettings } = await supabase
                .from('payment_settings')
                .select('admin_tg_id')
                .eq('owner_id', req.user.id)
                .maybeSingle();

            const { data: officialBots } = await supabase
                .from('tg_accounts')
                .select('id, tg_username, tg_account_id, bot_role')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'bot')
                .order('created_at', { ascending: true });

            const { data: userbots } = await supabase
                .from('tg_accounts')
                .select('*, proxies(id, name, host, port, username, password, is_working, provision_source, inventory_group, last_check_country, last_check_country_code)')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'userbot')
                .order('created_at', { ascending: false });

            if (!userbots || userbots.length === 0) {
                return res.status(404).json({ error: 'Подключите Юзербота.' });
            }

            const selection = resolveOpsCenterSelection({ userbots, reservedUserbotIds, requestedUserbotId });

            if (selection.kind === 'reserved') {
                return res.status(409).json({
                    error: 'Этот юзербот сейчас выставлен в shop и выведен из рабочей Telegram-операционки. Сними его с витрины или выбери другой аккаунт.'
                });
            }

            if (selection.kind === 'safe_mode') {
                // Запрошен свежий импорт: живой скан до активации запрещён, но
                // центр обязан отрисоваться — селектор, баннер safe-mode и кнопка
                // «Выполнить активацию». Раньше здесь падал 404 «Выбранный юзербот
                // не найден» и заменял весь центр ошибкой (баг 2026-10-20).
                return res.json({
                    success: true,
                    safe_mode: true,
                    scan_required: false,
                    cache_source: 'safe_mode',
                    selected_userbot_id: selection.userbot.id,
                    selected_userbot_username: selection.userbot.tg_username || selection.userbot.tg_account_id || null,
                    signal_config: buildUserbotCenterSignalConfig(paymentSettings, officialBots),
                    userbots: selection.operationalUserbots.map(item => buildUserbotCenterAccount(item)),
                    summary: buildUserbotCenterSummary([], []),
                    groups: [],
                    conversations: []
                });
            }

            if (selection.kind === 'no_operational') {
                return res.status(409).json({
                    error: 'Сейчас нет ни одного активированного юзербота для рабочего центра. Свежие импорты сначала нужно вручную активировать живой проверкой.'
                });
            }

            if (selection.kind === 'not_found') {
                return res.status(404).json({ error: 'Выбранный юзербот не найден' });
            }

            const preferredUserbot = selection.userbot;
            const operationalUserbots = selection.operationalUserbots;

            const { data: linkedChannels } = await supabase
                .from('channels')
                .select('id, tg_chat_id, title, bot_id')
                .eq('owner_id', req.user.id);

            if (!runScan) {
                const cache = await loadUserbotCenterCache(supabase, req.user.id, preferredUserbot.id);
                return res.json({
                    success: true,
                    scan_required: !cache.scanned_at,
                    cache_source: cache.scanned_at ? 'database' : 'empty',
                    cache_scanned_at: cache.scanned_at,
                    selected_userbot_id: preferredUserbot.id,
                    selected_userbot_username: preferredUserbot.tg_username || preferredUserbot.tg_account_id || null,
                    signal_config: buildUserbotCenterSignalConfig(paymentSettings, officialBots),
                    userbots: operationalUserbots.map(item => buildUserbotCenterAccount(item)),
                    summary: buildUserbotCenterSummary(cache.groups, cache.conversations),
                    groups: cache.groups,
                    conversations: cache.conversations
                });
            }

            let userbot = null;
            let client = null;
            const runtimeStates = new Map();

            const orderedCandidates = requestedUserbotId
                ? [preferredUserbot, ...operationalUserbots.filter(item => String(item.id) !== requestedUserbotId)]
                : operationalUserbots;

            for (const candidate of orderedCandidates) {
                if (isUserbotOnDeadProxy(candidate)) {
                    runtimeStates.set(String(candidate.id), {
                        status: 'dead_proxy',
                        reason: getDeadProxyMessage()
                    });
                    continue;
                }

                let candidateClient = null;
                try {
                    candidateClient = await userbotService.createAuthorizedClient(candidate, 1);
                    const health = await userbotService.inspectAccountHealth(candidateClient, {
                        userbotId: candidate.id
                    });
                    runtimeStates.set(String(candidate.id), health);
                    if (health.status === 'online') {
                        userbot = candidate;
                        client = candidateClient;
                        candidateClient = null;
                        break;
                    }
                } catch (error) {
                    const status = isExpiredUserbotSessionError(error) ? 'expired' : 'error';
                    runtimeStates.set(String(candidate.id), {
                        status,
                        reason: status === 'expired'
                            ? 'Сессия юзербота сдохла. Нужно переподключить аккаунт.'
                            : (error?.message || 'Юзербот сейчас не отвечает.')
                    });
                } finally {
                    if (candidateClient) {
                        try {
                            await candidateClient.disconnect();
                        } catch (disconnectError) {
                            console.warn('[USERBOT_CENTER] Не удалось отключить кандидата:', disconnectError?.message || disconnectError);
                        }
                    }
                }
            }

            if (!userbot || !client) {
                const preferredState = runtimeStates.get(String(preferredUserbot.id));
                const fallbackMessage = preferredState?.reason || 'Сейчас нет ни одного живого юзербота для центра.';
                return res.status(409).json({
                    error: fallbackMessage,
                    userbots: operationalUserbots.map(item => buildUserbotCenterAccount(item, runtimeStates.get(String(item.id)) || {
                        status: 'unknown',
                        reason: null
                    }))
                });
            }

            try {
                const me = await client.getMe();
                const dialogs = await client.getDialogs({ limit: USERBOT_CENTER_DIALOG_LIMIT });
                const groups = [];
                const conversations = [];
                let adminChecks = 0;

                for (const dialog of dialogs) {
                    const previewText = String(dialog?.message?.message || '').trim();
                    const lastMessageAt = normalizeMessageDate(dialog?.message?.date);
                    const unreadCount = Number(dialog?.unreadCount || 0);

                    if (dialog.isChannel || dialog.isGroup) {
                        const chatIdStr = String(dialog.id);
                        const linkedChannel = (linkedChannels || []).find(channel => String(channel.tg_chat_id) === chatIdStr);

                        let userbotAdmin = false;
                        let adminError = null;
                        let adminCheckSkipped = false;

                        if (linkedChannel) {
                            try {
                                if (adminChecks > 0) {
                                    await sleep(USERBOT_CENTER_ADMIN_CHECK_DELAY_MS);
                                }
                                adminChecks += 1;
                                const admins = await client.getParticipants(dialog.entity, { filter: new Api.ChannelParticipantsAdmins() });
                                userbotAdmin = admins.some(admin => String(admin.id) === String(me.id));
                            } catch (error) {
                                adminError = 'Не удалось проверить админство';
                            }
                        } else {
                            adminCheckSkipped = true;
                        }

                        groups.push({
                            chat_id: chatIdStr,
                            title: dialog.title,
                            type: dialog.isChannel ? 'channel' : 'group',
                            unread_count: unreadCount,
                            last_message_preview: previewText || null,
                            last_message_at: lastMessageAt,
                            userbot_admin: userbotAdmin,
                            admin_check_skipped: adminCheckSkipped,
                            linked_channel_id: linkedChannel?.id || null,
                            linked_channel_title: linkedChannel?.title || null,
                            admin_error: adminError
                        });
                        continue;
                    }

                    const entity = dialog.entity;
                    if (!entity || entity.className !== 'User' || entity.bot || entity.self) {
                        continue;
                    }

                    conversations.push({
                        tg_user_id: String(entity.id),
                        username: entity.username || null,
                        display_name: [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim() || entity.username || `ID ${entity.id}`,
                        unread_count: unreadCount,
                        last_message_preview: previewText || null,
                        last_message_at: lastMessageAt,
                        last_outgoing: !!dialog?.message?.out,
                        sales_signal: !dialog?.message?.out && detectSalesSignal(previewText)
                    });
                }

                groups.sort((a, b) => {
                    if (b.userbot_admin !== a.userbot_admin) return Number(b.userbot_admin) - Number(a.userbot_admin);
                    if ((b.unread_count || 0) !== (a.unread_count || 0)) return (b.unread_count || 0) - (a.unread_count || 0);
                    return String(b.last_message_at || '').localeCompare(String(a.last_message_at || ''));
                });

                conversations.sort((a, b) => {
                    if (b.sales_signal !== a.sales_signal) return Number(b.sales_signal) - Number(a.sales_signal);
                    if ((b.unread_count || 0) !== (a.unread_count || 0)) return (b.unread_count || 0) - (a.unread_count || 0);
                    return String(b.last_message_at || '').localeCompare(String(a.last_message_at || ''));
                });

                const conversationIds = conversations.map(item => item.tg_user_id);
                let notificationMap = {};
                if (conversationIds.length > 0) {
                    const { data: notifications } = await supabase
                        .from('userbot_inbox_notifications')
                        .select('dialog_tg_user_id, notified_at, last_message_id')
                        .eq('owner_id', req.user.id)
                        .eq('userbot_id', userbot.id)
                        .in('dialog_tg_user_id', conversationIds)
                        .order('notified_at', { ascending: false });

                    notificationMap = Object.fromEntries(
                        (notifications || []).map(item => [
                            String(item.dialog_tg_user_id),
                            {
                                notified_at: item.notified_at || null,
                                last_message_id: item.last_message_id || null
                            }
                        ])
                    );
                }

                const enrichedConversations = conversations.map(conversation => ({
                    ...conversation,
                    signal_notified_at: notificationMap[String(conversation.tg_user_id)]?.notified_at || null,
                    signal_last_message_id: notificationMap[String(conversation.tg_user_id)]?.last_message_id || null
                }));

                const scannedAt = new Date().toISOString();
                await replaceUserbotCenterCache(supabase, req.user.id, userbot.id, groups, enrichedConversations, scannedAt);

                res.json({
                    success: true,
                    scan_required: false,
                    cache_source: 'telegram',
                    cache_scanned_at: scannedAt,
                    selected_userbot_id: userbot.id,
                    selected_userbot_username: userbot.tg_username || userbot.tg_account_id || null,
                    signal_config: buildUserbotCenterSignalConfig(paymentSettings, officialBots),
                    userbots: operationalUserbots.map(item => buildUserbotCenterAccount(item, runtimeStates.get(String(item.id)) || null)),
                    summary: buildUserbotCenterSummary(groups, enrichedConversations),
                    groups,
                    conversations: enrichedConversations
                });
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            console.error('Ошибка центра юзербота:', error);
            res.status(500).json({ error: 'Ошибка загрузки центра юзербота' });
        }
    });

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

    // =========================================================
    // 7. CRM БАЗА КЛИЕНТОВ - ПОЛУЧЕНИЕ
    // =========================================================
    router.get('/crm/subscribers', authenticateUser, async (req, res) => {
        try {
            const { data: channels } = await supabase.from('channels').select('id, title').eq('owner_id', req.user.id);
            if (!channels || channels.length === 0) return res.json({ subscribers: [] });

            const channelIds = channels.map(c => c.id);
            const { data: subs, error } = await supabase.from('subscriptions').select('*').in('channel_id', channelIds).order('created_at', { ascending: false });
            if (error) throw error;

            const result = subs.map(sub => {
                const ch = channels.find(c => c.id === sub.channel_id);
                return { ...sub, channel_title: ch ? ch.title : 'Неизвестный канал' };
            });

            res.json({ subscribers: result });
        } catch (error) { res.status(500).json({ error: 'Ошибка загрузки базы данных' }); }
    });

    // =========================================================
    // 8. CRM БАЗА КЛИЕНТОВ - ПОДАРИТЬ ДНИ
    // =========================================================
    router.post('/crm/subscribers/:id/add-days', authenticateUser, async (req, res) => {
        const subId = req.params.id;
        const { days } = req.body;

        try {
            const { data: sub } = await supabase.from('subscriptions').select('*').eq('id', subId).single();
            if (!sub) return res.status(404).json({ error: 'Подписка не найдена' });

            const { data: channel } = await supabase.from('channels').select('*').eq('id', sub.channel_id).single();
            if (!channel || channel.owner_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });

            let newExpiresAt = null;
            if (days !== 'forever') {
                const now = new Date();
                let baseDate = new Date();
                if (sub.status === 'active' && sub.expires_at) {
                    const currentExp = new Date(sub.expires_at);
                    if (currentExp > now) baseDate = currentExp;
                }
                baseDate.setDate(baseDate.getDate() + parseInt(days));
                newExpiresAt = baseDate.toISOString();
            }

            await supabase.from('subscriptions').update({ expires_at: newExpiresAt, status: 'active' }).eq('id', subId);
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: 'Внутренняя ошибка' }); }
    });

    const MAX_EXTENSION_DAYS = 3650;

    // 'forever' или целое число дней 1..3650; иначе null (и роут вернет 400,
    // а не 500 от parseInt('abc') -> NaN -> Invalid Date).
    function parseExtensionDays(days) {
        if (days === 'forever') return 'forever';
        const num = Number(days);
        if (!Number.isInteger(num) || num < 1 || num > MAX_EXTENSION_DAYS) return null;
        return num;
    }

    router.post('/crm/subscribers/batch-add-days', authenticateUser, async (req, res) => {
        const subscriptionIds = Array.isArray(req.body?.subscription_ids) ? req.body.subscription_ids.map(String) : [];
        const { days } = req.body || {};

        if (subscriptionIds.length === 0) {
            return res.status(400).json({ error: 'Не переданы подписки для продления' });
        }

        const daysNum = parseExtensionDays(days);
        if (daysNum === null) {
            return res.status(400).json({ error: `days должен быть целым числом от 1 до ${MAX_EXTENSION_DAYS} или строкой "forever"` });
        }

        try {
            const { data: subscriptions, error } = await supabase
                .from('subscriptions')
                .select('*')
                .in('id', subscriptionIds);

            if (error) throw error;
            if (!subscriptions || subscriptions.length === 0) {
                return res.status(404).json({ error: 'Подписки не найдены' });
            }

            const channelIds = Array.from(new Set(subscriptions.map(sub => sub.channel_id).filter(Boolean)));
            const { data: channels, error: channelsError } = await supabase
                .from('channels')
                .select('id, owner_id')
                .in('id', channelIds);

            if (channelsError) throw channelsError;

            const ownedChannelIds = new Set((channels || []).filter(channel => channel.owner_id === req.user.id).map(channel => channel.id));
            const allowedSubscriptions = subscriptions.filter(sub => ownedChannelIds.has(sub.channel_id));

            if (allowedSubscriptions.length === 0) {
                return res.status(403).json({ error: 'Нет доступа к этим подпискам' });
            }

            let updated = 0;
            let conflicts = 0;
            let failed = 0;

            for (const sub of allowedSubscriptions) {
                let current = sub;
                let applied = false;
                let kickedRestore = false;

                // Оптимистический гард от TOCTOU: read-modify-write expires_at без
                // гарда теряет параллельные продления. Апдейт проходит только если
                // expires_at не изменился с момента чтения; конфликт — перечитываем
                // подписку, пересчитываем и повторяем (максимум 2 ретрая).
                for (let attempt = 0; attempt < 3 && !applied; attempt++) {
                    let newExpiresAt = null;
                    if (daysNum !== 'forever') {
                        const now = new Date();
                        let baseDate = new Date();
                        if (current.status === 'active' && current.expires_at) {
                            const currentExp = new Date(current.expires_at);
                            if (currentExp > now) baseDate = currentExp;
                        }
                        baseDate.setDate(baseDate.getDate() + daysNum);
                        newExpiresAt = baseDate.toISOString();
                    }

                    const updates = {
                        expires_at: newExpiresAt,
                        status: 'active'
                    };

                    if (current.last_access_event === 'kicked') {
                        updates.last_access_event = 'manual_restore';
                        updates.access_note = daysNum === 'forever'
                            ? 'Доступ восстановлен вручную из админки навсегда'
                            : `Доступ восстановлен вручную из админки на ${daysNum} дней`;
                    }

                    let guardedQuery = supabase.from('subscriptions').update(updates).eq('id', sub.id);
                    guardedQuery = current.expires_at == null
                        ? guardedQuery.is('expires_at', null)
                        : guardedQuery.eq('expires_at', current.expires_at);

                    const { data: updatedRows, error: updateError } = await guardedQuery.select('id');

                    // Ошибка одной строки не роняет batch: часть подписок уже
                    // продлена, остальные должны получить попытку. Считаем в failed.
                    if (updateError) {
                        failed += 1;
                        console.error('batch-add-days: сбой обновления подписки', sub.id, updateError.message || updateError);
                        break;
                    }

                    if ((updatedRows || []).length > 0) {
                        applied = true;
                        // Событие restored пишем по состоянию применённой итерации,
                        // а не по первоначально прочитанной подписке
                        kickedRestore = current.last_access_event === 'kicked';
                    } else {
                        const { data: rereadSub, error: rereadError } = await supabase
                            .from('subscriptions')
                            .select('*')
                            .eq('id', sub.id)
                            .single();
                        if (rereadError) {
                            failed += 1;
                            console.error('batch-add-days: сбой перечитывания подписки', sub.id, rereadError.message || rereadError);
                            break;
                        }
                        if (!rereadSub) break;
                        current = rereadSub;
                    }
                }

                if (!applied) {
                    conflicts += 1;
                    continue;
                }

                if (kickedRestore) {
                    await supabase.from('access_events').insert({
                        owner_id: req.user.id,
                        channel_id: sub.channel_id,
                        subscription_id: sub.id,
                        invoice_id: null,
                        invite_id: null,
                        tg_user_id: String(sub.tg_user_id),
                        event_type: 'restored',
                        event_source: 'manual_restore',
                        payload: {
                            days: daysNum === 'forever' ? 'forever' : daysNum,
                            source: 'admin_extend',
                            note: daysNum === 'forever'
                                ? 'Доступ восстановлен вручную из админки навсегда'
                                : `Доступ восстановлен вручную из админки на ${daysNum} дней`
                        }
                    });
                }

                updated += 1;
            }

            res.json({
                success: true,
                requested: subscriptionIds.length,
                updated,
                conflicts,
                failed
            });
        } catch (error) {
            console.error('Ошибка batch-add-days:', error);
            res.status(500).json({ error: 'Внутренняя ошибка batch-продления' });
        }
    });

    router.post('/crm/subscribers/batch-kick', authenticateUser, async (req, res) => {
        const subscriptionIds = Array.isArray(req.body?.subscription_ids) ? req.body.subscription_ids.map(String) : [];
        const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
        const batchKickSource = resolveBatchKickCallSource(
            req.body?.action_source,
            req.body?.source,
            req.body?.event_source
        );

        if (subscriptionIds.length === 0) {
            return res.status(400).json({ error: 'Не переданы подписки для кика' });
        }

        try {
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });

            const { data: subscriptions, error } = await supabase
                .from('subscriptions')
                .select('id, tg_user_id, channel_id, status, expires_at')
                .in('id', subscriptionIds);

            if (error) throw error;
            if (!subscriptions || subscriptions.length === 0) {
                return res.status(404).json({ error: 'Подписки не найдены' });
            }

            const channelIds = Array.from(new Set(subscriptions.map(sub => sub.channel_id).filter(Boolean)));
            const { data: channels, error: channelsError } = await supabase
                .from('channels')
                .select('id, owner_id, tg_chat_id')
                .in('id', channelIds);

            if (channelsError) throw channelsError;

            const channelMap = new Map((channels || []).filter(channel => channel.owner_id === req.user.id).map(channel => [channel.id, channel]));
            const allowedSubscriptions = subscriptions.filter(sub => channelMap.has(sub.channel_id));

            if (allowedSubscriptions.length === 0) {
                return res.status(403).json({ error: 'Нет доступа к этим подпискам' });
            }

            let kicked = 0;

            for (const sub of allowedSubscriptions) {
                const channel = channelMap.get(sub.channel_id);
                if (!channel?.tg_chat_id) continue;

                try {
                    await userbotService.kickMemberFromChannel(userbot, channel.tg_chat_id, sub.tg_user_id);

                    await supabase.from('access_events').insert({
                        owner_id: req.user.id,
                        channel_id: sub.channel_id,
                        subscription_id: sub.id,
                        invoice_id: null,
                        invite_id: null,
                        tg_user_id: String(sub.tg_user_id),
                        event_type: 'kicked',
                        event_source: batchKickSource.eventSource,
                        payload: {
                            source: batchKickSource.payloadSource,
                            note: batchKickSource.accessNote,
                            ...(batchKickSource.removalKind
                                ? { removal_kind: batchKickSource.removalKind }
                                : {})
                        }
                    });

                    const subscriptionPatch = {
                        last_access_event: 'kicked',
                        access_note: batchKickSource.accessNote
                    };

                    if (batchKickSource.shouldExpireSubscription) {
                        subscriptionPatch.status = 'expired';
                    }

                    await supabase
                        .from('subscriptions')
                        .update(subscriptionPatch)
                        .eq('id', sub.id);

                    kicked += 1;
                } catch (kickError) {
                    console.error(`Ошибка batch-kick для ${sub.tg_user_id}:`, kickError.message);
                }
            }

            res.json({
                success: true,
                requested: subscriptionIds.length,
                kicked
            });
        } catch (error) {
            console.error('Ошибка batch-kick:', error);
            res.status(500).json({ error: 'Внутренняя ошибка batch-кика' });
        }
    });

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

    return router;
}
