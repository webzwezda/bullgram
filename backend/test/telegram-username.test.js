// Юнит-тесты валидации username для быстрой смены из кабинета
// (routes/userbot/profile.js POST /username/:id → utils/telegram-profile.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTelegramUsernameInput, TG_USERNAME_PATTERN } from '../utils/telegram-profile.js';

test('strip @ и валидные варианты проходят', () => {
    assert.equal(normalizeTelegramUsernameInput('@webzwezda'), 'webzwezda');
    assert.equal(normalizeTelegramUsernameInput('@@webzwezda'), 'webzwezda'); // двойная @ срезается
    assert.equal(normalizeTelegramUsernameInput('webzwezda'), 'webzwezda');
    assert.equal(normalizeTelegramUsernameInput('  ab_cd123  '), 'ab_cd123');
    assert.equal(normalizeTelegramUsernameInput('A0000'), 'A0000');
    assert.equal(normalizeTelegramUsernameInput('user_name_99'), 'user_name_99');
});

test('невалидные возвращают null', () => {
    assert.equal(normalizeTelegramUsernameInput(''), null);
    assert.equal(normalizeTelegramUsernameInput(null), null);
    assert.equal(normalizeTelegramUsernameInput('abc'), null); // короче 5
    assert.equal(normalizeTelegramUsernameInput('1abcde'), null); // первая — не буква
    assert.equal(normalizeTelegramUsernameInput('_abcde'), null);
    assert.equal(normalizeTelegramUsernameInput('user-name'), null); // дефис
    assert.equal(normalizeTelegramUsernameInput('user name'), null); // пробел
    assert.equal(normalizeTelegramUsernameInput('юзернейм'), null); // не латиница
    assert.equal(normalizeTelegramUsernameInput('a'.repeat(33)), null); // длиннее 32
    assert.equal(normalizeTelegramUsernameInput('a'.repeat(32)), 'a'.repeat(32)); // ровно 32 — ок
});

test('паттерн согласован с правилом Telegram (5–32, первая буква)', () => {
    assert.ok(TG_USERNAME_PATTERN.test('Abcde'));
    assert.ok(!TG_USERNAME_PATTERN.test('Abcd'));
});
