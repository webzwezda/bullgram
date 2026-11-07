// Тесты обёртки прогонов cron-джоб (фаза 2 логирования).
// Запуск: node test/test-job-runner.js — часть npm run test:jobs.

import { Writable } from 'node:stream';
import assert from 'node:assert';
import { createLogger } from '../utils/logger.js';
import { wrapJobTick, SLOW_JOB_LOG_MS } from '../utils/job-runner.js';

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

function rows(lines) {
    return lines.map((l) => JSON.parse(l));
}

let passed = 0;
async function check(name, fn) {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
}

await check('успешный быстрый тик: started/finished в debug, runId и job в полях', async () => {
    const { lines, logger } = makeCapture();
    const tick = wrapJobTick('health-check', async () => {}, { log: logger });
    await tick();
    const all = rows(lines);
    assert.strictEqual(all.length, 2);
    assert.strictEqual(all[0].level, 'debug');
    assert.strictEqual(all[0].job, 'health-check');
    assert.strictEqual(all[0].msg, 'job started');
    assert.ok(all[0].runId, 'нет runId у started');
    assert.strictEqual(all[1].msg, 'job finished');
    assert.strictEqual(all[1].runId, all[0].runId, 'runId не совпадает');
    assert.strictEqual(typeof all[1].durationMs, 'number');
});

await check('медленный тик (>= slowMs): finished на уровне info', async () => {
    const { lines, logger } = makeCapture();
    const tick = wrapJobTick('slow-job', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    }, { log: logger, slowMs: 5 });
    await tick();
    const all = rows(lines);
    assert.strictEqual(all[1].level, 'info');
    assert.strictEqual(all[1].msg, 'job finished (slow)');
    assert.ok(all[1].durationMs >= 5);
});

await check('SLOW_JOB_LOG_MS по умолчанию 30 секунд', () => {
    assert.strictEqual(SLOW_JOB_LOG_MS, 30_000);
});

await check('падение тика: error с err-сериализацией, наружу не пробрасывается', async () => {
    const { lines, logger } = makeCapture();
    const tick = wrapJobTick('broken-job', async () => {
        throw new Error('telegram не ответил');
    }, { log: logger });
    await tick(); // не должно бросить
    const all = rows(lines);
    const failure = all.find((r) => r.msg === 'job failed');
    assert.ok(failure, 'нет записи job failed');
    assert.strictEqual(failure.level, 'error');
    assert.strictEqual(failure.job, 'broken-job');
    assert.ok(failure.runId);
    assert.strictEqual(failure.err.type, 'Error');
    assert.strictEqual(failure.err.message, 'telegram не ответил');
});

await check('нечитаемый рантайм-объект вместо Error не роняет лог', async () => {
    const { lines, logger } = makeCapture();
    const tick = wrapJobTick('weird-job', async () => {
        throw 'строка вместо ошибки';
    }, { log: logger });
    await tick();
    const failure = rows(lines).find((r) => r.msg === 'job failed');
    assert.ok(failure, 'нет записи job failed');
});

await check('sync-бросок внутри тика тоже ловится', async () => {
    const { lines, logger } = makeCapture();
    const tick = wrapJobTick('sync-throw', () => {
        throw new RangeError('sync fail');
    }, { log: logger });
    await tick();
    const failure = rows(lines).find((r) => r.msg === 'job failed');
    assert.strictEqual(failure.err.type, 'RangeError');
});

console.log(`\nВсего проверок: ${passed} — все зелёные.`);
