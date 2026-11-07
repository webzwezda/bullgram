// Тесты фабрики логгера (docs/plans/2026-11-05-logging-research.md, фаза 1).
// Запуск: node test/test-logger.js — часть npm run test:logging.

import { Writable } from 'node:stream';
import assert from 'node:assert';
import {
    createLogger,
    safeErr,
    sanitizeConsoleArg,
    installConsoleShim
} from '../utils/logger.js';

function makeCapture() {
    const lines = [];
    const stream = new Writable({
        write(chunk, _enc, cb) {
            lines.push(chunk.toString());
            cb();
        }
    });
    return { lines, logger: createLogger({ destination: stream, level: 'debug' }) };
}

function lastJson(lines) {
    assert.ok(lines.length > 0, 'логгер ничего не записал');
    return JSON.parse(lines[lines.length - 1]);
}

let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
}

// --- 1. Формат строки: level-лейбл, time, msg, child-bindings ---
check('формат JSONL: level строкой, time, msg, child fields', () => {
    const { lines, logger } = makeCapture();
    const log = logger.child({ module: 'scheduler', runId: 'r-123' });
    log.info({ ok: 1 }, 'прогон завершён');
    const row = lastJson(lines);
    assert.strictEqual(row.level, 'info');
    assert.strictEqual(row.msg, 'прогон завершён');
    assert.strictEqual(row.module, 'scheduler');
    assert.strictEqual(row.runId, 'r-123');
    assert.strictEqual(row.ok, 1);
    assert.ok(typeof row.time === 'string' && !Number.isNaN(Date.parse(row.time)), 'time не ISO-строка');
});

// --- 2. safeErr не выпускает enumerable-пропсы ошибки ---
class FakeSocksClientError extends Error {
    constructor(options) {
        super('Proxy connection timed out');
        this.name = 'SocksClientError';
        this.code = 'ESOCKS';
        // Именно так устроен SocksClientError: options с userId/password — enumerable.
        this.options = options;
    }
}

check('safeErr: SocksClientError без .options (пароль прокси не утекает)', () => {
    const err = new FakeSocksClientError({ userId: 'mp_65', password: 'SUPERSECRET1' });
    const serialized = safeErr(err);
    const json = JSON.stringify(serialized);
    assert.ok(!json.includes('SUPERSECRET1'), 'пароль утёк в сериализацию');
    assert.ok(!('options' in serialized), 'options попал в сериализацию');
    assert.strictEqual(serialized.type, 'SocksClientError');
    assert.strictEqual(serialized.code, 'ESOCKS');
    assert.strictEqual(serialized.message, 'Proxy connection timed out');
});

check('логгер: err через сериализатор без пароля, stack ≤5 строк', () => {
    const { lines, logger } = makeCapture();
    const err = new FakeSocksClientError({ userId: 'mp_65', password: 'SUPERSECRET2' });
    logger.error({ err }, 'проверка не прошла');
    const raw = lines[lines.length - 1];
    assert.ok(!raw.includes('SUPERSECRET2'), 'пароль утёк в лог');
    const row = JSON.parse(raw);
    assert.strictEqual(row.err.type, 'SocksClientError');
    assert.ok(row.err.stack.split('\n').length <= 5, 'stack длиннее 5 строк');
});

// --- 3. redact известных ключей ---
check('redact: bot_token/password/session_data/phone цензурируются', () => {
    const { lines, logger } = makeCapture();
    logger.info({
        bot_token: 'SECRET_T',
        password: 'SECRET_P',
        session_data: 'SECRET_S',
        phone: '+79990001122',
        nested: { api_hash: 'SECRET_H' },
        note: 'обычное поле остаётся'
    }, 'проверка redact');
    const raw = lines[lines.length - 1];
    for (const secret of ['SECRET_T', 'SECRET_P', 'SECRET_S', '+79990001122', 'SECRET_H']) {
        assert.ok(!raw.includes(secret), `утёк ${secret}`);
    }
    const row = JSON.parse(raw);
    assert.strictEqual(row.bot_token, '[redacted]');
    assert.strictEqual(row.password, '[redacted]');
    assert.strictEqual(row.session_data, '[redacted]');
    assert.strictEqual(row.phone, '[redacted]');
    assert.strictEqual(row.nested.api_hash, '[redacted]');
    assert.strictEqual(row.note, 'обычное поле остаётся');
});

// --- 4. sanitizeConsoleArg ---
check('sanitizeConsoleArg: чувствительные ключи цензурируются на глубине', () => {
    const out = sanitizeConsoleArg({
        userbot_id: 'u1',
        proxy: { host: '1.2.3.4', port: 1080, username: 'mp_65', password: 'SUPERSECRET3' },
        tags: ['a', 'b']
    });
    const json = JSON.stringify(out);
    assert.ok(!json.includes('SUPERSECRET3'), 'пароль утёк');
    assert.strictEqual(out.proxy.password, '[redacted]');
    assert.strictEqual(out.proxy.host, '1.2.3.4');
    assert.strictEqual(out.userbot_id, 'u1');
    assert.deepStrictEqual(out.tags, ['a', 'b']);
});

check('sanitizeConsoleArg: Error → type/message/code, без stack/options', () => {
    const err = new FakeSocksClientError({ userId: 'mp_65', password: 'SUPERSECRET4' });
    const out = sanitizeConsoleArg(err);
    const json = JSON.stringify(out);
    assert.ok(!json.includes('SUPERSECRET4'), 'пароль утёк');
    assert.ok(!json.includes('at '), 'stack утёк');
    assert.strictEqual(out.errType, 'SocksClientError');
    assert.strictEqual(out.errMessage, 'Proxy connection timed out');
});

check('sanitizeConsoleArg: цикл и глубина безопасны', () => {
    const circular = { name: 'loop' };
    circular.self = circular;
    const out = sanitizeConsoleArg(circular);
    assert.ok(JSON.stringify(out).length < 500, 'цикл не оборвался');

    const deep = { a: { b: { c: { d: { e: 'too-deep' } } } } };
    const deepOut = sanitizeConsoleArg(deep);
    assert.strictEqual(deepOut.a.b.c.d, '[max-depth]');
});

// --- 5. installConsoleShim ---
check('shim: console.error → JSON с msg из строк и sanitized data', () => {
    const { lines, logger } = makeCapture();
    installConsoleShim(logger);
    console.error('[ShopGuard] Сняли лоты:', { owner_id: 'o1', reason: 'test' });
    const row = lastJson(lines);
    assert.strictEqual(row.level, 'error');
    assert.strictEqual(row.msg, '[ShopGuard] Сняли лоты:');
    assert.strictEqual(row.data.owner_id, 'o1');
    assert.strictEqual(row.data.reason, 'test');
});

check('shim: объект с паролем и Error в одном вызове не утекают', () => {
    const { lines, logger } = makeCapture();
    installConsoleShim(logger);
    console.error('[GramJS _errorHandler]', new FakeSocksClientError({ userId: 'mp_65', password: 'SUPERSECRET5' }));
    const raw = lines[lines.length - 1];
    assert.ok(!raw.includes('SUPERSECRET5'), 'пароль утёк через shim');
    assert.ok(!raw.includes('mp_65'), 'userId прокси утёк через shim');
    const row = JSON.parse(raw);
    assert.strictEqual(row.msg, '[GramJS _errorHandler]');
    assert.strictEqual(row.data.errType, 'SocksClientError');
});

check('shim: console.log/info-подобные вызовы без аргументов не падают', () => {
    const { lines, logger } = makeCapture();
    installConsoleShim(logger);
    console.log();
    console.warn('%d процентов', 50, { password: 'SUPERSECRET6' });
    const rows = lines.map((l) => JSON.parse(l));
    assert.strictEqual(rows[0].msg, 'console.log');
    assert.strictEqual(rows[1].level, 'warn');
    assert.strictEqual(rows[1].msg, '%d процентов 50');
    assert.strictEqual(rows[1].data.password, '[redacted]');
});

console.log(`\nВсего проверок: ${passed} — все зелёные.`);
