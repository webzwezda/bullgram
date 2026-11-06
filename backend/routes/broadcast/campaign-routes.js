import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { ensureBroadcastAllowed } from '../../utils/product-tier.js';
// Общая логика доставки рассылок живёт в сервисе: матрица подготовки нужна здесь (валидация /send),
// отправка одному получателю — крон-джобе broadcast-delivery
import {
    loadPreparationMatrix,
    senderTypeUsesUserbot
} from '../../services/broadcast-delivery.service.js';

function isUserbotBroadcastEnabled() {
    return String(process.env.USERBOT_BROADCAST_ENABLED || '').trim().toLowerCase() === 'true';
}

export function registerCampaignRoutes(router, deps) {
    const { supabase, buildAudience, loadOwnerContext, loadLatestPaidTariffMap } = deps;

    router.get('/campaigns', authenticateUser, async (req, res) => {
        try {
            const [{ data: campaigns, error }, { data: failures, error: failuresError }] = await Promise.all([
                supabase
                    .from('broadcast_campaigns')
                    .select('*')
                    .eq('owner_id', req.user.id)
                    .order('created_at', { ascending: false })
                    .limit(30),
                supabase
                    .from('broadcast_deliveries')
                    .select('*')
                    .eq('owner_id', req.user.id)
                    .eq('delivery_status', 'failed')
                    .order('created_at', { ascending: false })
                    .limit(30)
            ]);

            if (error) throw error;
            if (failuresError) throw failuresError;

            const campaignIds = (campaigns || []).map(campaign => campaign.id);
            // pending-строки (mark-and-queue) — ещё не доставки: без фильтра они падали бы в failed-статистику отправителей
            const { data: deliveries, error: deliveriesError } = campaignIds.length > 0
                ? await supabase
                    .from('broadcast_deliveries')
                    .select('campaign_id, delivery_status, meta')
                    .eq('owner_id', req.user.id)
                    .in('campaign_id', campaignIds)
                    .neq('delivery_status', 'pending')
                : { data: [], error: null };

            if (deliveriesError) throw deliveriesError;

            const senderStatsByCampaign = new Map();
            for (const delivery of deliveries || []) {
                const campaignId = delivery.campaign_id;
                const senderKey = String(delivery.meta?.sender_userbot_id || delivery.meta?.sender_username || 'official_bot');
                const senderLabel = delivery.meta?.sender_username
                    ? `@${delivery.meta.sender_username}`
                    : (delivery.meta?.sender_userbot_id ? `Userbot ${delivery.meta.sender_userbot_id}` : 'Официальный бот');

                if (!senderStatsByCampaign.has(campaignId)) {
                    senderStatsByCampaign.set(campaignId, new Map());
                }

                const statsMap = senderStatsByCampaign.get(campaignId);
                const current = statsMap.get(senderKey) || {
                    sender_key: senderKey,
                    sender_label: senderLabel,
                    sent: 0,
                    failed: 0
                };

                if (delivery.delivery_status === 'sent') {
                    current.sent += 1;
                } else {
                    current.failed += 1;
                }

                statsMap.set(senderKey, current);
            }

            const campaignsWithStats = (campaigns || []).map(campaign => ({
                ...campaign,
                meta: {
                    ...(campaign.meta || {}),
                    sender_stats: Array.from(senderStatsByCampaign.get(campaign.id)?.values() || [])
                }
            }));

            const summary = {
                totalCampaigns: campaignsWithStats.length,
                sentCampaigns: campaignsWithStats.filter(campaign => campaign.status === 'sent').length,
                partialCampaigns: campaignsWithStats.filter(campaign => campaign.status === 'completed_with_errors').length,
                totalSent: campaignsWithStats.reduce((sum, campaign) => sum + Number(campaign.meta?.sent || 0), 0),
                totalFailed: campaignsWithStats.reduce((sum, campaign) => sum + Number(campaign.meta?.failed || 0), 0)
            };

            res.json({
                campaigns: campaignsWithStats,
                failures: failures || [],
                summary
            });
        } catch (error) {
            res.status(500).json({ error: 'Ошибка загрузки кампаний' });
        }
    });

    router.post('/preview', authenticateUser, async (req, res) => {
        try {
            const { audience_type, channel_id, base_id, manual_tg_user_ids, base_filter, manual_members } = req.body;
            if (!audience_type) return res.status(400).json({ error: 'Не выбрана аудитория' });

            const audience = await buildAudience(
                supabase,
                loadOwnerContext,
                loadLatestPaidTariffMap,
                req.user.id,
                audience_type,
                channel_id || null,
                base_id || null,
                manual_tg_user_ids || [],
                base_filter || 'all_members',
                manual_members || []
            );
            res.json({
                success: true,
                count: audience.length,
                audience: audience.slice(0, 20)
            });
        } catch (error) {
            console.error('Ошибка preview broadcast:', error);
            res.status(500).json({ error: 'Ошибка построения аудитории' });
        }
    });

    router.post('/send', authenticateUser, async (req, res) => {
        try {
            ensureBroadcastAllowed(req.profile);
            const { audience_type, channel_id, base_id, manual_tg_user_ids, base_filter, manual_members, title, message_text, sender_type, sender_userbot_id, sender_userbot_ids, delay_ms, preparation_id, skip_unreachable, leave_groups_on_complete } = req.body;
            if (!audience_type) return res.status(400).json({ error: 'Не выбрана аудитория' });
            if (!message_text || !message_text.trim()) return res.status(400).json({ error: 'Нет текста рассылки' });

            const audience = await buildAudience(
                supabase,
                loadOwnerContext,
                loadLatestPaidTariffMap,
                req.user.id,
                audience_type,
                channel_id || null,
                base_id || null,
                manual_tg_user_ids || [],
                base_filter || 'all_members',
                manual_members || []
            );
            if (audience.length === 0) {
                return res.status(400).json({ error: 'Для этой аудитории сейчас нет получателей' });
            }

            const { channels, userbots } = await loadOwnerContext(supabase, req.user.id);
            const channelMap = new Map(channels.map(channel => [channel.id, channel]));
            const normalizedSenderType = sender_type || 'official_only';
            const requestedDelayMs = Math.max(0, Math.min(Number(delay_ms) || 0, 30000));
            const normalizedDelayMs = senderTypeUsesUserbot(normalizedSenderType)
                ? Math.max(5000, requestedDelayMs)
                : requestedDelayMs;

            if (senderTypeUsesUserbot(normalizedSenderType) && !isUserbotBroadcastEnabled()) {
                return res.status(403).json({
                    error: 'Рассылки через юзерботов отключены. Включай USERBOT_BROADCAST_ENABLED=true только если осознанно принимаешь риск Telegram-банов.'
                });
            }

            if (senderTypeUsesUserbot(normalizedSenderType) && req.body?.manual_confirmed_userbot_risk !== true) {
                return res.status(403).json({
                    error: 'Рассылка через юзерботов запускается только после явного подтверждения риска из интерфейса.'
                });
            }

            const requestedUserbotIds = Array.isArray(sender_userbot_ids) && sender_userbot_ids.length > 0
                ? sender_userbot_ids.map(id => String(id))
                : (sender_userbot_id ? [String(sender_userbot_id)] : []);
            const selectedUserbots = requestedUserbotIds.length > 0
                ? userbots.filter(userbot => requestedUserbotIds.includes(String(userbot.id)))
                : (userbots[0] ? [userbots[0]] : []);
            const selectedUserbot = selectedUserbots[0] || null;

            if (requestedUserbotIds.length > 0 && selectedUserbots.length !== requestedUserbotIds.length) {
                return res.status(400).json({ error: 'Часть выбранных юзерботов не найдена или не принадлежит тебе' });
            }

            if (senderTypeUsesUserbot(normalizedSenderType) && selectedUserbots.length === 0) {
                return res.status(400).json({ error: 'Выбери хотя бы одного юзербота для отправки' });
            }

            let preparationMatrix = null;
            let skippedUnreachableCount = 0;
            if (preparation_id && senderTypeUsesUserbot(normalizedSenderType)) {
                preparationMatrix = await loadPreparationMatrix(supabase, req.user.id, preparation_id);
                const routed = audience.filter(row => preparationMatrix.has(String(row.tg_user_id)));
                skippedUnreachableCount = audience.length - routed.length;
                if (skippedUnreachableCount > 0 && skip_unreachable === false) {
                    return res.status(400).json({
                        error: `По матрице подготовки ${skippedUnreachableCount} человек недостижимы. Убери их из базы или подтверди отправку без них.`
                    });
                }
                if (routed.length === 0) {
                    return res.status(400).json({ error: 'Матрица подготовки не покрывает ни одного получателя этой аудитории' });
                }
                audience.length = 0;
                audience.push(...routed);
            }

            // Guard: у владельца не должно быть двух рассылок одновременно, иначе job доставит
            // обе аудитории с пересечением. Проверяем перед самой вставкой, чтобы окно гонки было минимальным.
            const { data: activeCampaign } = await supabase
                .from('broadcast_campaigns')
                .select('id')
                .eq('owner_id', req.user.id)
                .in('status', ['queued', 'sending'])
                .limit(1)
                .maybeSingle();
            if (activeCampaign) {
                return res.status(409).json({ error: 'Уже идёт рассылка — дождись завершения' });
            }

            // Mark-and-queue: кампания только создаётся как 'queued', доставки — upfront как 'pending'.
            // Фактическую отправку делает крон-джоба backend/jobs/broadcast-delivery.job.js
            const { data: campaign, error: campaignError } = await supabase
                .from('broadcast_campaigns')
                .insert({
                    owner_id: req.user.id,
                    title: title || `Рассылка ${new Date().toLocaleString('ru-RU')}`,
                    audience_type,
                    channel_id: channel_id || null,
                    message_text,
                    status: 'queued',
                    meta: {
                        base_id: base_id || null,
                        base_filter: base_filter || 'all_members',
                        manual_total: Array.isArray(manual_tg_user_ids) ? manual_tg_user_ids.length : 0,
                        manual_named_total: Array.isArray(manual_members) ? manual_members.length : 0,
                        sender_type: normalizedSenderType,
                        sender_userbot_id: selectedUserbot?.id || null,
                        sender_username: selectedUserbot?.tg_username || selectedUserbot?.tg_account_id || null,
                        sender_userbot_ids: selectedUserbots.map(userbot => userbot.id),
                        sender_usernames: selectedUserbots.map(userbot => userbot.tg_username || userbot.tg_account_id),
                        delay_ms: normalizedDelayMs,
                        total: audience.length,
                        sent: 0,
                        failed: 0,
                        preparation_id: preparation_id || null,
                        skipped_unreachable: skippedUnreachableCount,
                        // галочка «выйти по окончанию рассылки»: jobs/broadcast-membership-cleanup.job.js
                        // читает этот флаг после терминального статуса кампании
                        ...(leave_groups_on_complete === true ? { leave_groups_on_complete: true } : {}),
                        queued_at: new Date().toISOString()
                    }
                })
                .select()
                .single();

            if (campaignError) throw campaignError;

            // Все доставки ставим в очередь сразу: job потом разберёт их по одной.
            // Метаданные доставки фиксируем в момент постановки — sender-фолбэки нужны статистике GET /campaigns,
            // фактического sender'а джоба допишет в meta после доставки.
            const deliveryRows = audience.map(row => {
                const channel = channelMap.get(row.channel_id);
                return {
                    campaign_id: campaign.id,
                    owner_id: req.user.id,
                    channel_id: row.channel_id || null,
                    tg_user_id: row.tg_user_id,
                    delivery_status: 'pending',
                    error_text: null,
                    delivered_at: null,
                    meta: {
                        source_type: row.source_type,
                        source_id: row.source_id,
                        channel_title: channel?.title || row.channel_title,
                        bot_id: row.bot_id || null,
                        sender_type: normalizedSenderType,
                        sender_userbot_id: selectedUserbot?.id || null,
                        sender_username: selectedUserbot?.tg_username || selectedUserbot?.tg_account_id || null,
                        sender_userbot_ids: selectedUserbots.map(userbot => userbot.id),
                        delay_ms: normalizedDelayMs
                    }
                };
            });

            try {
                for (let from = 0; from < deliveryRows.length; from += 500) {
                    const { error: insertError } = await supabase
                        .from('broadcast_deliveries')
                        .insert(deliveryRows.slice(from, from + 500));
                    if (insertError) throw insertError;
                }
            } catch (insertError) {
                console.error('Ошибка постановки доставок в очередь:', insertError);
                // Оставлять 'queued' нельзя — owner навсегда упрётся в 409-guard.
                // Guard по статусу: джоба могла уже claim'нуть кампанию в 'sending' —
                // её не затаптываем.
                await supabase
                    .from('broadcast_campaigns')
                    .update({
                        status: 'failed',
                        meta: {
                            ...(campaign.meta || {}),
                            queue_error: String(insertError.message || 'Не удалось поставить рассылку в очередь')
                        }
                    })
                    .eq('id', campaign.id)
                    .eq('status', 'queued');
                throw insertError;
            }

            res.json({
                success: true,
                campaign_id: campaign.id,
                campaign,
                queued_count: deliveryRows.length,
                skipped_unreachable_count: skippedUnreachableCount
            });
        } catch (error) {
            console.error('Ошибка send broadcast:', error);
            const message = String(error.message || '');
            const statusCode = message.includes('На Trial') ? 403
                : (message.includes('Подготовка') || message.includes('матриц')) ? 400
                : 500;
            res.status(statusCode).json({ error: statusCode === 500 ? 'Ошибка отправки рассылки' : message });
        }
    });
}
