// tdata-парсер: раундтрип фикстуры → аккаунт; пин; мультиаккаунт — reject.
// Плюс контракт синтезированного sqlite: реальный extractSessionFromSqliteBuffer
// (прод-читатель сессий) обязан прочитать его в ту же строку сессии.
import {
    extractTdataAccount,
    packSessionString
} from '../../services/tdata.service.js';
import { TELEGRAM_DC_IPV4 } from '../../services/userbot/constants.js';
import { buildTdataFiles } from './tdata-fixture.js';
import { assert, realService } from './shared.js';

export async function runTdataParse() {
    console.log('• tdata: парсер');
    {
        const built = await buildTdataFiles({ dcId: 2, userId: 777000111 });
        const account = await extractTdataAccount(built.files, [Buffer.alloc(0)]);

        assert(account.userId === 777000111, `userId извлечён (${account.userId})`);
        assert(account.dcId === 2, 'mainDcId извлечён');
        assert(account.authKey.equals(built.authKey), 'auth key извлечён байт в байт');
        assert(
            account.sessionString === packSessionString(2, TELEGRAM_DC_IPV4[2], 443, built.authKey),
            'строка сессии собрана по контракту упаковки (dc|IPv4|port|key)'
        );

        const reread = await realService.extractSessionFromSqliteBuffer(account.sessionSqliteBuffer);
        assert(reread === account.sessionString, 'прод-читатель читает синтезированный sqlite в ту же строку');
        assert(account.sessionSqliteBuffer.subarray(0, 15).toString('utf8') === 'SQLite format 3', 'sqlite имеет валидный заголовок');
    }

    {
        // Локальный пин: без пароля — отказ с подсказкой, с паролем из заметки — ок
        const built = await buildTdataFiles({ passcode: 'Pin777' });
        let failed = null;
        try {
            await extractTdataAccount(built.files, [Buffer.alloc(0)]);
        } catch (error) {
            failed = error;
        }
        assert(Boolean(failed) && String(failed.message).includes('заметку'), 'без пина — понятный отказ про заметку с паролем');

        const account = await extractTdataAccount(built.files, [Buffer.alloc(0), Buffer.from('Pin777', 'utf8')]);
        assert(account.authKey.equals(built.authKey), 'с паролем из заметки ключ снят');
    }

    {
        // Мультиаккаунт: индексов два → reject; ключей два → reject
        const twoAccounts = await buildTdataFiles({ accountIndices: [0, 1] });
        let e1 = null;
        try { await extractTdataAccount(twoAccounts.files, [Buffer.alloc(0)]); } catch (error) { e1 = error; }
        assert(Boolean(e1) && String(e1.message).includes('аккаунтов: 2'), 'два аккаунта в key_datas — reject с сообщением');

        const twoKeys = await buildTdataFiles({
            keyEntries: [
                { dcId: 2, authKey: Buffer.alloc(256, 1) },
                { dcId: 3, authKey: Buffer.alloc(256, 2) }
            ]
        });
        let e2 = null;
        try { await extractTdataAccount(twoKeys.files, [Buffer.alloc(0)]); } catch (error) { e2 = error; }
        assert(Boolean(e2) && String(e2.message).includes('несколько аккаунтов'), 'два ключа в авторизации — reject');
    }

    {
        // Без tdata-структуры: ключей нет вообще
        let e3 = null;
        try {
            await extractTdataAccount([{ relPath: 'x/tdata/nothing', name: 'nothing', buffer: Buffer.alloc(32, 7) }], [Buffer.alloc(0)]);
        } catch (error) { e3 = error; }
        assert(Boolean(e3) && String(e3.message).includes('key_datas'), 'папка без key_datas — reject');
    }
}
