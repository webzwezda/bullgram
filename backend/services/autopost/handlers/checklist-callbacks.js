/**
 * Тогглы пунктов чек-листа: callback_data `cli:<item_uuid>` на кнопках
 * опубликованного списка.
 *
 * Stateless — всё нужное несёт callback_data, истина в БД (план: ничего не хранить
 * в памяти процесса для интерактива). Единственное исключение — UX-дебаунс
 * double-tap (1.5с, ephemeral): спам-кнопка в публичном канале не должна
 * штамповать события. Один тоггл = один RPC (advisory-лок внутри plpgsql закрывает
 * lost-update при параллельных кликах), затем перерисовка всех опубликованных
 * копий best-effort. Любой throw в хендлере гасится — процесс бота не падает.
 */
import { log } from '../logger.js';
import { computeChecklistStatus, parseCallbackData } from '../checklist.js';

const TOGGLE_DEBOUNCE_MS = 1500;
const DEBOUNCE_PRUNE_SIZE = 500;

async function safeAnswer(ctx, text) {
    try {
        await ctx.answerCbQuery(text);
    } catch (e) {
        // Сообщение/кнопка могли исчезнуть — ответ на callback не критичен.
    }
}

export function registerChecklistCallbacksHandler(bot, service, botId) {
    const supabase = service.supabase;
    const toggleDebounce = new Map(); // `${tgUserId}:${itemId}` → last tap ts

    bot.action(/cli:(.+)/, async (ctx) => {
        try {
            const itemId = parseCallbackData(`cli:${ctx.match[1]}`);
            if (!itemId) return safeAnswer(ctx, 'Список больше не доступен');

            const now = Date.now();
            const debounceKey = `${ctx.from?.id}:${itemId}`;
            if (now - (toggleDebounce.get(debounceKey) || 0) < TOGGLE_DEBOUNCE_MS) {
                return safeAnswer(ctx, '⏳');
            }
            toggleDebounce.set(debounceKey, now);
            if (toggleDebounce.size > DEBOUNCE_PRUNE_SIZE) {
                for (const [k, ts] of toggleDebounce) {
                    if (now - ts > 10000) toggleDebounce.delete(k);
                }
            }

            const { data: item } = await supabase
                .from('autopost_checklist_items')
                .select('*')
                .eq('id', itemId)
                .maybeSingle();
            if (!item) return safeAnswer(ctx, 'Список больше не доступен');

            const { data: checklist } = await supabase
                .from('autopost_checklists')
                .select('*')
                .eq('id', item.checklist_id)
                .eq('bot_id', botId)
                .maybeSingle();
            if (!checklist) return safeAnswer(ctx, 'Список больше не доступен');
            if (checklist.cancelled_at) return safeAnswer(ctx, 'Список закрыт');
            if (computeChecklistStatus(checklist) === 'expired') return safeAnswer(ctx, 'Список истёк');

            // Человекочитаемый тост: список должен быть опубликован именно в этот чат.
            // Серверные проверки отмены/истечения живут внутри RPC — здесь только UX.
            const { data: postedRows, error: postedRowsError } = await supabase
                .from('autopost_items')
                .select('id, posted_message_ids')
                .eq('checklist_id', checklist.id)
                .eq('target_channel_id', String(ctx.chat?.id ?? ''))
                .eq('status', 'posted');
            if (postedRowsError) {
                log.warn('checklist', 'posted_rows_lookup_failed', { botId, checklistId: checklist.id, err: postedRowsError.message });
                return safeAnswer(ctx, 'Не получилось, попробуй ещё раз');
            }
            const hasPostedCopy = (postedRows || []).some(
                (r) => Array.isArray(r.posted_message_ids) && r.posted_message_ids.length > 0
            );
            if (!hasPostedCopy) return safeAnswer(ctx, 'Список ещё не опубликован');

            const actorName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ')
                || ctx.from?.username || '';
            const { data, error } = await supabase.rpc('autopost_toggle_checklist_item', {
                p_item_id: itemId,
                p_actor_tg_id: ctx.from?.id,
                p_actor_name: actorName,
                p_chat_id: ctx.chat?.id ?? null
            });
            if (error) {
                log.error('checklist', 'toggle_rpc_failed', { botId, itemId, err: error.message });
                return safeAnswer(ctx, 'Не получилось, попробуй ещё раз');
            }
            if (data?.reason === 'not_found') return safeAnswer(ctx, 'Список больше не доступен');
            if (data?.reason === 'cancelled') return safeAnswer(ctx, 'Список закрыт');
            if (data?.reason === 'expired') return safeAnswer(ctx, 'Список истёк');

            if (data?.ok) {
                log.info('checklist', 'toggled', {
                    botId,
                    checklistId: item.checklist_id,
                    itemId,
                    action: data.action,
                    chatId: ctx.chat?.id ?? null,
                    actorName
                });
                try {
                    await service.rerenderChecklistPost(ctx.telegram, botId, item.checklist_id);
                } catch (e) {
                    // Тоггл уже записан в БД — упавшая перерисовка не отменяет отметку.
                    log.warn('checklist', 'rerender_failed', { botId, checklistId: item.checklist_id, err: e.message });
                }
                return safeAnswer(ctx, data.action === 'checked' ? `✅ Отмечено — ${actorName || '—'}` : '↩️ Вернул в список');
            }

            log.error('checklist', 'toggle_unexpected_result', { botId, itemId, result: data ?? null });
            return safeAnswer(ctx, 'Не получилось, попробуй ещё раз');
        } catch (err) {
            log.error('checklist', 'callback_failed', { botId, err: err.message });
            try { await ctx.answerCbQuery('Не получилось, попробуй ещё раз'); } catch (e) {}
        }
    });
}
