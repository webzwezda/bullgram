// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import { parseTwoFaPassword } from '../../services/account-pack.service.js';
import { assert, encodeCp1251 } from './shared.js';

export async function runParseTwoFaPassword() {
console.log('— parseTwoFaPassword —');

{
    assert(parseTwoFaPassword(Buffer.from('FAQ\nЛогин: +79991234567\nПароль 2FA: MyPass123')) === 'MyPass123', 'utf8: пароль из последней строки с «пароль»');
    assert(parseTwoFaPassword(encodeCp1251('Пароль: Секрет123')) === 'Секрет123', 'CP1251: кириллический пароль читается');
    assert(parseTwoFaPassword(Buffer.from('тут просто инструкция, без секретов')) === null, 'без строки с «пароль» → null');
    assert(parseTwoFaPassword(Buffer.from('Пароль: ' + 'x'.repeat(70))) === null, 'пароль длиннее 64 → null');
    assert(parseTwoFaPassword(Buffer.alloc(0)) === null, 'пустой буфер → null');
}
}
