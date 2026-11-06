// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import AdmZip from 'adm-zip';
import { groupAccountPacks, parseTwoFaPassword, unpackZipEntries } from '../../services/account-pack.service.js';
import { assert, sqliteHeaderFixture, encodeCp1251 } from './shared.js';

export async function runGroupPacksTeleakZip() {
console.log('— groupAccountPacks: teleak-style zip (tdata + json + session + CP1251-заметка) —');

{
    const zip = new AdmZip();
    zip.addFile('+13637778642/tdata/key_datas', Buffer.from('kd'));
    zip.addFile('+13637778642/tdata/s', Buffer.from('s-data'));
    zip.addFile('+13637778642/tdata/maps', Buffer.from('maps'));
    zip.addFile('+13637778642.json', Buffer.from(JSON.stringify({ app_id: 6, app_hash: 'hash' })));
    zip.addFile('+13637778642.session', sqliteHeaderFixture());
    zip.addFile('FAQ + Пароль 2фа ….txt', encodeCp1251('FAQ\r\nПароль: SuperSecret42\r\n'));

    const expanded = unpackZipEntries([{ relPath: 'teleak.zip', name: 'teleak.zip', buffer: zip.toBuffer() }]);
    assert(expanded.length === 6, 'zip развёрнут в 6 файлов');
    assert(expanded.every((entry) => entry.scope === 'teleak'), 'scope = имя zip без расширения');

    const { packs, rejects } = groupAccountPacks(expanded);
    assert(rejects.length === 0, 'без rejects');
    assert(packs.length === 1, 'одна пачка');
    assert(packs[0].key === '13637778642', 'key нормализован (без +)');
    assert(packs[0].label === '+13637778642', 'label сохранён');
    assert(packs[0].sessionEntry && packs[0].jsonEntry, 'session+json склеены по basename');
    assert(packs[0].tdataEntries.length === 3, 'tdata привязан по имени папки');
    assert(packs[0].passwordEntry && parseTwoFaPassword(packs[0].passwordEntry.buffer) === 'SuperSecret42', 'CP1251-заметка привязана, пароль вытащен');
}
}
