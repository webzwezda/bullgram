// Юнит-тесты JIT-выдачи managed-прокси новому юзерботу (BACKLOG §32).
// Офлайн, детерминированные: мок supabase в стиле test/messaging-router/shared.js
// (in-memory rows + thenable-билдер с фильтрами eq/is/like/order/limit и
// update c count: 'exact'); Telegram алерт — на моке globalThis.fetch.
//
// Покрывает: (a) флаг off → disabled, БД не тронута; (b) свободный слот →
// условный claim + tg_accounts.proxy_id записан (берётся младший mp_* по
// username); (c) гонка (claim update вернул 0) → race_lost, аккаунт не тронут;
// (d) пул пуст → pool_empty + alert('proxy_pool_exhausted'); (e) дедуп алерта:
// повторный вызов notifyPlatformAlert в пределах 1ч не шлёт повторно.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
    allocateManagedProxyForAccount,
    PROXY_POOL_EXHAUSTED_ALERT_KEY
} from '../services/proxy-allocation.service.js';
import {
    notifyPlatformAlert,
    __resetPlatformAlertDedupForTests
} from '../utils/platform-telegram-alert.js';

const OWNER = 'owner-1';
const ACCOUNT_ID = 'acc-1';
const FLAG = 'USERBOT_AUTO_ALLOCATE_PROXY_ENABLED';

// ---------------------------------------------------------------------------
// Мок supabase: фильтры применяются на await; update возвращает честный count
// совпавших строк (основа для условного claim). onAfterSelect вызывается после
// каждого select — тест через него имитирует параллельный claim (гонку).
// ---------------------------------------------------------------------------
function makeMockSupabase({ proxies = [], accounts = [], onAfterSelect = null } = {}) {
    const tables = {
        proxies: proxies.map((row) => ({ ...row })),
        tg_accounts: accounts.map((row) => ({ ...row }))
    };
    const calls = [];

    function from(table) {
        const rows = tables[table] || (tables[table] = []);
        const state = { op: 'select', patch: null, wantCount: false, filters: [], orderCol: null, orderAsc: true, limitN: null };
        const matches = () => rows.filter((row) => state.filters.every(([col, test]) => test(row[col])));

        const builder = {
            select() { state.op = 'select'; return builder; },
            update(patch, opts = {}) {
                state.op = 'update';
                state.patch = patch;
                state.wantCount = opts?.count === 'exact';
                return builder;
            },
            eq(col, val) {
                state.filters.push([col, (cell) => String(cell) === String(val)]);
                return builder;
            },
            is(col, val) {
                state.filters.push([col, (cell) => (val === null ? (cell === null || cell === undefined) : cell === val)]);
                return builder;
            },
            like(col, pattern) {
                const re = new RegExp('^' + String(pattern)
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                    .replace(/%/g, '.*')
                    .replace(/_/g, '.') + '$');
                state.filters.push([col, (cell) => re.test(String(cell ?? ''))]);
                return builder;
            },
            order(col, opts = {}) { state.orderCol = col; state.orderAsc = opts.ascending !== false; return builder; },
            limit(n) { state.limitN = n; return builder; },
            then(resolve, reject) {
                calls.push({ table, op: state.op });
                try {
                    if (state.op === 'select') {
                        let out = matches();
                        if (state.orderCol) {
                            out = [...out].sort((a, b) => (state.orderAsc ? 1 : -1)
                                * String(a[state.orderCol]).localeCompare(String(b[state.orderCol])));
                        }
                        if (state.limitN != null) out = out.slice(0, state.limitN);
                        if (onAfterSelect) onAfterSelect({ table });
                        resolve({ data: out, error: null });
                        return;
                    }
                    const matched = matches();
                    for (const row of matched) Object.assign(row, state.patch);
                    resolve({ data: null, error: null, count: state.wantCount ? matched.length : null });
                } catch (error) {
                    reject(error);
                }
            }
        };
        return builder;
    }

    return { from, tables, calls };
}

const SLOT_A = { id: 'p-1', username: 'mp_1', host: '203.0.113.10', port: 25101, owner_id: null };
const SLOT_B = { id: 'p-2', username: 'mp_2', host: '203.0.113.10', port: 25102, owner_id: OWNER };

function enableFlag() { process.env[FLAG] = 'true'; }
function disableFlag() { delete process.env[FLAG]; }

describe('allocateManagedProxyForAccount', () => {
    beforeEach(disableFlag);
    afterEach(disableFlag);

    it('(a) flag off → disabled, БД не тронута', async () => {
        const db = makeMockSupabase({ proxies: [SLOT_A], accounts: [{ id: ACCOUNT_ID, owner_id: OWNER, proxy_id: null }] });

        const result = await allocateManagedProxyForAccount(db, { ownerId: OWNER, accountId: ACCOUNT_ID });

        assert.deepStrictEqual(result, { allocated: false, reason: 'disabled' });
        assert.strictEqual(db.calls.length, 0, 'ни одного запроса в БД при выключенном флаге');
        assert.strictEqual(db.tables.proxies[0].owner_id, null);
        assert.strictEqual(db.tables.tg_accounts[0].proxy_id, null);
    });

    it('(b) свободный слот → claim условным update + tg_accounts.proxy_id записан', async () => {
        enableFlag();
        const db = makeMockSupabase({
            proxies: [SLOT_B, SLOT_A],
            accounts: [{ id: ACCOUNT_ID, owner_id: OWNER, proxy_id: null }]
        });

        const result = await allocateManagedProxyForAccount(db, { ownerId: OWNER, accountId: ACCOUNT_ID, alert: () => { throw new Error('alert must not fire on success'); } });

        assert.strictEqual(result.allocated, true);
        assert.deepStrictEqual(result.proxy, { id: 'p-1', username: 'mp_1', host: '203.0.113.10', port: 25101 }, 'берётся младший mp_* по username');
        assert.strictEqual(db.tables.proxies.find((row) => row.id === 'p-1').owner_id, OWNER, 'слот заклеймлен');
        assert.strictEqual(db.tables.proxies.find((row) => row.id === 'p-2').owner_id, OWNER, 'чужой занятый слот не тронут');
        assert.strictEqual(db.tables.tg_accounts[0].proxy_id, 'p-1', 'аккаунту записан proxy_id');
    });

    it('(c) гонка (claim update вернул 0) → race_lost, tg_accounts не тронут', async () => {
        enableFlag();
        // Имитация параллельного claim: сразу после select слот забирает «соперник»,
        // условный update (owner_id IS NULL) честно совпадает с 0 строками.
        const db = makeMockSupabase({
            proxies: [{ ...SLOT_A }],
            accounts: [{ id: ACCOUNT_ID, owner_id: OWNER, proxy_id: null }],
            onAfterSelect: ({ table }) => {
                if (table === 'proxies') db.tables.proxies[0].owner_id = 'rival-owner';
            }
        });

        const result = await allocateManagedProxyForAccount(db, { ownerId: OWNER, accountId: ACCOUNT_ID });

        assert.deepStrictEqual(result, { allocated: false, reason: 'race_lost' });
        assert.strictEqual(db.tables.proxies[0].owner_id, 'rival-owner', 'слот остаётся у соперника');
        assert.strictEqual(db.tables.tg_accounts[0].proxy_id, null, 'аккаунт не получил чужой слот');
    });

    it('(d) пул пуст → pool_empty + alert вызван', async () => {
        enableFlag();
        const db = makeMockSupabase({
            proxies: [{ ...SLOT_B, owner_id: 'someone-else' }],
            accounts: [{ id: ACCOUNT_ID, owner_id: OWNER, proxy_id: null }]
        });
        const alertCalls = [];

        const result = await allocateManagedProxyForAccount(db, {
            ownerId: OWNER,
            accountId: ACCOUNT_ID,
            alert: (key) => alertCalls.push(key)
        });

        assert.deepStrictEqual(result, { allocated: false, reason: 'pool_empty' });
        assert.deepStrictEqual(alertCalls, [PROXY_POOL_EXHAUSTED_ALERT_KEY]);
        assert.strictEqual(alertCalls[0], 'proxy_pool_exhausted');
        assert.strictEqual(db.tables.tg_accounts[0].proxy_id, null);
    });

    it('(d2) alert отсутствует/бросает — не ломает pool_empty', async () => {
        enableFlag();
        const empty = makeMockSupabase({ proxies: [], accounts: [] });

        const withoutAlert = await allocateManagedProxyForAccount(empty, { ownerId: OWNER, accountId: ACCOUNT_ID });
        assert.deepStrictEqual(withoutAlert, { allocated: false, reason: 'pool_empty' });

        const throwingAlert = makeMockSupabase({ proxies: [], accounts: [] });
        const withBrokenAlert = await allocateManagedProxyForAccount(throwingAlert, {
            ownerId: OWNER,
            accountId: ACCOUNT_ID,
            alert: () => { throw new Error('alert transport down'); }
        });
        assert.deepStrictEqual(withBrokenAlert, { allocated: false, reason: 'pool_empty' });
    });

    it('(e) дедуп алерта: повтор в пределах 1ч не шлёт повторно', async () => {
        __resetPlatformAlertDedupForTests();
        const prevToken = process.env.TG_BOT_TOKEN;
        const prevChat = process.env.TG_ADMIN_CHAT_ID;
        const prevFetch = globalThis.fetch;
        const fetchCalls = [];
        process.env.TG_BOT_TOKEN = 'test-token';
        process.env.TG_ADMIN_CHAT_ID = '100200300';
        globalThis.fetch = async (url, options) => {
            fetchCalls.push({ url, options });
            return { json: async () => ({ ok: true }) };
        };

        try {
            const first = await notifyPlatformAlert('proxy_pool_exhausted', 'пул пуст');
            const second = await notifyPlatformAlert('proxy_pool_exhausted', 'пул пуст снова');
            const otherKey = await notifyPlatformAlert('other_key', 'другой алерт');

            assert.deepStrictEqual(first, { sent: true });
            assert.strictEqual(second.sent, false, 'тот же ключ в пределах часа — дедуп');
            assert.strictEqual(second.deduped, true);
            assert.strictEqual(fetchCalls.length, 2, 'один send для первого ключа + один для другого');
            assert.strictEqual(fetchCalls[0].url, 'https://api.telegram.org/bottest-token/sendMessage', 'sendMessage по токену из env');
            assert.strictEqual(JSON.parse(fetchCalls[0].options.body).chat_id, '100200300');
            assert.strictEqual(JSON.parse(fetchCalls[0].options.body).text, 'пул пуст');
            assert.strictEqual(otherKey.sent, true, 'другой ключ дедупом не гасится');
        } finally {
            globalThis.fetch = prevFetch;
            if (prevToken === undefined) delete process.env.TG_BOT_TOKEN; else process.env.TG_BOT_TOKEN = prevToken;
            if (prevChat === undefined) delete process.env.TG_ADMIN_CHAT_ID; else process.env.TG_ADMIN_CHAT_ID = prevChat;
            __resetPlatformAlertDedupForTests();
        }
    });
});
