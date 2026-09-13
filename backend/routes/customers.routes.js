import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { OfficialBotService } from '../services/official-bot.service.js';
import { getBotById } from './official-bot.routes.js';

function latestBy(list = [], keyFn, dateField = 'created_at') {
    const map = new Map();

    for (const item of list) {
        const key = keyFn(item);
        if (!key) continue;

        const prev = map.get(key);
        const itemDate = new Date(item?.[dateField] || item?.issued_at || 0).getTime();
        const prevDate = new Date(prev?.[dateField] || prev?.issued_at || 0).getTime();

        if (!prev || itemDate >= prevDate) {
            map.set(key, item);
        }
    }

    return map;
}

function emptyListResult() {
    return Promise.resolve({ data: [], error: null });
}

function buildPersonDisplayName(profile = {}) {
    const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
    if (fullName) return fullName;
    if (profile.display_name) return String(profile.display_name).trim();
    return null;
}

function buildFunnelPersonProfile(event = {}) {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    const first_name = payload.first_name || null;
    const last_name = payload.last_name || null;
    const display_name = payload.display_name || null;
    const username = payload.username || null;

    return {
        first_name,
        last_name,
        display_name: buildPersonDisplayName({ first_name, last_name, display_name }),
        username
    };
}

function normalizeUuidLike(value) {
    const raw = String(value || '').trim();
    return raw || null;
}

function detectAccessSource(eventSource = null, payload = {}, accessNote = '') {
    const source = String(eventSource || '').trim().toLowerCase();
    const note = String(accessNote || '').toLowerCase();
    const eventPayload = payload && typeof payload === 'object' ? payload : {};
    const payloadSource = String(eventPayload.source || '').trim().toLowerCase();

    if (
        source === 'customers_manual_admin_removed'
        || source === 'customers_manual_action'
        || eventPayload.removal_kind === 'manual_admin_removed'
        || (source === 'manual_batch' && payloadSource === 'customers')
        || note.includes('удален админом вручную из customers')
    ) {
        return { key: 'manual_admin_removed', label: 'Удален админом вручную' };
    }

    if (
        source === 'customers_direct_access'
        || eventPayload.issued_via === 'customers_direct_access'
        || note.includes('доступ выдан вручную из customers')
    ) {
        return { key: 'customers_direct_access', label: 'Выдан вручную из Customers' };
    }

    if (source === 'gift_code' || source === 'admin_gift' || eventPayload.gift_code_id || eventPayload.gift_code || note.includes('подарочному коду')) {
        return { key: 'gift_code', label: 'Подарочный код' };
    }

    if (source === 'official_bot' || source === 'manual_ton' || source === 'manual_rub' || note.includes('join request')) {
        return { key: 'payment', label: 'Оплата' };
    }

    return { key: 'unknown', label: null };
}

function isManualAdminRemoval(eventSource = null, payload = {}, accessNote = '') {
    return detectAccessSource(eventSource, payload, accessNote).key === 'manual_admin_removed';
}

export default function customersRoutes(supabase) {
    const router = express.Router();
    const officialBotService = new OfficialBotService(supabase);

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

    router.get('/workbench', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const selectedBotId = normalizeUuidLike(req.query.bot_id);

            // Фильтр по боту — в самом запросе, а не после выборки: иначе при
            // выбранном боте лимит 150 съедается чужими событиями и под-вкладки
            // показывают урезанные счётчики.
            let funnelQuery = supabase
                .from('customer_funnel_events')
                .select('id, owner_id, bot_id, tg_user_id, tariff_id, event_type, source, referral_code, session_key, payload, created_at')
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
                    .select('base_id, tg_user_id, username, display_name, first_name, last_name, last_seen_at, present_now, is_bot, source_channel_ids')
                    .eq('owner_id', ownerId),
                funnelQuery
                    .order('created_at', { ascending: false })
                    .limit(150)
            ]);

            if (botsResp.error) throw botsResp.error;
            if (channelsResp.error) throw channelsResp.error;
            if (tariffsResp.error) throw tariffsResp.error;
            if (baseMembersResp.error && !(baseMembersResp.error.message || '').includes('channel_audience_members')) throw baseMembersResp.error;

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
                        .select('*')
                        .in('tariff_id', tariffIds)
                        .order('created_at', { ascending: false })
                        .limit(250)
                    : emptyListResult(),
                channelIds.length > 0
                    ? supabase
                        .from('subscriptions')
                        .select('id, tg_user_id, tg_username, channel_id, status, expires_at, last_join_request_at, last_join_approved_at, last_access_event, access_note, created_at')
                        .in('channel_id', channelIds)
                        .order('created_at', { ascending: false })
                        .limit(1000)
                    : emptyListResult(),
                supabase
                    .from('access_events')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(250)
            ]);

            if (invoicesResp.error) throw invoicesResp.error;
            if (subscriptionsResp.error) throw subscriptionsResp.error;
            if (accessEventsResp.error && !(accessEventsResp.error.message || '').includes('access_events')) throw accessEventsResp.error;

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
                channels
            });
        } catch (error) {
            console.error('Ошибка customers workbench:', error);
            res.status(500).json({ error: 'Ошибка загрузки клиентов' });
        }
    });

    return router;
}
