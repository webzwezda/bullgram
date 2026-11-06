import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { upsertPeerCacheBatch } from '../../utils/peer-cache.js';

function buildDisplayName(user) {
    if (user.username) return `@${user.username}`;
    return [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || `ID ${user.tg_user_id}`;
}

export function registerSyncRoute(router, deps) {
    const { supabase, userbotService, loadOwnedBase, loadOwnedUserbot } = deps;

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
            // Каналы, опрошенные без ошибок: только их членов можно честно пометить absent.
            // Члены каналов, которые не опросились, остаются со своим старым present_now.
            const polledChannelIds = [];
            const failedChannels = [];
            let truncated = false;

            try {
                for (const channel of linkedChannels) {
                    try {
                        const participants = await client.getParticipants(channel.tg_chat_id, { limit: 5000 });

                        // GramJS возвращает TotalList с .total (общий count из ответа Telegram).
                        // Если total больше собранного — часть участников не влезла в лимит 5000.
                        const totalParticipants = Number(participants?.total ?? 0);
                        if (totalParticipants > (participants?.length || 0)) {
                            truncated = true;
                        }

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

                        polledChannelIds.push(channel.id);
                    } catch (channelError) {
                        console.error(`Ошибка чтения участников ${channel.title}:`, channelError.message);
                        failedChannels.push({
                            channel_id: channel.id,
                            chat_id: channel.tg_chat_id || null,
                            error: String(channelError?.message || channelError)
                        });
                    }
                }
            } finally {
                await client.disconnect();
            }

            // present_now выставляем по факту опроса, а не заранее:
            // найден сейчас — true (upsert ниже), замечен раньше в опрошенных каналах,
            // но сейчас не найден — false. Члены неопросённых каналов не трогаем.
            const { data: existingMembers, error: existingMembersError } = await supabase
                .from('channel_audience_members')
                .select('id, tg_user_id, source_channel_ids')
                .eq('base_id', baseId)
                .eq('owner_id', req.user.id);
            if (existingMembersError) throw existingMembersError;

            const foundIds = new Set(aggregatedMembers.keys());
            const polledIds = new Set(polledChannelIds);
            const absentMemberIds = (existingMembers || [])
                .filter(member => {
                    const sourceIds = Array.isArray(member.source_channel_ids) ? member.source_channel_ids : [];
                    // false ставим только когда опрошены ВСЕ каналы, где член мог быть:
                    // если хоть один его канал упал — присутствие неизвестно, не трогаем
                    return sourceIds.length > 0
                        && sourceIds.every(cid => polledIds.has(cid))
                        && !foundIds.has(String(member.tg_user_id));
                })
                .map(member => member.id);

            const upsertPayload = Array.from(aggregatedMembers.values());
            if (upsertPayload.length > 0) {
                const { error: upsertError } = await supabase
                    .from('channel_audience_members')
                    .upsert(upsertPayload, { onConflict: 'base_id,tg_user_id' });
                if (upsertError) throw upsertError;
            }

            if (absentMemberIds.length > 0) {
                const { error: absentError } = await supabase
                    .from('channel_audience_members')
                    .update({ present_now: false, updated_at: new Date().toISOString() })
                    .in('id', absentMemberIds)
                    .eq('owner_id', req.user.id);
                if (absentError) throw absentError;
            }

            await supabase
                .from('channel_audiences')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', baseId)
                .eq('owner_id', req.user.id);

            res.json({
                success: true,
                synced_count: upsertPayload.length,
                scanned_channels: linkedChannels.length,
                // Новое: сколько каналов опросили без ошибок, какие упали и не обрезан ли лимит.
                synced: polledChannelIds.length,
                failed_channels: failedChannels,
                truncated
            });
        } catch (error) {
            console.error('Ошибка синка базы клиентов:', error);
            res.status(500).json({ error: 'Ошибка синка базы клиентов' });
        }
    });
}
