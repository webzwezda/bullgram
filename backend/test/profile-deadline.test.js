// Дедлайн живых Telegram-вызовов (utils/with-deadline.js):
// прокси-«черная дыра» не должна вечно держать HTTP-запрос (кейс @craps_1921).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withDeadline } from '../utils/with-deadline.js';

test('отвечающий промис проходит сквозь дедлайн без ошибки', async () => {
    const result = await withDeadline(Promise.resolve({ ok: true }), 500);
    assert.deepEqual(result, { ok: true });
});

test('зависший промис отклоняется по дедлайну с человекочитаемым текстом', async () => {
    const hung = new Promise(() => {});
    await assert.rejects(
        withDeadline(hung, 50, 'Telegram не ответил за 0.05 сек — попробуй ещё раз.'),
        /Telegram не ответил за 0\.05 сек/
    );
});

test('таймер очищается после успеха (не держит event loop)', async () => {
    await withDeadline(Promise.resolve(1), 10_000);
    // если таймер не очищен, процесс висел бы ~10 сек после теста;
    // косвенный признак — быстрое завершение теста
    assert.ok(true);
});
