import { buildChannelVisibilityPayload } from '../shared/pending-state.js';

export function registerChatEventHandlers(bot, { service, botId }) {
    bot.on('my_chat_member', async (ctx) => {
        const chat = ctx.myChatMember.chat;
        const newStatus = ctx.myChatMember.new_chat_member.status;
        if (newStatus === 'administrator') {
            try {
                const ownerId = await service.getBotOwner(botId);
                if (ownerId) {
                    await service.supabase.from('channels').upsert(
                        {
                            owner_id: ownerId,
                            bot_id: botId,
                            tg_chat_id: chat.id,
                            title: chat.title || String(chat.id),
                            chat_type: chat.type || 'channel',
                            ...buildChannelVisibilityPayload(chat)
                        },
                        { onConflict: 'tg_chat_id' }
                    );
                }
            } catch (err) {}
        } else if (newStatus === 'left' || newStatus === 'kicked') {
            await service.supabase.from('channels').delete().eq('tg_chat_id', chat.id);
        }
    });

    bot.on('chat_join_request', async (ctx) => {
        try {
            const chatId = ctx.chatJoinRequest.chat.id;
            const tgUserId = ctx.chatJoinRequest.from.id;
            const channel = await service.getChannelByChatId(chatId);

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
