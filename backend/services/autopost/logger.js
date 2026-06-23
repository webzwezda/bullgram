/**
 * Структурированный логгер для автопостера.
 * Эмитит одну строку JSON в stdout — удобно для grep/journalctl/loki.
 *
 * log.info('scheduler', 'post_published', { botId, itemId, channelId })
 *   → {"ts":"2026-06-23T12:00:00.000Z","level":"info","module":"scheduler","event":"post_published","botId":"…","itemId":"…"}
 *
 * Уровни: debug (по умолчанию подавляется, включить AUTOSTRUCT_LOG_LEVEL=debug),
 * info, warn, error.
 */

const LEVELS = ['debug', 'info', 'warn', 'error'];
const configuredLevel = String(process.env.AUTOPST_LOG_LEVEL || 'info').toLowerCase();
const minIndex = LEVELS.indexOf(configuredLevel === 'warning' ? 'warn' : configuredLevel);
const minLevelIdx = minIndex === -1 ? 1 : minIndex; // default to info

function emit(level, module, event, fields) {
    if (LEVELS.indexOf(level) < minLevelIdx) return;
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        module,
        event,
        ...fields
    });
    if (level === 'error') {
        process.stderr.write(line + '\n');
    } else {
        process.stdout.write(line + '\n');
    }
}

export const log = {
    debug: (module, event, fields = {}) => emit('debug', module, event, fields),
    info: (module, event, fields = {}) => emit('info', module, event, fields),
    warn: (module, event, fields = {}) => emit('warn', module, event, fields),
    error: (module, event, fields = {}) => emit('error', module, event, {
        ...(fields || {}),
        ...(fields?.err instanceof Error
            ? { err: fields.err.message, stack: fields.err.stack }
            : (fields?.err ? { err: String(fields.err) } : {}))
    })
};
