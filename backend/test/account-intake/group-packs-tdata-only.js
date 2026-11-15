// Группировка: tdata-only пачки. Папка tdata без .session/.json — больше не
// reject, а самостоятельная пачка с конвертацией внутри приёмки; полные пачки
// продолжают забирать tdata к себе как раньше.
import { groupAccountPacks } from '../../services/account-pack.service.js';
import { assert } from './shared.js';
import { sqliteHeaderFixture } from './shared.js';

export async function runGroupPacksTdataOnly() {
    console.log('• группировка: tdata-only пачки');

    {
        // scope проставляет normalizeEntries в реальном пайплайне — в фикстуре
        // даём сразу (папка loose-загрузки = первый сегмент пути)
        const { packs, rejects } = groupAccountPacks([
            { relPath: 'account-1/tdata/key_datas', name: 'key_datas', buffer: Buffer.from('kd'), scope: 'account-1' },
            { relPath: 'account-1/tdata/D877F783D5D3EF8Cs', name: 'D877F783D5D3EF8Cs', buffer: Buffer.from('mtp'), scope: 'account-1' },
            { relPath: 'account-1/пароль.txt', name: 'пароль.txt', buffer: Buffer.from('Пароль: Secret9'), scope: 'account-1' }
        ]);
        assert(packs.length === 1 && rejects.length === 0, 'одна tdata-папка → одна пачка без reject’ов');
        const pack = packs[0];
        assert(pack.tdataOnly === true, 'пачка помечена tdataOnly');
        assert(pack.label === 'account-1', `лейбл из имени папки (${pack.label})`);
        assert(pack.sessionEntry === null && pack.jsonEntry === null, 'без .session/.json');
        assert(pack.tdataEntries.length === 2, 'оба tdata-файла в пачке');
        assert(Boolean(pack.passwordEntry), 'заметка с паролем привязана (годится и как 2FA, и как локальный пин)');
    }

    {
        // Две разные tdata-папки — две пачки, имена не схлопываются
        const { packs } = groupAccountPacks([
            { relPath: 'a1/tdata/key_datas', name: 'key_datas', buffer: Buffer.from('kd') },
            { relPath: 'a2/tdata/key_datas', name: 'key_datas', buffer: Buffer.from('kd') }
        ]);
        assert(packs.length === 2, 'две папки → две tdata-only пачки');
        assert(packs.some((p) => p.label === 'a1') && packs.some((p) => p.label === 'a2'), 'лейблы раздельные');
    }

    {
        // Мультипачечный zip: один scope на всех, заметка «account-1.txt»
        // находит свою tdata-папку по basename (как у полных пачек)
        const { packs, rejects } = groupAccountPacks([
            { relPath: 'packs/account-1/tdata/key_datas', name: 'key_datas', buffer: Buffer.from('kd'), scope: 'packs' },
            { relPath: 'packs/account-2/tdata/key_datas', name: 'key_datas', buffer: Buffer.from('kd'), scope: 'packs' },
            { relPath: 'packs/account-1.txt', name: 'account-1.txt', buffer: Buffer.from('Пароль: Secret1'), scope: 'packs' }
        ]);
        assert(packs.length === 2, 'две tdata-only пачки в одном scope');
        const withNote = packs.find((p) => p.label === 'account-1');
        assert(Boolean(withNote?.passwordEntry), 'заметка привязана по basename к своей папке');
        assert(!packs.find((p) => p.label === 'account-2').passwordEntry, 'чужая папка заметку не получила');
        assert(rejects.length === 0, 'reject’ов нет');
    }

    {
        // Регресс: tdata при полной пачке продолжает приклеиваться к ней,
        // tdata-only дубликата не возникает
        const { packs, rejects } = groupAccountPacks([
            { relPath: 'up/+79991112233.session', name: '+79991112233.session', buffer: sqliteHeaderFixture() },
            { relPath: 'up/+79991112233.json', name: '+79991112233.json', buffer: Buffer.from(JSON.stringify({ app_id: 6, app_hash: 'h' })) },
            { relPath: 'up/+79991112233/tdata/key_datas', name: 'key_datas', buffer: Buffer.from('kd') }
        ]);
        assert(packs.length === 1 && packs[0].tdataEntries.length === 1, 'tdata приклеен к полной пачке');
        assert(packs[0].tdataOnly === undefined && rejects.length === 0, 'tdata-only пачка не создана, reject’ов нет');
    }
}
