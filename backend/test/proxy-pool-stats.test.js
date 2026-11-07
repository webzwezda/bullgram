// Тесты статистики платформенного пула (GET /api/userbot/proxy-pool/stats).
// Офлайн: фейковый express-роутер + мок supabase (две таблицы, plain select).
// Покрывает: admin видит total/used/free/reserved; не-admin → 403; proxy_id
// вне пула (свой прокси пользователя) не считается «используемым» пулом.
import { describe, it } from 'node:test';
import assert from 'node:assert';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'dummy';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';

const { registerProxyPoolStats } = await import('../routes/userbot/proxy-pool-stats.js');

const OWNER = 'pool-owner';

function makeMockSupabase({ proxies = [], accounts = [] } = {}) {
    const tables = { proxies: proxies.map(r => ({ ...r })), tg_accounts: accounts.map(r => ({ ...r })) };
    function from(table) {
        const rows = tables[table] || (tables[table] = []);
        const state = { filters: [], wantSingle: false };
        const matches = () => rows.filter(row => state.filters.every(([col, test]) => test(row[col])));
        const builder = {
            select() { return builder; },
            eq(col, val) { state.filters.push([col, cell => String(cell) === String(val)]); return builder; },
            like(col, pattern) {
                const re = new RegExp('^' + String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$');
                state.filters.push([col, cell => re.test(String(cell ?? ''))]);
                return builder;
            },
            not(col, op, val) {
                state.filters.push([col, op === 'is' && val === null ? cell => !(cell === null || cell === undefined) : () => true]);
                return builder;
            },
            maybeSingle() { state.wantSingle = true; return builder; },
            then(resolve) { resolve({ data: state.wantSingle ? (matches()[0] ?? null) : matches(), error: null }); }
        };
        return builder;
    }
    return { from, tables };
}

function makeRouter() {
    const routes = [];
    const router = {
        routes,
        get(path, ...handlers) { routes.push({ method: 'GET', path, handlers }); },
        post(path, ...handlers) { routes.push({ method: 'POST', path, handlers }); }
    };
    return router;
}

function routeHandler(router, method, path) {
    const route = router.routes.find(r => r.method === method && r.path === path);
    return route.handlers[route.handlers.length - 1];
}

function makeReqRes({ role = 'admin' } = {}) {
    const log = { info() {}, warn() {}, error() {}, child() { return log; } };
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
    const req = { user: { id: OWNER }, profile: { role }, log, headers: {} };
    return { req, res };
}

function setup({ proxies, accounts, role }) {
    const db = makeMockSupabase({ proxies, accounts });
    const router = makeRouter();
    registerProxyPoolStats(router, { supabase: db });
    const handler = routeHandler(router, 'GET', '/proxy-pool/stats');
    const { req, res } = makeReqRes({ role });
    return { handler, req, res };
}

describe('GET /proxy-pool/stats', () => {
    const POOL = [
        { id: 'mp-a', username: 'mp_1', owner_id: null },
        { id: 'mp-b', username: 'mp_2', owner_id: null },
        { id: 'mp-c', username: 'mp_3', owner_id: OWNER }
    ];

    it('admin видит total/used/free/reserved', async () => {
        const { handler, req, res } = setup({
            proxies: POOL,
            accounts: [{ proxy_id: 'mp-c' }, { proxy_id: 'user-own-proxy' }]
        });

        await handler(req, res);

        assert.strictEqual(res.statusCode, 200);
        assert.deepStrictEqual(res.body, { total: 3, used: 1, free: 2, reserved: 0 });
    });

    it('не-admin получает 403', async () => {
        const { handler, req, res } = setup({ proxies: POOL, accounts: [], role: 'user' });

        await handler(req, res);

        assert.strictEqual(res.statusCode, 403);
    });

    it('proxy_id вне пула (свой прокси) не считается used пула', async () => {
        const { handler, req, res } = setup({
            proxies: [{ id: 'mp-a', username: 'mp_1', owner_id: null }],
            accounts: [{ proxy_id: 'user-own-proxy' }]
        });

        await handler(req, res);

        assert.strictEqual(res.body.used, 0);
        assert.strictEqual(res.body.total, 1);
        assert.strictEqual(res.body.free, 1);
    });
});
