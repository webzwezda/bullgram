/**
 * Cron-задача: восстанавливает посты, застрявшие в статусе `editing`.
 * Если админ начал "Изменить текст" и не завершил ввод (закрыл чат / отвлёкся),
 * планировщик не будет публиковать пост (status=editing им игнорируется).
 * Через 10 минут возвращаем запись обратно в `queued` и пересчитываем очередь.
 */

const STUCK_THRESHOLD_MINUTES = 10;
const TICK_INTERVAL_MS = 60 * 1000;

export const startAutopostStuckEditingRecovery = (supabase, service) => {
    setInterval(async () => {
        try {
            const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();

            const { data: stuck, error } = await supabase
                .from('autopost_items')
                .select('id, bot_id, target_channel_id')
                .eq('status', 'editing')
                .lt('updated_at', cutoff);

            if (error) {
                console.error('[Autopost stuck-editing] Ошибка запроса:', error.message);
            } else if (stuck && stuck.length > 0) {
                for (const item of stuck) {
                    // Bug 10 fix: если админ сейчас активно редактирует этот пост
                    // (есть запись в adminStates), не возвращаем его в очередь —
                    // иначе длинная правка подписи молча потеряет текст.
                    const isBeingEdited = service?.adminStates
                        && Array.from(service.adminStates.values()).some(
                            s => s.action === 'edit_caption' && s.itemId === item.id
                        );
                    if (isBeingEdited) continue;

                    const { error: updErr } = await supabase
                        .from('autopost_items')
                        .update({ status: 'queued', scheduled_at: null })
                        .eq('id', item.id);

                    if (updErr) {
                        console.error(`[Autopost stuck-editing] Ошибка обновления ${item.id}:`, updErr.message);
                        continue;
                    }

                    if (item.target_channel_id && service?.collapseQueue) {
                        try {
                            await service.collapseQueue(item.bot_id, item.target_channel_id);
                        } catch (e) {
                            console.error(`[Autopost stuck-editing] Ошибка collapseQueue для ${item.id}:`, e.message);
                        }
                    }

                    console.log(`[Autopost stuck-editing] Пост ${item.id} возвращён в очередь после ${STUCK_THRESHOLD_MINUTES} мин бездействия`);
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
