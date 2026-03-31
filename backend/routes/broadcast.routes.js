import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { UserbotService } from '../services/userbot.service.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';
import { ensureBroadcastAllowed } from '../utils/product-tier.js';

function isUserbotBroadcastEnabled() {
    return String(process.env.USERBOT_BROADCAST_ENABLED || '').trim().toLowerCase() === 'true';
}

function senderTypeUsesUserbot(senderType = '') {
    return [
        'userbot_only',
        'official_then_userbot',
        'userbot_pool_round_robin',
        'official_then_userbot_pool'
    ].includes(String(senderType || '').trim());
}

function senderTypeUsesUserbotPool(senderType = '') {
    return [
        'userbot_pool_round_robin',
        'official_then_userbot_pool'
    ].includes(String(senderType || '').trim());
}

function dedupeAudience(rows = []) {
    const seen = new Set();
    return rows.filter(row => {
        const key = `${row.tg_user_id}:${row.channel_id || 'global'}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function buildAudienceKey(tgUserId, channelId) {
    return `${tgUserId}:${channelId || 'global'}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default function(supabase, getBotById) {
    const router = express.Router();
    const userbotService = new UserbotService(
        supabase,
        process.env.TG_API_ID,
        process.env.TG_API_HASH
    );

    async function loadOwnerContext(ownerId) {
        const reservedUserbotIds = await loadReservedUserbotIds(supabase, ownerId);
        const [{ data: channels }, { data: userbots }] = await Promise.all([
            supabase.from('channels').select('id, title, bot_id, tg_chat_id').eq('owner_id', ownerId),
            supabase.from('tg_accounts').select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)').eq('owner_id', ownerId).eq('account_type', 'userbot').order('created_at', { ascending: false })
        ]);

        return {
            channels: channels || [],
            userbots: (userbots || []).filter(userbot =>
                !reservedUserbotIds.has(String(userbot.id)) &&
                !(userbot.proxy_id && userbot.proxies?.is_working === false)
            )
        };
    }

    async function loadLatestPaidTariffMap(channelIds = []) {
        if (channelIds.length === 0) return new Map();

        const { data: invoices, error } = await supabase
            .from('invoices')
            .select('tg_user_id, paid_at, created_at, tariffs(channel_id, title, is_trial, trial_label, price, currency)')
            .eq('status', 'paid')
            .order('paid_at', { ascending: false })
            .limit(5000);

        if (error) throw error;

        const latestTariffMap = new Map();
        for (const invoice of invoices || []) {
            if (!invoice.tariffs || !channelIds.includes(invoice.tariffs.channel_id)) continue;

            const key = buildAudienceKey(String(invoice.tg_user_id), invoice.tariffs.channel_id);
            if (latestTariffMap.has(key)) continue;

            latestTariffMap.set(key, {
                is_trial: !!invoice.tariffs.is_trial,
                trial_label: invoice.tariffs.trial_label || null,
                title: invoice.tariffs.title,
                price: invoice.tariffs.price,
                currency: invoice.tariffs.currency
            });
        }

        return latestTariffMap;
    }

    async function buildAudience(ownerId, audienceType, channelId = null, baseId = null, manualTgUserIds = [], baseFilter = 'all_members', manualMembers = []) {
        const { channels } = await loadOwnerContext(ownerId);
        const channelIds = channels.map(channel => channel.id);
        const channelMap = new Map(channels.map(channel => [channel.id, channel]));
        const nowIso = new Date().toISOString();
        const trialSoonIso = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

        if (audienceType === 'manual_list') {
            const manualMemberMap = new Map((manualMembers || [])
                .filter(member => member?.tg_user_id)
                .map(member => [String(member.tg_user_id), member]));
            const uniqueUserIds = Array.from(new Set((manualTgUserIds || []).map(value => String(value)).filter(Boolean)));
            return uniqueUserIds.map(tgUserId => ({
                tg_user_id: tgUserId,
                channel_id: null,
                channel_title: 'Ручная выборка',
                bot_id: null,
                source_type: 'manual_list',
                source_id: tgUserId,
                is_trial: false,
                segment_label: 'Выбрано руками',
                tariff_title: manualMemberMap.get(tgUserId)?.display_name || null,
                username: manualMemberMap.get(tgUserId)?.username || null
            }));
        }

        if (audienceType === 'customer_base_members') {
            if (!baseId) return [];

            const { data: base } = await supabase
                .from('customer_bases')
                .select('id, name')
                .eq('id', baseId)
                .eq('owner_id', ownerId)
                .single();

            if (!base) return [];

            const { data: members, error } = await supabase
                .from('customer_base_members')
                .select('id, tg_user_id, display_name, username, present_now, channels_count, is_bot')
                .eq('owner_id', ownerId)
                .eq('base_id', baseId)
                .eq('is_bot', false)
                .order('channels_count', { ascending: false })
                .order('updated_at', { ascending: false });

            if (error) throw error;

            return dedupeAudience((members || [])
                .filter(member => {
                    if (baseFilter === 'present_only') return !!member.present_now;
                    if (baseFilter === 'missing_only') return !member.present_now;
                    if (baseFilter === 'partial_only') return Number(member.channels_count || 0) > 0 && !!member.present_now;
                    if (baseFilter === 'multi_channel_only') return Number(member.channels_count || 0) >= 2;
                    return true;
                })
                .map(member => ({
                tg_user_id: String(member.tg_user_id),
                channel_id: null,
                channel_title: base.name,
                bot_id: null,
                source_type: 'customer_base',
                source_id: member.id,
                is_trial: false,
                segment_label: !member.present_now
                    ? 'Сейчас не найден'
                    : (Number(member.channels_count || 0) >= 2 ? 'Есть в нескольких местах' : 'Есть только в части базы'),
                tariff_title: member.display_name || null,
                username: member.username || null,
                channels_count: member.channels_count || 0
            })));
        }

        if (channelIds.length === 0) return [];

        if (
            audienceType === 'active_subscribers' ||
            audienceType === 'channel_active' ||
            audienceType === 'trial_active' ||
            audienceType === 'trial_expiring'
        ) {
            const latestPaidTariffMap = await loadLatestPaidTariffMap(channelIds);
            const query = supabase
                .from('subscriptions')
                .select('id, tg_user_id, channel_id, status, expires_at')
                .eq('status', 'active');

            if (audienceType === 'channel_active' && channelId) {
                query.eq('channel_id', channelId);
            } else {
                query.in('channel_id', channelIds);
            }

            const { data } = await query.order('created_at', { ascending: false });
            return dedupeAudience((data || [])
                .map(row => {
                    const key = buildAudienceKey(String(row.tg_user_id), row.channel_id);
                    const latestTariff = latestPaidTariffMap.get(key) || null;

                    return {
                        tg_user_id: String(row.tg_user_id),
                        channel_id: row.channel_id,
                        channel_title: channelMap.get(row.channel_id)?.title || 'Неизвестный канал',
                        bot_id: channelMap.get(row.channel_id)?.bot_id || null,
                        source_type: 'subscription',
                        source_id: row.id,
                        is_trial: !!latestTariff?.is_trial,
                        segment_label: latestTariff?.is_trial
                            ? (latestTariff?.trial_label || 'Пробник')
                            : 'Обычная подписка',
                        tariff_title: latestTariff?.title || null,
                        expires_at: row.expires_at || null
                    };
                })
                .filter(row => {
                    if (audienceType === 'trial_active') return row.is_trial;
                    if (audienceType === 'trial_expiring') {
                        return row.is_trial && row.expires_at && row.expires_at <= trialSoonIso && row.expires_at >= nowIso;
                    }
                    return true;
                }));
        }

        if (audienceType === 'expired_subscribers') {
            const latestPaidTariffMap = await loadLatestPaidTariffMap(channelIds);
            const { data } = await supabase
                .from('subscriptions')
                .select('id, tg_user_id, channel_id, status, expires_at')
                .in('channel_id', channelIds)
                .order('created_at', { ascending: false });

            return dedupeAudience((data || [])
                .filter(row => row.status === 'expired' || (row.expires_at && row.expires_at < nowIso))
                .map(row => ({
                    tg_user_id: String(row.tg_user_id),
                    channel_id: row.channel_id,
                    channel_title: channelMap.get(row.channel_id)?.title || 'Неизвестный канал',
                    bot_id: channelMap.get(row.channel_id)?.bot_id || null,
                    source_type: 'subscription',
                    source_id: row.id,
                    is_trial: !!latestPaidTariffMap.get(buildAudienceKey(String(row.tg_user_id), row.channel_id))?.is_trial,
                    segment_label: latestPaidTariffMap.get(buildAudienceKey(String(row.tg_user_id), row.channel_id))?.is_trial
                        ? (latestPaidTariffMap.get(buildAudienceKey(String(row.tg_user_id), row.channel_id))?.trial_label || 'Пробник')
                        : 'Обычная подписка',
                    expires_at: row.expires_at || null
                })));
        }

        if (audienceType === 'paid_not_joined') {
            const latestPaidTariffMap = await loadLatestPaidTariffMap(channelIds);
            const { data } = await supabase
                .from('subscriptions')
                .select('id, tg_user_id, channel_id, status, expires_at, last_join_approved_at')
                .in('channel_id', channelIds)
                .eq('status', 'active')
                .order('created_at', { ascending: false });

            return dedupeAudience((data || [])
                .filter(row => !row.last_join_approved_at)
                .map(row => ({
                    tg_user_id: String(row.tg_user_id),
                    channel_id: row.channel_id,
                    channel_title: channelMap.get(row.channel_id)?.title || 'Неизвестный канал',
                    bot_id: channelMap.get(row.channel_id)?.bot_id || null,
                    source_type: 'subscription',
                    source_id: row.id,
                    is_trial: !!latestPaidTariffMap.get(buildAudienceKey(String(row.tg_user_id), row.channel_id))?.is_trial,
                    segment_label: latestPaidTariffMap.get(buildAudienceKey(String(row.tg_user_id), row.channel_id))?.is_trial
                        ? (latestPaidTariffMap.get(buildAudienceKey(String(row.tg_user_id), row.channel_id))?.trial_label || 'Пробник')
                        : 'Обычная подписка',
                    expires_at: row.expires_at || null
                })));
        }

        if (audienceType === 'unpaid_leads' || audienceType === 'trial_unpaid') {
            const { data: invoices } = await supabase
                .from('invoices')
                .select('id, tg_user_id, tariff_id, status, created_at, tariffs(channel_id, title, is_trial, trial_label)')
                .in('status', ['pending', 'awaiting_receipt'])
                .order('created_at', { ascending: false });

            return dedupeAudience((invoices || [])
                .filter(invoice => {
                    if (!invoice.tariffs || !channelIds.includes(invoice.tariffs.channel_id)) return false;
                    if (audienceType === 'trial_unpaid') return !!invoice.tariffs.is_trial;
                    return true;
                })
                .map(invoice => ({
                    tg_user_id: String(invoice.tg_user_id),
                    channel_id: invoice.tariffs.channel_id,
                    channel_title: channelMap.get(invoice.tariffs.channel_id)?.title || invoice.tariffs.title || 'Неизвестный канал',
                    bot_id: channelMap.get(invoice.tariffs.channel_id)?.bot_id || null,
                    source_type: 'invoice',
                    source_id: invoice.id,
                    is_trial: !!invoice.tariffs.is_trial,
                    segment_label: invoice.tariffs.is_trial
                        ? (invoice.tariffs.trial_label || 'Пробник')
                        : 'Обычный тариф',
                    tariff_title: invoice.tariffs.title,
                    created_at: invoice.created_at
                })));
        }

        return [];
    }

    async function sendViaUserbotPool(userbots, startIndex, tgUserId, messageText, options = {}) {
        if (!userbots || userbots.length === 0) {
            throw new Error('Нет доступных юзерботов для отправки');
        }

        let lastError = null;

        for (let offset = 0; offset < userbots.length; offset++) {
            const userbot = userbots[(startIndex + offset) % userbots.length];

            try {
                await userbotService.sendMessage(userbot, tgUserId, messageText, {
                    event_source: 'broadcast',
                    event_type: 'broadcast_delivery',
                    ...options
                });
                return userbot;
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error('Ни один юзербот из пула не смог доставить сообщение');
    }

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
            const { data: deliveries, error: deliveriesError } = campaignIds.length > 0
                ? await supabase
                    .from('broadcast_deliveries')
                    .select('campaign_id, delivery_status, meta')
                    .eq('owner_id', req.user.id)
                    .in('campaign_id', campaignIds)
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
            const { audience_type, channel_id, base_id, manual_tg_user_ids, base_filter, manual_members, title, message_text, sender_type, sender_userbot_id, sender_userbot_ids, delay_ms } = req.body;
            if (!audience_type) return res.status(400).json({ error: 'Не выбрана аудитория' });
            if (!message_text || !message_text.trim()) return res.status(400).json({ error: 'Нет текста рассылки' });

            const audience = await buildAudience(
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

            const { channels, userbots } = await loadOwnerContext(req.user.id);
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

            const { data: campaign, error: campaignError } = await supabase
                .from('broadcast_campaigns')
                .insert({
                    owner_id: req.user.id,
                    title: title || `Рассылка ${new Date().toLocaleString('ru-RU')}`,
                    audience_type,
                    channel_id: channel_id || null,
                    message_text,
                    status: 'sending',
                    meta: {
                        base_id: base_id || null,
                        base_filter: base_filter || 'all_members',
                        manual_total: Array.isArray(manual_tg_user_ids) ? manual_tg_user_ids.length : 0,
                        manual_named_total: Array.isArray(manual_members) ? manual_members.length : 0,
                        sender_type: normalizedSenderType,
                        sender_userbot_id: selectedUserbot?.id || null,
                        sender_username: selectedUserbot?.tg_username || null,
                        sender_userbot_ids: selectedUserbots.map(userbot => userbot.id),
                        sender_usernames: selectedUserbots.map(userbot => userbot.tg_username || userbot.tg_account_id),
                        delay_ms: normalizedDelayMs
                    }
                })
                .select()
                .single();

            if (campaignError) throw campaignError;

            let sentCount = 0;
            let failedCount = 0;

            for (let index = 0; index < audience.length; index++) {
                const row = audience[index];
                const channel = channelMap.get(row.channel_id);
                const bot = row.bot_id ? getBotById(row.bot_id) : null;
                let deliveryStatus = 'failed';
                let errorText = null;
                let deliveredAt = null;
                let actualSenderUserbot = null;
                const canUseOfficialBot = normalizedSenderType === 'official_only' ||
                    normalizedSenderType === 'official_then_userbot' ||
                    normalizedSenderType === 'official_then_userbot_pool';
                const canFallbackToUserbot = normalizedSenderType === 'official_then_userbot' ||
                    normalizedSenderType === 'official_then_userbot_pool';
                const canUseOnlyUserbot = normalizedSenderType === 'userbot_only' ||
                    normalizedSenderType === 'userbot_pool_round_robin';

                try {
                    if (canUseOfficialBot && bot) {
                        await bot.telegram.sendMessage(row.tg_user_id, message_text, { parse_mode: 'Markdown' });
                        deliveryStatus = 'sent';
                        deliveredAt = new Date().toISOString();
                        sentCount++;
                    } else {
                        throw new Error(
                            canUseOnlyUserbot
                                ? 'Выбран режим отправки только юзерботами'
                                : 'Официальный бот недоступен'
                        );
                    }
                } catch (botError) {
                    try {
                        if (!canFallbackToUserbot && !canUseOnlyUserbot) {
                            throw botError;
                        }
                        if (selectedUserbots.length === 0) throw botError;
                        actualSenderUserbot = await sendViaUserbotPool(
                            senderTypeUsesUserbotPool(normalizedSenderType) ? selectedUserbots : [selectedUserbot].filter(Boolean),
                            senderTypeUsesUserbotPool(normalizedSenderType) ? index % selectedUserbots.length : 0,
                            row.tg_user_id,
                            message_text,
                            {
                                campaign_id: campaign.id,
                                channel_id: row.channel_id || null
                            }
                        );
                        deliveryStatus = 'sent';
                        deliveredAt = new Date().toISOString();
                        sentCount++;
                    } catch (userbotError) {
                        failedCount++;
                        errorText = userbotError.message || botError.message || 'Не удалось доставить сообщение';
                    }
                }

                await supabase.from('broadcast_deliveries').insert({
                    campaign_id: campaign.id,
                    owner_id: req.user.id,
                    channel_id: row.channel_id || null,
                    tg_user_id: row.tg_user_id,
                    delivery_status: deliveryStatus,
                    error_text: errorText,
                    delivered_at: deliveredAt,
                    meta: {
                        source_type: row.source_type,
                        source_id: row.source_id,
                        channel_title: channel?.title || row.channel_title,
                        sender_type: normalizedSenderType,
                        sender_userbot_id: actualSenderUserbot?.id || selectedUserbot?.id || null,
                        sender_username: actualSenderUserbot?.tg_username || actualSenderUserbot?.tg_account_id || selectedUserbot?.tg_username || selectedUserbot?.tg_account_id || null,
                        sender_userbot_ids: selectedUserbots.map(userbot => userbot.id),
                        delay_ms: normalizedDelayMs
                    }
                });

                if (normalizedDelayMs > 0 && index < audience.length - 1) {
                    await sleep(normalizedDelayMs);
                }
            }

            await supabase
                .from('broadcast_campaigns')
                .update({
                    status: failedCount > 0 ? 'completed_with_errors' : 'sent',
                    sent_at: new Date().toISOString(),
                    meta: {
                        ...(campaign.meta || {}),
                        sender_type: normalizedSenderType,
                        sender_userbot_id: selectedUserbot?.id || null,
                        sender_username: selectedUserbot?.tg_username || null,
                        sender_userbot_ids: selectedUserbots.map(userbot => userbot.id),
                        sender_usernames: selectedUserbots.map(userbot => userbot.tg_username || userbot.tg_account_id),
                        delay_ms: normalizedDelayMs,
                        total: audience.length,
                        sent: sentCount,
                        failed: failedCount
                    }
                })
                .eq('id', campaign.id);

            res.json({
                success: true,
                campaign_id: campaign.id,
                sent_count: sentCount,
                failed_count: failedCount
            });
        } catch (error) {
            console.error('Ошибка send broadcast:', error);
            const statusCode = String(error.message || '').includes('На Trial') ? 403 : 500;
            res.status(statusCode).json({ error: statusCode === 403 ? error.message : 'Ошибка отправки рассылки' });
        }
    });

    return router;
}
