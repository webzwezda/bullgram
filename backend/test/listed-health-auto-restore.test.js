// Авто-возврат карантинных лотов на витрину (BACKLOG §33, симметрия
// двухстрайк-карантину). Офлайн, детерминированные: runListedHealthCheck гоняем
// на моке supabase в стиле test/shop-quarantine.test.js, Telegram не трогаем —
// в job передаём инъекционный checkFn, globalThis.fetch подменяем рекордером
// (алерт авто-возврата).
//
// Покрывает: (a) карантинный лот + 1 online → streak=1 без восстановления;
// (b) 2-й подряд online → published/public + is_working=true + streak=0 + алерт;
// (c) sentinel после restricted — восстановления нет; (d) неудача между online
// сбрасывает streak; (e) анти-флап для published-лотов жив; (f) sold не
// загружается; (g) лот старше 14 дней не загружается.
import assert from 'node:assert';
import { test, after } from 'node:test';
import { runListedHealthCheck } from '../jobs/listed-userbot-health.job.js';

// --- Алерт: рекордер вместо globalThis.fetch (env как на проде) ---
const sentAlerts = [];
const realFetch = globalThis.fetch;
process.env.TG_BOT_TOKEN = 'test-bot-token';
process.env.TG_ADMIN_CHAT_ID = '424242';
globalThis.fetch = async (url, init) => {
    sentAlerts.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) });
    return { ok: true, status: 200 };
};
after(() => {
    globalThis.fetch = realFetch;
    delete process.env.TG_BOT_TOKEN;
    delete process.env.TG_ADMIN_CHAT_ID;
});

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UB_ID = '11111111-1111-4111-8111-111111111111';
const PROXY_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';

const STALE_ISO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // проходит age-guard 60 мин
const NOW_ISO = new Date().toISOString();
const FIFTEEN_DAYS_AGO_ISO = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();

const ONLINE = { status: 'online', reason: null, details: null };
const userbotServiceStub = {};

// --- Мок supabase: thenable-билдер с фильтрами eq/in/gte + проекция select ---
function makeMockSupabase(tablesInit = {}) {
    const tables = {};
    for (const [name, rows] of Object.entries(tablesInit)) tables[name] = rows.map((r) => ({ ...r }));
    const predFor = (filters) => (row) => filters.every(([col, op, val]) => {
        const cell = row[col];
        if (op === 'eq') return String(cell) === String(val);
        if (op === 'in') return (val || []).some((v) => String(cell) === String(v));
        if (op === 'gte') return new Date(cell).getTime() >= new Date(val).getTime();
        return true;
    });
    const project = (colsStr) => (row) => {
        const cols = String(colsStr || '').split(',').map((s) => s.trim()).filter(Boolean);
        return cols.includes('*') || !cols.length
            ? { ...row }
            : Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]]));
    };
    const db = {
        from(table) {
            const rows = tables[table] ?? (tables[table] = []);
            const filters = [];
            const matches = () => rows.filter(predFor(filters));
            const builder = {
                _cols: '',
                select(cols) { builder._cols = String(cols || ''); return builder; },
                eq(col, val) { filters.push([col, 'eq', val]); return builder; },
                in(col, vals) { filters.push([col, 'in', vals]); return builder; },
                gte(col, val) { filters.push([col, 'gte', val]); return builder; },
                insert(payload) {
                    const list = Array.isArray(payload) ? payload : [payload];
                    for (const p of list) rows.push({ ...p });
                    return Promise.resolve({ data: list.map((p) => ({ ...p })), error: null });
                },
                update(patch) {
                    let selectCalled = false;
                    const updateBuilder = {
                        select(cols) { selectCalled = true; updateBuilder._cols = String(cols || ''); return updateBuilder; },
                        eq(col, val) { filters.push([col, 'eq', val]); return updateBuilder; },
                        in(col, vals) { filters.push([col, 'in', vals]); return updateBuilder; },
                        then(resolve) {
                            const updated = [];
                            for (const row of rows) {
                                if (predFor(filters)(row)) { Object.assign(row, patch); updated.push({ ...row }); }
                            }
                            resolve({
                                data: selectCalled ? updated.map(project(updateBuilder._cols)) : null,
                                error: null,
                                count: updated.length
                            });
                        }
                    };
                    updateBuilder._cols = '';
                    return updateBuilder;
                },
                delete() {
                    const deleteBuilder = {
                        eq(col, val) { filters.push([col, 'eq', val]); return deleteBuilder; },
                        in(col, vals) { filters.push([col, 'in', vals]); return deleteBuilder; },
                        then(resolve) {
                            const keep = rows.filter((row) => !predFor(filters)(row));
                            const removed = rows.length - keep.length;
                            rows.length = 0;
                            rows.push(...keep);
                            resolve({ data: null, error: null, count: removed });
                        }
                    };
                    return deleteBuilder;
                },
                maybeSingle: async () => ({ data: matches()[0] ? { ...matches()[0] } : null, error: null }),
                single: async () => ({ data: matches()[0] ? { ...matches()[0] } : null, error: null }),
                then(resolve) {
                    // Проекция колонок как в PostgREST: ловит код, который читает
                    // невыбранные поля (select — не украшение, а контракт).
                    resolve({
                        data: matches().map(project(builder._cols)),
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

function accountRow(overrides = {}) {
    return {
        id: UB_ID, owner_id: OWNER, account_type: 'userbot',
        tg_username: 'testbot', runtime_status: 'online',
        session_data: 'enc', proxy_id: PROXY_ID,
        healthy_streak: 0, last_checked_at: STALE_ISO,
        ...overrides
    };
}

function itemRow(overrides = {}) {
    return {
        id: ITEM_ID, owner_id: OWNER, status: 'published',
        visibility: 'public', title: 'Лот', updated_at: NOW_ISO,
        ...overrides
    };
}

// Карантинное состояние: лот снят unpublish'ем (draft/private), прокси остался.
function quarantinedTables(overrides = {}) {
    return {
        tg_accounts: [accountRow({ runtime_status: 'error', healthy_streak: 0 })],
        proxies: [{
            id: PROXY_ID, owner_id: OWNER, host: '1.2.3.4', port: 1080,
            username: 'u', password: 'p', is_working: false,
            last_check_ip: null, provision_source: null, inventory_group: null
        }],
        shop_items: [itemRow({ status: 'draft', visibility: 'private' })],
        shop_item_assets: [{ id: 'sa1', shop_item_id: ITEM_ID, asset_type: 'userbot', asset_id: UB_ID }],
        shop_purchases: [],
        telegram_error_events: [],
        userbot_restore_sources: [],
        userbot_inbox_notifications: [],
        ...overrides
    };
}

// Один тик джобы + сброс age-guard между тиками (джоба пишет last_checked_at=now).
async function tick(supabase, result, counter) {
    await runListedHealthCheck(supabase, userbotServiceStub, {
        checkFn: async () => { counter.calls += 1; return result; }
    });
    for (const row of supabase._tables.tg_accounts) row.last_checked_at = STALE_ISO;
}

test('карантинный лот: 1-й online — streak=1, восстановления нет', async () => {
    const supabase = makeMockSupabase(quarantinedTables());
    const counter = { calls: 0 };
    const alertsBefore = sentAlerts.length;

    await tick(supabase, ONLINE, counter);

    assert.strictEqual(counter.calls, 1, 'карантинный лот должен проверяться');
    assert.strictEqual(supabase._tables.tg_accounts[0].healthy_streak, 1, 'streak после 1-го online = 1');
    assert.strictEqual(supabase._tables.shop_items[0].status, 'draft', 'лот остаётся в карантине');
    assert.strictEqual(supabase._tables.shop_items[0].visibility, 'private');
    assert.strictEqual(supabase._tables.proxies[0].is_working, false, 'прокси не тронут');
    assert.strictEqual(sentAlerts.length, alertsBefore, 'алерта нет');
});

test('2-й подряд online — published/public + is_working=true + streak=0 + алерт', async () => {
    const supabase = makeMockSupabase(quarantinedTables());
    const counter = { calls: 0 };
    const alertsBefore = sentAlerts.length;

    await tick(supabase, ONLINE, counter);
    await tick(supabase, ONLINE, counter);

    assert.strictEqual(counter.calls, 2);
    const item = supabase._tables.shop_items[0];
    assert.strictEqual(item.status, 'published', 'лот возвращён на витрину');
    assert.strictEqual(item.visibility, 'public', 'visibility снова public');
    assert.ok(item.updated_at, 'updated_at обновлён');
    assert.strictEqual(supabase._tables.proxies[0].is_working, true, 'прокси помечен рабочим');
    assert.strictEqual(supabase._tables.tg_accounts[0].healthy_streak, 0, 'streak сброшен после возврата');
    assert.strictEqual(sentAlerts.length, alertsBefore + 1, 'TG-алерт отправлен');
    assert.ok(sentAlerts.at(-1).url.includes('/sendMessage'), 'алерт идёт в sendMessage');
    assert.ok(sentAlerts.at(-1).body.text.includes('@testbot'), 'в алерте username лота');
});

test('sentinel: карантин после restricted, затем 2× online — восстановления НЕТ', async () => {
    // Тик 1: published-лот, Telegram-авторитетный restricted — сразу в карантин.
    const supabase = makeMockSupabase(quarantinedTables({
        tg_accounts: [accountRow()],
        shop_items: [itemRow()]
    }));
    const counter = { calls: 0 };
    const alertsBefore = sentAlerts.length;

    await tick(supabase, { status: 'restricted', reason: 'SpamBot подтвердил блокировку.' }, counter);
    assert.strictEqual(supabase._tables.shop_items[0].status, 'draft', 'restricted: лот снят');
    assert.strictEqual(supabase._tables.tg_accounts[0].healthy_streak, -1, 'restricted: sentinel -1');
    assert.strictEqual(supabase._tables.proxies.length, 0, 'restricted: прокси почищен (существующая логика)');
    assert.strictEqual(supabase._tables.tg_accounts[0].proxy_id, null);

    // Тики 2-3: карантинный лот проверяется, аккаунт жив — но sentinel не даёт возврат.
    await tick(supabase, ONLINE, counter);
    await tick(supabase, ONLINE, counter);

    assert.strictEqual(counter.calls, 3, 'карантинный лот после restricted проверяется');
    assert.strictEqual(supabase._tables.tg_accounts[0].healthy_streak, -1, 'sentinel переживает online-проверки');
    assert.strictEqual(supabase._tables.shop_items[0].status, 'draft', 'восстановления нет');
    assert.strictEqual(supabase._tables.shop_items[0].visibility, 'private');
    assert.strictEqual(sentAlerts.length, alertsBefore, 'алерта нет');
});

test('неудача между online сбрасывает streak', async () => {
    const supabase = makeMockSupabase(quarantinedTables());
    const counter = { calls: 0 };

    await tick(supabase, ONLINE, counter);
    assert.strictEqual(supabase._tables.tg_accounts[0].healthy_streak, 1);

    await tick(supabase, { status: 'dead_proxy', reason: 'IPv6-флап.' }, counter);
    assert.strictEqual(supabase._tables.tg_accounts[0].healthy_streak, 0, 'неудача сбросила streak');
    assert.strictEqual(supabase._tables.shop_items[0].status, 'draft');

    await tick(supabase, ONLINE, counter);
    assert.strictEqual(supabase._tables.tg_accounts[0].healthy_streak, 1, 'серия началась заново');
    assert.strictEqual(supabase._tables.shop_items[0].status, 'draft', 'одного online после сброса мало');

    await tick(supabase, ONLINE, counter);
    assert.strictEqual(supabase._tables.shop_items[0].status, 'published', 'после 2 подряд online лот восстановлен');
    assert.strictEqual(supabase._tables.shop_items[0].visibility, 'public');
});

test('published-лот: первая инфра-неудача не снимает (анти-флап жив), вторая подряд снимает и пишет streak=0', async () => {
    const supabase = makeMockSupabase(quarantinedTables({
        tg_accounts: [accountRow()],
        shop_items: [itemRow()]
    }));
    const counter = { calls: 0 };

    await tick(supabase, { status: 'dead_proxy', reason: 'IPv6-флап.' }, counter);
    assert.strictEqual(supabase._tables.shop_items[0].status, 'published', 'первая инфра-неудача лот держит');
    assert.strictEqual(supabase._tables.shop_items[0].visibility, 'public');
    assert.strictEqual(supabase._tables.tg_accounts[0].healthy_streak, 0, 'streak сброшен неудачей');

    await tick(supabase, { status: 'dead_proxy', reason: 'IPv6-флап.' }, counter);
    assert.strictEqual(supabase._tables.shop_items[0].status, 'draft', 'вторая подряд неудача снимает лот');
    assert.strictEqual(supabase._tables.shop_items[0].visibility, 'private');
    assert.strictEqual(supabase._tables.tg_accounts[0].healthy_streak, 0, 'при карантине за инфра-причину streak=0');
});

test("'sold' лот не загружается", async () => {
    const supabase = makeMockSupabase(quarantinedTables({
        shop_items: [itemRow({ status: 'sold' })]
    }));
    const counter = { calls: 0 };

    await runListedHealthCheck(supabase, userbotServiceStub, {
        checkFn: async () => { counter.calls += 1; return ONLINE; }
    });

    assert.strictEqual(counter.calls, 0, 'sold-лот не попадает в проверку');
    assert.strictEqual(supabase._tables.shop_items[0].status, 'sold', 'sold-лот не тронут');
});

test('карантинный лот старше 14 дней не загружается', async () => {
    const supabase = makeMockSupabase(quarantinedTables({
        shop_items: [itemRow({ status: 'draft', visibility: 'private', updated_at: FIFTEEN_DAYS_AGO_ISO })]
    }));
    const counter = { calls: 0 };

    await runListedHealthCheck(supabase, userbotServiceStub, {
        checkFn: async () => { counter.calls += 1; return ONLINE; }
    });

    assert.strictEqual(counter.calls, 0, 'старый карантин вне окна авто-возврата');
    assert.strictEqual(supabase._tables.shop_items[0].status, 'draft');
});
