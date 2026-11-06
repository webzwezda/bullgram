// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import AdmZip from 'adm-zip';
import { groupAccountPacks, unpackZipEntries } from '../../services/account-pack.service.js';
import { assert, sqliteHeaderFixture } from './shared.js';

export async function runGroupPacksMultipack() {
console.log('— groupAccountPacks: multi-pack zip —');

{
    const zip = new AdmZip();
    for (const phone of ['+79990000001', '+79990000002']) {
        zip.addFile(`${phone}/tdata/key_datas`, Buffer.from('kd'));
        zip.addFile(`${phone}/tdata/s`, Buffer.from('s'));
        zip.addFile(`${phone}.json`, Buffer.from('{}'));
        zip.addFile(`${phone}.session`, sqliteHeaderFixture());
    }
    const expanded = unpackZipEntries([{ relPath: 'batch.zip', name: 'batch.zip', buffer: zip.toBuffer() }]);
    const { packs, rejects } = groupAccountPacks(expanded);
    assert(packs.length === 2 && rejects.length === 0, 'две полные пачки, без rejects');
    assert(packs[0].key === '79990000001' && packs[1].key === '79990000002', 'ключи по телефонам');
    assert(packs.every((pack) => pack.tdataEntries.length === 2), 'tdata разложен по своим пачкам');
}
}
