/**
 * Логика очереди автопостера: рассчёт слотов, схлопывание, статистика.
 * Работает поверх supabase-клиента, не зависит от Telegraf.
 */
import { getUtcDateForLocal, getLocalDateParts } from './timezone.js';

export function getNextSlots(afterDateTime, postsPerDay, postingTimes, tz, count) {
    const slots = [];
    const sortedPostingTimes = postingTimes && postingTimes.length > 0
        ? [...postingTimes].sort()
        : ['12:00'];
    // Cap на количество указанных времён — не создаём дубликаты слотов в одно время.
    const effectiveTimes = sortedPostingTimes.slice(0, Math.max(1, postsPerDay || 1));

    const startLocalParts = getLocalDateParts(afterDateTime, tz);
    let currentTzDate = new Date(Date.UTC(startLocalParts.year, startLocalParts.month, startLocalParts.day));

    let iterations = 0;
    while (slots.length < count && iterations < 1000) {
        iterations++;
        for (const timeStr of effectiveTimes) {
            const [hours, minutes] = timeStr.split(':').map(Number);

            const slotUtcDate = getUtcDateForLocal(
                currentTzDate.getUTCFullYear(),
                currentTzDate.getUTCMonth(),
                currentTzDate.getUTCDate(),
                hours || 12,
                minutes || 0,
                tz
            );

            if (slotUtcDate.getTime() > afterDateTime.getTime()) {
                slots.push(slotUtcDate);
                if (slots.length === count) {
                    return slots;
                }
            }
        }
        currentTzDate.setUTCDate(currentTzDate.getUTCDate() + 1);
    }
    return slots;
}

export async function scheduleNextBatch(supabase, botId, channelId = null, isSuggestion = null) {
    if (!channelId) {
        const { data: channels } = await supabase
            .from('channels')
            .select('tg_chat_id')
            .eq('autopost_bot_id', botId);
        let total = 0;
        for (const ch of channels || []) {
            if (isSuggestion === null) {
                total += await scheduleNextBatch(supabase, botId, ch.tg_chat_id, false);
                total += await scheduleNextBatch(supabase, botId, ch.tg_chat_id, true);
            } else {
                total += await scheduleNextBatch(supabase, botId, ch.tg_chat_id, isSuggestion);
            }
        }
        return total;
    }

    if (isSuggestion === null) {
        let total = 0;
        total += await scheduleNextBatch(supabase, botId, channelId, false);
        total += await scheduleNextBatch(supabase, botId, channelId, true);
        return total;
    }

    const { data: channel } = await supabase
        .from('channels')
        .select('*')
        .eq('autopost_bot_id', botId)
        .eq('tg_chat_id', channelId)
        .single();
    if (!channel) return 0;

    const postsPerDay = isSuggestion
        ? (channel.suggestion_posts_per_day || 1)
        : (channel.posts_per_day || 1);
    const postingTimes = isSuggestion
        ? (channel.suggestion_posting_times || ['12:00'])
        : (channel.posting_times || ['10:00']);

    const { data: lastScheduled } = await supabase
        .from('autopost_items')
        .select('scheduled_at')
        .eq('bot_id', botId)
        .eq('target_channel_id', channel.tg_chat_id)
        .eq('status', 'scheduled')
        .eq('is_suggestion', isSuggestion)
        .order('scheduled_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    const tz = channel.timezone || 'Europe/Moscow';

    const { data: unscheduled } = await supabase
        .from('autopost_items')
        .select('*')
        .eq('bot_id', botId)
        .eq('target_channel_id', channel.tg_chat_id)
        .eq('status', 'queued')
        .eq('is_suggestion', isSuggestion)
        .order('sort_order', { ascending: true });

    if (!unscheduled || unscheduled.length === 0) return 0;

    const afterDateTime = lastScheduled?.scheduled_at ? new Date(lastScheduled.scheduled_at) : new Date();
    const slots = getNextSlots(afterDateTime, postsPerDay, postingTimes, tz, unscheduled.length);

    let scheduled = 0;
    for (let idx = 0; idx < unscheduled.length; idx++) {
        const scheduledAt = slots[idx];
        if (!scheduledAt) break;

        await supabase
            .from('autopost_items')
            .update({ status: 'scheduled', scheduled_at: scheduledAt.toISOString() })
            .eq('id', unscheduled[idx].id);

        scheduled++;
    }

    return scheduled;
}

export async function collapseQueue(supabase, botId, channelId) {
    if (!channelId) return;

    await supabase
        .from('autopost_items')
        .update({ status: 'queued', scheduled_at: null })
        .eq('bot_id', botId)
        .eq('target_channel_id', channelId)
        .eq('status', 'scheduled')
        .eq('is_suggestion', false);

    await supabase
        .from('autopost_items')
        .update({ status: 'queued', scheduled_at: null })
        .eq('bot_id', botId)
        .eq('target_channel_id', channelId)
        .eq('status', 'scheduled')
        .eq('is_suggestion', true);

    await scheduleNextBatch(supabase, botId, channelId, false);
    await scheduleNextBatch(supabase, botId, channelId, true);
}

export async function getStats(supabase, botId) {
    const { data, error } = await supabase.rpc('autopost_stats', { p_bot_id: botId });
    if (error) {
        const counts = { queued: 0, scheduled: 0, posted: 0, failed: 0, suggested: 0, editing: 0 };
        const { data: rows } = await supabase
            .from('autopost_items')
            .select('status')
            .eq('bot_id', botId);
        for (const r of rows || []) {
            counts[r.status] = (counts[r.status] || 0) + 1;
        }
        const { data: nextScheduled } = await supabase
            .from('autopost_items')
            .select('scheduled_at')
            .eq('bot_id', botId)
            .eq('status', 'scheduled')
            .order('scheduled_at', { ascending: true })
            .limit(1)
            .maybeSingle();
        return { ...counts, nextScheduledAt: nextScheduled?.scheduled_at || null };
    }
    const row = data?.[0] || {};
    return {
        queued: Number(row.queued || 0),
        scheduled: Number(row.scheduled || 0),
        posted: Number(row.posted || 0),
        failed: Number(row.failed || 0),
        suggested: Number(row.suggested || 0),
        editing: Number(row.editing || 0),
        nextScheduledAt: row.next_scheduled_at || null
    };
}
