/**
 * Юнит-тесты ротации токена QR-логина (utils/qr-auth.js).
 * Офлайн, детерминированные: Telegram не трогается, цикл авторизации
 * подменяется старт-функцией.
 *
 * Регрессия 2026-11-04: токен QR живёт ~30 секунд, GramJS
 * signInUserWithQrCode не ловит AUTH_TOKEN_EXPIRED и падает целиком —
 * владелец видел сырую ошибку, просто не успев достать телефон.
 *
 * Запуск: node test/test-qr-auth.js
 */
import assert from 'node:assert';
import { isQrTokenExpiredError, runQrAuthWithRotation } from '../utils/qr-auth.js';

let failures = 0;
let passes = 0;
function ok(label) {
    passes += 1;
    console.log(`  ✓ ${label}`);
}
function fail(label, error) {
    failures += 1;
    console.error(`  ✗ ${label}${error ? `: ${error.message}` : ''}`);
}

async function expectThrows(promise, label) {
    try {
        await promise;
        fail(label, new Error('ожидали отклонение, получили успех'));
    } catch (error) {
        ok(label);
        return error;
    }
}

console.log('— isQrTokenExpiredError распознаёт RPC- и message-формы —');

assert.strictEqual(isQrTokenExpiredError({ errorMessage: 'AUTH_TOKEN_EXPIRED' }), true, 'errorMessage форма');
assert.strictEqual(isQrTokenExpiredError(new Error('AUTH_TOKEN_EXPIRED')), true, 'Error.message форма');
assert.strictEqual(isQrTokenExpiredError(new Error('TIMEOUT')), false, 'чужая ошибка — не ротация');

console.log('— runQrAuthWithRotation: двойное истечение токена переживается —');

{
    let calls = 0;
    const result = await runQrAuthWithRotation(async () => {
        calls += 1;
        if (calls <= 2) {
            const error = new Error('AUTH_TOKEN_EXPIRED');
            throw error;
        }
        return 'authorized';
    });
    assert.strictEqual(result, 'authorized', 'вернул успех после ротаций');
    assert.strictEqual(calls, 3, 'старт-цикл вызван трижды');
}

console.log('— runQrAuthWithRotation: не-ротируемая ошибка падает сразу —');

{
    let calls = 0;
    const error = await expectThrows(
        runQrAuthWithRotation(async () => {
            calls += 1;
            throw new Error('AUTH_KEY_UNREGISTERED');
        }),
        'цикл отклонился'
    );
    assert.strictEqual(error.message, 'AUTH_KEY_UNREGISTERED', 'исходная ошибка без обёрток');
    assert.strictEqual(calls, 1, 'перезапуска нет');
}

console.log('— runQrAuthWithRotation: лимит перезапусков уважается —');

{
    let calls = 0;
    await expectThrows(
        runQrAuthWithRotation(async () => {
            calls += 1;
            throw new Error('AUTH_TOKEN_EXPIRED');
        }, { maxRestarts: 3 }),
        'цикл отклонился на лимите'
    );
    assert.strictEqual(calls, 4, 'ровно 1 старт + 3 перезапуска');
}

console.log('— runQrAuthWithRotation: старт-цикл, который сам ловит истечение и выдаёт новый токен, не ломается —');

{
    // Имитация реального цикла: коллбек qrCode получает новый токен на каждый
    // перезапуск (это делает qrCodeCallback в generateQR).
    const tokens = [];
    const result = await runQrAuthWithRotation(async () => {
        tokens.push(`token-${tokens.length + 1}`);
        if (tokens.length < 3) throw new Error('AUTH_TOKEN_EXPIRED');
        return tokens[tokens.length - 1];
    });
    assert.strictEqual(result, 'token-3', 'последний токен победил');
    assert.deepStrictEqual(tokens, ['token-1', 'token-2', 'token-3'], 'токены ротировались по порядку');
}

console.log(failures === 0 ? `\nВсе проверки ротации QR-логина прошли (${passes} шт.)` : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
