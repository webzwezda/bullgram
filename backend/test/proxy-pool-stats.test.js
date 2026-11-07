// Тесты статистики платформенного пула (GET /api/userbot/proxy-pool/stats).
// Офлайн: фейковый express-роутер + мок supabase (proxies, tg_accounts,
// shop_items, shop_item_assets, shop_purchases; head-count для покупок).
// Покрывает: admin видит total/used/free/reserved/dead/shop_listed/purchased;
// не-admin → 403; proxy_id вне пула не считается used; черновик-лот и
// недоставленная покупка не считаются.
import { describe, it } from 'node:test';
import assert from 'node:assert';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'dummy';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';

const { registerProxyPoolStats } = await import('../routes/userbot/proxy-pool-stats.js');

const OWNER = 'pool-owner';

function makeMockSupabase({ tables: seed = {} } = {}) {
    const tables = Object.fromEntries(Object.entries(seed).map(([t, rows]) => [t, rows.map(r => ({ ...r }))]));
    function from(table) {
        const rows = tables[table] || (tables[table] = []);
        const state = { op: 'select', filters: [], wantSingle: false, wantCount: false, wantHead: false };
        const matches = () => rows.filter(row => state.filters.every(([col, test]) => test(row[col])));
        const builder = {
            select(_cols, opts = {}) {
                if (opts?.count === 'exact') state.wantCount = true;
                if (opts?.head) state.wantHead = true;
                return builder;
            },
            eq(col, val) { state.filters.push([col, cell => String(cell) === String(val)]); return builder; },
            like(col, pattern) {
                const re = new RegExp('^' + String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$');
                state.filters.push([col, cell => re.test(String(cell ?? ''))]);
                return builder;
            },
            in(col, values) {
                const set = new Set((values || []).map(v => String(v)));
                state.filters.push([col, cell => set.has(String(cell))]);
                return builder;
            },
            not(col, op, val) {
                state.filters.push([col, op === 'is' && val === null ? cell => !(cell === null || cell === undefined) : () => true]);
                return builder;
            },
            maybeSingle() { state.wantSingle = true; return builder; },
            then(resolve) {
                const out = matches();
                if (state.wantCount) resolve({ data: state.wantHead ? null : out, count: out.length, error: null });
                else resolve({ data: state.wantSingle ? (out[0] ?? null) : out, error: null });
            }
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

function setup({ tables, role }) {
    const db = makeMockSupabase({ tables });
    const router = makeRouter();
    registerProxyPoolStats(router, { supabase: db });
    const handler = routeHandler(router, 'GET', '/proxy-pool/stats');
    const { req, res } = makeReqRes({ role });
    return { handler, req, res };
}

describe('GET /proxy-pool/stats', () => {
    const TABLES = {
        proxies: [
            { id: 'mp-a', username: 'mp_1', owner_id: null, is_working: true },
            { id: 'mp-shop', username: 'mp_2', owner_id: null, is_working: true },
            { id: 'mp-res', username: 'mp_3', owner_id: OWNER, is_working: true },
            { id: 'mp-used', username: 'mp_4', owner_id: OWNER, is_working: true },
            { id: 'mp-dead', username: 'mp_5', owner_id: null, is_working: false }
        ],
        tg_accounts: [{ proxy_id: 'mp-used' }],
        shop_items: [
            { id: 'item-live', status: 'published', visibility: 'public' },
            { id: 'item-draft', status: 'draft', visibility: 'private' }
        ],
        shop_item_assets: [
            { shop_item_id: 'item-live', asset_type: 'proxy', asset_id: 'mp-shop' },
            { shop_item_id: 'item-draft', asset_type: 'proxy', asset_id: 'mp-a' }
        ],
        shop_purchases: [
            { shop_item_id: 'item-live', delivered_at: '2026-11-01T00:00:00Z' },
            { shop_item_id: 'item-draft', delivered_at: null }
        ]
    };

    it('admin видит полный жизненный цикл: total/used/free/reserved/dead/shop_listed/purchased', async () => {
        const { handler, req, res } = setup({ tables: TABLES, role: 'admin' });

        await handler(req, res);

        assert.strictEqual(res.statusCode, 200);
        assert.deepStrictEqual(res.body, {
            total: 5,
            used: 1,
            free: 3,          // mp-a, mp-shop, mp-dead (owner NULL)
            reserved: 1,      // mp-res: занят владельцем, не привязан
            dead: 1,          // mp-dead
            shop_listed: 1,   // mp-shop в published-лоте; черновик не считается
            purchased: 1      // доставленная покупка; без delivered_at не считается
        });
    });

    it('не-admin получает 403', async () => {
        const { handler, req, res } = setup({ tables: TABLES, role: 'user' });

        await handler(req, res);

        assert.strictEqual(res.statusCode, 403);
    });

    it('proxy_id вне пула (свой прокси пользователя) не считается used пула', async () => {
        const { handler, req, res } = setup({
            tables: {
                proxies: [{ id: 'mp-a', username: 'mp_1', owner_id: null, is_working: true }],
                tg_accounts: [{ proxy_id: 'user-own-proxy' }],
                shop_items: [],
                shop_item_assets: [],
                shop_purchases: []
            },
            role: 'admin'
        });

        await handler(req, res);

        assert.strictEqual(res.body.used, 0);
        assert.strictEqual(res.body.total, 1);
        assert.strictEqual(res.body.free, 1);
        assert.strictEqual(res.body.shop_listed, 0);
        assert.strictEqual(res.body.purchased, 0);
    });
});
