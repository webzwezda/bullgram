// Общие фикстуры сценариев test/account-intake/* (вынесено из test/test-account-intake.js вербатимно).
import { UserbotService } from '../../services/userbot.service.js';
import { processIntakeBatch } from '../../services/account-intake.service.js';

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
                neq(col, val) { filters.push([col, 'ne', val]); return builder; },
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
                        neq(col, val) { filters.push([col, 'ne', val]); return ub; },
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
const realService = new UserbotService({}, 111, 'test-hash');
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

export function failureCount() {
    return failures;
}

export {
    assert,
    encodeCp1251,
    sqliteHeaderFixture,
    makeMockSupabase,
    realService,
    OWNER,
    makePackFixture,
    intakeUserbotStub,
    runIntake,
    UB_ID,
    PROXY_ID,
    DUPLICATE_ID,
    restingTables,
    ME_ONLINE,
    ONLINE_DETAILS,
    noSleep
};
