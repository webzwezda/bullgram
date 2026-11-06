// Выдача доступа: access-invites, подарочные коды, каналы, подписочные ссылки —
// вынесено дословно из official-bot.service.js; this.supabase -> параметр supabase,
// вызовы соседних хелперов переведены на импорт функций (behavior идентичен).

import { generateGiftCode } from './shared/pending-state.js';
import { buildTelegramTargets } from './tariff-format.js';
import { logAccessEvent } from './bot-events.js';
import { getTariffBundleItems, upsertSubscriptionForChannel } from './subscriptions.js';

export async function createAccessInvite(supabase, {
    ownerId,
    channelId,
    tariffId = null,
    invoiceId = null,
    subscriptionId = null,
    tgUserId,
    inviteLink,
    inviteName
}) {
    const { data, error } = await supabase.from('access_invites').insert({
        owner_id: ownerId,
        channel_id: channelId,
        tariff_id: tariffId,
        invoice_id: invoiceId,
        subscription_id: subscriptionId,
        tg_user_id: String(tgUserId),
        invite_link: inviteLink,
        invite_name: inviteName,
        status: 'issued'
    }).select().single();

    if (error) {
        console.error('Ошибка сохранения access_invite:', error.message);
        return null;
    }

    return data;
}

export async function findLatestAccessInvite(supabase, channelId, tgUserId) {
    const { data } = await supabase
        .from('access_invites')
        .select('*')
        .eq('channel_id', channelId)
        .eq('tg_user_id', String(tgUserId))
        .order('issued_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    return data || null;
}

export async function getOwnedSalesChannels(supabase, botId, ownerId) {
    const query = supabase
        .from('channels')
        .select('id, title, tg_chat_id, bot_id, chat_type, created_at')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    const channels = (data || []).filter((channel) => {
        if (!channel?.tg_chat_id) return false;
        if (String(channel.chat_type || '').toLowerCase() === 'private') return false;
        return !channel.bot_id || String(channel.bot_id) === String(botId);
    });

    return channels;
}

export async function issueDirectChannelAccess(supabase, {
    bot,
    ownerId,
    targetTgUserId,
    channel,
    durationDays,
    eventSource = 'system',
    accessNote = null,
    payload = {}
}) {
    const targetId = String(targetTgUserId || '').trim();
    if (!targetId || !channel?.id || !channel?.tg_chat_id) {
        return { error: 'Не хватает данных для выдачи доступа.' };
    }

    const { subscriptionId, expiresAt } = await upsertSubscriptionForChannel(supabase, targetId, channel.id, durationDays);
    if (!subscriptionId) {
        return { error: 'Не удалось создать подписку.' };
    }

    const inviteName = `Gift_${targetId}_${new Date().toISOString().split('T')[0]}_${channel.id.slice(0, 6)}`;
    const inviteLink = await bot.telegram.createChatInviteLink(channel.tg_chat_id, {
        creates_join_request: true,
        name: inviteName
    });

    const accessInvite = await createAccessInvite(supabase, {
        ownerId,
        channelId: channel.id,
        subscriptionId,
        tgUserId: targetId,
        inviteLink: inviteLink.invite_link,
        inviteName
    });

    await logAccessEvent(supabase, {
        ownerId,
        channelId: channel.id,
        inviteId: accessInvite?.id || null,
        subscriptionId,
        tgUserId: targetId,
        eventType: 'invite_issued',
        eventSource,
        payload
    });

    await supabase
        .from('subscriptions')
        .update({
            last_access_event: 'invite_issued',
            access_note: accessNote || (
                durationDays === 0
                    ? 'Выдана ссылка с join request (навсегда)'
                    : `Выдана ссылка с join request (+${durationDays} дней)`
            )
        })
        .eq('id', subscriptionId);

    const durationText = durationDays === 0
        ? 'Навсегда'
        : `на ${Number(durationDays)} дней`;

    return {
        success: true,
        subscriptionId,
        expiresAt,
        inviteLink: inviteLink.invite_link,
        durationText
    };
}

export async function createGiftAccessCode(supabase, { ownerId, botId, channelId, tariffId, durationDays, createdByTgUserId }) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = generateGiftCode();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
            .from('gift_access_codes')
            .insert({
                owner_id: ownerId,
                bot_id: botId,
                channel_id: channelId,
                tariff_id: tariffId || null,
                code,
                duration_days: durationDays === 0 ? null : Number(durationDays || 0),
                status: 'active',
                created_by_tg_user_id: String(createdByTgUserId || ''),
                expires_at: expiresAt,
                payload: {
                    duration_label: durationDays === 0 ? 'forever' : `${durationDays}_days`
                }
            })
            .select('id, code, channel_id, tariff_id, duration_days, expires_at')
            .single();

        if (!error && data) return data;
        if ((error?.message || '').toLowerCase().includes('duplicate')) continue;
        throw error;
    }

    throw new Error('Не удалось сгенерировать уникальный подарочный код.');
}

export async function redeemGiftAccessCode(supabase, { bot, botId, tgUserId, code }) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) {
        return { error: 'Код пустой.' };
    }

    const { data: giftCode, error } = await supabase
        .from('gift_access_codes')
        .select('id, owner_id, bot_id, channel_id, tariff_id, code, duration_days, status, expires_at, redeemed_at')
        .eq('code', normalizedCode)
        .maybeSingle();

    if (error) throw error;
    if (!giftCode) return { error: 'Код не найден.' };
    if (giftCode.bot_id && String(giftCode.bot_id) !== String(botId)) {
        return { error: 'Этот код выпущен для другого бота.' };
    }
    if (giftCode.status === 'redeemed' || giftCode.redeemed_at) {
        return { error: 'Этот код уже использован.' };
    }
    if (giftCode.status === 'revoked') {
        return { error: 'Этот код отозван админом.' };
    }
    if (giftCode.expires_at && new Date(giftCode.expires_at) < new Date()) {
        await supabase
            .from('gift_access_codes')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('id', giftCode.id);
        return { error: 'Срок действия кода закончился.' };
    }

    const { data: lockingRow, error: lockingError } = await supabase
        .from('gift_access_codes')
        .update({
            status: 'redeeming',
            updated_at: new Date().toISOString()
        })
        .eq('id', giftCode.id)
        .eq('status', 'active')
        .is('redeemed_at', null)
        .select('id')
        .maybeSingle();

    if (lockingError) throw lockingError;
    if (!lockingRow) return { error: 'Этот код уже активируется или уже использован.' };

    try {
        const ownerId = giftCode.owner_id;
        const durationDays = Number(giftCode.duration_days || 0);
        const durationText = durationDays > 0 ? `${durationDays} дней` : 'Навсегда';

        let tariff = null;
        let primaryChannel = null;

        if (giftCode.tariff_id) {
            const { data: t } = await supabase.from('tariffs').select('*').eq('id', giftCode.tariff_id).single();
            tariff = t;
        }

        if (tariff?.channel_id) {
            const { data } = await supabase.from('channels').select('*').eq('id', tariff.channel_id).single();
            primaryChannel = data;
        } else if (giftCode.channel_id) {
            const { data } = await supabase.from('channels').select('*').eq('id', giftCode.channel_id).single();
            primaryChannel = data;
        }

        const bundleItems = tariff ? await getTariffBundleItems(supabase, tariff, ownerId) : [];
        const channelTargets = bundleItems
            .filter(item => item.item_type === 'channel' && item.channels)
            .map(item => item.channels);
        const resourceTargets = bundleItems
            .filter(item => item.item_type === 'resource')
            .map(item => ({ title: item.resource_title, url: item.resource_url }));

        const telegramTargets = buildTelegramTargets(primaryChannel, channelTargets);

        if (!telegramTargets.length && !resourceTargets.length) {
            throw new Error('В тарифе нет каналов или ресурсов для выдачи.');
        }

        const inviteLinks = [];
        let finalExpiresAt = null;
        let firstSubscriptionId = null;

        for (const channel of telegramTargets) {
            const { subscriptionId, expiresAt } = await upsertSubscriptionForChannel(
                supabase, String(tgUserId), channel.id, durationDays
            );

            if (!firstSubscriptionId) firstSubscriptionId = subscriptionId;
            if (!finalExpiresAt) finalExpiresAt = expiresAt;

            const inviteName = `Gift_${tgUserId}_${new Date().toISOString().split('T')[0]}_${channel.id.slice(0, 6)}`;
            const inviteLink = await bot.telegram.createChatInviteLink(channel.tg_chat_id, {
                creates_join_request: true,
                name: inviteName
            });

            await createAccessInvite(supabase, {
                ownerId,
                channelId: channel.id,
                tariffId: tariff?.id || null,
                subscriptionId,
                tgUserId: String(tgUserId),
                inviteLink: inviteLink.invite_link,
                inviteName
            });

            await logAccessEvent(supabase, {
                ownerId,
                channelId: channel.id,
                subscriptionId,
                tgUserId: String(tgUserId),
                eventType: 'invite_issued',
                eventSource: 'gift_code',
                payload: {
                    bot_id: botId,
                    gift_code_id: giftCode.id,
                    gift_code: normalizedCode,
                    tariff_title: tariff?.title || null,
                    duration_days: durationDays === 0 ? 'forever' : durationDays
                }
            });

            await supabase
                .from('subscriptions')
                .update({
                    last_access_event: 'invite_issued',
                    access_note: `Доступ выдан по промокоду (+${durationText})`
                })
                .eq('id', subscriptionId);

            inviteLinks.push({ title: channel.title, url: inviteLink.invite_link });
        }

        await supabase
            .from('gift_access_codes')
            .update({
                status: 'redeemed',
                redeemed_by_tg_user_id: String(tgUserId),
                redeemed_subscription_id: firstSubscriptionId,
                redeemed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                payload: {
                    redeemed_via: 'official_bot',
                    channels_granted: telegramTargets.length,
                    tariff_title: tariff?.title || null
                }
            })
            .eq('id', giftCode.id);

        return {
            success: true,
            tariffTitle: tariff?.title || null,
            inviteLinks,
            resourceTargets,
            expiresAt: finalExpiresAt,
            durationText
        };
    } catch (redeemError) {
        await supabase
            .from('gift_access_codes')
            .update({
                status: 'active',
                updated_at: new Date().toISOString()
            })
            .eq('id', giftCode.id)
            .eq('status', 'redeeming');
        throw redeemError;
    }
}

export async function getBotOwner(supabase, botId) {
    const { data } = await supabase
        .from('tg_accounts')
        .select('owner_id')
        .eq('id', botId)
        .single();

    return data?.owner_id || null;
}

export async function getChannelByChatId(supabase, chatId, botId = null) {
    // channels.tg_chat_id глобально уникален на всех тенантов: без bot_id
    // можно получить чужую строку. С botId ищем только строку этого бота.
    let query = supabase
        .from('channels')
        .select('*')
        .eq('tg_chat_id', chatId);
    if (botId) {
        query = query.eq('bot_id', botId);
    }
    const { data } = await query.maybeSingle();

    return data || null;
}

export async function hasActiveSubscription(supabase, tgUserId, channelId) {
    const nowIso = new Date().toISOString();
    const { data: subscription } = await supabase
        .from('subscriptions')
        .select('id, expires_at')
        .eq('tg_user_id', tgUserId)
        .eq('channel_id', channelId)
        .eq('status', 'active')
        .single();

    if (!subscription) return false;
    if (!subscription.expires_at) return true;

    return new Date(subscription.expires_at).toISOString() > nowIso;
}
