/**
 * Юнит-тесты приёмки пачек аккаунтов (account shop intake, Wave 1).
 * Офлайн, детерминированные: группировка пачек и распаковка zip — на реальном
 * adm-zip; 2FA-пароли — utf8 и CP1251 (ручной энкодер в тесте); validatePack —
 * на реальных методах userbot.service (extractSession инъекцией, без sqlite);
 * processIntakeBatch и job отстоя runIntakeRestingCheck — на моке supabase в
 * стиле test-shop-quarantine.js, Telegram не трогаем.
 *
 * Покрывает: teleak-style zip (tdata + json + session + CP1251-заметка),
 * multi-pack zip, .session без .json → reject, tdata по scope, вложенный zip,
 * zip-bomb гард, parseTwoFaPassword (utf8/CP1251/без пароля/слишком длинный),
 * validatePack (ок/битый sqlite/битый json), processIntakeBatch (ок-путь с
 * safe-mode + recovery + прогресс; упавшая пачка освобождает ровно свой прокси;
 * missing restore table → откат айтема; упавший insert прокси), отсюда же
 * runIntakeRestingCheck (online сохраняет pending_activation и пишет identity +
 * health_summary; restricted → событие + чистка прокси; frozen → событие без
 * чистки; expired; дубликат; свежая проверка не повторяется).
 */
import AdmZip from 'adm-zip';
import {
    groupAccountPacks,
    parseTwoFaPassword,
    unpackZipEntries,
    validatePack,
    zipTdataEntries
} from '../services/account-pack.service.js';
import { INTAKE_MISSING_MIGRATION_MESSAGE, processIntakeBatch } from '../services/account-intake.service.js';
import { runIntakeRestingCheck } from '../jobs/intake-resting.job.js';
import { UserbotService } from '../services/userbot.service.js';
import { FRESH_IMPORT_RUNTIME_REASON } from '../utils/ops-center-selection.js';

let failures = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        failures++;
    }
}

// Ручной CP1251-энкодер (зеркало decodeCp1251 из сервиса, только нужные тесту
// диапазоны: ASCII, А-я, Ё/ё, тире).
function encodeCp1251(text) {
    const bytes = [];
    for (const ch of String(text)) {
        const code = ch.codePointAt(0);
        if (code < 0x80) bytes.push(code);
        else if (code >= 0x410 && code <= 0x44F) bytes.push(0xC0 + (code - 0x410));
        else if (code === 0x401) bytes.push(0xB7);
        else if (code === 0x451) bytes.push(0xB8);
        else if (code === 0x2014) bytes.push(0x97);
        else throw new Error(`encodeCp1251: символ не поддержан тестом: ${ch}`);
    }
    return Buffer.from(bytes);
}

function sqliteHeaderFixture() {
    return Buffer.concat([Buffer.from('SQLite format 3\0', 'utf8'), Buffer.alloc(64, 7)]);
}

let idSeq = 0;
function mockId() {
    idSeq += 1;
    return `00000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`;
}

// --- Мок supabase: thenable-билдер с eq/ne/in/lt + insert().select().single() ---
function makeMockSupabase(tablesInit = {}, { tableErrors = {} } = {}) {
    const tables = {};
    for (const [name, rows] of Object.entries(tablesInit)) tables[name] = rows.map((r) => ({ ...r }));

    const db = {
        from(table) {
            const rows = tables[table] ?? (tables[table] = []);
            const filters = [];
            let cols = '*';
            const predFor = (filterList) => (row) => filterList.every(([col, op, val]) => {
                const cell = row[col];
                if (op === 'eq') return String(cell) === String(val);
                if (op === 'ne') return String(cell) !== String(val);
                if (op === 'in') return (val || []).some((v) => String(cell) === String(v));
                if (op === 'lt') return String(cell) < String(val);
                if (op === 'not_is') return cell !== null && cell !== undefined;
                return true;
            });
            const matches = () => rows.filter(predFor(filters));
            const project = (row) => {
                const colList = String(cols).split(',').map((s) => s.trim()).filter(Boolean);
                if (cols.includes('*') || !colList.length) return { ...row };
                return Object.fromEntries(colList.filter((c) => c in row).map((c) => [c, row[c]]));
            };
            const builder = {
                select(c = '*', _opts = {}) { cols = String(c || '*'); return builder; },
                eq(col, val) { filters.push([col, 'eq', val]); return builder; },
                ne(col, val) { filters.push([col, 'ne', val]); return builder; },
                in(col, vals) { filters.push([col, 'in', vals]); return builder; },
                lt(col, val) { filters.push([col, 'lt', val]); return builder; },
                not(col, op, val) {
                    if (op === 'is' && val === null) filters.push([col, 'not_is', null]);
                    return builder;
                },
                order() { return builder; },
                limit() { return builder; },
                insert(payload) {
                    const list = Array.isArray(payload) ? payload : [payload];
                    const injectedError = tableErrors[table]?.insert || null;
                    if (injectedError) {
                        const failed = {
                            select() { return failed; },
                            single: async () => ({ data: null, error: { ...injectedError } }),
                            then(resolve) { resolve({ data: null, error: { ...injectedError } }); }
                        };
                        return failed;
                    }
                    const inserted = list.map((p) => ({ id: p.id || mockId(), ...p }));
                    rows.push(...inserted);
                    const after = {
                        select(c = '*') { cols = String(c || '*'); return after; },
                        single: async () => ({ data: inserted[0] ? { ...inserted[0] } : null, error: null }),
                        then(resolve) { resolve({ data: inserted.map((r) => project(r)), error: null }); }
                    };
                    return after;
                },
                update(patch) {
                    const ub = {
                        eq(col, val) { filters.push([col, 'eq', val]); return ub; },
                        ne(col, val) { filters.push([col, 'ne', val]); return ub; },
                        in(col, vals) { filters.push([col, 'in', vals]); return ub; },
                        lt(col, val) { filters.push([col, 'lt', val]); return ub; },
                        select() { return ub; },
                        then(resolve) {
                            let count = 0;
                            for (const row of rows) {
                                if (predFor(filters)(row)) { Object.assign(row, patch); count++; }
                            }
                            resolve({ data: null, error: null, count });
                        }
                    };
                    return ub;
                },
                delete() {
                    const db2 = {
                        eq(col, val) { filters.push([col, 'eq', val]); return db2; },
                        then(resolve) {
                            const keep = rows.filter((row) => !predFor(filters)(row));
                            const removed = rows.length - keep.length;
                            rows.length = 0;
                            rows.push(...keep);
                            resolve({ data: null, error: null, count: removed });
                        }
                    };
                    return db2;
                },
                maybeSingle: async () => {
                    const found = matches()[0];
                    return { data: found ? { ...found } : null, error: null };
                },
                single: async () => {
                    const found = matches()[0];
                    return { data: found ? { ...found } : null, error: null };
                },
                then(resolve) {
                    resolve({
                        data: matches().map(project),
                        error: null,
                        count: matches().length
                    });
                }
            };
            return builder;
        }
    };
    db._tables = tables;
    return db;
}

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

console.log('— parseTwoFaPassword —');

{
    assert(parseTwoFaPassword(Buffer.from('FAQ\nЛогин: +79991234567\nПароль 2FA: MyPass123')) === 'MyPass123', 'utf8: пароль из последней строки с «пароль»');
    assert(parseTwoFaPassword(encodeCp1251('Пароль: Секрет123')) === 'Секрет123', 'CP1251: кириллический пароль читается');
    assert(parseTwoFaPassword(Buffer.from('тут просто инструкция, без секретов')) === null, 'без строки с «пароль» → null');
    assert(parseTwoFaPassword(Buffer.from('Пароль: ' + 'x'.repeat(70))) === null, 'пароль длиннее 64 → null');
    assert(parseTwoFaPassword(Buffer.alloc(0)) === null, 'пустой буфер → null');
}

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

console.log('— validatePack (реальные методы userbot.service, extractSession инъекцией) —');

const realService = new UserbotService({}, 111, 'test-hash');

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

// --- processIntakeBatch ---

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makePackFixture(key) {
    return {
        key,
        label: `+${key}`,
        sessionEntry: { relPath: `up/+${key}.session`, name: `+${key}.session`, buffer: sqliteHeaderFixture() },
        jsonEntry: { relPath: `up/+${key}.json`, name: `+${key}.json`, buffer: Buffer.from(JSON.stringify({ app_id: 6, app_hash: 'hash' })) },
        tdataEntries: [{ relPath: `up/+${key}/tdata/s`, name: 's', buffer: Buffer.from('td') }],
        passwordEntry: { relPath: `up/note.txt`, name: 'note.txt', buffer: Buffer.from('Пароль: Pass42') },
        scope: 'up'
    };
}

function makeManagedProxyStub(records) {
    const released = [];
    return {
        released,
        async provisionManagedProxyBatch({ count }) {
            return records.slice(0, count).map((record) => ({ ...record }));
        },
        async releaseManagedProxyBatch({ records: recs }) {
            for (const record of recs || []) released.push(record);
            return (recs || []).length;
        }
    };
}

// Заглушка userbotService для оркестратора: парсинг делегируем РЕАЛЬНЫМ
// методам userbot.service (по духу прод-пути), saveRecoverySource подменяем.
const intakeUserbotStub = {
    validateSessionSqliteBuffer: (buffer) => realService.validateSessionSqliteBuffer(buffer),
    parseConfigJsonContent: (raw) => realService.parseConfigJsonContent(raw),
    stringifySessionData: (token, fingerprint, source) => JSON.stringify({ token, source }),
    saveRecoverySource: async () => {}
};

async function runIntake(supabase, packs, { managedProxy, validatePackFn, saveRecoverySource, launchVerification } = {}) {
    const records = (managedProxy && managedProxy._records)
        || (managedProxy === null ? [] : packs.map((_, index) => ({ host: '10.0.0.9', port: 40000 + index, username: `mp_${index}`, password: 'p', ipv6: null, inventory_group: 'self_use' })));
    const proxy = managedProxy || makeManagedProxyStub(records);
    proxy._records = records;
    if (saveRecoverySource) intakeUserbotStub.saveRecoverySource = saveRecoverySource;
    else if (!intakeUserbotStub.saveRecoverySource) intakeUserbotStub.saveRecoverySource = async () => {};

    const items = packs.map((pack) => ({ key: pack.key, label: pack.label, status: 'queued' }));
    const { data: batchRow } = await supabase
        .from('account_import_batches')
        .insert({ owner_id: OWNER, status: 'processing', total: packs.length, processed: 0, failed: 0, items })
        .select('id')
        .single();

    let launched = 0;
    await processIntakeBatch({
        supabase,
        userbotService: intakeUserbotStub,
        managedProxyService: proxy,
        ownerId: OWNER,
        batchId: batchRow.id,
        packs,
        items,
        launchVerification: () => { launched += 1; },
        deps: validatePackFn ? { validatePackFn } : { extractSession: async () => 'SESS' }
    });

    const batch = supabase._tables.account_import_batches.find((row) => row.id === batchRow.id);
    return { batch, items, proxy, launched };
}

console.log('— processIntakeBatch: ok-путь —');

{
    const supabase = makeMockSupabase({ proxies: [], tg_accounts: [], account_import_batches: [] });
    const restoreCalls = [];
    const { batch, proxy, launched } = await runIntake(
        supabase,
        [makePackFixture('79001234567')],
        {
            saveRecoverySource: async (args) => { restoreCalls.push(args); }
        }
    );

    const account = supabase._tables.tg_accounts[0];
    assert(account && account.runtime_status === 'pending_activation', 'аккаунт в safe-mode (pending_activation)');
    assert(account.runtime_error === FRESH_IMPORT_RUNTIME_REASON, 'runtime_error = причина safe-mode');
    assert(account.custom_label === '+79…567', 'custom_label = маскированный телефон');
    assert(account.allow_proxy_failover === false, 'failover выключен');
    assert(account.proxy_id, 'прокси привязан');
    assert(supabase._tables.proxies.length === 1, 'один managed-прокси вставлен');
    assert(supabase._tables.proxies[0].provision_source === 'manual_admin', 'provision_source manual_admin');
    assert(supabase._tables.proxies[0].inventory_group === 'self_use', 'inventory_group self_use');
    assert(supabase._tables.proxies[0].is_working === null, 'прокси ждёт фоновой проверки');
    assert(restoreCalls.length === 1, 'recovery source сохранён');
    assert(restoreCalls[0].twoFaSecret === 'Pass42', 'пароль 2FA ушёл в recovery');
    assert(Buffer.isBuffer(restoreCalls[0].tdataZipBuffer) && restoreCalls[0].tdataZipBuffer.length > 0, 'tdata zip собран');
    assert(String(restoreCalls[0].intakeBatchId).length > 0, 'intake_batch_id проброшен в recovery');
    assert(launched === 1, 'фоновая проверка прокси запущена');
    assert(batch.status === 'completed', 'батч завершён');
    assert(batch.processed === 1 && batch.failed === 0, 'прогресс 1/0');
    assert(batch.items[0].status === 'ok' && batch.items[0].account_id === account.id, 'айтем ok с account_id');
    assert(proxy.released.length === 0, 'ничего лишнего не освобождено');
}

console.log('— processIntakeBatch: упавшая пачка освобождает ровно свой прокси —');

{
    const supabase = makeMockSupabase({ proxies: [], tg_accounts: [], account_import_batches: [] });
    const { batch, proxy } = await runIntake(
        supabase,
        [makePackFixture('79000000001'), makePackFixture('79000000002')],
        {
            validatePackFn: async (pack) => pack.key === '79000000001'
                ? { ok: false, error: 'битая сессия', fingerprint: null, sessionBuffer: null, sessionString: null }
                : { ok: true, fingerprint: { api_id: 6, api_hash: 'h' }, sessionBuffer: sqliteHeaderFixture(), sessionString: 'SESS' }
        }
    );

    assert(supabase._tables.tg_accounts.length === 1, 'вставлен только валидный аккаунт');
    assert(supabase._tables.proxies.length === 1, 'прокси упавшей пачки удалён из proxies');
    assert(proxy.released.length === 1, 'упавшая пачка освободила ровно свой прокси');
    assert(batch.status === 'completed', 'батч завершён (не всё упало)');
    assert(batch.processed === 1 && batch.failed === 1, 'прогресс 1 ok / 1 failed');
    assert(batch.items[0].status === 'failed' && batch.items[0].error === 'битая сессия', 'айтем failed с ошибкой валидации');
    assert(batch.items[1].status === 'ok', 'вторая пачка не пострадала');
}

console.log('— processIntakeBatch: нет таблицы восстановления → откат айтема —');

{
    const supabase = makeMockSupabase({ proxies: [], tg_accounts: [], account_import_batches: [] });
    const { batch, proxy } = await runIntake(
        supabase,
        [makePackFixture('79000000003')],
        {
            saveRecoverySource: async () => {
                throw new Error('relation "public.userbot_restore_sources" does not exist');
            }
        }
    );

    assert(supabase._tables.tg_accounts.length === 0, 'свежевставленный аккаунт удалён');
    assert(supabase._tables.proxies.length === 0, 'прокси удалён');
    assert(proxy.released.length === 1, 'прокси освобождён');
    assert(batch.status === 'failed', 'батч failed (всё упало)');
    assert(batch.items[0].status === 'failed' && batch.items[0].error === INTAKE_MISSING_MIGRATION_MESSAGE, 'точное сообщение про SQL-миграцию');
}

console.log('— processIntakeBatch: упавший insert прокси → всё освобождено —');

{
    const supabase = makeMockSupabase(
        { proxies: [], tg_accounts: [], account_import_batches: [] },
        { tableErrors: { proxies: { insert: { message: 'duplicate key value violates unique constraint' } } } }
    );
    const { batch, proxy } = await runIntake(supabase, [makePackFixture('79000000004')]);

    assert(supabase._tables.tg_accounts.length === 0, 'без аккаунтов при упавшем прокси-insert');
    assert(proxy.released.length === 1, 'поднятый прокси возвращён в инвентарь');
    assert(batch.status === 'failed', 'батч failed');
    assert(String(batch.items[0].error).includes('прокси'), 'айтем с ошибкой про прокси');
}

// --- runIntakeRestingCheck ---

const UB_ID = '11111111-1111-4111-8111-111111111111';
const PROXY_ID = '22222222-2222-4222-8222-222222222222';
const DUPLICATE_ID = '55555555-5555-4555-8555-555555555555';

function restingTables(overrides = {}) {
    return {
        profiles: [{ id: OWNER, role: 'admin' }],
        // Джоба берёт только приёмочный сток: restore source с intake_batch_id.
        userbot_restore_sources: [{ account_id: UB_ID, intake_batch_id: 'batch-1' }],
        tg_accounts: [{
            id: UB_ID,
            owner_id: OWNER,
            account_type: 'userbot',
            tg_account_id: null,
            tg_username: null,
            runtime_status: 'pending_activation',
            session_data: 'enc',
            proxy_id: PROXY_ID,
            last_checked_at: null
        }],
        proxies: [{
            id: PROXY_ID,
            owner_id: OWNER,
            host: '10.0.0.1',
            port: 45817,
            username: 'mp_test',
            password: 'p',
            is_working: true,
            provision_source: 'manual_admin'
        }],
        telegram_error_events: [],
        ...overrides
    };
}

const ME_ONLINE = { id: 555000111, username: 'freshacc', firstName: 'Fresh', lastName: '', phone: '+79991234567' };
const ONLINE_DETAILS = { session: 'alive', restriction: 'clear', restriction_reason: '', spambot: { state: 'clear', reason: '', source: 'spambot' } };
const noSleep = async () => {};

console.log('— runIntakeRestingCheck: online сохраняет safe-mode и пишет identity —');

{
    const supabase = makeMockSupabase(restingTables());
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => ({ status: 'online', reason: null, details: ONLINE_DETAILS, me: ME_ONLINE }),
        sleepFn: noSleep
    });

    const account = supabase._tables.tg_accounts[0];
    assert(account.runtime_status === 'pending_activation', 'safe-mode сохранён (не online)');
    assert(account.runtime_error === null, 'runtime_error очищен');
    assert(account.tg_account_id === '555000111', 'tg_account_id заполнен из getMe');
    assert(account.tg_username === 'freshacc', 'tg_username заполнен');
    assert(account.tg_first_name === 'Fresh' && account.tg_phone === '+79991234567', 'профиль заполнен');
    assert(account.health_summary?.status === 'online' && account.health_summary?.checked_at, 'health_summary записан');
    assert(account.last_checked_at, 'last_checked_at обновлён');
    assert(supabase._tables.telegram_error_events.length === 0, 'без событий');
    assert(supabase._tables.proxies.length === 1, 'прокси не тронут');
}

console.log('— runIntakeRestingCheck: restricted / frozen / expired / дубликат —');

{
    const supabase = makeMockSupabase(restingTables());
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => ({ status: 'restricted', reason: 'SpamBot подтвердил блокировку.', details: ONLINE_DETAILS, me: ME_ONLINE }),
        sleepFn: noSleep
    });

    const account = supabase._tables.tg_accounts[0];
    assert(account.runtime_status === 'restricted', 'статус restricted');
    const events = supabase._tables.telegram_error_events;
    assert(events.length === 1 && events[0].is_restriction === true, 'restriction-событие записано');
    assert(events[0].event_source === 'intake_resting' && events[0].restriction_kind === 'account_restricted', 'event_source/restriction_kind intake_resting/account_restricted');
    assert(supabase._tables.proxies.length === 0, 'прокси почищен как в отстойнике');
    assert(account.proxy_id === null, 'прокси отвязан');
}

{
    const supabase = makeMockSupabase(restingTables());
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => ({ status: 'frozen', reason: 'Аккаунт заморожен Telegram: read-only.', details: ONLINE_DETAILS, me: ME_ONLINE }),
        sleepFn: noSleep
    });

    const account = supabase._tables.tg_accounts[0];
    assert(account.runtime_status === 'frozen', 'статус frozen');
    const events = supabase._tables.telegram_error_events;
    assert(events.length === 1 && events[0].is_restriction === false, 'frozen: не is_restriction (пурж не должен сработать)');
    assert(supabase._tables.proxies.length === 1, 'frozen: прокси сохранён для апелляции');
    assert(supabase._tables.tg_accounts.length === 1, 'frozen: аккаунт сохранён');
}

{
    const supabase = makeMockSupabase(restingTables());
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => ({ status: 'expired', reason: 'Сессия недействительна.', details: null, me: null }),
        sleepFn: noSleep
    });

    const account = supabase._tables.tg_accounts[0];
    assert(account.runtime_status === 'expired', 'статус expired');
    assert(account.runtime_error === 'Сессия недействительна.', 'причина записана');
    assert(supabase._tables.proxies.length === 1, 'expired: прокси остаётся (сессия мертва, не прокси)');
    assert(supabase._tables.telegram_error_events.length === 0, 'expired: без Telegram-события');
}

{
    const supabase = makeMockSupabase(restingTables({
        tg_accounts: [
            ...restingTables().tg_accounts,
            { id: DUPLICATE_ID, owner_id: OWNER, account_type: 'userbot', tg_account_id: '555000111', runtime_status: 'online', proxy_id: null, last_checked_at: null }
        ]
    }));
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => ({ status: 'online', reason: null, details: null, me: ME_ONLINE }),
        sleepFn: noSleep
    });

    const target = supabase._tables.tg_accounts.find((row) => row.id === UB_ID);
    assert(target.runtime_status === 'error', 'дубликат: статус error');
    assert(target.runtime_error === 'Дубликат: этот Telegram-аккаунт уже подключен в системе.', 'дубликат: точное сообщение');
    assert(target.health_summary?.status === 'duplicate', 'дубликат: health_summary.status duplicate');
    assert(supabase._tables.tg_accounts.length === 2, 'дубликат: ничего не удалено');
}

console.log('— runIntakeRestingCheck: свежая проверка и не-админ не трогаются —');

{
    const supabase = makeMockSupabase(restingTables({
        tg_accounts: restingTables().tg_accounts.map((row) => ({ ...row, last_checked_at: new Date().toISOString() }))
    }));
    let checkCalls = 0;
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => { checkCalls += 1; return { status: 'online', reason: null, details: null, me: null }; },
        sleepFn: noSleep
    });
    assert(checkCalls === 0, 'проверка младше часа не повторяется');
}

{
    const supabase = makeMockSupabase(restingTables({
        tg_accounts: restingTables().tg_accounts.map((row) => ({ ...row, owner_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }))
    }));
    let checkCalls = 0;
    await runIntakeRestingCheck(supabase, {}, {
        checkFn: async () => { checkCalls += 1; return { status: 'online', reason: null, details: null, me: null }; },
        sleepFn: noSleep
    });
    assert(checkCalls === 0, 'аккаунт не-платформенного-админа не проверяется');
}

console.log(failures === 0 ? '\nВсе проверки приёмки пачек прошли' : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
