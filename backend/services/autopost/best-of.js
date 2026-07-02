/**
 * Компиляция "лучших постов месяца" по reaction_total и их публикация.
 *
 * composeBestOfMonth — запрос к БД: посты за указанный месяц (границы месяца
 * в таймзоне канала), с reaction_total > 0, отсортированные по реакциям.
 * В Фазе 2 убрали фильтр media_type=photo — видео/гифки тоже попадают.
 *
 * publishBestOf — отправляет заголовок + подборку однородными альбомами
 * (photo album, затем video album, затем animation/document поодиночке).
 * Telegram sendMediaGroup требует однородный тип медиа внутри группы.
 * Подпись — только у самого топ-1 поста (Telegram разрешает 1 caption на альбом).
 */

import { monthBoundsInTz } from './timezone.js';

const MONTHS_RU = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

const BEST_OF_LIMIT = 10;
const ALBUM_MAX = 10;

export function formatMonthLabel(year, month) {
    return `${MONTHS_RU[month - 1] || 'Месяц'} ${year}`;
}

/**
 * Устаревший alias для обратной совместимости. Используй monthBoundsInTz.
 */
export function monthBoundsUtc(year, month) {
    return monthBoundsInTz(year, month, 'UTC');
}

/**
 * Топ постов за месяц по реакциям. Границы месяца — в timezone канала.
 *
 * @returns Promise<{ items, totalWithReactions }> — items уже ограничен BEST_OF_LIMIT,
 *   totalWithReactions — сколько вообще постов за месяц с reaction_total > 0
 *   (для корректного "Топ-N из M").
 */
export async function composeBestOfMonth(supabase, botId, channelId, year, month, options = {}) {
    const { timezone = 'UTC' } = options;
    const { start, end } = monthBoundsInTz(year, month, timezone);

    let query = supabase
        .from('autopost_items')
        .select('id, file_id, file_ids, caption, reaction_total, posted_at, media_type, posted_message_ids')
        .eq('bot_id', botId)
        .eq('status', 'posted')
        .gt('reaction_total', 0)
        .gte('posted_at', start)
        .lt('posted_at', end)
        .order('reaction_total', { ascending: false })
        .order('posted_at', { ascending: true });

    if (channelId) query = query.eq('target_channel_id', String(channelId));

    const { data, error } = await query;
    if (error) throw error;

    const all = Array.isArray(data) ? data : [];
    const items = all
        .filter(it => Boolean((it.file_ids && it.file_ids.length > 0) || it.file_id))
        .slice(0, BEST_OF_LIMIT);

    return { items, totalWithReactions: all.length };
}

function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

/**
 * Публикует подборку: заголовок + подборка медиа + футер.
 *
 * Медиа группируются по типу (photo / video / animation / document).
 * Photos и videos отправляются альбомами по ≤10 (лимит Telegram sendMediaGroup),
 * animations/documents — поодиночке (Telegram не позволяет им быть в альбоме).
 *
 * Подпись исходного поста сохраняется только у самого топ-1 item во всей подборке
 * (Telegram разрешает 1 caption на альбом).
 */
export async function publishBestOf(bot, targetChatId, items, { year, month, isPreview = false }) {
    if (!items || items.length === 0) {
        return { published: false, reason: 'no_items' };
    }

    const monthLabel = formatMonthLabel(year, month);
    const headerLines = [
        `🏆 Лучшее за ${monthLabel}`,
        `Топ-${items.length} постов по реакциям аудитории.`
    ];
    if (isPreview) headerLines.push('👁 Предпросмотр (не опубликовано).');

    await bot.telegram.sendMessage(targetChatId, headerLines.join('\n'));

    const photos = [];
    const videos = [];
    const others = [];
    for (const it of items) {
        const fileId = (it.file_ids && it.file_ids.length > 0) ? it.file_ids[0] : it.file_id;
        if (!fileId) continue;
        if (it.media_type === 'video') videos.push({ it, fileId });
        else if (it.media_type === 'animation' || it.media_type === 'document') others.push({ it, fileId });
        else photos.push({ it, fileId });
    }

    const allMessageIds = [];
    let captionAssigned = false;

    function buildCaption(it) {
        if (captionAssigned) return undefined;
        captionAssigned = true;
        return it.caption || undefined;
    }

    for (const chunk of chunkArray(photos, ALBUM_MAX)) {
        const media = chunk.map(({ it, fileId }) => ({
            type: 'photo',
            media: fileId,
            caption: buildCaption(it)
        }));
        const sent = await bot.telegram.sendMediaGroup(targetChatId, media);
        if (Array.isArray(sent)) allMessageIds.push(...sent.map(m => m.message_id));
    }

    for (const chunk of chunkArray(videos, ALBUM_MAX)) {
        const media = chunk.map(({ it, fileId }) => ({
            type: 'video',
            media: fileId,
            caption: buildCaption(it)
        }));
        const sent = await bot.telegram.sendMediaGroup(targetChatId, media);
        if (Array.isArray(sent)) allMessageIds.push(...sent.map(m => m.message_id));
    }

    for (const { it, fileId } of others) {
        const caption = buildCaption(it);
        let msg;
        if (it.media_type === 'animation') {
            msg = await bot.telegram.sendAnimation(targetChatId, fileId, { caption });
        } else {
            msg = await bot.telegram.sendDocument(targetChatId, fileId, { caption });
        }
        if (msg?.message_id) allMessageIds.push(msg.message_id);
    }

    await bot.telegram.sendMessage(targetChatId, `Спасибо за реакции ❤️ — вы формируете этот топ.`);

    return { published: true, messageIds: allMessageIds };
}
