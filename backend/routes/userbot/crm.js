// CRM база клиентов: список подписок, продление дней (одиночное и batch)
// и batch-кик (финальная стадия 2b разрезки userbot.routes.js).
// Зона: GET /crm/subscribers, POST /crm/subscribers/:id/add-days,
// POST /crm/subscribers/batch-add-days, POST /crm/subscribers/batch-kick.
// MAX_EXTENSION_DAYS и parseExtensionDays использовались только этой зоной —
// переехали вместе с ней (в исходном месте между add-days и batch-add-days).
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { loadOperationalUserbot } from './helpers-core.js';
import { resolveBatchKickCallSource } from './helpers-center.js';

export function registerCrm(router, ctx) {
    const { supabase, userbotService } = ctx;
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
}
