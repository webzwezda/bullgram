/**
 * Cron-задача: ретеншен ленты событий чек-листов (autopost_checklist_events).
 *
 * Лента — память агента (кто/что/когда отмечал), но без TTL она растёт
 * бесконечно; итоги и атрибуция живут в autopost_checklist_items, поэтому
 * удаляются только старые события, состояние списков не страдает.
 *
 * Каденс: проверка раз в 6ч (для дневной ленты достаточно), первый прогон —
 * на старте процесса. Удаляем строки старше CHECKLIST_EVENTS_RETENTION_DAYS
 * (по умолчанию 90, минимум 7 — ниже порога откат к дефолту).
 * План: docs/plans/2026-09-17-autopost-checklists.md (Фаза 4).
 */
import { log } from '../services/autopost/logger.js';

const DEFAULT_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 7;
const TICK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const resolveRetentionDays = () => {
    const parsed = Number(process.env.CHECKLIST_EVENTS_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
    if (!Number.isFinite(parsed) || parsed < MIN_RETENTION_DAYS) return DEFAULT_RETENTION_DAYS;
    return Math.floor(parsed);
};

export const startAutopostChecklistEventsCleanup = (supabase) => {
    const retentionDays = resolveRetentionDays();

    const runCleanup = async () => {
        try {
            const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
            const { data, error } = await supabase
                .from('autopost_checklist_events')
                .delete()
                .lt('created_at', cutoff)
                .select('id');
            if (error) throw error;
            const removed = Array.isArray(data) ? data.length : 0;
            if (removed > 0) {
                log.info('checklist', 'events_retention_deleted', { removed, retentionDays });
            }
        } catch (err) {
            log.error('checklist', 'events_retention_failed', { err });
        }
    };

    console.log('[AutopostChecklistEventsCleanup] started', {
        interval_ms: TICK_INTERVAL_MS,
        retention_days: retentionDays
    });
    runCleanup();
    setInterval(runCleanup, TICK_INTERVAL_MS);
};
