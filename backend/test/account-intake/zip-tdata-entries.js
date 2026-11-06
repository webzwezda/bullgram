// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import AdmZip from 'adm-zip';
import { zipTdataEntries } from '../../services/account-pack.service.js';
import { assert } from './shared.js';

export async function runZipTdataEntries() {
console.log('— zipTdataEntries —');

{
    const tdataEntries = [
        { relPath: 'pack1/+7999/tdata/key_datas', name: 'key_datas', buffer: Buffer.from('KD') },
        { relPath: 'pack1/+7999/tdata/s', name: 's', buffer: Buffer.from('SS') }
    ];
    const zipBuffer = zipTdataEntries(tdataEntries);
    const readBack = new AdmZip(zipBuffer).getEntries().map((e) => [e.entryName, e.getData().toString()]);
    assert(readBack.length === 2, 'в zip два файла');
    assert(readBack.some(([name, data]) => name === 'tdata/key_datas' && data === 'KD'), 'путь tdata/... сохранён, содержимое цело');
    assert(readBack.some(([name, data]) => name === 'tdata/s' && data === 'SS'), 'второй файл на месте');
}
}
