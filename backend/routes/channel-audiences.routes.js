import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { UserbotService } from '../services/userbot.service.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';
import { upsertPeerCacheBatch } from '../utils/peer-cache.js';

function buildDisplayName(user) {
    if (user.username) return `@${user.username}`;
    return [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || `ID ${user.tg_user_id}`;
}

export default function channelAudiencesRoutes(supabase) {
    const router = express.Router();
    const userbotService = new UserbotService(
        supabase,
        process.env.TG_API_ID,
        process.env.TG_API_HASH
    );

    async function loadOwnedBase(ownerId, baseId) {
        const { data: base, error } = await supabase
            .from('channel_audiences')
            .select('*')
            .eq('id', baseId)
            .eq('owner_id', ownerId)
            .single();

        if (error || !base) return null;
        return base;
    }

    async function loadLatestUserbot(ownerId) {
        const reservedUserbotIds = await loadReservedUserbotIds(supabase, ownerId);
        const { data, error } = await supabase
            .from('tg_accounts')
            .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
            .eq('owner_id', ownerId)
            .eq('account_type', 'userbot')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return (data || []).find(account =>
            !reservedUserbotIds.has(String(account.id)) &&
            !(account.proxy_id && account.proxies?.is_working === false)
        ) || null;
    }

    async function loadOwnedUserbot(ownerId, userbotId = null) {
        if (!userbotId) {
            return loadLatestUserbot(ownerId);
        }

        const reservedUserbotIds = await loadReservedUserbotIds(supabase, ownerId);
        if (reservedUserbotIds.has(String(userbotId))) {
            return null;
        }

        const { data, error } = await supabase
            .from('tg_accounts')
            .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
            .eq('owner_id', ownerId)
            .eq('account_type', 'userbot')
            .eq('id', userbotId)
            .limit(1);

        if (error) throw error;
        return data?.[0] || null;
    }

    router.get('/', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const reservedUserbotIds = await loadReservedUserbotIds(supabase, ownerId);
            const [{ data: bases, error: basesError }, { data: channels, error: channelsError }, { data: baseChannels, error: baseChannelsError }, { data: members, error: membersError }, { data: userbots, error: userbotsError }, { data: bots, error: botsError }] = await Promise.all([
                supabase.from('channel_audiences').select('*').eq('owner_id', ownerId).order('created_at', { ascending: false }),
                supabase.from('channels').select('id, title, tg_chat_id, bot_id').eq('owner_id', ownerId).order('created_at', { ascending: false }),
                supabase.from('channel_audience_channels').select('base_id, channel_id'),
                supabase.from('channel_audience_members').select('base_id, present_now, is_bot')
                    .eq('owner_id', ownerId),
                supabase
                    .from('tg_accounts')
                    .select('id, tg_account_id, tg_username, proxy_id, proxies(name, last_check_country, is_working)')
                    .eq('owner_id', ownerId)
                    .eq('account_type', 'userbot')
                    .order('created_at', { ascending: false }),
                supabase
                    .from('tg_accounts')
                    .select('id, tg_username, custom_label, bot_role')
                    .eq('owner_id', ownerId)
                    .eq('account_type', 'bot')
                    .neq('bot_role', 'ops')
                    .order('created_at', { ascending: true })
            ]);

            if (basesError) throw basesError;
            if (channelsError) throw channelsError;
            if (baseChannelsError && !(baseChannelsError.message || '').includes('channel_audience_channels')) throw baseChannelsError;
            if (membersError && !(membersError.message || '').includes('channel_audience_members')) throw membersError;
            if (userbotsError) throw userbotsError;
            if (botsError) throw botsError;

            const channelMap = new Map((channels || []).map(channel => [channel.id, channel]));
            const channelsByBase = new Map();
            for (const link of baseChannels || []) {
                if (!channelsByBase.has(link.base_id)) channelsByBase.set(link.base_id, []);
                const channel = channelMap.get(link.channel_id);
                if (channel) channelsByBase.get(link.base_id).push(channel);
            }

            const memberStatsByBase = new Map();
            for (const member of members || []) {
                if (!memberStatsByBase.has(member.base_id)) {
                    memberStatsByBase.set(member.base_id, {
                        total: 0,
                        humans: 0,
                        bots: 0,
                        present: 0
                    });
                }
                const stats = memberStatsByBase.get(member.base_id);
                stats.total += 1;
                if (member.is_bot) stats.bots += 1;
                else stats.humans += 1;
                if (member.present_now) stats.present += 1;
            }

            const hydratedBases = (bases || []).map(base => {
                const baseChannels = channelsByBase.get(base.id) || [];
                return {
                    ...base,
                    bot_id: baseChannels[0]?.bot_id || null,
                    channels: baseChannels,
                    stats: memberStatsByBase.get(base.id) || { total: 0, humans: 0, bots: 0, present: 0 }
                };
            });

            const baseBySingleChannel = new Map();
            for (const base of bases || []) {
                const baseChannels = channelsByBase.get(base.id) || [];
                if (baseChannels.length === 1) {
                    baseBySingleChannel.set(baseChannels[0].id, base.id);
                }
            }

            const hydratedChannels = (channels || []).map(channel => ({
                ...channel,
                linked_base_id: baseBySingleChannel.get(channel.id) || null
            }));

            const hydratedUserbots = (userbots || [])
                .filter((account) => !reservedUserbotIds.has(String(account.id)))
                .map((account) => ({
                    id: account.id,
                    tg_account_id: account.tg_account_id,
                    tg_username: account.tg_username,
                    proxy_id: account.proxy_id,
                    proxy_name: account.proxies?.name || null,
                    proxy_country: account.proxies?.last_check_country || null,
                    proxy_is_working: account.proxies?.is_working
                }));

            res.json({
                success: true,
                bases: hydratedBases,
                channels: hydratedChannels,
                userbots: hydratedUserbots,
                bots: bots || []
            });
        } catch (error) {
            console.error('Ошибка загрузки баз клиентов:', error);
            res.status(500).json({ error: 'Ошибка загрузки баз клиентов' });
        }
    });

    router.post('/', authenticateUser, async (req, res) => {
        try {
            const { id, name, description } = req.body;
            if (!name || !name.trim()) {
                return res.status(400).json({ error: 'Назови базу, а то непонятно что ты создаешь' });
            }

            const payload = {
                owner_id: req.user.id,
                name: name.trim(),
                description: description?.trim() || null,
                updated_at: new Date().toISOString()
            };

            let query = supabase.from('channel_audiences');
            if (id) {
                const { data, error } = await query.update(payload).eq('id', id).eq('owner_id', req.user.id).select('id').single();
                if (error) throw error;
                res.json({ success: true, id: data?.id || id });
            } else {
                const { data, error } = await query.insert(payload).select('id').single();
                if (error) throw error;
                res.json({ success: true, id: data?.id || null });
            }
        } catch (error) {
            console.error('Ошибка сохранения базы клиентов:', error);
            res.status(500).json({ error: 'Ошибка сохранения базы клиентов' });
        }
    });

    router.post('/:id/channels', authenticateUser, async (req, res) => {
        try {
            const baseId = req.params.id;
            const channelIds = Array.isArray(req.body.channel_ids) ? req.body.channel_ids : [];

            const { data: base, error: baseError } = await supabase
                .from('channel_audiences')
                .select('id')
                .eq('id', baseId)
                .eq('owner_id', req.user.id)
                .single();

            if (baseError || !base) return res.status(404).json({ error: 'База не найдена' });

            const { data: ownedChannels, error: channelsError } = await supabase
                .from('channels')
                .select('id')
                .eq('owner_id', req.user.id)
                .in('id', channelIds.length > 0 ? channelIds : ['00000000-0000-0000-0000-000000000000']);

            if (channelIds.length > 0 && channelsError) throw channelsError;
            if (channelIds.length > 0 && (ownedChannels || []).length !== channelIds.length) {
                return res.status(400).json({ error: 'В список попали чужие или битые каналы' });
            }

            const { error: deleteError } = await supabase
                .from('channel_audience_channels')
                .delete()
                .eq('base_id', baseId);
            if (deleteError) throw deleteError;

            if (channelIds.length > 0) {
                const { error: insertError } = await supabase
                    .from('channel_audience_channels')
                    .insert(channelIds.map(channelId => ({
                        base_id: baseId,
                        channel_id: channelId
                    })));
                if (insertError) throw insertError;
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Ошибка привязки каналов к базе:', error);
            res.status(500).json({ error: 'Ошибка привязки каналов к базе' });
        }
    });

    router.get('/:id/members', authenticateUser, async (req, res) => {
        try {
            const baseId = req.params.id;
            const base = await loadOwnedBase(req.user.id, baseId);
            if (!base) return res.status(404).json({ error: 'База не найдена' });

            const { data: members, error } = await supabase
                .from('channel_audience_members')
                .select('*')
                .eq('owner_id', req.user.id)
                .eq('base_id', baseId)
                .order('channels_count', { ascending: false })
                .order('updated_at', { ascending: false })
                .limit(1000);

            if (error) throw error;

            const { data: links } = await supabase
                .from('channel_audience_channels')
                .select('channel_id, channels(id, title)')
                .eq('base_id', baseId);

            const linkedChannels = (links || [])
                .map(link => link.channels || null)
                .filter(Boolean);
            const totalChannels = linkedChannels.length;
            const linkedChannelIds = linkedChannels.map(channel => channel.id);

            const { data: linkedTariffs, error: linkedTariffsError } = linkedChannelIds.length > 0
                ? await supabase
                    .from('tariffs')
                    .select('id, channel_id')
                    .in('channel_id', linkedChannelIds)
                : { data: [], error: null };

            if (linkedTariffsError) throw linkedTariffsError;

            const linkedTariffIds = (linkedTariffs || []).map(tariff => tariff.id);

            const [{ data: subscriptions, error: subscriptionsError }, { data: invoices, error: invoicesError }] = await Promise.all([
                linkedChannelIds.length > 0
                    ? supabase
                        .from('subscriptions')
                        .select('tg_user_id, channel_id, status, expires_at')
                        .in('channel_id', linkedChannelIds)
                    : Promise.resolve({ data: [], error: null }),
                linkedTariffIds.length > 0
                    ? supabase
                        .from('invoices')
                        .select('tg_user_id, status, created_at, paid_at')
                        .in('tariff_id', linkedTariffIds)
                        .order('created_at', { ascending: false })
                        .limit(5000)
                    : Promise.resolve({ data: [], error: null })
            ]);

            if (subscriptionsError) throw subscriptionsError;
            if (invoicesError) throw invoicesError;

            const nowIso = new Date().toISOString();
            const subscriptionStatsByUser = new Map();
            for (const subscription of subscriptions || []) {
                const tgUserId = String(subscription.tg_user_id);
                if (!subscriptionStatsByUser.has(tgUserId)) {
                    subscriptionStatsByUser.set(tgUserId, {
                        active_subscription_count: 0,
                        expired_subscription_count: 0
                    });
                }

                const stats = subscriptionStatsByUser.get(tgUserId);
                const isActive = subscription.status === 'active' && (!subscription.expires_at || subscription.expires_at >= nowIso);
                if (isActive) stats.active_subscription_count += 1;
                else stats.expired_subscription_count += 1;
            }

            const invoiceStatsByUser = new Map();
            for (const invoice of invoices || []) {
                const tgUserId = String(invoice.tg_user_id);
                if (!invoiceStatsByUser.has(tgUserId)) {
                    invoiceStatsByUser.set(tgUserId, {
                        has_any_paid_invoice: false,
                        has_pending_invoice: false,
                        last_paid_at: null,
                        last_invoice_status: null
                    });
                }

                const stats = invoiceStatsByUser.get(tgUserId);
                stats.last_invoice_status = stats.last_invoice_status || invoice.status;

                if (invoice.status === 'paid') {
                    stats.has_any_paid_invoice = true;
                    if (!stats.last_paid_at || new Date(invoice.paid_at || invoice.created_at || 0) > new Date(stats.last_paid_at)) {
                        stats.last_paid_at = invoice.paid_at || invoice.created_at || null;
                    }
                }

                if (['pending', 'awaiting_receipt', 'wait_admin'].includes(invoice.status)) {
                    stats.has_pending_invoice = true;
                }
            }

            const hydratedMembers = (members || []).map(member => ({
                ...member,
                total_channels: totalChannels,
                present_channel_titles: linkedChannels
                    .filter(channel => (member.source_channel_ids || []).includes(channel.id))
                    .map(channel => channel.title),
                missing_channel_titles: linkedChannels
                    .filter(channel => !(member.source_channel_ids || []).includes(channel.id))
                    .map(channel => channel.title),
                ...(() => {
                    const tgUserId = String(member.tg_user_id);
                    const subscriptionStats = subscriptionStatsByUser.get(tgUserId) || {
                        active_subscription_count: 0,
                        expired_subscription_count: 0
                    };
                    const invoiceStats = invoiceStatsByUser.get(tgUserId) || {
                        has_any_paid_invoice: false,
                        has_pending_invoice: false,
                        last_paid_at: null
                    };

                    let payment_status = 'no_payment_history';
                    if (subscriptionStats.active_subscription_count > 0) payment_status = 'active_paid';
                    else if (invoiceStats.has_any_paid_invoice) payment_status = 'expired_paid';
                    else if (invoiceStats.has_pending_invoice) payment_status = 'unpaid_lead';

                    if (member.present_now && subscriptionStats.active_subscription_count === 0 && !member.is_bot) {
                        payment_status = invoiceStats.has_any_paid_invoice ? 'expired_paid_inside' : 'free_rider';
                    }

                    return {
                        active_subscription_count: subscriptionStats.active_subscription_count,
                        expired_subscription_count: subscriptionStats.expired_subscription_count,
                        has_any_paid_invoice: invoiceStats.has_any_paid_invoice,
                        has_pending_invoice: invoiceStats.has_pending_invoice,
                        last_paid_at: invoiceStats.last_paid_at,
                        payment_status
                    };
                })(),
                coverage_status: totalChannels > 0 && member.channels_count >= totalChannels
                    ? 'all_channels'
                    : (member.channels_count > 0 ? 'partial_channels' : 'missing_everywhere')
            }));

            const summary = hydratedMembers.reduce((stats, member) => {
                if (member.is_bot) {
                    stats.bots += 1;
                    return stats;
                }
                stats.total += 1;
                stats.humans += 1;
                if (member.payment_status === 'active_paid') stats.active_paid += 1;
                if (member.payment_status === 'expired_paid' || member.payment_status === 'expired_paid_inside') stats.expired_paid += 1;
                if (member.payment_status === 'unpaid_lead') stats.unpaid_leads += 1;
                if (member.payment_status === 'free_rider' || member.payment_status === 'expired_paid_inside') stats.free_riders += 1;
                return stats;
            }, {
                total: 0,
                humans: 0,
                bots: 0,
                active_paid: 0,
                expired_paid: 0,
                unpaid_leads: 0,
                free_riders: 0
            });

            res.json({ success: true, members: hydratedMembers, summary });
        } catch (error) {
            console.error('Ошибка загрузки участников базы:', error);
            res.status(500).json({ error: 'Ошибка загрузки участников базы' });
        }
    });

    router.post('/:id/sync', authenticateUser, async (req, res) => {
        try {
            const baseId = req.params.id;
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const base = await loadOwnedBase(req.user.id, baseId);
            if (!base) return res.status(404).json({ error: 'База не найдена' });

            const [{ data: links, error: linksError }, { data: userbot, error: userbotError }] = await Promise.all([
                supabase
                    .from('channel_audience_channels')
                    .select('channel_id, channels(id, title, tg_chat_id)')
                    .eq('base_id', baseId),
                loadOwnedUserbot(req.user.id, userbotId).then(userbot => ({ data: userbot, error: null })).catch(error => ({ data: null, error }))
            ]);

            if (linksError) throw linksError;
            if (userbotError || !userbot) return res.status(400).json({ error: 'Сначала подключи живой юзербот. Если у него сдох прокси, синк базы не взлетит.' });

            const linkedChannels = (links || [])
                .map(link => link.channels)
                .filter(Boolean);

            if (linkedChannels.length === 0) {
                return res.status(400).json({ error: 'В базе нет привязанных групп или чатов' });
            }

            const client = await userbotService.createAuthorizedClient(userbot, 1);
            const aggregatedMembers = new Map();

            try {
                await supabase
                    .from('channel_audience_members')
                    .update({ present_now: false, updated_at: new Date().toISOString() })
                    .eq('base_id', baseId)
                    .eq('owner_id', req.user.id);

                for (const channel of linkedChannels) {
                    try {
                        const participants = await client.getParticipants(channel.tg_chat_id, { limit: 5000 });

                        await upsertPeerCacheBatch(supabase, (participants || [])
                            .filter(participant => participant?.accessHash != null)
                            .map(participant => ({
                                owner_id: req.user.id,
                                userbot_id: userbot.id,
                                tg_user_id: String(participant.id),
                                access_hash: participant.accessHash.toString(),
                                username: participant.username || null,
                                source: 'get_participants'
                            })));

                        for (const participant of participants || []) {
                            const tgUserId = String(participant.id);
                            const existing = aggregatedMembers.get(tgUserId) || {
                                owner_id: req.user.id,
                                base_id: baseId,
                                tg_user_id: tgUserId,
                                username: participant.username || null,
                                first_name: participant.firstName || null,
                                last_name: participant.lastName || null,
                                display_name: buildDisplayName({
                                    tg_user_id: tgUserId,
                                    username: participant.username || null,
                                    first_name: participant.firstName || null,
                                    last_name: participant.lastName || null
                                }),
                                is_bot: !!participant.bot,
                                source_channel_ids: [],
                                channels_count: 0,
                                present_now: true,
                                last_seen_at: new Date().toISOString(),
                                updated_at: new Date().toISOString()
                            };

                            if (!existing.source_channel_ids.includes(channel.id)) {
                                existing.source_channel_ids.push(channel.id);
                            }

                            existing.channels_count = existing.source_channel_ids.length;
                            existing.present_now = true;
                            existing.last_seen_at = new Date().toISOString();
                            existing.updated_at = new Date().toISOString();

                            aggregatedMembers.set(tgUserId, existing);
                        }
                    } catch (channelError) {
                        console.error(`Ошибка чтения участников ${channel.title}:`, channelError.message);
                    }
                }
            } finally {
                await client.disconnect();
            }

            const upsertPayload = Array.from(aggregatedMembers.values());
            if (upsertPayload.length > 0) {
                const { error: upsertError } = await supabase
                    .from('channel_audience_members')
                    .upsert(upsertPayload, { onConflict: 'base_id,tg_user_id' });
                if (upsertError) throw upsertError;
            }

            await supabase
                .from('channel_audiences')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', baseId)
                .eq('owner_id', req.user.id);

            res.json({
                success: true,
                synced_count: upsertPayload.length,
                scanned_channels: linkedChannels.length
            });
        } catch (error) {
            console.error('Ошибка синка базы клиентов:', error);
            res.status(500).json({ error: 'Ошибка синка базы клиентов' });
        }
    });

    router.post('/:id/actions/import-subscriptions', authenticateUser, async (req, res) => {
        try {
            const baseId = req.params.id;
            const base = await loadOwnedBase(req.user.id, baseId);
            if (!base) return res.status(404).json({ error: 'База не найдена' });

            const tgUserIds = Array.isArray(req.body.tg_user_ids)
                ? req.body.tg_user_ids.map(value => String(value)).filter(Boolean)
                : [];
            const channelId = req.body.channel_id;
            const days = req.body.days || '30';

            if (tgUserIds.length === 0) {
                return res.status(400).json({ error: 'Ты никого не выбрал. Без людей импортировать нечего.' });
            }

            if (!channelId) {
                return res.status(400).json({ error: 'Выбери канал, куда закидывать людей в CRM' });
            }

            const { data: channel, error: channelError } = await supabase
                .from('channels')
                .select('id, title')
                .eq('id', channelId)
                .eq('owner_id', req.user.id)
                .single();

            if (channelError || !channel) {
                return res.status(404).json({ error: 'Канал не найден или не принадлежит тебе' });
            }

            let expiresAt = null;
            if (days !== 'forever') {
                const date = new Date();
                date.setDate(date.getDate() + parseInt(days, 10));
                expiresAt = date.toISOString();
            }

            const uniqueUserIds = Array.from(new Set(tgUserIds));
            const upsertData = uniqueUserIds.map(tgUserId => ({
                tg_user_id: tgUserId,
                channel_id: channel.id,
                status: 'active',
                expires_at: expiresAt
            }));

            const { error: upsertError } = await supabase
                .from('subscriptions')
                .upsert(upsertData, { onConflict: 'tg_user_id,channel_id' });

            if (upsertError) throw upsertError;

            res.json({
                success: true,
                imported_count: uniqueUserIds.length,
                channel_title: channel.title
            });
        } catch (error) {
            console.error('Ошибка массового импорта из базы в CRM:', error);
            res.status(500).json({ error: 'Ошибка массового импорта из базы в CRM' });
        }
    });

    return router;
}
