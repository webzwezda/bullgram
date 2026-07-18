/**
 * Сервис списков: создание + постинг в Telegram, toggle пунктов, синхронизация
 * при редактировании исходного сообщения.
 *
 * Главная задача — атомарность. Если bot.telegram.sendMessage падает, оставляем
 * строку в status='failed' с error_message для дебага/ретрая из UI. Не удаляем —
 * иначе orphan rows потеряются без следа.
 */

import { parseTextToItems } from './parser.js';
import { buildKeyboard } from './keyboard.js';

const MAX_ITEM_TEXT = 500;
const MAX_ERROR_MSG = 500;

function sortItems(items) {
    return [...(items || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
}

/**
 * Создаёт list + items в БД и отправляет inline keyboard в чат.
 * Бросает Error при провале — вызывающий код ловит и показывает юзеру.
 *
 * @param {Object} opts
 * @param {Object} opts.supabase
 * @param {string} opts.ownerId
 * @param {string} opts.botId
 * @param {Object} opts.bot — Telegraf instance
 * @param {number} opts.chatId
 * @param {string} [opts.rawText]
 * @param {string} [opts.source] — 'agent' | 'web' | 'telegram_dm' | 'telegram_reply' | 'telegram_mention' | 'telegram_command'
 * @param {string} [opts.title] override
 * @param {string[]} [opts.items] override
 * @param {number} [opts.sourceMessageId]
 * @param {number} [opts.replyToMessageId]
 */
export async function createAndPost({
    supabase, ownerId, botId, bot, chatId,
    rawText, source = 'agent',
    title: overrideTitle, items: overrideItems,
    sourceMessageId = null, replyToMessageId = null
}) {
    const { title, items } = overrideItems
        ? { title: overrideTitle || 'Чеклист', items: overrideItems }
        : parseTextToItems(rawText);

    if (!items.length) {
        throw new Error('Список пуст — нет пунктов');
    }

    // 1. Создаём list в статусе 'posting'
    const { data: list, error } = await supabase.from('checklist_lists').insert({
        bot_id: botId,
        owner_id: ownerId,
        chat_id: chatId,
        title,
        source,
        status: 'posting',
        source_message_id: sourceMessageId
    }).select().single();
    if (error) throw error;

    // 2. Вставляем items
    const itemRows = items.map((text, idx) => ({
        list_id: list.id,
        text: String(text).slice(0, MAX_ITEM_TEXT),
        position: idx
    }));
    const { data: insertedItems, error: itemsErr } = await supabase
        .from('checklist_items')
        .insert(itemRows)
        .select();
    if (itemsErr) {
        await markFailed(supabase, list.id, itemsErr.message);
        throw itemsErr;
    }
    list.items = sortItems(insertedItems || []);

    // 3. Отправляем в Telegram. reply_to_message_id может упасть если бот не админ
    //    или reply-сообщение удалено — ретраим без reply.
    const basePayload = {
        reply_markup: buildKeyboard(list)
    };
    let sent;
    try {
        sent = await bot.telegram.sendMessage(
            chatId,
            `📋 ${title}`,
            replyToMessageId
                ? { ...basePayload, reply_to_message_id: replyToMessageId }
                : basePayload
        );
    } catch (sendErr) {
        // Ретраим без reply_to_message_id
        if (replyToMessageId) {
            try {
                sent = await bot.telegram.sendMessage(chatId, `📋 ${title}`, basePayload);
            } catch (retryErr) {
                await markFailed(supabase, list.id, retryErr?.message || retryErr);
                throw retryErr;
            }
        } else {
            await markFailed(supabase, list.id, sendErr?.message || sendErr);
            throw sendErr;
        }
    }

    await supabase.from('checklist_lists')
        .update({ message_id: sent.message_id, status: 'posted' })
        .eq('id', list.id);

    return { ...list, message_id: sent.message_id, status: 'posted' };
}

async function markFailed(supabase, listId, errMsg) {
    await supabase.from('checklist_lists')
        .update({
            status: 'failed',
            error_message: String(errMsg || '').slice(0, MAX_ERROR_MSG)
        })
        .eq('id', listId);
}

/**
 * Переключает checked пункта по индексу. Возвращает обновлённый list или null
 * если list не найден/не в статусе posted.
 */
export async function toggleItem(supabase, listId, idx) {
    const { data: list } = await supabase.from('checklist_lists')
        .select('id, status')
        .eq('id', listId)
        .maybeSingle();
    if (!list || list.status !== 'posted') return null;

    const { data: items } = await supabase.from('checklist_items')
        .select('id, checked, position')
        .eq('list_id', listId)
        .order('position');
    const target = (items || [])[idx];
    if (!target) return null;

    const newChecked = !target.checked;
    await supabase.from('checklist_items')
        .update({ checked: newChecked })
        .eq('id', target.id);

    // Пересчитываем completed_at: если ВСЕ checked → ставим, иначе сбрасываем
    const updatedItems = items.map(i =>
        i.id === target.id ? { ...i, checked: newChecked } : i
    );
    const allChecked = updatedItems.every(i => i.checked);
    await supabase.from('checklist_lists')
        .update({ completed_at: allChecked ? new Date().toISOString() : null })
        .eq('id', listId);

    return reloadList(supabase, listId);
}

/**
 * Синхронизирует items при редактировании исходного сообщения.
 * Сохраняет checked-состояние пунктов что остались (по text-совпадению).
 * Возвращает обновлённый list или null если list не найден.
 */
export async function syncFromEditedText(supabase, { listId, rawText }) {
    const { title: newTitle, items: newTexts } = parseTextToItems(rawText);
    if (!newTexts.length) return null;

    const { data: list } = await supabase.from('checklist_lists')
        .select('id, message_id, title, status')
        .eq('id', listId)
        .maybeSingle();
    if (!list || list.status !== 'posted') return null;

    const { data: existingItems } = await supabase.from('checklist_items')
        .select('id, text, checked')
        .eq('list_id', listId);
    const existingByText = new Map(
        (existingItems || []).map(i => [i.text, i])
    );

    // Строим финальный список: существующие сохраняют id+checked, новые с checked=false
    const finalRows = newTexts.map((text, idx) => {
        const match = existingByText.get(text);
        return match
            ? { id: match.id, text, checked: match.checked, position: idx }
            : { text, checked: false, position: idx };
    });

    // Удаляем отсутствующие
    const finalIds = new Set(finalRows.filter(r => r.id).map(r => r.id));
    const toDelete = (existingItems || []).filter(i => !finalIds.has(i.id)).map(i => i.id);
    if (toDelete.length) {
        await supabase.from('checklist_items').delete().in('id', toDelete);
    }

    // Обновляем position у остающихся
    for (const row of finalRows.filter(r => r.id)) {
        await supabase.from('checklist_items')
            .update({ position: row.position })
            .eq('id', row.id);
    }

    // Вставляем новые
    const newRows = finalRows
        .filter(r => !r.id)
        .map(({ text, checked, position }) => ({
            list_id: listId, text, checked, position
        }));
    if (newRows.length) {
        await supabase.from('checklist_items').insert(newRows);
    }

    // Обновляем title если изменился
    if (newTitle && newTitle !== list.title) {
        await supabase.from('checklist_lists')
            .update({ title: newTitle })
            .eq('id', listId);
    }

    // Пересчитываем completed_at
    const { data: afterItems } = await supabase.from('checklist_items')
        .select('checked')
        .eq('list_id', listId);
    const allChecked = (afterItems || []).every(i => i.checked);
    await supabase.from('checklist_lists')
        .update({ completed_at: allChecked && (afterItems || []).length > 0 ? new Date().toISOString() : null })
        .eq('id', listId);

    return reloadList(supabase, listId);
}

export async function reloadList(supabase, listId) {
    const { data: full } = await supabase.from('checklist_lists')
        .select('*, checklist_items(*)')
        .eq('id', listId)
        .maybeSingle();
    if (!full) return null;
    full.items = sortItems(full.checklist_items || []);
    return full;
}

/**
 * Удаляет list по id если owner совпадает. Возвращает {deleted: true} или {deleted: false}.
 */
export async function deleteList(supabase, { listId, ownerId }) {
    const { data, error } = await supabase.from('checklist_lists')
        .delete()
        .eq('id', listId)
        .eq('owner_id', ownerId)
        .select('id')
        .maybeSingle();
    if (error) throw error;
    return { deleted: Boolean(data?.id) };
}
