// Рабочий центр юзербота: живой скан диалогов/групп и кэш центра
// (финальная стадия 2b разрезки userbot.routes.js).
// Зона: GET /ops-center. Константы USERBOT_CENTER_* использовались только
// этой зоной — переехали вместе с ней.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { Api } from 'teleproto';
import { loadReservedUserbotIds } from '../../utils/shop-reservations.js';
import { resolveOpsCenterSelection } from '../../utils/ops-center-selection.js';
import {
    buildUserbotCenterAccount,
    buildUserbotCenterSignalConfig,
    buildUserbotCenterSummary,
    loadUserbotCenterCache,
    replaceUserbotCenterCache
} from './helpers-center.js';
import {
    detectSalesSignal,
    getDeadProxyMessage,
    isExpiredUserbotSessionError,
    isUserbotOnDeadProxy,
    normalizeMessageDate,
    sleep
} from './helpers-core.js';

const USERBOT_CENTER_DIALOG_LIMIT = Number(process.env.USERBOT_CENTER_DIALOG_LIMIT || 80);
const USERBOT_CENTER_ADMIN_CHECK_DELAY_MS = Number(process.env.USERBOT_CENTER_ADMIN_CHECK_DELAY_MS || 350);

export function registerOpsCenter(router, ctx) {
    const { supabase, userbotService } = ctx;
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
}
