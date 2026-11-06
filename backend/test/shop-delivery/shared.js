// Общие фикстуры сценариев test/shop-delivery/* (вынесено из test/test-shop-delivery.js вербатимно).
import crypto from 'crypto';
import { encrypt } from '../../utils/crypto.js';

let failures = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        failures++;
    }
}
async function capture(promise) {
    try {
        await promise;
        return null;
    } catch (e) {
        return e;
    }
}

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BUYER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACC1 = '11111111-1111-4111-8111-111111111111';
const ACC2 = '12121212-1212-4121-8121-121212121212';
const ACC3 = '14141414-1414-4141-8141-141414141414';
const ACC_BAD = '13131313-1313-4131-8131-131313131313';
const PROXY_ID = '22222222-2222-4222-8222-222222222222';
const PROXY2_ID = '23232323-2323-4232-8232-232323232323';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_HYBRID = '34343434-3434-4343-8343-343434343434';
const PURCHASE_ID = '44444444-4444-4444-8444-444444444444';
const PURCHASE_HYBRID_ID = '45454545-4545-4545-8545-454545454545';

const FRESH_ISO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const STALE_ISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
// --- Мок supabase: thenable-билдер с проекцией select, insert/update/delete,
// фильтры eq/in/is/lt/not + json-пути вида payload->delivery->>mode ---
function makeMockSupabase(tablesInit = {}) {
    const tables = {};
    for (const [name, rows] of Object.entries(tablesInit)) tables[name] = rows.map((r) => ({ ...r }));

    const cellFor = (row, col) => {
        if (!col.includes('->')) return row?.[col];
        const segs = col.split('->').map((part, index) => (index > 0 && part.startsWith('>') ? part.slice(1) : part));
        let cur = row;
        for (const seg of segs) {
            if (cur == null) return undefined;
            cur = cur[seg];
        }
        return cur;
    };
    const applyOp = (row, col, op, val) => {
        const cell = cellFor(row, col);
        if (op === 'eq') return String(cell) === String(val);
        if (op === 'is') return (val === null || val === undefined) ? (cell === null || cell === undefined) : cell === val;
        if (op === 'lt') return cell != null && new Date(cell).getTime() < new Date(val).getTime();
        if (op === 'not') return !applyOp(row, col, val.op, val.value);
        if (op === 'in') return (val || []).some((v) => String(cell) === String(v));
        return true;
    };
    const predFor = (filters) => (row) => filters.every(([col, op, val]) => applyOp(row, col, op, val));

    const db = {
        from(table) {
            const rows = tables[table] ?? (tables[table] = []);
            const filters = [];
            let selectCols = '';
            const matches = () => rows.filter((row) => predFor(filters)(row));
            const project = (row) => {
                const cols = String(selectCols || '').split(',').map((s) => s.trim()).filter(Boolean);
                if (!cols.length || cols.includes('*')) return { ...row };
                return Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]]));
            };
            const builder = {
                select(cols) { selectCols = String(cols || ''); return builder; },
                eq(col, val) { filters.push([col, 'eq', val]); return builder; },
                is(col, val) { filters.push([col, 'is', val]); return builder; },
                lt(col, val) { filters.push([col, 'lt', val]); return builder; },
                not(col, op, val) { filters.push([col, 'not', { op, value: val }]); return builder; },
                in(col, vals) { filters.push([col, 'in', vals]); return builder; },
                order() { return builder; },
                limit() { return builder; },
                insert(payload) {
                    const list = Array.isArray(payload) ? payload : [payload];
                    const inserted = list.map((p) => ({ id: p.id || crypto.randomUUID(), ...p }));
                    rows.push(...inserted);
                    const insertBuilder = {
                        select(cols) { selectCols = String(cols || ''); return insertBuilder; },
                        single: async () => ({ data: inserted[0] ? project(inserted[0]) : null, error: null }),
                        maybeSingle: async () => ({ data: inserted[0] ? project(inserted[0]) : null, error: null }),
                        then(resolve) { resolve({ data: inserted.map(project), error: null }); }
                    };
                    return insertBuilder;
                },
                update(patch) {
                    const apply = () => {
                        const patched = [];
                        for (const row of rows) {
                            if (predFor(filters)(row)) { Object.assign(row, patch); patched.push(row); }
                        }
                        return patched;
                    };
                    const updateBuilder = {
                        eq(col, val) { filters.push([col, 'eq', val]); return updateBuilder; },
                        in(col, vals) { filters.push([col, 'in', vals]); return updateBuilder; },
                        select(cols) { selectCols = String(cols || ''); return updateBuilder; },
                        single: async () => { const patched = apply(); return { data: patched[0] ? { ...patched[0] } : null, error: null }; },
                        maybeSingle: async () => { const patched = apply(); return { data: patched[0] ? { ...patched[0] } : null, error: null }; },
                        then(resolve) { const patched = apply(); resolve({ data: null, error: null, count: patched.length }); }
                    };
                    return updateBuilder;
                },
                delete() {
                    const deleteBuilder = {
                        eq(col, val) { filters.push([col, 'eq', val]); return deleteBuilder; },
                        in(col, vals) { filters.push([col, 'in', vals]); return deleteBuilder; },
                        then(resolve) {
                            const doomed = rows.filter((row) => predFor(filters)(row));
                            const keep = rows.filter((row) => !predFor(filters)(row));
                            rows.length = 0;
                            rows.push(...keep);
                            resolve({ data: null, error: null, count: doomed.length });
                        }
                    };
                    return deleteBuilder;
                },
                maybeSingle: async () => { const m = matches(); return { data: m[0] ? project(m[0]) : null, error: null }; },
                single: async () => { const m = matches(); return { data: m[0] ? project(m[0]) : null, error: null }; },
                then(resolve) { const m = matches(); resolve({ data: m.map(project), error: null, count: m.length }); }
            };
            return builder;
        }
    };
    db._tables = tables;
    return db;
}

function accountRow(overrides = {}) {
    return {
        id: ACC1,
        owner_id: OWNER,
        account_type: 'userbot',
        custom_label: '+13…642',
        runtime_status: 'pending_activation',
        last_checked_at: FRESH_ISO,
        health_summary: { status: 'online' },
        proxy_id: PROXY_ID,
        // Отлёжка по умолчанию давно пройдена (правило продажи 2026-11-03).
        created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        ...overrides
    };
}

function restoreSourceRow(overrides = {}) {
    return {
        account_id: ACC1,
        owner_id: OWNER,
        session_blob_encrypted: encrypt(Buffer.from('SESSION-SQLITE-BYTES').toString('base64')),
        json_blob_encrypted: encrypt('{"app_id": 4, "device": "Desktop"}'),
        tdata_blob_encrypted: encrypt(Buffer.from('TDATA-ZIP-BYTES').toString('base64')),
        two_fa_secret_encrypted: encrypt('p@ssw0rd-2fa'),
        ...overrides
    };
}

function filesDelivery(deliveredAtIso, overrides = {}) {
    return {
        mode: 'files',
        downloads: [],
        downloads_max: 10,
        window_hours: 168,
        purged_at: null,
        sha256: null,
        size_bytes: null,
        ...overrides
    };
}

function accountItemRow(overrides = {}) {
    return {
        id: ITEM_ID,
        owner_id: OWNER,
        title: 'Аккаунт из приёмки',
        item_type: 'account',
        delivery_mode: 'files',
        price_ton: 12,
        status: 'published',
        visibility: 'public',
        sales_channel: 'both',
        payment_methods: ['ton'],
        transfer_mode: 'ownership_transfer',
        ...overrides
    };
}

function baseTables(overrides = {}) {
    return {
        tg_accounts: [accountRow()],
        proxies: [{
            id: PROXY_ID, owner_id: OWNER, host: '1.2.3.4', port: 1080,
            username: 'u3p', password: 'pw', is_working: true,
            provision_source: 'manual_admin', inventory_group: 'self_use'
        }],
        shop_items: [accountItemRow()],
        shop_item_assets: [{
            id: 'sa1', shop_item_id: ITEM_ID, asset_type: 'userbot', asset_id: ACC1, label: '+13…642', sort_order: 0
        }],
        shop_purchases: [],
        userbot_restore_sources: [restoreSourceRow()],
        ...overrides
    };
}

function pendingPurchase(overrides = {}) {
    return {
        id: PURCHASE_ID,
        shop_item_id: ITEM_ID,
        seller_owner_id: OWNER,
        buyer_owner_id: null,
        status: 'pending',
        amount_ton: 12,
        ownership_transfer_status: 'pending',
        ownership_transfer_error: null,
        delivered_at: null,
        created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        payload: { payment_method: 'ton', memo: 'shop_test1', seller_wallet: 'UQtestwalletforrunittests000' },
        ...overrides
    };
}

export function failureCount() {
    return failures;
}

export {
    assert,
    capture,
    OWNER,
    BUYER,
    ACC1,
    ACC2,
    ACC3,
    ACC_BAD,
    PROXY_ID,
    PROXY2_ID,
    ITEM_ID,
    ITEM_HYBRID,
    PURCHASE_ID,
    PURCHASE_HYBRID_ID,
    FRESH_ISO,
    STALE_ISO,
    makeMockSupabase,
    accountRow,
    restoreSourceRow,
    filesDelivery,
    accountItemRow,
    baseTables,
    pendingPurchase
};
