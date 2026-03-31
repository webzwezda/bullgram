import express from 'express';
import { authenticateUser, requireObserverRole } from '../middlewares/auth.middleware.js';

function getOwnerLabel(profile, ownerId) {
    if (!profile) return `ID ${ownerId}`;
    return profile.full_name || profile.email || `ID ${ownerId}`;
}

function dedupeManagedChannels(channels = []) {
    const grouped = new Map();

    for (const channel of channels) {
        const key = String(channel.tg_chat_id || channel.id);
        const existing = grouped.get(key);

        if (!existing) {
            grouped.set(key, channel);
            continue;
        }

        const existingInviteReady = !!existing.observer_invite_ready;
        const nextInviteReady = !!channel.observer_invite_ready;

        if (!existingInviteReady && nextInviteReady) {
            grouped.set(key, channel);
            continue;
        }

        if (existingInviteReady === nextInviteReady) {
            const existingUpdatedAt = existing.observer_invite_generated_at || existing.created_at || '';
            const nextUpdatedAt = channel.observer_invite_generated_at || channel.created_at || '';
            if (String(nextUpdatedAt) > String(existingUpdatedAt)) {
                grouped.set(key, channel);
            }
        }
    }

    return Array.from(grouped.values());
}

async function loadCachedObserverInvites(supabase, channelIds = []) {
    if (!channelIds.length) return new Map();

    const { data, error } = await supabase
        .from('observer_channel_invites')
        .select('channel_id, invite_link, invite_name, created_at, updated_at, last_generated_at')
        .in('channel_id', channelIds);

    if (error && !(error.message || '').includes('observer_channel_invites')) {
        throw error;
    }

    return new Map((data || []).map(row => [String(row.channel_id), row]));
}

async function persistObserverInvite(supabase, payload) {
    const { data, error } = await supabase
        .from('observer_channel_invites')
        .upsert(payload, { onConflict: 'channel_id' })
        .select('channel_id, invite_link, invite_name, created_at, updated_at, last_generated_at')
        .single();

    if (error) throw error;
    return data;
}

async function generateObserverInvite({ supabase, channel, bot, force = false }) {
    const existingMap = await loadCachedObserverInvites(supabase, [channel.id]);
    const existing = existingMap.get(String(channel.id));
    if (existing && !force) return existing;

    const inviteName = `Observer_${channel.id.slice(0, 6)}_${Date.now()}`;
    const invite = await bot.telegram.createChatInviteLink(channel.tg_chat_id, {
        name: inviteName
    });

    return persistObserverInvite(supabase, {
        owner_id: channel.owner_id,
        channel_id: channel.id,
        bot_id: channel.bot_id,
        invite_link: invite.invite_link,
        invite_name: inviteName,
        last_generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });
}

export default function observerRoutes(supabase, getBotById) {
    const router = express.Router();

    router.get('/overview', authenticateUser, requireObserverRole, async (req, res) => {
        try {
            const [{ data: channels, error: channelsError }, { data: accounts, error: accountsError }] = await Promise.all([
                supabase
                    .from('channels')
                    .select('id, owner_id, title, tg_chat_id, bot_id, created_at')
                    .order('created_at', { ascending: false }),
                supabase
                    .from('tg_accounts')
                    .select('id, owner_id, account_type, tg_username, tg_account_id, bot_role')
                    .in('account_type', ['userbot', 'bot'])
            ]);

            if (channelsError) throw channelsError;
            if (accountsError) throw accountsError;

            const ownerIds = [...new Set((channels || []).map(channel => channel.owner_id).filter(Boolean))];
            let profiles = [];

            if (ownerIds.length > 0) {
                const { data: profilesData, error: profilesError } = await supabase
                    .from('profiles')
                    .select('id, email, full_name, role')
                    .in('id', ownerIds);

                if (profilesError) throw profilesError;
                profiles = profilesData || [];
            }

            const profileMap = new Map(profiles.map(profile => [String(profile.id), profile]));
            const userbotCountByOwner = new Map();
            const botCountByOwner = new Map();
            const opsBotCountByOwner = new Map();

            for (const account of accounts || []) {
                const key = String(account.owner_id);
                if (account.account_type === 'userbot') {
                    userbotCountByOwner.set(key, (userbotCountByOwner.get(key) || 0) + 1);
                }

                if (account.account_type === 'bot') {
                    botCountByOwner.set(key, (botCountByOwner.get(key) || 0) + 1);
                    if ((account.bot_role || 'sales') === 'ops') {
                        opsBotCountByOwner.set(key, (opsBotCountByOwner.get(key) || 0) + 1);
                    }
                }
            }

            const botMap = new Map((accounts || [])
                .filter(account => account.account_type === 'bot')
                .map(account => [String(account.id), account]));

            const eligibleChannels = (channels || []).filter(channel => !!channel.bot_id);
            const inviteMap = await loadCachedObserverInvites(supabase, eligibleChannels.map(channel => channel.id));

            const grouped = ownerIds.map(ownerId => {
                const ownedChannels = (channels || [])
                    .filter(channel => String(channel.owner_id) === String(ownerId))
                    .filter(channel => !!channel.bot_id)
                    .map(channel => {
                        const bot = botMap.get(String(channel.bot_id));
                        const cachedInvite = inviteMap.get(String(channel.id)) || null;
                        return {
                            id: channel.id,
                            title: channel.title,
                            tg_chat_id: channel.tg_chat_id,
                            bot_id: channel.bot_id || null,
                            bot_label: bot
                                ? (bot.tg_username ? '@' + bot.tg_username : `ID ${bot.tg_account_id}`)
                                : null,
                            can_generate_invite: true,
                            observer_invite_link: cachedInvite?.invite_link || null,
                            observer_invite_generated_at: cachedInvite?.last_generated_at || cachedInvite?.updated_at || null,
                            observer_invite_ready: !!cachedInvite?.invite_link,
                            created_at: channel.created_at || null
                        };
                    });
                const dedupedChannels = dedupeManagedChannels(ownedChannels);
                const profile = profileMap.get(String(ownerId));
                return {
                    owner_id: ownerId,
                    owner_label: getOwnerLabel(profile, ownerId),
                    owner_email: profile?.email || null,
                    groups_count: dedupedChannels.length,
                    userbots_count: userbotCountByOwner.get(String(ownerId)) || 0,
                    bots_count: botCountByOwner.get(String(ownerId)) || 0,
                    ops_bots_count: opsBotCountByOwner.get(String(ownerId)) || 0,
                    groups: dedupedChannels.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ru'))
                };
            }).filter(row => row.groups_count > 0)
                .sort((a, b) => b.groups_count - a.groups_count);

            res.json({
                success: true,
                summary: {
                    admins_count: grouped.length,
                    groups_count: grouped.reduce((sum, row) => sum + row.groups_count, 0),
                    groups_with_invites: grouped.reduce(
                        (sum, row) => sum + row.groups.filter((group) => group.observer_invite_ready).length,
                        0
                    ),
                    total_userbots: grouped.reduce((sum, row) => sum + row.userbots_count, 0)
                },
                admins: grouped
            });
        } catch (error) {
            console.error('Ошибка пульта наблюдения:', error);
            res.status(500).json({ error: 'Не удалось собрать пульт наблюдения' });
        }
    });

    router.post('/invite', authenticateUser, requireObserverRole, async (req, res) => {
        try {
            const { channel_id, force } = req.body || {};
            if (!channel_id) {
                return res.status(400).json({ error: 'Не передан канал для генерации инвайта' });
            }

            const { data: channel, error: channelError } = await supabase
                .from('channels')
                .select('id, title, tg_chat_id, bot_id, owner_id')
                .eq('id', channel_id)
                .maybeSingle();

            if (channelError) throw channelError;
            if (!channel) {
                return res.status(404).json({ error: 'Канал не найден' });
            }

            if (!channel.bot_id) {
                return res.status(409).json({ error: 'У этой группы нет bot-админа. Сгенерить инвайт сейчас нельзя.' });
            }

            const bot = getBotById(channel.bot_id);
            if (!bot) {
                return res.status(409).json({ error: 'Bot-админ не запущен. Сначала подними его, потом генерь ссылку.' });
            }

            const invite = await generateObserverInvite({
                supabase,
                channel,
                bot,
                force: !!force
            });

            res.json({
                success: true,
                invite_link: invite.invite_link,
                generated_at: invite.last_generated_at || invite.updated_at || invite.created_at,
                channel_title: channel.title
            });
        } catch (error) {
            console.error('Ошибка генерации observer invite:', error);
            res.status(500).json({ error: 'Не удалось сгенерить пригласительную ссылку' });
        }
    });

    return router;
}
