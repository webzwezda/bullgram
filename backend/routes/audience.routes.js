import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { UserbotService } from '../services/userbot.service.js';

const TARGET_LABELS = {
    public_channel: 'Открытый канал',
    paid_channel: 'Платный канал',
    public_chat: 'Открытый чат',
    paid_chat: 'Платный чат'
};

const TARGET_FIELDS = {
    public_channel: 'public_channel_id',
    paid_channel: 'paid_channel_id',
    public_chat: 'public_chat_id',
    paid_chat: 'paid_chat_id'
};

function buildDisplayName(user) {
    if (user.username) return `@${user.username}`;
    return [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || `ID ${user.tg_user_id}`;
}

async function getParticipantsSafely(client, chatId) {
    let participants = [];
    let offset = 0;
    const limit = 100;
    while (true) {
        const chunk = await client.getParticipants(chatId, { limit, offset });
        if (!chunk || chunk.length === 0) {
            break;
        }
        participants.push(...chunk);
        if (chunk.length < limit) {
            break;
        }
        offset += chunk.length;
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    return participants;
}

export default function audienceRoutes(supabase) {
    const router = express.Router();
    const userbotService = new UserbotService(
        supabase,
        process.env.TG_API_ID,
        process.env.TG_API_HASH
    );

    async function loadContour(ownerId, contourId) {
        const { data, error } = await supabase
            .from('sales_bot_contours')
            .select('*')
            .eq('bot_id', contourId)
            .eq('owner_id', ownerId)
            .single();
        if (error || !data) return null;
        return data;
    }

    async function loadContourUserbot(contour) {
        let userbotIds = [];
        if (contour.userbot_mode === 'single') {
            if (contour.selected_userbot_id) {
                userbotIds = [contour.selected_userbot_id];
            }
        } else if (contour.userbot_mode === 'pool') {
            const { data: activeBindings, error: bindingsError } = await supabase
                .from('official_bot_userbot_bindings')
                .select('userbot_id')
                .eq('bot_id', contour.bot_id)
                .eq('is_active', true);
            
            if (!bindingsError && activeBindings) {
                const activeSet = new Set(activeBindings.map((r) => String(r.userbot_id)));
                userbotIds = (contour.selected_userbot_ids || []).filter((id) => activeSet.has(String(id)));
            }
        }

        if (userbotIds.length === 0) return null;

        for (const userbotId of userbotIds) {
            const { data: userbot, error } = await supabase
                .from('tg_accounts')
                .select('*, proxies(id, host, port, username, password, is_working, provision_source)')
                .eq('id', userbotId)
                .eq('owner_id', contour.owner_id)
                .eq('account_type', 'userbot')
                .single();

            if (error || !userbot) continue;

            let operationalUserbot = userbot;
            if (operationalUserbot.proxy_id && operationalUserbot.proxies?.is_working === false) {
                try {
                    const failover = await userbotService.tryAutoFailoverUserbot(operationalUserbot);
                    if (failover?.switched && failover?.account) {
                        operationalUserbot = {
                            ...operationalUserbot,
                            ...failover.account,
                            proxies: failover.account.proxies || operationalUserbot.proxies
                        };
                    }
                } catch (failoverErr) {
                    console.error(`[loadContourUserbot] failover failed for userbot ${userbotId}:`, failoverErr);
                }
            }

            if (operationalUserbot.proxy_id && operationalUserbot.proxies?.is_working === false) {
                console.warn(`[loadContourUserbot] Skipping userbot ${userbotId} because proxy is dead.`);
                continue;
            }

            return operationalUserbot;
        }

        return null;
    }

    async function findOrCreateBase(ownerId, contourId, targetType, channelId) {
        const { data: existing } = await supabase
            .from('customer_bases')
            .select('id')
            .eq('contour_id', contourId)
            .eq('target_type', targetType)
            .maybeSingle();

        if (existing) return existing.id;

        const { data, error } = await supabase
            .from('customer_bases')
            .insert({
                owner_id: ownerId,
                contour_id: contourId,
                target_type: targetType,
                name: TARGET_LABELS[targetType] || targetType
            })
            .select('id')
            .single();

        if (error) {
            const { data: retry } = await supabase
                .from('customer_bases')
                .select('id')
                .eq('contour_id', contourId)
                .eq('target_type', targetType)
                .single();
            return retry?.id || null;
        }

        await supabase
            .from('customer_base_channels')
            .upsert({ base_id: data.id, channel_id: channelId }, { onConflict: 'base_id,channel_id' });

        return data.id;
    }

    router.get('/', authenticateUser, async (req, res) => {
        try {
            const explicitContourId = req.query.contourId;
            let contour;

            if (explicitContourId) {
                contour = await loadContour(req.user.id, explicitContourId);
            } else {
                const { data } = await supabase
                    .from('sales_bot_contours')
                    .select('*')
                    .eq('owner_id', req.user.id)
                    .limit(1)
                    .maybeSingle();
                contour = data;
            }

            if (!contour) {
                return res.json({ targets: [], hasContour: false });
            }

            const targets = [];
            for (const [targetType, field] of Object.entries(TARGET_FIELDS)) {
                const channelId = contour[field];
                const target = {
                    targetType,
                    label: TARGET_LABELS[targetType],
                    channelId,
                    channelTitle: null,
                    members: [],
                    syncedAt: null,
                    totalMembers: 0,
                    activeMembers: 0
                };

                if (!channelId) {
                    targets.push(target);
                    continue;
                }

                const { data: channel } = await supabase
                    .from('channels')
                    .select('title, tg_chat_id')
                    .eq('id', channelId)
                    .single();
                target.channelTitle = channel?.title || null;
                target.tgChatId = channel?.tg_chat_id || null;

                const { data: base } = await supabase
                    .from('customer_bases')
                    .select('id, updated_at')
                    .eq('contour_id', contour.bot_id)
                    .eq('target_type', targetType)
                    .maybeSingle();

                if (!base) {
                    targets.push(target);
                    continue;
                }

                target.baseId = base.id;
                target.syncedAt = base.updated_at;

                const { data: members, error } = await supabase
                    .from('customer_base_members')
                    .select('id, tg_user_id, username, display_name, first_name, last_name, is_bot, present_now, activity_score, comments_count, last_activity_at, updated_at')
                    .eq('base_id', base.id)
                    .eq('owner_id', req.user.id)
                    .eq('is_bot', false)
                    .order('activity_score', { ascending: false, nullsFirst: false })
                    .order('updated_at', { ascending: false });

                if (!error && members) {
                    target.members = members;
                    target.totalMembers = members.length;
                    target.activeMembers = members.filter(m => (m.activity_score || 0) > 0).length;
                }

                targets.push(target);
            }

            res.json({ targets, hasContour: true, contourId: contour.bot_id });
        } catch (error) {
            console.error('Ошибка загрузки аудитории:', error);
            res.status(500).json({ error: 'Ошибка загрузки аудитории' });
        }
    });

    router.post('/sync', authenticateUser, async (req, res) => {
        try {
            const { contourId: explicitContourId, targetType } = req.body || {};
            if (!targetType) {
                return res.status(400).json({ error: 'targetType обязательныи' });
            }

            if (!TARGET_FIELDS[targetType]) {
                return res.status(400).json({ error: 'Неизвестный тип группы' });
            }

            let contour;
            if (explicitContourId) {
                contour = await loadContour(req.user.id, explicitContourId);
            } else {
                const { data } = await supabase
                    .from('sales_bot_contours')
                    .select('*')
                    .eq('owner_id', req.user.id)
                    .limit(1)
                    .maybeSingle();
                contour = data;
            }
            if (!contour) return res.status(404).json({ error: 'Контур не найден' });

            const channelId = contour[TARGET_FIELDS[targetType]];
            if (!channelId) return res.status(400).json({ error: 'В контуре не выбрана эта группа' });

            const { data: channel } = await supabase
                .from('channels')
                .select('id, title, tg_chat_id')
                .eq('id', channelId)
                .single();
            if (!channel?.tg_chat_id) return res.status(400).json({ error: 'У группы нет tg_chat_id' });

            const userbot = await loadContourUserbot(contour);
            if (!userbot) return res.status(400).json({ error: 'Живой юзербот не найден. Подключите юзербот к контуру.' });

            const baseId = await findOrCreateBase(req.user.id, contour.bot_id, targetType, channelId);
            if (!baseId) return res.status(500).json({ error: 'Не удалось создать базу' });

            // Step 1: sync participants
            const client = await userbotService.createAuthorizedClient(userbot, 1);
            const aggregatedMembers = new Map();

            try {
                await supabase
                    .from('customer_base_members')
                    .update({ present_now: false, updated_at: new Date().toISOString() })
                    .eq('base_id', baseId)
                    .eq('owner_id', req.user.id);

                const participants = await getParticipantsSafely(client, channel.tg_chat_id);

                for (const p of participants || []) {
                    const tgUserId = String(p.id);
                    aggregatedMembers.set(tgUserId, {
                        owner_id: req.user.id,
                        base_id: baseId,
                        tg_user_id: tgUserId,
                        username: p.username || null,
                        first_name: p.firstName || null,
                        last_name: p.lastName || null,
                        display_name: buildDisplayName({
                            tg_user_id: tgUserId,
                            username: p.username || null,
                            first_name: p.firstName || null,
                            last_name: p.lastName || null
                        }),
                        is_bot: !!p.bot,
                        source_channel_ids: [channel.id],
                        channels_count: 1,
                        present_now: true,
                        last_seen_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
                }
            } finally {
                await client.disconnect();
            }

            const upsertPayload = Array.from(aggregatedMembers.values());
            if (upsertPayload.length > 0) {
                const { error: upsertError } = await supabase
                    .from('customer_base_members')
                    .upsert(upsertPayload, { onConflict: 'base_id,tg_user_id' });
                if (upsertError) throw upsertError;
            }

            await supabase
                .from('customer_bases')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', baseId);

            res.json({
                success: true,
                synced_count: upsertPayload.length
            });
        } catch (error) {
            console.error('Ошибка синка аудитории:', error);
            res.status(500).json({ error: 'Ошибка обновления списка участников' });
        }
    });

    return router;
}
