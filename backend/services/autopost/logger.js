/**
 * Структурированный логгер автопостера — обёртка над общей фабрикой
 * backend/utils/logger.js (pino, JSONL). План: docs/plans/2026-11-05-logging-research.md.
 *
 * API прежний: log.info('scheduler', 'post_published', { botId, itemId })
 *   → {"level":"info","time":"…","module":"scheduler","event":"post_published","msg":"post_published","botId":"…"}
 *
 * Отличие от старого формата: поле времени `time` вместо `ts`, уровень —
 * строка-лейбл (число раньше), err сериализуется в {type,message,code,stack≤5}.
 *
 * Уровень: LOG_LEVEL (общий), легаси-фолбэк AUTOPST_LOG_LEVEL. debug по умолчанию
 * подавлен.
 */

import { createLogger } from '../../utils/logger.js';

const legacyLevel = String(process.env.AUTOPST_LOG_LEVEL || '').trim().toLowerCase();

const logger = createLogger({
    level: legacyLevel || undefined
});

function emit(level, module, event, fields) {
    const payload = { module, event, ...(fields || {}) };
    logger[level](payload, event);
}

export const log = {
    debug: (module, event, fields = {}) => emit('debug', module, event, fields),
    info: (module, event, fields = {}) => emit('info', module, event, fields),
    warn: (module, event, fields = {}) => emit('warn', module, event, fields),
    error: (module, event, fields = {}) => emit('error', module, event, fields)
};
