// Публикация постов (publishItem, applyReactionDelta) и album cache.
// Выделено из autopost.service.js при разрезке под pre-commit лимит:
// методы класса AutopostService стали однострочными делегатами, инстанс
// сервиса передаётся первым аргументом (service).
import { sendItemToChannel } from './sender.js';
import { buildSeedReactionAttempts, buildSeedReactionPlans } from './handlers/reactions.js';
import { log } from './logger.js';

// --- Album cache (БД-backed, Bug 4 fix) ---
// Раньше жил в Map() на инстансе сервиса и терялся при рестарте —
// между "альбом обнаружен" и кликом по кнопке keep/split.
export async function setAlbumCache(service, cacheId, { botId, tgUserId, photos, mediaTypes = [], caption, targetChannelId, stage = 'pick' }) {
    const { error } = await service.supabase
        .from('autopost_album_cache')
        .upsert({
            cache_id: cacheId,
            bot_id: botId,
            tg_user_id: tgUserId,
            photos,
            media_types: mediaTypes,
            caption: caption || '',
            target_channel_id: targetChannelId,
            stage,
            created_at: new Date().toISOString()
        }, { onConflict: 'cache_id' });
    if (error) throw error;
}

export async function getAlbumCache(service, cacheId) {
    const { data, error } = await service.supabase
        .from('autopost_album_cache')
        .select('*')
        .eq('cache_id', cacheId)
        .maybeSingle();
    if (error) return null;
    if (!data) return null;
    return {
        photos: data.photos || [],
        mediaTypes: data.media_types || [],
        caption: data.caption || '',
        targetChannelId: data.target_channel_id,
        stage: data.stage
    };
}

export async function deleteAlbumCache(service, cacheId) {
    await service.supabase
        .from('autopost_album_cache')
        .delete()
        .eq('cache_id', cacheId);
}

export async function pruneExpiredAlbumCache(service) {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await service.supabase
        .from('autopost_album_cache')
        .delete()
        .lt('created_at', cutoff);
}

/**
 * Публикует пост в канал и фиксирует результат на item.
 * Выносит общую логику publish + UPDATE, которая раньше дублировалась
 * в scheduler / post_now / sug_post_now. Дополнительно сохраняет
 * posted_message_ids для последующего lookup'а реакций.
 *
 * Если у channel.seed_reaction_emoji выставлено значение (например '❤'),
 * бот сразу ставит эту реакцию на первое сообщение поста — social proof.
 * Боты не получают собственные message_reaction апдейты → это НЕ засчитывается
 * в reaction_total, счётчик остаётся чистым по реальным юзерам.
 *
 * Чек-лист (media_type='checklist'): checklist+items грузятся ЗДЕСЬ (у sender
 * нет доступа к supabase) и прокидываются в рендер через item.options;
 * seed-реакция пропускается — реакции юзеров на списке не мешаем и не
 * провоцируем (решение 6 из плана).
 */
export async function publishItem(service, bot, item, channel, botUsername, { claimed = false, actorSource = 'agent' } = {}) {
    const isChecklist = item.media_type === 'checklist';

    // Отменённый/удалённый список публиковать нельзя — строка уйдёт в failed у вызывающего.
    if (isChecklist) {
        const checklist = await service.loadChecklistScoped(item.bot_id, item.checklist_id);
        if (!checklist || checklist.cancelled_at) {
            throw new Error('CHECKLIST_UNAVAILABLE');
        }
        item.options = {
            checklist,
            items: await service.loadChecklistItems(checklist.id),
            showNames: await service.resolveChecklistShowNames(item.bot_id, item.target_channel_id)
        };
    }

    const messageIds = await sendItemToChannel(bot.telegram, item.target_channel_id, item, {
        channel,
        botUsername
    });

    // Реакцию ставим ДО записи в БД — она должна появиться вместе с постом,
    // а не после DB-апдейта. Если setMessageReaction упадёт (нет прав),
    // пост всё равно считается опубликованным.
    //
    // setMessageReaction ЗАМЕНЯЕТ предыдущий набор реакций бота на сообщении,
    // поэтому каждая попытка — один вызов с готовым набором. Премиум-канал
    // (channel.seed_reaction_premium) шлёт мультиреакцию 2-3 эмодзи одним
    // вызовом; при отказе деградируем по префиксам вниз до одиночного.
    // Не-премиум — прежние одиночные попытки. Список уже нормализован
    // (❤️ → ❤, без VS16 — иначе Telegram даёт REACTION_INVALID),
    // пустой/мусорный список → Telegram не вызываем вовсе.
    // Чек-листы — без seed-реакций (решение 6: реакции юзеров на списке не мешаем,
    // но и не провоцируем; best-of всё равно фильтрует по media_type).
    const seedPlans = isChecklist
        ? []
        : buildSeedReactionPlans(
            buildSeedReactionAttempts(channel?.seed_reaction_emoji),
            { premium: channel?.seed_reaction_premium === true }
        );
    if (seedPlans.length > 0 && messageIds && messageIds.length > 0) {
        let seeded = false;
        for (const plan of seedPlans) {
            try {
                await bot.telegram.setMessageReaction(item.target_channel_id, messageIds[0], plan.map((emoji) => ({ type: 'emoji', emoji })));
                seeded = true;
                break;
            } catch (e) {
                console.error(`[Autopost] seed reaction attempt failed (chat=${item.target_channel_id} message=${messageIds[0]} emojis="${plan.join(',')}"):`, e.message);
            }
        }
        if (!seeded) {
            console.error(`[Autopost] seed reaction не удалась ни одной попыткой из ${seedPlans.length} (chat=${item.target_channel_id} message=${messageIds[0]}) — проверь, что эмодзи разрешён в настройках реакций канала, а для мультиреакций — что бот реально премиум (non-fatal, пост опубликован)`);
        }
    }

    // claimed-путь (scheduler) финализирует только item, который ещё в 'sending':
    // если статус уже изменился (recovery забрал, ручная правка) — апдейт не пройдёт
    // и повторная отправка следующим тиком исключена. Ручные пути (post_now, MCP,
    // предложка) публикуют из 'queued'/'editing' без claim — им guard не нужен.
    const postedUpdate = service.supabase
        .from('autopost_items')
        .update({
            status: 'posted',
            posted_at: new Date().toISOString(),
            posted_message_ids: messageIds || [],
            error_message: null
        })
        .eq('id', item.id);
    const { error: postedError } = await (claimed
        ? postedUpdate.eq('status', 'sending')
        : postedUpdate);
    if (postedError) console.error('[Autopost] mark posted failed:', postedError.message);

    // Лента событий чек-листа: агент читает историю (published) через state.
    // Ошибка записи non-fatal — список уже опубликован.
    if (isChecklist) {
        const { error: evError } = await service.supabase.from('autopost_checklist_events').insert({
            checklist_id: item.checklist_id,
            action: 'published',
            actor_source: actorSource === 'admin' ? 'admin' : 'agent'
        });
        if (evError) {
            log.error('checklist', 'published_event_failed', { botId: item.bot_id, checklistId: item.checklist_id, err: evError.message });
        }
        log.info('checklist', 'published', { botId: item.bot_id, checklistId: item.checklist_id, itemId: item.id, chatId: item.target_channel_id });
    }

    // create-post (MCP) читает messageIds для ответа; остальные вызовы
    // (scheduler, post_now, sug_post_now) возвращаемое значение игнорируют.
    return { messageIds: messageIds || [] };
}

/**
 * Применяет дельту реакций к посту по message_id.
 * Используется GIN-индексом posted_message_ids для O(1) lookup.
 * Возвращает обновлённый item id или null если пост не найден
 * (например, message_id не наш — пришёл для чужого сообщения).
 */
export async function applyReactionDelta(service, messageId, delta) {
    if (!delta) return null;

    const { data, error } = await service.supabase.rpc('autopost_apply_reaction_delta', {
        p_message_id: Number(messageId),
        p_delta: delta
    });

    if (error) {
        console.error('[Autopost] applyReactionDelta failed:', error.message);
        return null;
    }
    return data || null;
}
