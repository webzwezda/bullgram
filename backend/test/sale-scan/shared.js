// Общие фикстуры сценариев test/sale-scan/* (вынесено из test/test-sale-scan.js вербатимно).

let failures = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        failures++;
    }
}

let idSeq = 0;
function mockId() {
    idSeq += 1;
    return `00000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`;
}

// --- Мок supabase: thenable-билдер с eq/neq/in/lt + insert().select().single()
// (копия стиля test-account-intake.js — там мок не экспортируется) ---
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

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const noSleep = async () => {};
const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

function makeMockManagedProxy() {
    const calls = [];
    return {
        calls,
        async releaseManagedProxy(args) { calls.push(args); return true; },
        async releaseManagedProxyBatch({ records }) { return (records || []).length; }
    };
}

function makeAccountFixture(id, overrides = {}) {
    return {
        id,
        owner_id: OWNER,
        account_type: 'userbot',
        tg_account_id: null,
        tg_username: null,
        custom_label: null,
        runtime_status: 'pending_activation',
        session_data: 'enc',
        proxy_id: null,
        last_checked_at: null,
        health_summary: null,
        // Отлёжка по умолчанию давно пройдена — тесты правила переопределяют.
        created_at: THIRTY_DAYS_AGO,
        tg_phone: null,
        ...overrides
    };
}

export function failureCount() {
    return failures;
}

export {
    assert,
    mockId,
    makeMockSupabase,
    OWNER,
    OTHER,
    noSleep,
    THIRTY_DAYS_AGO,
    makeMockManagedProxy,
    makeAccountFixture
};
