/**
 * Юнит-тесты фильтра bullgram_userbot_list (MCP-инструмент списка юзерботов).
 * Офлайн, детерминированные: хендлер зовётся напрямую на моке supabase,
 * Telegram и HTTP не трогаются.
 *
 * Покрывает: дефолтный вызов прячет витринные лоты (shop_items.status=
 * 'published') и приёмочный сток отлёжки (restore-сорс с intake_batch_id);
 * include_reserved=true показывает всё; draft-лот остаётся видимым
 * (витрина = published, регрессия 2026-11-04).
 *
 * Запуск: node test/test-mcp-userbot-list.js
 */
import { listUserbotsHandler } from '../mcp/tools/account/list-userbots.js';

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

// --- Мок supabase: thenable-билдер, resolve → { data, error } ---
function makeMockSupabase(tablesInit = {}) {
    const tables = {};
    for (const [name, rows] of Object.entries(tablesInit)) tables[name] = rows.map((r) => ({ ...r }));

    return {
        from(table) {
            const rows = tables[table] ?? (tables[table] = []);
            const filters = [];
            const predFor = (filterList) => (row) => filterList.every(([col, op, val]) => {
                const cell = row[col];
                if (op === 'eq') return String(cell) === String(val);
                if (op === 'not_is') return cell !== null && cell !== undefined;
                if (op === 'in') return (val || []).some((v) => String(cell) === String(v));
                return true;
            });
            const matches = () => rows.filter(predFor(filters));
            const builder = {
                select() { return builder; },
                eq(col, val) { filters.push([col, 'eq', val]); return builder; },
                neq(col, val) { filters.push([col, 'ne', val]); return builder; },
                not(col, op, val) {
                    if (op === 'is' && val === null) filters.push([col, 'not_is', null]);
                    return builder;
                },
                in(col, vals) { filters.push([col, 'in', vals]); return builder; },
                order() { return builder; },
                limit() { return builder; },
                then(resolve, reject) {
                    return Promise.resolve({ data: matches(), error: null }).then(resolve, reject);
                }
            };
            return builder;
        },
        _tables: tables
    };
}

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const REGULAR_ID = mockId();
const PUBLISHED_SHOP_ID = mockId();
const DRAFT_SHOP_ID = mockId();
const INTAKE_STOCK_ID = mockId();
const PUBLISHED_ITEM_ID = mockId();
const DRAFT_ITEM_ID = mockId();

function listTables() {
    return {
        tg_accounts: [
            { id: REGULAR_ID, owner_id: OWNER, account_type: 'userbot', tg_username: 'regular_bot', tg_account_id: '1001', runtime_status: 'online', proxy_id: null, last_update_at: null, created_at: '2026-11-01T00:00:00Z' },
            { id: PUBLISHED_SHOP_ID, owner_id: OWNER, account_type: 'userbot', tg_username: 'shopfront_bot', tg_account_id: '1002', runtime_status: 'online', proxy_id: null, last_update_at: null, created_at: '2026-11-02T00:00:00Z' },
            { id: DRAFT_SHOP_ID, owner_id: OWNER, account_type: 'userbot', tg_username: 'draft_lot_bot', tg_account_id: '1003', runtime_status: 'online', proxy_id: null, last_update_at: null, created_at: '2026-11-03T00:00:00Z' },
            { id: INTAKE_STOCK_ID, owner_id: OWNER, account_type: 'userbot', tg_username: 'resting_bot', tg_account_id: '1004', runtime_status: 'pending_activation', proxy_id: null, last_update_at: null, created_at: '2026-11-04T00:00:00Z' }
        ],
        shop_items: [
            { id: PUBLISHED_ITEM_ID, owner_id: OWNER, status: 'published', visibility: 'public' },
            { id: DRAFT_ITEM_ID, owner_id: OWNER, status: 'draft', visibility: 'private' }
        ],
        shop_item_assets: [
            { shop_item_id: PUBLISHED_ITEM_ID, asset_type: 'userbot', asset_id: PUBLISHED_SHOP_ID },
            { shop_item_id: DRAFT_ITEM_ID, asset_type: 'userbot', asset_id: DRAFT_SHOP_ID }
        ],
        userbot_restore_sources: [
            { owner_id: OWNER, account_id: INTAKE_STOCK_ID, intake_batch_id: 'batch-1' }
        ]
    };
}

async function callList(supabase, args = {}) {
    return listUserbotsHandler({ supabase, req: { user: { id: OWNER } }, args });
}

console.log('— bullgram_userbot_list: дефолт прячет витрину и отлёжку —');

{
    const supabase = makeMockSupabase(listTables());
    const result = await callList(supabase);
    const ids = result.userbots.map((u) => u.id);
    assert(result.count === 2, 'видны ровно два бота');
    assert(ids.includes(REGULAR_ID), 'обычный бот виден');
    assert(ids.includes(DRAFT_SHOP_ID), 'draft-лот виден (витрина = published)');
    assert(!ids.includes(PUBLISHED_SHOP_ID), 'published-лот спрятан');
    assert(!ids.includes(INTAKE_STOCK_ID), 'приёмочный сток (отлёжка) спрятан');
}

console.log('— bullgram_userbot_list: include_reserved=true показывает всё —');

{
    const supabase = makeMockSupabase(listTables());
    const result = await callList(supabase, { include_reserved: true });
    assert(result.count === 4, 'все четыре бота видны');
}

console.log('— bullgram_userbot_list: отлёжка по чужому restore-сорсу не прячется —');

{
    const tables = listTables();
    tables.userbot_restore_sources = [{ owner_id: OWNER, account_id: INTAKE_STOCK_ID, intake_batch_id: null }];
    const supabase = makeMockSupabase(tables);
    const result = await callList(supabase);
    const ids = result.userbots.map((u) => u.id);
    assert(ids.includes(INTAKE_STOCK_ID), 'restore-сорс без intake_batch_id — не отлёжка');
    assert(!ids.includes(PUBLISHED_SHOP_ID), 'витрина по-прежнему спрятана');
}

console.log(failures === 0 ? '\nВсе проверки фильтра списка юзерботов прошли' : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
