// Чек-листы автопостера: I/O-методы сервиса (state, правки, отмена, рендер).
// Выделено из autopost.service.js при разрезке под pre-commit лимит: методы
// класса AutopostService стали однострочными делегатами, инстанс сервиса
// передаётся первым аргументом (service). Чистые функции — в checklist.js,
// Telegram-клиент приходит аргументом в render-методы.
import { buildChecklistMessage, applyChecklistOps, computeChecklistStatus } from './checklist.js';
import { getFloodWaitSeconds } from './sender.js';
import { log } from './logger.js';

// Каждая загрузка чек-листа — строго по паре (id, bot_id): чужой checklist_id
// под своим ботом — штатный NOT_FOUND (план: защита от IDOR).

export async function loadChecklistScoped(service, botId, checklistId) {
    const { data, error } = await service.supabase
        .from('autopost_checklists')
        .select('*')
        .eq('id', checklistId)
        .eq('bot_id', botId)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

export async function loadChecklistItems(service, checklistId) {
    const { data, error } = await service.supabase
        .from('autopost_checklist_items')
        .select('*')
        .eq('checklist_id', checklistId)
        .order('position', { ascending: true });
    if (error) throw error;
    return data || [];
}

export async function getChecklistState(service, botId, checklistId, { includeEvents = false, eventsLimit = 20 } = {}) {
    const checklist = await service.loadChecklistScoped(botId, checklistId);
    if (!checklist) throw new Error('NOT_FOUND');
    const status = computeChecklistStatus(checklist);
    const state = {
        checklist: { ...checklist, status },
        items: await service.loadChecklistItems(checklistId)
    };
    if (includeEvents) {
        const { data, error } = await service.supabase
            .from('autopost_checklist_events')
            .select('*')
            .eq('checklist_id', checklistId)
            .order('created_at', { ascending: false })
            .limit(Math.min(Math.max(1, Number(eventsLimit) || 20), 100));
        if (error) throw error;
        state.events = data || [];
    }
    // Ленивое истечение (TTL, решение плана — без отдельной джобы): списку с
    // прошедшим expires_at снимаем клавиатуры при чтении state. Один заход на
    // чтение — removeChecklistKeyboards сам state не читает, рекурсии нет.
    // Best-effort: бот офлайн — тихий log.debug; ошибка Telegram/БД — log.debug
    // (перерисовки внутри уже non-fatal, истина в БД).
    if (status === 'expired') {
        const telegram = service.getBot(botId)?.telegram;
        if (!telegram) {
            log.debug('checklist', 'lazy_expiry_skip_no_bot', { botId, checklistId });
        } else {
            try {
                await service.removeChecklistKeyboards(telegram, botId, checklistId);
                log.info('checklist', 'lazy_expiry_keyboards_removed', { botId, checklistId });
            } catch (e) {
                log.debug('checklist', 'lazy_expiry_keyboard_remove_failed', { botId, checklistId, err: e.message });
            }
        }
    }
    return state;
}

/**
 * Список чек-листов бота. Статус вычисляемый — фильтр применяется в коде
 * после fetch (масштаб мелкий, индекс (owner_id, created_at desc) покрывает).
 * Курсор = created_at ISO; строки с тем же created_at, что у курсора,
 * пропускаются — для этого масштаба приемлемо. Старые курсоры вида
 * `created_at|id` читаются: парсер берёт только половину до '|'.
 */
export async function listChecklists(service, botId, { status, createdAfter, limit = 20, cursor } = {}) {
    const cappedLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
    let query = service.supabase
        .from('autopost_checklists')
        .select('*')
        .eq('bot_id', botId)
        .order('created_at', { ascending: false });
    if (createdAfter) query = query.gte('created_at', new Date(createdAfter).toISOString());
    if (cursor) {
        const [createdAtIso] = String(cursor).split('|');
        if (createdAtIso) query = query.lt('created_at', createdAtIso);
    }
    const { data, error } = await query.limit(cappedLimit);
    if (error) throw error;
    const rows = data || [];
    const items = rows
        .map((row) => ({ ...row, status: computeChecklistStatus(row) }))
        .filter((row) => !status || row.status === status);
    const last = rows[rows.length - 1];
    return {
        items,
        nextCursor: rows.length === cappedLimit && last ? last.created_at : null
    };
}

/**
 * Правки опубликованного списка: add/rename/remove/reset. Отметки переживают
 * rename (перенос по item_id — семантика в applyChecklistOps, чистой функции).
 * После записи — перерисовка всех posted-копий; отменённый список править нельзя
 * (его клавиатуры уже сняты — перерисовка вернула бы их).
 * Кап общего числа: существующие пункты + добавляемые ≤ 25 (TOO_MANY_ITEMS).
 */
export async function updateChecklist(service, botId, checklistId, { add, rename, remove, reset, agentNote } = {}, actor = {}) {
    const checklist = await service.loadChecklistScoped(botId, checklistId);
    if (!checklist) throw new Error('NOT_FOUND');
    if (checklist.cancelled_at) throw new Error('CHECKLIST_CANCELLED');

    const items = await service.loadChecklistItems(checklistId);
    // Кап после add — здесь, ПОСЛЕ NOT_FOUND-проверки по паре (id, bot_id):
    // pre-load в вызывающих читал бы потенциально чужие строки до scope-гейта.
    if (items.length + (Array.isArray(add) ? add.length : 0) > 25) {
        throw new Error('TOO_MANY_ITEMS');
    }
    // Приватная заметка агента: семантика «ключ пришёл» (typeof), а не
    // «значение truthy» — иначе пустой строкой нельзя было бы очистить.
    // '' → null (очистить), непустая строка → перезаписать.
    if (typeof agentNote !== 'undefined') {
        const { error } = await service.supabase
            .from('autopost_checklists')
            .update({ agent_note: agentNote === '' ? null : agentNote })
            .eq('id', checklistId)
            .eq('bot_id', botId);
        if (error) throw error;
    }
    const { items: nextItems, events } = applyChecklistOps(items, { add, rename, remove, reset });
    const originalIds = new Set(items.map((it) => String(it.id)));

    if (reset === true) {
        const { error } = await service.supabase
            .from('autopost_checklist_items')
            .update({ is_checked: false, checked_by_tg_id: null, checked_by_name: null, checked_at: null })
            .eq('checklist_id', checklistId)
            .eq('is_checked', true);
        if (error) throw error;
    }

    for (const r of Array.isArray(rename) ? rename : []) {
        const { error } = await service.supabase
            .from('autopost_checklist_items')
            .update({ text: String(r?.text ?? '').trim() })
            .eq('id', r?.item_id)
            .eq('checklist_id', checklistId);
        if (error) throw error;
    }

    for (const rawId of Array.isArray(remove) ? remove : []) {
        const { error } = await service.supabase
            .from('autopost_checklist_items')
            .delete()
            .eq('id', rawId)
            .eq('checklist_id', checklistId);
        if (error) throw error;
    }

    const addedRows = nextItems.filter((it) => !originalIds.has(String(it.id)));
    if (addedRows.length > 0) {
        const { error } = await service.supabase.from('autopost_checklist_items').insert(
            addedRows.map((it) => ({
                id: it.id,
                checklist_id: checklistId,
                bot_id: checklist.bot_id,
                text: it.text,
                position: it.position
            }))
        );
        if (error) throw error;
    }

    if (events.length > 0) {
        const { error } = await service.supabase.from('autopost_checklist_events').insert(
            events.map((ev) => ({
                checklist_id: checklistId,
                item_id: ev.item_id,
                action: ev.action,
                actor_source: actor?.source || 'agent',
                actor_tg_id: actor?.tgId ?? null,
                actor_name: actor?.name ?? null
            }))
        );
        if (error) throw error;
    }

    const bot = service.getBot(botId);
    if (bot?.telegram) {
        await service.rerenderChecklistPost(bot.telegram, botId, checklistId);
    } else {
        log.warn('checklist', 'rerender_skip_no_bot', { botId, checklistId });
    }

    return service.getChecklistState(botId, checklistId);
}

/**
 * Отмена списка: queued/scheduled-строки очереди удаляются (семантика del_post),
 * posted остаются в Telegram, но клавиатуры снимаются — тапы по закрытому
 * списку должны умереть. Статус 'cancelled' у items сознательно не вводим
 * (решение 9: scheduler/статистика ждут фиксированный набор статусов).
 */
export async function cancelChecklist(service, botId, checklistId, actor = {}) {
    const checklist = await service.loadChecklistScoped(botId, checklistId);
    if (!checklist) throw new Error('NOT_FOUND');
    // Идемпотентность: повторный cancel (двойной тап, гонка колбэков) просто
    // возвращает состояние — без второго события и без правок клавиатур.
    if (checklist.cancelled_at) return service.getChecklistState(botId, checklistId);

    const { data: queuedRows } = await service.supabase
        .from('autopost_items')
        .select('target_channel_id')
        .eq('checklist_id', checklistId)
        .in('status', ['queued', 'scheduled']);
    const { error: delError } = await service.supabase
        .from('autopost_items')
        .delete()
        .eq('checklist_id', checklistId)
        .in('status', ['queued', 'scheduled']);
    if (delError) throw delError;

    const { error: updError } = await service.supabase
        .from('autopost_checklists')
        .update({ cancelled_at: new Date().toISOString() })
        .eq('id', checklistId)
        .eq('bot_id', botId);
    if (updError) throw updError;

    const { error: evError } = await service.supabase.from('autopost_checklist_events').insert({
        checklist_id: checklistId,
        action: 'cancelled',
        actor_source: actor?.source || 'agent',
        actor_tg_id: actor?.tgId ?? null,
        actor_name: actor?.name ?? null
    });
    if (evError) throw evError;

    log.info('checklist', 'cancelled', {
        botId,
        checklistId,
        queuedRemoved: queuedRows?.length || 0,
        actorSource: actor?.source || 'agent'
    });

    const affectedChannels = [...new Set((queuedRows || []).map((r) => String(r.target_channel_id)))];
    for (const cid of affectedChannels) {
        await service.collapseQueue(botId, cid);
    }

    const bot = service.getBot(botId);
    if (bot?.telegram) {
        await service.removeChecklistKeyboards(bot.telegram, botId, checklistId);
    } else {
        log.warn('checklist', 'cancel_keyboard_skip_no_bot', { botId, checklistId });
    }

    return service.getChecklistState(botId, checklistId);
}

/**
 * Per-chat lookup видимости канала: в публичных каналах имена из кнопок
 * убираем — кнопки видны всему интернету через t.me/s/ (решение 11).
 * Ошибка lookup'а или отсутствие строки канала → имена прячем
 * (fail-closed: приватность важнее атрибуции).
 */
export async function resolveChecklistShowNames(service, botId, targetChannelId) {
    try {
        const { data, error } = await service.supabase
            .from('channels')
            .select('visibility')
            .eq('tg_chat_id', String(targetChannelId))
            .eq('autopost_bot_id', botId)
            .maybeSingle();
        if (error) throw error;
        if (!data) return false;
        return data.visibility !== 'public';
    } catch (e) {
        log.warn('checklist', 'visibility_lookup_failed', { botId, targetChannelId, err: e.message });
        return false;
    }
}

export async function loadChecklistRenderContext(service, botId, checklistId) {
    const checklist = await service.loadChecklistScoped(botId, checklistId);
    if (!checklist) return null;
    const { data: postedRows, error } = await service.supabase
        .from('autopost_items')
        .select('id, target_channel_id, posted_message_ids')
        .eq('checklist_id', checklistId)
        .eq('bot_id', botId)
        .eq('status', 'posted');
    if (error) throw error;
    return { checklist, items: await service.loadChecklistItems(checklistId), postedRows: postedRows || [] };
}

/**
 * Перерисовывает ВСЕ опубликованные копии чек-листа: свежий текст с прогрессом
 * + клавиатура. Per-chat ошибки non-fatal — истина в БД, клавиатура догонит
 * следующим тогглом. Один FLOOD_WAIT-ретай по retry_after (паттерн sender.js).
 */
export async function rerenderChecklistPost(service, telegramClient, botId, checklistId) {
    const context = await service.loadChecklistRenderContext(botId, checklistId);
    if (!context) return;
    const { checklist, items, postedRows } = context;
    if (checklist.cancelled_at) {
        // Отменённый список клавиатуру не возвращает.
        return service.removeChecklistKeyboards(telegramClient, botId, checklistId);
    }
    const showNamesByChat = new Map();
    for (const row of postedRows) {
        const messageIds = Array.isArray(row.posted_message_ids) ? row.posted_message_ids : [];
        if (messageIds.length === 0) continue;
        if (!showNamesByChat.has(row.target_channel_id)) {
            showNamesByChat.set(row.target_channel_id, await service.resolveChecklistShowNames(botId, row.target_channel_id));
        }
        const { text, replyMarkup } = buildChecklistMessage(checklist, items, {
            showNames: showNamesByChat.get(row.target_channel_id)
        });
        for (const messageId of messageIds) {
            await service.applyEditWithFloodRetry(telegramClient, () =>
                telegramClient.editMessageText(row.target_channel_id, messageId, undefined, text, { reply_markup: replyMarkup })
            , { botId, checklistId, chatId: row.target_channel_id, messageId, op: 'rerender' });
        }
    }
}

/** Снятие клавиатур у опубликованных копий (cancel): текст остаётся, кнопки умирают. */
export async function removeChecklistKeyboards(service, telegramClient, botId, checklistId) {
    const context = await service.loadChecklistRenderContext(botId, checklistId);
    if (!context) return;
    for (const row of context.postedRows) {
        const messageIds = Array.isArray(row.posted_message_ids) ? row.posted_message_ids : [];
        for (const messageId of messageIds) {
            await service.applyEditWithFloodRetry(telegramClient, () =>
                telegramClient.editMessageReplyMarkup(row.target_channel_id, messageId)
            , { botId, checklistId, chatId: row.target_channel_id, messageId, op: 'keyboard_remove' });
        }
    }
}

export async function applyEditWithFloodRetry(service, telegramClient, editFn, meta) {
    try {
        await editFn();
    } catch (err) {
        const wait = getFloodWaitSeconds(err);
        if (wait <= 0) {
            log.warn('checklist', 'render_failed', { ...meta, err: err.message });
            return;
        }
        // спим в хендлере бота: долгий FLOOD_WAIT заморозил бы все апдейты
        // инстанса; истина в БД — клавиатура догонит следующим тогглом
        const capped = Math.min(wait, 10);
        await new Promise((resolve) => setTimeout(resolve, capped * 1000));
        try {
            await editFn();
        } catch (retryErr) {
            log.warn('checklist', 'render_failed_after_flood_retry', { ...meta, waitSeconds: capped, err: retryErr.message });
        }
    }
}
