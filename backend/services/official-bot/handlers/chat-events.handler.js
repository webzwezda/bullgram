import { buildChannelVisibilityPayload } from '../shared/pending-state.js';

async function autoAssignChannelToContour({ service, botId, chat }) {
    const chatType = String(chat?.type || 'channel').toLowerCase();
    const isChannel = chatType === 'channel';
    const username = String(chat?.username || '').trim().replace(/^@/, '');
    const visibility = username ? 'public' : 'private';

    const preferredField = isChannel
        ? (visibility === 'public' ? 'public_channel_id' : 'paid_channel_id')
        : (visibility === 'public' ? 'public_chat_id' : 'paid_chat_id');

    const { data: channelRow, error: channelError } = await service.supabase
        .from('channels')
        .select('id')
        .eq('bot_id', botId)
        .eq('tg_chat_id', chat.id)
        .maybeSingle();
    if (channelError || !channelRow?.id) return;

    const { data: contour, error: contourError } = await service.supabase
        .from('sales_bot_contours')
        .select('bot_id, public_channel_id, paid_channel_id, public_chat_id, paid_chat_id')
        .eq('bot_id', botId)
        .maybeSingle();
    if (contourError || !contour) return;
    if (contour[preferredField]) return;

    const { error: updateError } = await service.supabase
        .from('sales_bot_contours')
        .update({ [preferredField]: channelRow.id, updated_at: new Date().toISOString() })
        .eq('bot_id', botId);
    if (updateError) {
        console.error(`[chat-events] contour auto-assign failed for bot ${botId}, field ${preferredField}:`, updateError.message);
    }
}

export function registerChatEventHandlers(bot, { service, botId }) {
    bot.on('my_chat_member', async (ctx) => {
        const chat = ctx.myChatMember.chat;
        const newStatus = ctx.myChatMember.new_chat_member.status;
        if (newStatus === 'administrator') {
            const ownerId = await service.getBotOwner(botId);
            if (!ownerId) return;

            // channels.tg_chat_id глобально уникален на всех тенантов. Guard тенантный:
            // свою строку (в т.ч. мерж-строку с autopost-ботом того же владельца)
            // вставляем/обновляем — payload проставит bot_id, соседние фичевые
            // колонки не тронет. Чужую (другой owner_id) не крадём.
            const { data: existingChannel, error: selectError } = await service.supabase
                .from('channels')
                .select('id, owner_id')
                .eq('tg_chat_id', chat.id)
                .maybeSingle();
            if (selectError) {
                console.error(`[chat-events] channels.select failed for chat ${chat.id}:`, selectError.message);
                throw new Error(`channels.select failed: ${selectError.message}`);
            }

            if (existingChannel && existingChannel.owner_id !== ownerId) {
                console.warn(`[chat-events] chat ${chat.id} принадлежит другому владельцу (${existingChannel.owner_id}), пропуск привязки для бота ${botId}`);
            } else {
                const channelPayload = {
                    owner_id: ownerId,
                    bot_id: botId,
                    tg_chat_id: chat.id,
                    title: chat.title || String(chat.id),
                    chat_type: chat.type || 'channel',
                    ...buildChannelVisibilityPayload(chat)
                };

                const { error } = existingChannel
                    ? await service.supabase.from('channels').update(channelPayload).eq('id', existingChannel.id)
                    : await service.supabase.from('channels').insert(channelPayload);
                if (error) {
                    console.error(`[chat-events] channels insert/update failed for chat ${chat.id}:`, error.message);
                    throw new Error(`channels insert/update failed: ${error.message}`);
                }

                await autoAssignChannelToContour({ service, botId, chat });
            }
        } else if (newStatus === 'left' || newStatus === 'kicked') {
            // Строка может быть мерж-строкой того же владельца (в ней живёт
            // autopost_bot_id) и на неё ссылается история подписок, поэтому
            // не удаляем её, а отвязываем только своего бота — симметрично
            // leave-ветке autopost-хендлера.
            const { error } = await service.supabase
                .from('channels')
                .update({ bot_id: null })
                .eq('tg_chat_id', chat.id)
                .eq('bot_id', botId);
            if (error) {
                console.error(`[chat-events] channels detach failed for chat ${chat.id}:`, error.message);
            }
        }
    });

    bot.on('chat_join_request', async (ctx) => {
        try {
            const chatId = ctx.chatJoinRequest.chat.id;
            const tgUserId = ctx.chatJoinRequest.from.id;
            const channel = await service.getChannelByChatId(chatId, botId);

            if (!channel) {
                await ctx.telegram.declineChatJoinRequest(chatId, tgUserId).catch(() => {});
                return;
            }

            const invite = await service.findLatestAccessInvite(channel.id, tgUserId);
            await service.logAccessEvent({
                ownerId: channel.owner_id,
                channelId: channel.id,
                inviteId: invite?.id || null,
                subscriptionId: invite?.subscription_id || null,
                invoiceId: invite?.invoice_id || null,
                tgUserId,
                eventType: 'join_requested',
                eventSource: 'official_bot',
                payload: {
                    chat_id: String(chatId)
                }
            });

            await service.supabase
                .from('subscriptions')
                .update({
                    last_join_request_at: new Date().toISOString(),
                    last_access_event: 'join_requested'
                })
                .eq('channel_id', channel.id)
                .eq('tg_user_id', String(tgUserId));

            const hasAccess = await service.hasActiveSubscription(tgUserId, channel.id);
            if (hasAccess) {
                await ctx.telegram.approveChatJoinRequest(chatId, tgUserId);
                if (invite) {
                    await service.supabase
                        .from('access_invites')
                        .update({
                            status: 'approved',
                            used_at: new Date().toISOString()
                        })
                        .eq('id', invite.id);
                }

                await service.supabase
                    .from('subscriptions')
                    .update({
                        last_join_approved_at: new Date().toISOString(),
                        last_access_event: 'join_approved'
                    })
                    .eq('channel_id', channel.id)
                    .eq('tg_user_id', String(tgUserId));

                await service.logAccessEvent({
                    ownerId: channel.owner_id,
                    channelId: channel.id,
                    inviteId: invite?.id || null,
                    subscriptionId: invite?.subscription_id || null,
                    invoiceId: invite?.invoice_id || null,
                    tgUserId,
                    eventType: 'join_approved',
                    eventSource: 'official_bot',
                    payload: {
                        chat_id: String(chatId)
                    }
                });

                await ctx.telegram.sendMessage(
                    tgUserId,
                    `✅ Доступ в «${channel.title || 'закрытый канал'}» подтвержден. Добро пожаловать!`
                ).catch(() => {});
                return;
            }

            await ctx.telegram.declineChatJoinRequest(chatId, tgUserId);
            if (invite) {
                await service.supabase
                    .from('access_invites')
                    .update({
                        status: 'declined',
                        used_at: new Date().toISOString()
                    })
                    .eq('id', invite.id);
            }

            await service.supabase
                .from('subscriptions')
                .update({
                    last_access_event: 'join_declined',
                    access_note: 'Отклонен join request: нет активной подписки'
                })
                .eq('channel_id', channel.id)
                .eq('tg_user_id', String(tgUserId));

            await service.logAccessEvent({
                ownerId: channel.owner_id,
                channelId: channel.id,
                inviteId: invite?.id || null,
                subscriptionId: invite?.subscription_id || null,
                invoiceId: invite?.invoice_id || null,
                tgUserId,
                eventType: 'join_declined',
                eventSource: 'official_bot',
                payload: {
                    chat_id: String(chatId),
                    reason: 'no_active_subscription'
                }
            });

            await ctx.telegram.sendMessage(
                tgUserId,
                `⛔ Доступ в «${channel.title || 'закрытый канал'}» не подтвержден. Сначала оформи или продли подписку через этого бота.`
            ).catch(() => {});
        } catch (error) {
            console.error('Ошибка обработки chat_join_request:', error);
        }
    });
}
