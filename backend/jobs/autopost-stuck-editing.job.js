/**
 * Cron-задача: восстанавливает посты, застрявшие в статусе `editing`.
 * Если админ начал "Изменить текст" и не завершил ввод (закрыл чат / отвлёкся),
 * планировщик не будет публиковать пост (status=editing им игнорируется).
 * Через 10 минут возвращаем запись обратно в `queued` и пересчитываем очередь.
 *
 * Также восстанавливает посты, зависшие в `sending`: scheduler claim'ит item
 * перед отправкой, и если процесс умер между claim и финальным апдейтом
 * (краш / pm2 reload), item остаётся в 'sending'. Через 10 минут лизинг
 * протухает — запись возвращается в `queued` и пересчитывается очередь.
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
                        .in('id', siblingIds)
                        .eq('status', 'editing');

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

            // Recovery зависших 'sending' (код-ревью P1, claim/lease): scheduler
            // claim'ит item условным UPDATE в 'sending' перед отправкой. Если процесс
            // умер (краш/pm2 reload) между claim и финальным апдейтом, item навсегда
            // зависает в 'sending' — scheduler его больше не видит. Через 10 минут
            // (lease считается по updated_at, который бампит триггер set_updated_at
            // при claim) возвращаем в 'queued' с scheduled_at = now. Guard
            // .eq('status','sending') в UPDATE закрывает TOCTOU с финальным апдейтом.
            const { data: stuckSending, error: sendingErr } = await supabase
                .from('autopost_items')
                .select('id, bot_id, target_channel_id')
                .eq('status', 'sending')
                .lt('updated_at', cutoff);

            if (sendingErr) {
                console.error('[Autopost stuck-editing] Ошибка запроса sending:', sendingErr.message);
            } else if (stuckSending && stuckSending.length > 0) {
                const sendingIds = stuckSending.map(s => s.id);
                const { error: sendingUpdErr } = await supabase
                    .from('autopost_items')
                    .update({ status: 'queued', scheduled_at: new Date().toISOString() })
                    .in('id', sendingIds)
                    .eq('status', 'sending');

                if (sendingUpdErr) {
                    console.error('[Autopost stuck-editing] Ошибка восстановления sending:', sendingUpdErr.message);
                } else {
                    // collapseQueue требует СВОЙ bot_id для каждой пары (бот, канал):
                    // один тик может поднять зависшие items разных ботов — чужой bot_id
                    // схлопнул бы очередь не того бота
                    const botChannelPairs = [...new Set(stuckSending.map(s => `${s.bot_id}|${s.target_channel_id}`))];
                    for (const pair of botChannelPairs) {
                        const [botId, cid] = pair.split('|');
                        if (service?.collapseQueue) {
                            try {
                                await service.collapseQueue(botId, cid);
                            } catch (e) {
                                console.error(`[Autopost stuck-editing] Ошибка collapseQueue для ${cid}:`, e.message);
                            }
                        }
                    }
                    console.log(`[Autopost stuck-editing] ${sendingIds.length} items восстановлены из 'sending' после ${STUCK_THRESHOLD_MINUTES} мин лизинга`);
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
