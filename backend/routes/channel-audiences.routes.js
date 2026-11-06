import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { UserbotService } from '../services/userbot.service.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';
import { registerMembersRoute } from './channel-audiences/members.js';
import { registerSyncRoute } from './channel-audiences/sync.js';

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

            // Сначала свои базы: у channel_audience_channels нет owner_id,
            // поэтому без фильтра по base_id выборка тянула привязки чужих баз.
            const { data: bases, error: basesError } = await supabase
                .from('channel_audiences')
                .select('*')
                .eq('owner_id', ownerId)
                .order('created_at', { ascending: false });
            if (basesError) throw basesError;
            const ownerBaseIds = (bases || []).map(base => base.id);

            const [{ data: channels, error: channelsError }, { data: baseChannels, error: baseChannelsError }, { data: members, error: membersError }, { data: userbots, error: userbotsError }, { data: bots, error: botsError }] = await Promise.all([
                supabase.from('channels').select('id, title, tg_chat_id, bot_id').eq('owner_id', ownerId).order('created_at', { ascending: false }),
                ownerBaseIds.length > 0
                    ? supabase.from('channel_audience_channels').select('base_id, channel_id').in('base_id', ownerBaseIds)
                    : Promise.resolve({ data: [], error: null }),
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

    const deps = { supabase, userbotService, loadOwnedBase, loadOwnedUserbot };
    registerMembersRoute(router, deps);
    registerSyncRoute(router, deps);

    return router;
}
