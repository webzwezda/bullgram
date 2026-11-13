/**
 * Юнит-тесты повторного скачивания архива владельцем из кабинета
 * (GET /api/shop/public/my-purchases/:purchaseId/download) и delivery_view
 * в my-purchases. Офлайн, детерминированные: роут вызывается последним
 * хендлером цепочки (после authenticateUser — сам мидлварь стандартный и не
 * тестируется; паттерн test/seamless-proxy-connect.test.js), supabase — мок
 * из test/shop-delivery/shared.js, архив — реальный adm-zip, блобы — реальный
 * encrypt() (ENCRYPTION_KEY тестовый).
 *
 * Гейты окна/квоты/purge внутри prepareShopArchiveDelivery детально покрыты
 * в shop-delivery/public-archive-download.js — здесь маршрутовые случаи:
 * владелец/чужой/несуществующий/невалидный id, гейт-статусы сквозь роут
 * (409/410/429), zip-заголовки, счётчик скачиваний, delivery_view для
 * hybrid/files/pending.
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-0123456789ab';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
process.env.PLATFORM_TON_WALLET = process.env.PLATFORM_TON_WALLET || 'UQtestwalletforrunittests000';

import AdmZip from 'adm-zip';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { ARCHIVE_EXPIRED_MESSAGE } from '../services/shop-delivery.service.js';
import {
    assert,
    BUYER,
    ITEM_HYBRID,
    ITEM_ID,
    PURCHASE_HYBRID_ID,
    PURCHASE_ID,
    makeMockSupabase,
    accountItemRow,
    baseTables,
    filesDelivery,
    pendingPurchase
} from './shop-delivery/shared.js';

// Фабрика роутов импортируется после env-строк (конвенция shop-delivery.test.js).
const { default: shopRoutes } = await import('../routes/shop/index.js');

const OTHER_USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MISSING_PURCHASE_ID = '46464646-4646-4646-8646-464646464646';

const DOWNLOAD_PATH = '/public/my-purchases/:purchaseId/download';
const MY_PURCHASES_PATH = '/public/my-purchases';

function findRouteHandlers(router, method, path) {
    for (const layer of router.stack) {
        if (layer.route && layer.route.methods[method] && layer.route.path === path) {
            return layer.route.stack.map((item) => item.handle);
        }
    }
    throw new Error(`route not registered: ${method} ${path}`);
}

function findLastHandler(router, method, path) {
    const handlers = findRouteHandlers(router, method, path);
    return handlers[handlers.length - 1];
}

function makeRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        buffers: [],
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
        setHeader(name, value) { this.headers[name] = value; return this; },
        send(chunk) { this.buffers.push(chunk); return this; }
    };
    return res;
}

// Фикстура hybrid-покупки: аккаунт передан покупателю, архив бессрочный.
function hybridPurchase(overrides = {}) {
    const nowIso = new Date().toISOString();
    return pendingPurchase({
        id: PURCHASE_HYBRID_ID,
        shop_item_id: ITEM_HYBRID,
        buyer_owner_id: BUYER,
        status: 'paid',
        ownership_transfer_status: 'completed',
        delivered_at: nowIso,
        payload: {
            memo: 'shop_h',
            delivery: {
                mode: 'hybrid', transferred: true, downloads: [],
                downloads_max: 10, window_hours: 168, purged_at: null,
                sha256: null, size_bytes: null
            }
        },
        ...overrides
    });
}

function hybridTables(purchaseOverrides = {}) {
    return baseTables({
        shop_items: [accountItemRow({ id: ITEM_HYBRID, delivery_mode: 'hybrid' })],
        shop_item_assets: [{ id: 'sa2', shop_item_id: ITEM_HYBRID, asset_type: 'userbot', asset_id: '11111111-1111-4111-8111-111111111111', label: '+13…642', sort_order: 0 }],
        shop_purchases: [hybridPurchase(purchaseOverrides)]
    });
}

console.log('— Скачивание архива владельцем (JWT-роут кабинета) —');

{
    // Мидлварь — единственная дельта безопасности против публичного роута:
    // если её оторвать, юнит-кейсы ниже зелёные, поэтому цепочку проверяем
    // отдельно (первый слой — именно authenticateUser, второй — хендлер).
    const router = shopRoutes(makeMockSupabase(hybridTables()), {});
    const handlers = findRouteHandlers(router, 'get', DOWNLOAD_PATH);
    assert(handlers.length === 2 && handlers[0] === authenticateUser, 'owner download: цепочка authenticateUser → хендлер не оторвана');
}
{
    const supabase = makeMockSupabase(hybridTables());
    const router = shopRoutes(supabase, {});
    const handler = findLastHandler(router, 'get', DOWNLOAD_PATH);
    const res = makeRes();
    await handler({ params: { purchaseId: PURCHASE_HYBRID_ID }, user: { id: BUYER }, ip: '9.9.9.9' }, res);
    assert(res.statusCode === 200, 'owner download: владелец → 200');
    assert(res.headers['Content-Type'] === 'application/zip', 'owner download: Content-Type zip');
    assert(res.headers['Content-Disposition'] === 'attachment; filename="account-13642.zip"', 'owner download: имя архива из маскированного номера');
    assert(typeof res.headers['X-Archive-Sha256'] === 'string' && res.headers['X-Archive-Sha256'].length === 64, 'owner download: sha256 в заголовке');
    const zip = new AdmZip(res.buffers[0]);
    const names = zip.getEntries().map((entry) => entry.entryName);
    assert(names.includes('account-13642.session') && names.includes('README.txt'), 'owner download: архив содержит сессию и README');
    const deliveryRow = supabase._tables.shop_purchases[0].payload.delivery;
    assert(deliveryRow.downloads.length === 1 && deliveryRow.downloads[0].ip === '9.9.9.9', 'owner download: счётчик +1 с ip');
}
{
    const supabase = makeMockSupabase(hybridTables());
    const router = shopRoutes(supabase, {});
    const handler = findLastHandler(router, 'get', DOWNLOAD_PATH);
    const res = makeRes();
    await handler({ params: { purchaseId: PURCHASE_HYBRID_ID }, user: { id: OTHER_USER }, ip: '9.9.9.9' }, res);
    assert(res.statusCode === 404 && res.body?.error === 'Счёт не найден', 'owner download: чужая покупка → 404 без деталей');
    assert(supabase._tables.shop_purchases[0].payload.delivery.downloads.length === 0, 'owner download: чужому счётчик не растёт');
}
{
    const supabase = makeMockSupabase(hybridTables());
    const router = shopRoutes(supabase, {});
    const handler = findLastHandler(router, 'get', DOWNLOAD_PATH);
    const res = makeRes();
    await handler({ params: { purchaseId: MISSING_PURCHASE_ID }, user: { id: BUYER }, ip: '9.9.9.9' }, res);
    assert(res.statusCode === 404, 'owner download: несуществующий счёт → 404');
}
{
    const supabase = makeMockSupabase(hybridTables());
    const router = shopRoutes(supabase, {});
    const handler = findLastHandler(router, 'get', DOWNLOAD_PATH);
    const res = makeRes();
    await handler({ params: { purchaseId: 'not-a-uuid' }, user: { id: BUYER }, ip: '9.9.9.9' }, res);
    assert(res.statusCode === 400, 'owner download: невалидный id → 400');
}
{
    const supabase = makeMockSupabase(hybridTables({ status: 'pending', ownership_transfer_status: 'pending', delivered_at: null }));
    const router = shopRoutes(supabase, {});
    const handler = findLastHandler(router, 'get', DOWNLOAD_PATH);
    const res = makeRes();
    await handler({ params: { purchaseId: PURCHASE_HYBRID_ID }, user: { id: BUYER }, ip: '9.9.9.9' }, res);
    assert(res.statusCode === 409, 'owner download: неоплаченная → 409');
}
{
    const oldIso = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase(hybridTables({
        status: 'paid',
        delivered_at: oldIso,
        ownership_transfer_status: 'completed',
        payload: { memo: 'shop_f', delivery: filesDelivery(oldIso) }
    }));
    const router = shopRoutes(supabase, {});
    const handler = findLastHandler(router, 'get', DOWNLOAD_PATH);
    const res = makeRes();
    await handler({ params: { purchaseId: PURCHASE_HYBRID_ID }, user: { id: BUYER }, ip: '9.9.9.9' }, res);
    assert(res.statusCode === 410 && res.body?.error === ARCHIVE_EXPIRED_MESSAGE, 'owner download: files после окна → 410');
}
{
    const nowIso = new Date().toISOString();
    const supabase = makeMockSupabase(hybridTables({
        payload: { memo: 'shop_f', delivery: filesDelivery(nowIso, { purged_at: nowIso }) }
    }));
    const router = shopRoutes(supabase, {});
    const handler = findLastHandler(router, 'get', DOWNLOAD_PATH);
    const res = makeRes();
    await handler({ params: { purchaseId: PURCHASE_HYBRID_ID }, user: { id: BUYER }, ip: '9.9.9.9' }, res);
    assert(res.statusCode === 410, 'owner download: пуржнутое → 410');
}
{
    const nowIso = new Date().toISOString();
    const fullDownloads = Array.from({ length: 10 }, (_, index) => ({ at: nowIso, ip: `10.0.0.${index}` }));
    const supabase = makeMockSupabase(hybridTables({
        status: 'paid',
        delivered_at: nowIso,
        ownership_transfer_status: 'pending',
        payload: { memo: 'shop_f', delivery: filesDelivery(nowIso, { downloads: fullDownloads }) }
    }));
    const router = shopRoutes(supabase, {});
    const handler = findLastHandler(router, 'get', DOWNLOAD_PATH);
    const res = makeRes();
    await handler({ params: { purchaseId: PURCHASE_HYBRID_ID }, user: { id: BUYER }, ip: '9.9.9.9' }, res);
    assert(res.statusCode === 429, 'owner download: files без квоты → 429');
}

console.log('— delivery_view в my-purchases —');

{
    const supabase = makeMockSupabase(hybridTables());
    const router = shopRoutes(supabase, {});
    const handler = findLastHandler(router, 'get', MY_PURCHASES_PATH);
    const res = makeRes();
    await handler({ user: { id: BUYER } }, res);
    assert(res.statusCode === 200, 'my-purchases: 200');
    const view = res.body?.purchases?.[0]?.delivery_view;
    assert(view && view.available === true && view.mode === 'hybrid', 'my-purchases: hybrid передан → available true');
    assert(view.downloads_used === 0 && view.downloads_max === 10, 'my-purchases: счётчики в view');
}
{
    const oldIso = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [pendingPurchase({
            id: PURCHASE_ID,
            buyer_owner_id: BUYER,
            status: 'paid',
            delivered_at: oldIso,
            payload: { memo: 'shop_x', delivery: filesDelivery(oldIso) }
        })]
    }));
    const router = shopRoutes(supabase, {});
    const handler = findLastHandler(router, 'get', MY_PURCHASES_PATH);
    const res = makeRes();
    await handler({ user: { id: BUYER } }, res);
    const view = res.body?.purchases?.[0]?.delivery_view;
    assert(view && view.available === false && view.window_ends_at && view.reason === ARCHIVE_EXPIRED_MESSAGE, 'my-purchases: files после окна → available false с причиной');
}
{
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [pendingPurchase({ id: PURCHASE_ID, buyer_owner_id: BUYER })]
    }));
    const router = shopRoutes(supabase, {});
    const handler = findLastHandler(router, 'get', MY_PURCHASES_PATH);
    const res = makeRes();
    await handler({ user: { id: BUYER } }, res);
    assert(res.body?.purchases?.[0]?.delivery_view === null, 'my-purchases: без выдачи delivery_view null');
}

console.log('\nВсе проверки owner-download прошли');
