// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import AdmZip from 'adm-zip';
import { groupAccountPacks, unpackZipEntries } from '../../services/account-pack.service.js';
import { assert, sqliteHeaderFixture } from './shared.js';

export async function runGroupPacksIncomplete() {
console.log('— groupAccountPacks: неполные пачки и tdata по scope —');

{
    const expanded = [
        { relPath: 'loose/+79001234567.session', name: '+79001234567.session', buffer: sqliteHeaderFixture(), scope: 'loose' },
        { relPath: 'loose/folder_x/tdata/key_datas', name: 'key_datas', buffer: Buffer.from('kd'), scope: 'loose' }
    ];
    const { packs, rejects } = groupAccountPacks(expanded);
    assert(packs.length === 0, '.session без .json — пачки нет');
    assert(rejects.some((r) => String(r.reason).includes('.json')), 'reject с подсказкой доложить .json');
    assert(rejects.some((r) => String(r.name).includes('tdata')), 'осиротевший tdata в rejects');
}

{
    // Имя папки tdata не совпадает с basename пачки — цепляем по scope (ровно одна пачка).
    const zip = new AdmZip();
    zip.addFile('folder_x/tdata/key_datas', Buffer.from('kd'));
    zip.addFile('+79001234567.json', Buffer.from('{}'));
    zip.addFile('+79001234567.session', sqliteHeaderFixture());
    const expanded = unpackZipEntries([{ relPath: 'solo.zip', name: 'solo.zip', buffer: zip.toBuffer() }]);
    const { packs, rejects } = groupAccountPacks(expanded);
    assert(packs.length === 1 && packs[0].tdataEntries.length === 1, 'tdata привязан через single-pack scope');
    assert(rejects.length === 0, 'без rejects');
}

{
    const zip = new AdmZip();
    zip.addFile('+79001112233.json', Buffer.from('{}'));
    const expanded = unpackZipEntries([{ relPath: 'json-only.zip', name: 'json-only.zip', buffer: zip.toBuffer() }]);
    const { packs, rejects } = groupAccountPacks(expanded);
    assert(packs.length === 0, '.json без .session — пачки нет');
    assert(rejects.some((r) => String(r.reason).includes('.session')), 'reject с подсказкой доложить .session');
}
}
