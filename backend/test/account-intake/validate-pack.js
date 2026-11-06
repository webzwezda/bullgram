// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import { validatePack } from '../../services/account-pack.service.js';
import { assert, realService, sqliteHeaderFixture } from './shared.js';

export async function runValidatePack() {
console.log('— validatePack (реальные методы userbot.service, extractSession инъекцией) —');
{
    const pack = {
        label: '+79001234567',
        sessionEntry: { name: '+79001234567.session', buffer: sqliteHeaderFixture() },
        jsonEntry: { name: '+79001234567.json', buffer: Buffer.from(JSON.stringify({ app_id: 6, app_hash: 'hash' })) }
    };
    const result = await validatePack(pack, realService, { extractSession: async () => 'SESSION_STRING' });
    assert(result.ok === true, 'валидная пачка проходит');
    assert(result.fingerprint.api_id === 6 && result.fingerprint.api_hash === 'hash', 'fingerprint из .json распарсен');
    assert(result.sessionString === 'SESSION_STRING', 'extractSession инъекция отработала');
    assert(Buffer.isBuffer(result.sessionBuffer), 'sessionBuffer возвращён');
}

{
    const badSession = { label: 'x', sessionEntry: { name: 'x.session', buffer: Buffer.from('NOT SQLITE AT ALL') }, jsonEntry: { name: 'x.json', buffer: Buffer.from('{}') } };
    const result = await validatePack(badSession, realService, { extractSession: async () => 'S' });
    assert(result.ok === false && String(result.error).includes('SQLite'), 'битый .session → reject с русской ошибкой');
}

{
    const badJson = { label: 'x', sessionEntry: { name: 'x.session', buffer: sqliteHeaderFixture() }, jsonEntry: { name: 'x.json', buffer: Buffer.from('not json at all') } };
    const result = await validatePack(badJson, realService, { extractSession: async () => 'S' });
    assert(result.ok === false && String(result.error).includes('поврежден'), 'битый .json → reject');
}

{
    // _normalizeFingerprint подставляет дефолты за пустые поля — валидация
    // сырцового json должна ловить это ДО нормализации, иначе битая пачка
    // молча живёт на дефолтном fingerprint платформы.
    const noAppId = { label: 'x', sessionEntry: { name: 'x.session', buffer: sqliteHeaderFixture() }, jsonEntry: { name: 'x.json', buffer: Buffer.from('{}') } };
    const resultNoId = await validatePack(noAppId, realService, { extractSession: async () => 'S' });
    assert(resultNoId.ok === false && String(resultNoId.error).includes('app_id/app_hash'), 'json без app_id → reject, а не дефолтный fingerprint');
}

{
    const noAppHash = { label: 'x', sessionEntry: { name: 'x.session', buffer: sqliteHeaderFixture() }, jsonEntry: { name: 'x.json', buffer: Buffer.from(JSON.stringify({ app_id: 6 })) } };
    const resultNoHash = await validatePack(noAppHash, realService, { extractSession: async () => 'S' });
    assert(resultNoHash.ok === false && String(resultNoHash.error).includes('app_id/app_hash'), 'json без app_hash → reject');
}
}
