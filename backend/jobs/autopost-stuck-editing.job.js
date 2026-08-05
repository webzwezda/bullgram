/**
 * Cron-задача: восстанавливает посты, застрявшие в статусе `editing`.
 * Если админ начал "Изменить текст" и не завершил ввод (закрыл чат / отвлёкся),
 * планировщик не будет публиковать пост (status=editing им игнорируется).
 * Через 10 минут возвращаем запись обратно в `queued` и пересчитываем очередь.
 *
 * Batch-aware: один batch мог иметь несколько siblings в 'editing'. Сбрасываем
 * их вместе (по post_batch_id), processedBatches Set предотвращает дубль-запросы.
 */

const STUCK_THRESHOLD_MINUTES = 10;
const TICK_INTERVAL_MS = 60 * 1000;

export const startAutopostStuckEditingRecovery = (supabase, service) => {
    setInterval(async () => {
        try {
            const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();

            const { data: stuck, error } = await supabase
                .from('autopost_items')
                .select('id, bot_id, target_channel_id, post_batch_id')
                .eq('status', 'editing')
                .lt('updated_at', cutoff);

            if (error) {
                console.error('[Autopost stuck-editing] Ошибка запроса:', error.message);
            } else if (stuck && stuck.length > 0) {
                const processedBatches = new Set();
                for (const item of stuck) {
                    if (!item.post_batch_id) continue;
                    if (processedBatches.has(item.post_batch_id)) continue;
                    processedBatches.add(item.post_batch_id);

                    // Bug 10 fix + batch-aware: пропускаем если любой админ активно
                    // редактирует этот batch. Совпадение по batchId, не itemId.
                    const isBeingEdited = service?.adminStates
                        && Array.from(service.adminStates.values()).some(
                            s => s.action === 'edit_caption' && s.batchId === item.post_batch_id
                        );
                    if (isBeingEdited) continue;

                    // Сбрасываем ВСЕ застрявшие siblings этого batch (одним запросом).
                    const { data: siblings, error: sibErr } = await supabase
                        .from('autopost_items')
                        .select('id, target_channel_id, bot_id')
                        .eq('post_batch_id', item.post_batch_id)
                        .eq('status', 'editing')
                        .lt('updated_at', cutoff);
                    if (sibErr) {
                        console.error(`[Autopost stuck-editing] Ошибка выборки siblings batch ${item.post_batch_id}:`, sibErr.message);
                        continue;
                    }
                    const siblingIds = (siblings || []).map(s => s.id);
                    if (siblingIds.length === 0) continue;

                    const { error: updErr } = await supabase
                        .from('autopost_items')
                        .update({ status: 'queued', scheduled_at: null })
                        .in('id', siblingIds);

                    if (updErr) {
                        console.error(`[Autopost stuck-editing] Ошибка обновления batch ${item.post_batch_id}:`, updErr.message);
                        continue;
                    }

                    const affectedChannels = [...new Set((siblings || []).map(s => String(s.target_channel_id)))];
                    for (const cid of affectedChannels) {
                        if (service?.collapseQueue) {
                            try {
                                await service.collapseQueue(item.bot_id, cid);
                            } catch (e) {
                                console.error(`[Autopost stuck-editing] Ошибка collapseQueue для ${cid}:`, e.message);
                            }
                        }
                    }

                    console.log(`[Autopost stuck-editing] Batch ${item.post_batch_id}: ${siblingIds.length} items возвращены в очередь после ${STUCK_THRESHOLD_MINUTES} мин бездействия`);
                }
            }

            // Чистим протухшие guest sessions
            if (service?.pruneExpiredGuestSessions) {
                try {
                    await service.pruneExpiredGuestSessions();
                } catch (e) {
                    console.error('[Autopost stuck-editing] Ошибка чистки guest sessions:', e.message);
                }
            }

            // Чистим протухший album cache (> 1h)
            if (service?.pruneExpiredAlbumCache) {
                try {
                    await service.pruneExpiredAlbumCache();
                } catch (e) {
                    console.error('[Autopost stuck-editing] Ошибка чистки album cache:', e.message);
                }
            }
        } catch (err) {
            console.error('[Autopost stuck-editing] Ошибка cron:', err.message);
        }
    }, TICK_INTERVAL_MS);
};
