/**
 * Reply/inline keyboards для автопостера.
 */
import { Markup } from 'telegraf';

export async function getAdminKeyboard(botId, tgUserId, supabase) {
    const { data: bot } = await supabase.from('autopost_bots').select('*').eq('id', botId).single();
    const { data: channels } = await supabase.from('channels').select('*').eq('autopost_bot_id', botId);

    let modeLabel = '🔄 Направление: ⚠️ Нет каналов';
    if (channels && channels.length > 0) {
        const activeModes = bot.active_modes || {};
        let activeId = activeModes[String(tgUserId)];
        let activeChannel = channels.find(c => String(c.tg_chat_id) === String(activeId));
        if (!activeChannel) {
            activeChannel = channels[0];
            activeModes[String(tgUserId)] = String(activeChannel.tg_chat_id);
            await supabase.from('autopost_bots').update({ active_modes: activeModes }).eq('id', botId);
        }
        modeLabel = `🔄 Направление: ${activeChannel.title} ${activeChannel.visibility === 'public' ? '📢' : '🔒'}`;
    }

    return Markup.keyboard([
        [modeLabel],
        ['➕ Добавить пост', '📋 Очередь'],
        ['📥 Предложки']
    ]).resize();
}

export function queueItemInlineKeyboard(item, channel) {
    const type = (channel && channel.visibility) || (channel && channel.username ? 'public' : 'private');
    const buttons = [
        [
            Markup.button.callback('⚡️ Опубликовать', `post_now:${item.id}`),
            Markup.button.callback('📝 Изменить текст', `edit_post_txt:${item.id}`)
        ],
        [
            Markup.button.callback(type === 'public' ? '🔒 В Приват' : '📢 В Паблик', `move_post:${item.id}`),
            Markup.button.callback('❌ Удалить', `del_post:${item.id}`)
        ]
    ];
    return Markup.inlineKeyboard(buttons);
}

export function suggestionInlineKeyboard(item) {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('⚡️ Опубликовать сейчас', `sug_post_now:${item.id}`),
            Markup.button.callback('📥 В общую очередь', `sug_approve:${item.id}`)
        ],
        [
            Markup.button.callback('❌ Отклонить', `sug_reject:${item.id}`)
        ]
    ]);
}

/**
 * Рендерит ленту очереди (до 10 постов) с inline-кнопками управления.
 */
export async function showQueueForChannel(ctx, botId, channel, supabase) {
    const { data: items, error } = await supabase
        .from('autopost_items')
        .select('*')
        .eq('bot_id', botId)
        .eq('target_channel_id', channel.tg_chat_id)
        .in('status', ['queued', 'scheduled'])
        .order('sort_order', { ascending: true })
        .limit(10);

    if (error || !items || items.length === 0) {
        return ctx.reply(`Очередь постов для канала "${channel.title}" пуста.`);
    }

    await ctx.reply(`📋 **Очередь постов (${channel.title}):**`);

    for (const item of items) {
        const fileId = item.file_ids && item.file_ids.length > 0 ? item.file_ids[0] : item.file_id;
        const statusText = item.status === 'scheduled'
            ? `📅 Запланирован на ${new Date(item.scheduled_at).toLocaleString('ru-RU')}`
            : '📦 В очереди';
        const inlineKeyboard = queueItemInlineKeyboard(item, channel);

        if (fileId) {
            const type = item.media_type || 'photo';
            const caption = `${statusText}\n\n${item.caption || ''}`;
            if (type === 'video') {
                await ctx.replyWithVideo(fileId, { caption, ...inlineKeyboard });
            } else if (type === 'animation') {
                await ctx.replyWithAnimation(fileId, { caption, ...inlineKeyboard });
            } else if (type === 'document') {
                await ctx.replyWithDocument(fileId, { caption, ...inlineKeyboard });
            } else {
                await ctx.replyWithPhoto(fileId, { caption, ...inlineKeyboard });
            }
        } else {
            await ctx.reply(`${statusText}\n\n${item.caption || ''}`, inlineKeyboard);
        }
    }
}
