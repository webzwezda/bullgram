/**
 * Обёртка прогонов cron-джоб (фаза 2 логирования, план:
 * docs/plans/2026-11-05-logging-research.md): единый runId, длительность и
 * outcome для каждого тика setInterval.
 *
 * Политика шума: 'job started' и быстрый 'job finished' — debug (в проде
 * не пишется), медленный прогон (>= slowMs, по умолчанию 30с) — info,
 * падение — error всегда. Предметные счётчики джобы логируют сами.
 *
 * Использование: setInterval(wrapJobTick('job-name', run), intervalMs).
 * Ошибки наружу не пробрасываются — setInterval-тику нечему их отдать.
 */

import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';

export const SLOW_JOB_LOG_MS = 30_000;

export function wrapJobTick(jobName, tick, { log = logger, slowMs = SLOW_JOB_LOG_MS } = {}) {
    const jobLog = log.child({ job: jobName });
    return async () => {
        const runId = randomUUID();
        const startedAt = performance.now();
        jobLog.debug({ runId }, 'job started');
        try {
            await tick();
            const durationMs = Math.round(performance.now() - startedAt);
            if (durationMs >= slowMs) {
                jobLog.info({ runId, durationMs }, 'job finished (slow)');
            } else {
                jobLog.debug({ runId, durationMs }, 'job finished');
            }
        } catch (error) {
            jobLog.error(
                { runId, durationMs: Math.round(performance.now() - startedAt), err: error },
                'job failed'
            );
        }
    };
}
