// Сценарий из test/test-account-intake.js (разрезка под лимит pre-commit; хост — test/test-account-intake.js).
import AdmZip from 'adm-zip';
import { unpackZipEntries } from '../../services/account-pack.service.js';
import { assert } from './shared.js';

export async function runUnpackZipGuards() {
console.log('— unpackZipEntries: вложенный архив и zip-bomb гард —');

{
    const zip = new AdmZip();
    zip.addFile('inner.zip', Buffer.from('PK\x03\x04fake'));
    let error = null;
    try {
        unpackZipEntries([{ relPath: 'outer.zip', name: 'outer.zip', buffer: zip.toBuffer() }]);
    } catch (e) {
        error = e;
    }
    assert(error && String(error.message).includes('вложенный'), 'вложенный zip отклонён с понятной ошибкой');
}

{
    const zip = new AdmZip();
    for (let i = 0; i < 401; i++) {
        zip.addFile(`filler_${i}.bin`, Buffer.from('x'));
    }
    let error = null;
    try {
        unpackZipEntries([{ relPath: 'bomb.zip', name: 'bomb.zip', buffer: zip.toBuffer() }]);
    } catch (e) {
        error = e;
    }
    assert(error && String(error.message).includes('много файлов'), 'zip-bomb гард: >400 файлов отклонён');
}
}
