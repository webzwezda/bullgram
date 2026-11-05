/**
 * Единая фабрика логгера (pino). План: docs/plans/2026-11-05-logging-research.md.
 *
 * Формат: JSONL в stdout/stderr — {"level":"info","time":"…","module":…,"msg":"…", …fields}.
 * PM2 пишет stdout в logs/app.out.jsonl (без log_date_format — иначе префикс ломает JSONL).
 * Чтение: tail -f logs/app.out.jsonl | jq 'select(.level=="error")'.
 *
 * Уровни: error — провал с потерей функции/данных; warn — деградация с
 * самовосстановлением; info — бизнес-факты (успешные HTTP не пишем — pino-http
 * customLogLevel); debug — только при LOG_LEVEL=debug.
 *
 * Секреты: pino redact режет известные ключи на наших вызовах; safeErr не
 * выпускает enumerable-пропсы ошибок (там жили пароли прокси — SocksClientError
 * .options); installConsoleShim санитизирует всё, что продолжает писать через
 * console.* (604 вызова мигрируются поэтапно — BACKLOG §28, фаза 3).
 */

import { pino } from 'pino';

// Ключи, значение которых никогда не должно попасть в лог.
const SENSITIVE_KEY_RE = /(passw|pwd|secret|token|session|authorization|auth_key|api_hash|mnemonic|seed|cookie|private_key|bearer)/i;

const MAX_CONSOLE_DEPTH = 4;
const MAX_STRING_LENGTH = 500;

/**
 * Сериализатор err: только безопасные поля. НЕ pino.stdSerializers.err — тот
 * добавляет enumerable-пропсы ошибки, а SocksClientError хранит в .options
 * userId/password прокси (инцидент 2026-11-04, error.log).
 */
export function safeErr(err) {
    if (!err) return err;
    if (!(err instanceof Error)) return err;
    return {
        type: err.name || 'Error',
        message: String(err.message ?? '').slice(0, MAX_STRING_LENGTH),
        code: err.code ?? null,
        stack: typeof err.stack === 'string'
            ? err.stack.split('\n').slice(0, 5).join('\n')
            : null
    };
}

/**
 * Санитизация одного аргумента console.* для shim: строки проходят как есть,
 * ошибки сводятся к type/message/code (без stack/cause/options), объекты —
 * копия в глубину до 4 с цензурой чувствительных ключей. Циклы и огромные
 * структуры безопасны: глубина и ширина ограничены.
 */
export function sanitizeConsoleArg(arg, depth = 0) {
    if (arg === undefined) return null;
    if (arg === null) return null;
    const type = typeof arg;
    if (type === 'string') return arg;
    if (type === 'number' || type === 'boolean') return arg;
    if (type === 'bigint') return String(arg);
    if (type === 'symbol' || type === 'function') return `[${type}]`;
    if (arg instanceof Error || (typeof arg.message === 'string' && typeof arg.stack === 'string')) {
        // Намеренно без stack: стеки GramJS огромные и содержат локальные пути.
        return {
            errType: arg.name || 'Error',
            errMessage: String(arg.message ?? '').slice(0, MAX_STRING_LENGTH),
            errCode: arg.code ?? null
        };
    }
    if (depth >= MAX_CONSOLE_DEPTH) return '[max-depth]';
    if (Array.isArray(arg)) {
        return arg.slice(0, 20).map((item) => sanitizeConsoleArg(item, depth + 1));
    }
    if (type === 'object') {
        const out = {};
        for (const [key, value] of Object.entries(arg).slice(0, 30)) {
            out[key] = SENSITIVE_KEY_RE.test(key)
                ? '[redacted]'
                : sanitizeConsoleArg(value, depth + 1);
        }
        return out;
    }
    return String(arg);
}

/**
 * Заменяет console.log/warn/error на JSON-записи через pino. Ставится ТОЛЬКО в
 * entry-точке (backend/server.js) — тесты импортируют модули напрямую и должны
 * видеть чистый console (canary test-lifecycle-dm.js).
 *
 * Строковые аргументы склеиваются в msg (теги вида "[ShopGuard] …" остаются
 * greppable), остальные — санитизируются в поле data. console.info не
 * трогаем — он в коде не используется.
 */
export function installConsoleShim(log = logger) {
    const emit = (level, fallbackEvent, args) => {
        const strings = [];
        const objects = [];
        for (const arg of args) {
            const type = typeof arg;
            if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
                strings.push(String(arg));
            } else {
                objects.push(sanitizeConsoleArg(arg));
            }
        }
        const msg = strings.join(' ') || fallbackEvent;
        if (objects.length === 1) log[level]({ data: objects[0] }, msg);
        else if (objects.length > 1) log[level]({ data: objects }, msg);
        else log[level](msg);
    };

    console.log = (...args) => emit('info', 'console.log', args);
    console.warn = (...args) => emit('warn', 'console.warn', args);
    console.error = (...args) => emit('error', 'console.error', args);
}

export function createLogger({ level, destination } = {}) {
    return pino({
        level: String(level || process.env.LOG_LEVEL || 'info').trim().toLowerCase(),
        timestamp: pino.stdTimeFunctions.isoTime,
        // level строкой-лейблом, а не числом: jq 'select(.level=="error")'
        formatters: { level: (label) => ({ level: label }) },
        serializers: { err: safeErr },
        redact: {
            paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'authorization', '*.authorization',
                'cookie', '*.cookie',
                'token', '*.token',
                'bot_token', '*.bot_token',
                'session', '*.session',
                'session_data', '*.session_data',
                'password', '*.password',
                'proxy_password', '*.proxy_password',
                'api_hash', '*.api_hash',
                'mnemonic', '*.mnemonic',
                'seed_phrase', '*.seed_phrase',
                'ton_seed', '*.ton_seed',
                'phone', '*.phone',
                'tg_phone', '*.tg_phone',
                'email', '*.email'
            ],
            censor: '[redacted]'
        }
    }, destination);
}

export const logger = createLogger();
