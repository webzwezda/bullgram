// Тесты приёмника клиентских ошибок POST /api/log (фаза 4 логирования).
// Запуск: node test/test-client-log.js — часть npm run test:client-log.

import { Writable } from 'node:stream';
import http from 'node:http';
import assert from 'node:assert';
import express from 'express';
import { createLogger } from '../utils/logger.js';
import { createClientLogRouter } from '../routes/client-log.routes.js';

function makeCaptureLogger() {
    const lines = [];
    const stream = new Writable({
        write(chunk, _enc, cb) {
            lines.push(chunk.toString());
            cb();
        }
    });
    return { lines, logger: createLogger({ destination: stream, level: 'debug' }) };
}

async function startApp(router) {
    const app = express();
    app.use(express.json());
    app.use('/api/log', router);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
        port,
        post: async (path, body, headers = {}) => {
            const response = await fetch(`http://127.0.0.1:${port}${path}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...headers },
                body: typeof body === 'string' ? body : JSON.stringify(body)
            });
            return { status: response.status, json: await response.json().catch(() => null) };
        },
        close: () => new Promise((resolve) => server.close(resolve))
    };
}

const VALID_EVENT = {
    app: 'site',
    level: 'error',
    message: 'TypeError: Cannot read properties of undefined',
    stack: 'TypeError: ...\n    at App.jsx:1:1',
    url: 'https://bullgram.xyz/shop'
};

let passed = 0;
async function check(name, fn) {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
}

await check('валидный батч → 200, события в warn с source:web и app', async () => {
    const { lines, logger } = makeCaptureLogger();
    const app = await startApp(createClientLogRouter({ log: logger }));
    const { status, json } = await app.post('/api/log', { events: [VALID_EVENT, { app: 'paywall', message: 'chunk load failed', level: 'warn' }] });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.accepted, 2);
    await app.close();
    const rows = lines.map((l) => JSON.parse(l));
    const first = rows.find((r) => r.msg.includes('TypeError'));
    assert.strictEqual(first.level, 'error', 'клиентский error мапится в серверный error');
    const second = rows.find((r) => r.msg.includes('chunk load failed'));
    assert.strictEqual(second.level, 'warn');
    assert.strictEqual(first.source, 'web');
    assert.strictEqual(first.web_app, 'site');
    assert.strictEqual(first.web_url, VALID_EVENT.url);
    assert.strictEqual(first.stack, VALID_EVENT.stack);
});

await check('одиночное событие без обёртки events → тоже принимается', async () => {
    const { lines, logger } = makeCaptureLogger();
    const app = await startApp(createClientLogRouter({ log: logger }));
    const { status, json } = await app.post('/api/log', { app: 'userbot', message: 'boom' });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.accepted, 1);
    await app.close();
    const row = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(row.web_app, 'userbot');
    assert.strictEqual(row.level, 'error', 'дефолтный уровень error');
});

await check('неизвестный app / пустое сообщение / мусор → событие отброшено', async () => {
    const { lines, logger } = makeCaptureLogger();
    const app = await startApp(createClientLogRouter({ log: logger }));
    const { status, json } = await app.post('/api/log', {
        events: [
            { app: 'evil-app', message: 'x' },
            { app: 'site' },
            'строка вместо объекта',
            null
        ]
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.accepted, 0);
    await app.close();
    assert.strictEqual(lines.length, 0, 'мусор не должен попасть в лог');
});

await check('батч > 10 событий → 400', async () => {
    const { logger } = makeCaptureLogger();
    const app = await startApp(createClientLogRouter({ log: logger }));
    const events = Array.from({ length: 11 }, () => ({ app: 'site', message: 'x' }));
    const { status } = await app.post('/api/log', { events });
    assert.strictEqual(status, 400);
    await app.close();
});

await check('rate-limit: 11-й запрос от того же IP за окно → 429', async () => {
    const { logger } = makeCaptureLogger();
    const app = await startApp(createClientLogRouter({ log: logger }));
    for (let i = 0; i < 10; i += 1) {
        const { status } = await app.post('/api/log', { app: 'site', message: `hit ${i}` });
        assert.strictEqual(status, 200, `запрос ${i} должен пройти`);
    }
    const { status } = await app.post('/api/log', { app: 'site', message: 'overflow' });
    assert.strictEqual(status, 429);
    await app.close();
});

await check('длинные поля клампятся, не отклоняются', async () => {
    const { lines, logger } = makeCaptureLogger();
    const app = await startApp(createClientLogRouter({ log: logger }));
    const { status, json } = await app.post('/api/log', {
        app: 'bots',
        message: 'x'.repeat(5000),
        stack: 'y'.repeat(5000)
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.accepted, 1);
    await app.close();
    const row = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(row.msg.length, 300);
    assert.strictEqual(row.stack.length, 2000);
});

console.log(`\nВсего проверок: ${passed} — все зелёные.`);
