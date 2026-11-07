// Тесты статистики платформенного пула (GET /api/userbot/proxy-pool/stats).
// Офлайн: фейковый express-роутер + мок supabase (proxies, tg_accounts,
// shop_items, shop_item_assets). Состояния в сумме дают total:
// free + used + shop_listed + reserved_other = total; dead/sold/
// purchased_source — справочные пересекающиеся.
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
        const state = { op: 'select', filters: [], wantSingle: false };
        const matches = () => rows.filter(row => state.filters.every(([col, test]) => test(row[col])));
        const builder = {
            select() { return builder; },
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
            { id: 'mp-1', username: 'mp_1', owner_id: null, is_working: true, provision_source: 'manual_admin' },
            { id: 'mp-2', username: 'mp_2', owner_id: null, is_working: true, provision_source: 'manual_admin' },   // висит в магазине
            { id: 'mp-3', username: 'mp_3', owner_id: OWNER, is_working: true, provision_source: 'manual_admin' },  // осиротевший
            { id: 'mp-4', username: 'mp_4', owner_id: OWNER, is_working: true, provision_source: 'purchased' },     // используется + закуплен
            { id: 'mp-5', username: 'mp_5', owner_id: null, is_working: false, provision_source: 'manual_admin' },  // мёртвый
            { id: 'mp-6', username: 'mp_6', owner_id: OWNER, is_working: true, provision_source: 'manual_admin' }   // продан, у покупателя без привязки
        ],
        tg_accounts: [{ proxy_id: 'mp-4' }],
        shop_items: [
            { id: 'item-live', status: 'published', visibility: 'public' },
            { id: 'item-sold', status: 'sold', visibility: 'private' },
            { id: 'item-draft', status: 'published', visibility: 'private' }   // published, но private → не «в магазине»
        ],
        shop_item_assets: [
            { shop_item_id: 'item-live', asset_type: 'proxy', asset_id: 'mp-2' },
            { shop_item_id: 'item-sold', asset_type: 'proxy', asset_id: 'mp-6' },
            { shop_item_id: 'item-draft', asset_type: 'proxy', asset_id: 'mp-1' }
        ]
    };

    it('админ видит непересекающиеся состояния (сумма = total) и справочные', async () => {
        const { handler, req, res } = setup({ tables: TABLES, role: 'admin' });

        await handler(req, res);

        assert.strictEqual(res.statusCode, 200);
        const body = res.body;
        assert.strictEqual(body.total, 6);
        assert.strictEqual(body.free, 2);            // mp-1 + mp-5 (owner NULL и не в магазине; dead — справочный флаг)
        assert.strictEqual(body.used, 1);            // mp-4
        assert.strictEqual(body.shop_listed, 1);     // mp-2 в published/public
        assert.strictEqual(body.reserved_other, 2);  // mp-3 + mp-6 (у владельцев без привязки)
        assert.strictEqual(body.dead, 1);            // mp-5
        assert.strictEqual(body.sold, 1);            // mp-6 в sold-лоте
        assert.strictEqual(body.purchased_source, 1);// mp-4
        assert.strictEqual(body.free + body.used + body.shop_listed + body.reserved_other, body.total, 'состояния покрывают весь пул');
        assert.strictEqual(body.used_share, Math.round((1 / 6) * 100));
    });

    it('не-admin получает 403', async () => {
        const { handler, req, res } = setup({ tables: TABLES, role: 'user' });

        await handler(req, res);

        assert.strictEqual(res.statusCode, 403);
    });

    it('proxy_id вне пула (свой прокси пользователя) не считается used пула', async () => {
        const { handler, req, res } = setup({
            tables: {
                proxies: [{ id: 'mp-1', username: 'mp_1', owner_id: null, is_working: true, provision_source: 'manual_admin' }],
                tg_accounts: [{ proxy_id: 'user-own-proxy' }],
                shop_items: [],
                shop_item_assets: []
            },
            role: 'admin'
        });

        await handler(req, res);

        assert.strictEqual(res.body.used, 0);
        assert.strictEqual(res.body.total, 1);
        assert.strictEqual(res.body.free, 1);
        assert.strictEqual(res.body.shop_listed, 0);
        assert.strictEqual(res.body.sold, 0);
    });
});
