import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { OfficialBotService } from '../services/official-bot.service.js';
import {
    latestBy,
    emptyListResult,
    isUndefinedTableError,
    buildLimitCap,
    buildPersonDisplayName,
    buildFunnelPersonProfile,
    normalizeUuidLike,
    detectAccessSource,
    isManualAdminRemoval
} from './customers/access-source.js';
import { registerDirectAccessRoute } from './customers/direct-access.js';

export default function customersRoutes(supabase) {
    const router = express.Router();
    const officialBotService = new OfficialBotService(supabase);

    registerDirectAccessRoute(router, supabase, officialBotService);

    router.get('/workbench', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const selectedBotId = normalizeUuidLike(req.query.bot_id);

            // Фильтр по боту — в самом запросе, а не после выборки: иначе при
            // выбранном боте лимит 150 съедается чужими событиями и под-вкладки
            // показывают урезанные счётчики.
            let funnelQuery = supabase
                .from('customer_funnel_events')
                .select('id, owner_id, bot_id, tg_user_id, tariff_id, event_type, source, referral_code, session_key, payload, created_at', { count: 'exact' })
                .eq('owner_id', ownerId);
            if (selectedBotId) funnelQuery = funnelQuery.eq('bot_id', selectedBotId);

            const [
                botsResp,
                channelsResp,
                tariffsResp,
                baseMembersResp,
                funnelResp
            ] = await Promise.all([
                supabase
                    .from('tg_accounts')
                    .select('id, tg_username, tg_account_id, bot_role, runtime_status, created_at')
                    .eq('owner_id', ownerId)
                    .eq('account_type', 'bot')
                    .order('created_at', { ascending: false }),
                supabase
                    .from('channels')
                    .select('id, title, tg_chat_id, bot_id')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('tariffs')
                    .select('id, title, owner_id, channel_id, is_trial, trial_label')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('channel_audience_members')
                    // Только колонки, которые реально читаются ниже (профили + presence).
                    // Лимит 5000 — верхняя граница выборки аудитории на админа.
                    .select('tg_user_id, username, display_name, first_name, last_name, last_seen_at, present_now, source_channel_ids')
                    .eq('owner_id', ownerId)
                    .limit(5000),
                funnelQuery
                    .order('created_at', { ascending: false })
                    .limit(150)
            ]);

            if (botsResp.error) throw botsResp.error;
            if (channelsResp.error) throw channelsResp.error;
            if (tariffsResp.error) throw tariffsResp.error;
            if (baseMembersResp.error) {
                // Проглатываем только «таблицы нет», остальное падает в catch роута
                if (isUndefinedTableError(baseMembersResp.error)) {
                    console.error('[customers workbench] channel_audience_members недоступна:', baseMembersResp.error.message || baseMembersResp.error);
                } else {
                    throw baseMembersResp.error;
                }
            }

            const allBots = botsResp.data || [];
            const allChannels = channelsResp.data || [];
            const allTariffs = tariffsResp.data || [];
            // Ошибка funnel-выборки не роняет весь workbench (сегменты event-sourcing
            // некритичны), но больше не глотается молча.
            if (funnelResp.error) {
                console.error('[customers workbench] funnel events query failed:', funnelResp.error);
            }
            const allFunnelEvents = funnelResp.error ? [] : (funnelResp.data || []);

            const orphanBotIds = new Set([
                ...allChannels.map(channel => channel.bot_id).filter(Boolean),
                ...allFunnelEvents.map(event => event.bot_id).filter(Boolean)
            ]);
            for (const bot of allBots) {
                orphanBotIds.delete(bot.id);
            }

            const botOptions = [
                ...allBots.map(bot => ({
                    id: bot.id,
                    label: bot.tg_username ? `@${bot.tg_username}` : `ID ${bot.tg_account_id || bot.id}`,
                    tg_username: bot.tg_username || null,
                    tg_account_id: bot.tg_account_id || null,
                    bot_role: bot.bot_role || 'sales',
                    status: 'active',
                    runtime_status: bot.runtime_status || null
                })),
                ...Array.from(orphanBotIds).map(botId => ({
                    id: botId,
                    label: `Удаленный бот ${String(botId).slice(0, 8)}`,
                    tg_username: null,
                    tg_account_id: null,
                    bot_role: 'sales',
                    status: 'deleted',
                    runtime_status: 'deleted'
                }))
            ];

            const channels = selectedBotId
                ? allChannels.filter(channel => String(channel.bot_id || '') === selectedBotId)
                : allChannels;
            const channelIds = channels.map(channel => channel.id);
            const tariffs = allTariffs.filter(tariff => channelIds.includes(tariff.channel_id));
            const tariffIds = tariffs.map(tariff => tariff.id);
            const channelMap = new Map(channels.map(channel => [channel.id, channel]));
            const tariffMap = new Map(tariffs.map(tariff => [tariff.id, tariff]));

            const [
                invoicesResp,
                subscriptionsResp,
                accessEventsResp
            ] = await Promise.all([
                tariffIds.length > 0
                    ? supabase
                        .from('invoices')
                        // Только колонки дедупа viewed↔invoices ниже; invoices целиком
                        // в ответ workbench не попадают.
                        .select('tg_user_id, tariff_id, created_at', { count: 'exact' })
                        .in('tariff_id', tariffIds)
                        .order('created_at', { ascending: false })
                        .limit(250)
                    : emptyListResult(),
                channelIds.length > 0
                    ? supabase
                        .from('subscriptions')
                        .select('id, tg_user_id, tg_username, channel_id, status, expires_at, last_join_request_at, last_join_approved_at, last_access_event, access_note, created_at', { count: 'exact' })
                        .in('channel_id', channelIds)
                        .order('created_at', { ascending: false })
                        .limit(1000)
                    : emptyListResult(),
                supabase
                    .from('access_events')
                    // Только то, что читают latestBy + detectAccessSource ниже.
                    .select('subscription_id, event_source, payload, created_at')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(250)
            ]);

            if (invoicesResp.error) throw invoicesResp.error;
            if (subscriptionsResp.error) throw subscriptionsResp.error;
            if (accessEventsResp.error) {
                // Проглатываем только «таблицы нет», остальное падает в catch роута
                if (isUndefinedTableError(accessEventsResp.error)) {
                    console.error('[customers workbench] access_events недоступна:', accessEventsResp.error.message || accessEventsResp.error);
                } else {
                    throw accessEventsResp.error;
                }
            }

            const caps = {
                funnel: buildLimitCap(funnelResp, 150),
                invoices: buildLimitCap(invoicesResp, 250),
                subscriptions: buildLimitCap(subscriptionsResp, 1000)
            };

            const invoices = invoicesResp.data || [];
            const subscriptions = subscriptionsResp.data || [];
            const accessEvents = accessEventsResp.data || [];
            const baseMembers = baseMembersResp.data || [];
            const filteredBaseMembers = selectedBotId
                ? baseMembers.filter(member => {
                    const sourceChannelIds = Array.isArray(member.source_channel_ids) ? member.source_channel_ids : [];
                    return sourceChannelIds.some(cid => channelIds.includes(cid));
                })
                : baseMembers;

            const presentByUserChannel = new Set();
            for (const member of filteredBaseMembers) {
                if (!member.present_now || !member.tg_user_id) continue;
                const sourceChannelIds = Array.isArray(member.source_channel_ids) ? member.source_channel_ids : [];
                for (const channelId of sourceChannelIds) {
                    if (channelId) {
                        presentByUserChannel.add(`${member.tg_user_id}:${channelId}`);
                    }
                }
            }

            const latestAccessEventBySubscription = latestBy(
                accessEvents.filter(event => event.subscription_id),
                event => event.subscription_id
            );
            const latestBaseProfileByUser = latestBy(
                filteredBaseMembers.filter(member => member.tg_user_id),
                member => String(member.tg_user_id),
                'last_seen_at'
            );
            const latestFunnelProfileByUser = latestBy(
                allFunnelEvents.filter(event => event.tg_user_id),
                event => String(event.tg_user_id)
            );

            function getPersonProfile(tgUserId, fallbackUsername = null) {
                const baseProfile = latestBaseProfileByUser.get(String(tgUserId)) || null;
                const funnelProfile = buildFunnelPersonProfile(latestFunnelProfileByUser.get(String(tgUserId)) || null);
                const displayName = buildPersonDisplayName({
                    first_name: baseProfile?.first_name || funnelProfile.first_name,
                    last_name: baseProfile?.last_name || funnelProfile.last_name,
                    display_name: baseProfile?.display_name || funnelProfile.display_name
                });

                return {
                    tg_username: fallbackUsername || baseProfile?.username || funnelProfile.username || null,
                    display_name: displayName,
                    first_name: baseProfile?.first_name || funnelProfile.first_name || null,
                    last_name: baseProfile?.last_name || funnelProfile.last_name || null
                };
            }

            const enrichedSubscriptions = subscriptions.map(sub => {
                const person = getPersonProfile(sub.tg_user_id, sub.tg_username || null);
                const accessEvent = latestAccessEventBySubscription.get(sub.id) || null;
                const accessSource = detectAccessSource(accessEvent?.event_source, accessEvent?.payload, sub.access_note);
                const presenceConfirmed = presentByUserChannel.has(`${sub.tg_user_id}:${sub.channel_id}`);

                return {
                    ...sub,
                    tg_username: person.tg_username,
                    display_name: person.display_name,
                    first_name: person.first_name,
                    last_name: person.last_name,
                    access_source: accessSource.key,
                    access_source_label: accessSource.label,
                    in_group: !!sub.last_join_approved_at || presenceConfirmed,
                    presence_confirmed: presenceConfirmed,
                    channel_title: channelMap.get(sub.channel_id)?.title || 'Неизвестный канал',
                    removed_by_admin: isManualAdminRemoval(accessEvent?.event_source, accessEvent?.payload, sub.access_note)
                };
            });

            const activeCustomers = enrichedSubscriptions
                .filter(sub => sub.status === 'active' && !sub.removed_by_admin);

            const expiredCustomers = enrichedSubscriptions
                .filter(sub => sub.status === 'expired' && !sub.removed_by_admin);

            const scopedFunnelEvents = selectedBotId
                ? allFunnelEvents.filter(event => String(event.bot_id || '') === selectedBotId)
                : allFunnelEvents;

            const viewedEvents = scopedFunnelEvents.map(event => ({
                    ...event,
                    tariff_title: tariffMap.get(event.tariff_id)?.title || null,
                    channel_id: tariffMap.get(event.tariff_id)?.channel_id || null,
                    channel_title: channelMap.get(tariffMap.get(event.tariff_id)?.channel_id)?.title || null
                }));

            const viewedTariffs = viewedEvents.filter(event =>
                ['tariff_list_opened', 'tariff_card_opened', 'payment_method_selected'].includes(event.event_type) &&
                !invoices.some(invoice => {
                    if (String(invoice.tg_user_id) !== String(event.tg_user_id)) return false;
                    if (event.tariff_id && String(invoice.tariff_id) !== String(event.tariff_id)) return false;
                    return new Date(invoice.created_at).getTime() >= new Date(event.created_at).getTime();
                })
            ).map(event => {
                const person = getPersonProfile(event.tg_user_id, null);
                return {
                    ...event,
                    tg_username: person.tg_username,
                    display_name: person.display_name,
                    first_name: person.first_name,
                    last_name: person.last_name
                };
            });

            // Отдельный сегмент для под-вкладки «Создали счет»: без дедупа по
            // инвойсам, который применен к viewedTariffs (иначе сегмент всегда пуст).
            const invoiceCreatedRows = viewedEvents
                .filter(event => event.event_type === 'invoice_created')
                .map(event => {
                    const person = getPersonProfile(event.tg_user_id, null);
                    return {
                        ...event,
                        tg_username: person.tg_username,
                        display_name: person.display_name,
                        first_name: person.first_name,
                        last_name: person.last_name
                    };
                });

            const startedContacts = viewedEvents
                .filter(event => event.event_type === 'bot_started')
                .reduce((acc, event) => {
                    const existing = acc.get(String(event.tg_user_id));
                    const eventTime = new Date(event.created_at || 0).getTime();
                    const existingTime = new Date(existing?.created_at || 0).getTime();
                    if (!existing || eventTime < existingTime) {
                        const person = getPersonProfile(event.tg_user_id, null);
                        acc.set(String(event.tg_user_id), {
                            ...event,
                            tg_username: person.tg_username,
                            display_name: person.display_name,
                            first_name: person.first_name,
                            last_name: person.last_name,
                            status: 'Нажал /start',
                            reason: event.payload?.start_payload ? `Payload: ${event.payload.start_payload}` : 'Первое касание с ботом'
                        });
                    }
                    return acc;
                }, new Map());

            const segments = {
                startedContacts: Array.from(startedContacts.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
                viewedTariffs,
                invoiceCreated: invoiceCreatedRows,
                activeCustomers,
                expiredCustomers
            };

            res.json({
                success: true,
                updatedAt: new Date().toISOString(),
                bots: botOptions,
                segments,
                channels,
                caps
            });
        } catch (error) {
            console.error('Ошибка customers workbench:', error);
            res.status(500).json({ error: 'Ошибка загрузки клиентов' });
        }
    });

    return router;
}
