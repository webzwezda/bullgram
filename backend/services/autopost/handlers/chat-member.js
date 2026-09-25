/**
 * Обработка событий my_chat_member: подключение/отвязка каналов и групп.
 */
import { getAdminKeyboard } from '../keyboard.js';

export function registerChatMemberHandler(bot, service, botId) {
    const supabase = service.supabase;

    bot.on('my_chat_member', async (ctx) => {
        const chat = ctx.myChatMember.chat;
        const newStatus = ctx.myChatMember.new_chat_member.status;

        if (newStatus === 'administrator') {
            try {
                const { data: botData } = await supabase
                    .from('autopost_bots')
                    .select('*')
                    .eq('id', botId)
                    .single();

                if (botData?.owner_id) {
                    // channels.tg_chat_id глобально уникален на всех тенантов. Guard
                    // тенантный: свою строку (в т.ч. мерж-строку с official-ботом того
                    // же владельца) вставляем/обновляем — payload проставит
                    // autopost_bot_id, соседние фичевые колонки не тронет. Чужую
                    // (другой owner_id) не крадём.
                    const { data: existingChannel, error: selectError } = await supabase
                        .from('channels')
                        .select('id, owner_id')
                        .eq('tg_chat_id', chat.id)
                        .maybeSingle();
                    if (selectError) throw selectError;

                    const channelPayload = {
                        owner_id: botData.owner_id,
                        autopost_bot_id: botId,
                        tg_chat_id: chat.id,
                        title: chat.title || String(chat.id),
                        chat_type: chat.type || 'channel',
                        username: chat.username || null,
                        visibility: chat.username ? 'public' : 'private',
                        last_visibility_check_at: new Date().toISOString()
                    };

                    let bound = false;
                    if (!existingChannel) {
                        const { error } = await supabase.from('channels').insert(channelPayload);
                        if (error) throw error;
                        bound = true;
                    } else if (existingChannel.owner_id === botData.owner_id) {
                        const { error } = await supabase.from('channels').update(channelPayload).eq('id', existingChannel.id);
                        if (error) throw error;
                        bound = true;
                    } else {
                        console.warn(`[Autopost] Канал ${chat.id} принадлежит другому владельцу (${existingChannel.owner_id}), пропуск привязки для бота ${botId}`);
                    }

                    if (bound) {
                        console.log(`[Autopost] Канал ${chat.title || chat.id} привязан к боту ${botId}`);

                        const adminTgIds = botData.admin_tg_ids || [];
                        for (const adminId of adminTgIds) {
                            try {
                                const keyboard = await getAdminKeyboard(botId, adminId, supabase);
                                await ctx.telegram.sendMessage(adminId, `✅ Канал/группа "${chat.title || chat.id}" успешно привязана к автопостеру!`, keyboard);
                            } catch (e) {
                                console.error(`Failed to notify admin ${adminId} about channel addition:`, e.message);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('[Autopost] Ошибка сохранения канала:', err.message);
            }
        } else if (newStatus === 'left' || newStatus === 'kicked') {
            try {
                await supabase.from('channels').update({ autopost_bot_id: null }).eq('tg_chat_id', chat.id).eq('autopost_bot_id', botId);
                console.log(`[Autopost] Канал ${chat.title || chat.id} отвязан от бота ${botId}`);

                const { data: botData } = await supabase
                    .from('autopost_bots')
                    .select('*')
                    .eq('id', botId)
                    .single();

                if (botData) {
                    const adminTgIds = botData.admin_tg_ids || [];
                    for (const adminId of adminTgIds) {
                        try {
                            const keyboard = await getAdminKeyboard(botId, adminId, supabase);
                            await ctx.telegram.sendMessage(adminId, `⚠️ Канал/группа "${chat.title || chat.id}" отключена от автопостера.`, keyboard);
                        } catch (e) {
                            console.error(`Failed to notify admin ${adminId} about channel removal:`, e.message);
                        }
                    }
                }
            } catch (err) {
                console.error('[Autopost] Ошибка удаления канала:', err.message);
            }
        }
    });
}
