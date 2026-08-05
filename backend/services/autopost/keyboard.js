/**
 * Reply/inline keyboards для автопостера.
 */
import { Markup } from 'telegraf';

const CHANNEL_FORMS = ['канал', 'канала', 'каналов'];

function pluralizeChannels(n) {
    const n10 = Math.abs(n) % 10;
    const n100 = Math.abs(n) % 100;
    if (n10 === 1 && n100 !== 11) return CHANNEL_FORMS[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return CHANNEL_FORMS[1];
    return CHANNEL_FORMS[2];
}

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
        ['➕ Фото/Видео', '📝 Текст'],
        ['📋 Очередь', '📥 Предложки'],
        ['🏆 Лучшее', '❤️ Автореакция']
    ]).resize();
}

/**
 * Inline-клавиатура карточки очереди. Скрывает "Перенести" для multi-target
 * (batch > 1 — ломает fan-out семантику) и для single-channel ботов (некуда
 * переносить, кнопка бесполезна). Остальные кнопки通用ные.
 */
export function queueItemInlineKeyboard(item, channel, options = {}) {
    const { batchSize = 1, channelsCount = 0 } = options;
    const type = (channel && channel.visibility) || (channel && channel.username ? 'public' : 'private');
    const showMove = batchSize <= 1 && channelsCount >= 2;

    const buttons = [
        [
            Markup.button.callback('⚡️ Опубликовать', `post_now:${item.id}`),
            Markup.button.callback('📝 Изменить текст', `edit_post_txt:${item.id}`)
        ]
    ];
    if (showMove) {
        buttons.push([
            Markup.button.callback(type === 'public' ? '🔒 В Приват' : '📢 В Паблик', `move_post:${item.id}`),
            Markup.button.callback('❌ Удалить', `del_post:${item.id}`)
        ]);
    } else {
        buttons.push([Markup.button.callback('❌ Удалить', `del_post:${item.id}`)]);
    }
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
 * Рендерит страницу очереди (10 постов) с inline-кнопками управления
 * + пагинация. offset: число или 'last' (прыжок в конец).
 *
 * Сортировка: scheduled asc nulls first (сначала ждущие без слота, потом
 * по времени публикации), затем sort_order asc. Раньше было sort_order asc
 * + limit 10 — новые посты (sort_order = max+1) никогда не попадали в выдачу.
 *
 * Для каждой карточки считаем batch_size (actionable siblings — queued/
 * scheduled/editing) чтобы решить, показывать ли "Перенести" и добавлять ли
 * "· N каналов" в статус. Single-channel боты тоже не получают "Перенести".
 */
export async function showQueueForChannel(ctx, botId, channel, supabase, offset = 0) {
    const PAGE_SIZE = 10;
    const channelId = channel.tg_chat_id;

    let actualOffset = typeof offset === 'number' ? offset : 0;
    let total = 0;

    if (offset === 'last') {
        const { count } = await supabase
            .from('autopost_items')
            .select('id', { count: 'exact', head: true })
            .eq('bot_id', botId)
            .eq('target_channel_id', channelId)
            .in('status', ['queued', 'scheduled']);
        total = count || 0;
        actualOffset = total > PAGE_SIZE ? total - PAGE_SIZE : 0;
    }

    const { data: items, count, error } = await supabase
        .from('autopost_items')
        .select('*', { count: 'exact' })
        .eq('bot_id', botId)
        .eq('target_channel_id', channelId)
        .in('status', ['queued', 'scheduled'])
        .order('scheduled_at', { ascending: true, nullsFirst: true })
        .order('sort_order', { ascending: true })
        .range(actualOffset, actualOffset + PAGE_SIZE - 1);

    if (offset !== 'last') total = count || 0;

    if (error) {
        return ctx.reply('❌ Не удалось загрузить очередь. Попробуйте позже.');
    }
    if (!items || items.length === 0) {
        const msg = actualOffset > 0
            ? `На этой странице постов нет (возможно, они были опубликованы или удалены). Всего в очереди: ${total}.`
            : `Очередь постов для канала "${channel.title}" пуста.`;
        return ctx.reply(msg);
    }

    // (1) Actionable batch sizing per batch_id (для badge и скрытия "Перенести")
    const batchIds = [...new Set(items.map(i => i.post_batch_id).filter(Boolean))];
    const batchSizeByBatch = new Map();
    if (batchIds.length > 0) {
        const { data: batchRows } = await supabase
            .from('autopost_items')
            .select('post_batch_id')
            .in('post_batch_id', batchIds)
            .in('status', ['queued', 'scheduled', 'editing']);
        for (const r of batchRows || []) {
            const k = r.post_batch_id;
            batchSizeByBatch.set(k, (batchSizeByBatch.get(k) || 0) + 1);
        }
    }

    // (2) Total channels for this bot — для скрытия "Перенести" на single-channel ботах
    const { count: channelsCount } = await supabase
        .from('channels')
        .select('*', { count: 'exact', head: true })
        .eq('autopost_bot_id', botId);
    const channelsCountNum = channelsCount || 0;

    await ctx.reply(`📋 **Очередь постов (${channel.title})** — посты ${actualOffset + 1}–${actualOffset + items.length} из ${total}`);

    for (const item of items) {
        const fileId = item.file_ids && item.file_ids.length > 0 ? item.file_ids[0] : item.file_id;
        const isText = !fileId;
        const batchSize = batchSizeByBatch.get(item.post_batch_id) || 1;
        const batchSuffix = batchSize > 1 ? ` · ${batchSize} ${pluralizeChannels(batchSize)}` : '';
        const statusText = item.status === 'scheduled'
            ? `📅 Запланирован на ${new Date(item.scheduled_at).toLocaleString('ru-RU')}${batchSuffix}`
            : `📦 В очереди${batchSuffix}`;
        const typeLabel = isText ? '📝 Текст\n\n' : '';
        const inlineKeyboard = queueItemInlineKeyboard(item, channel, { batchSize, channelsCount: channelsCountNum });

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
            await ctx.reply(`${statusText}\n${typeLabel}${item.caption || ''}`, inlineKeyboard);
        }
    }

    const hasNext = actualOffset + items.length < total;
    const isAtStart = actualOffset === 0;
    const rows = [];
    if (!isAtStart) {
        rows.push([Markup.button.callback('⬅️ В начало', `queue_page:${channelId}:0`)]);
    }
    if (hasNext) {
        rows.push([
            Markup.button.callback('➡️ Следующие +10', `queue_page:${channelId}:${actualOffset + PAGE_SIZE}`),
            Markup.button.callback('⏩ Последние 10', `queue_page:${channelId}:last`)
        ]);
    }
    if (rows.length > 0) {
        await ctx.reply('📖 Листание:', Markup.inlineKeyboard(rows));
    }
}
