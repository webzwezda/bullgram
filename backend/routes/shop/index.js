// Агрегатор роут-модулей shop (стадия 2 разрезки shop.routes.js).
// Фабрика создаёт guard-блок публичных роутов и единый ctx замыканий;
// register-модули вешают роуты строго в исходном порядке прежнего главного
// файла. Фасад для server.js и тестов — ../shop.routes.js (реэкспортирует
// default отсюда + named из stage-1 модулей).
import express from 'express';
import { registerCatalogAdmin } from './catalog-admin.js';
import { registerItemsRead } from './items-read.js';
import { registerItemsCreate } from './items-create.js';
import { registerItemsLots } from './items-lots.js';
import { registerItemsLifecycle } from './items-lifecycle.js';
import { registerCatalogPublic } from './catalog-public.js';
import { registerMyPurchasesDownload } from './catalog-my-download.js';
import { registerPurchaseApi } from './purchase-api.js';
import { registerPurchaseChecks } from './purchase-checks.js';
import { registerDelivery } from './delivery.js';

// userbotService нужен скану «Найти аккаунты для продажи» — живая проверка
// сессий идёт тем же UserbotService-синглтоном, что у джобы отлёжки.
export default function shopRoutes(supabase, { userbotService = null } = {}) {
    const router = express.Router();

    // Guard-блок публичных роутов (переехал из хвоста прежней фабрики, где
    // стоял ровно перед зоной public-view): rate-limit карты живут
    // per-factory-instance, как и раньше.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const publicViewHitsByIp = new Map();
    const publicVerifyHitsByIp = new Map();
    const publicPurchaseHitsByIp = new Map();
    const publicDownloadHitsByIp = new Map();
    // Отдельный бакет для JWT-скачиваний владельцем из кабинета: чужой трафик
    // публичного роута не должен выедать лимит владельца (и наоборот).
    const ownerDownloadHitsByIp = new Map();
    const PUBLIC_RATE_LIMIT_RPM = 60;
    const PUBLIC_DOWNLOAD_RATE_LIMIT_RPM = 10;

    function checkRateLimit(map, ip, limitRpm = PUBLIC_RATE_LIMIT_RPM) {
        const now = Date.now();
        const windowStart = now - 60_000;
        for (const [key, hits] of map) {
            const fresh = hits.filter((t) => t > windowStart);
            if (fresh.length > 0) map.set(key, fresh);
            else map.delete(key);
        }
        const hits = map.get(ip) || [];
        if (hits.length >= limitRpm) return false;
        hits.push(now);
        map.set(ip, hits);
        return true;
    }

    // Единый контекст замыканий фабрики для всех register-модулей стадии 2.
    const ctx = {
        supabase,
        userbotService,
        checkRateLimit,
        UUID_RE,
        PUBLIC_DOWNLOAD_RATE_LIMIT_RPM,
        publicPurchaseHitsByIp,
        publicViewHitsByIp,
        publicVerifyHitsByIp,
        publicDownloadHitsByIp,
        ownerDownloadHitsByIp
    };

    registerCatalogAdmin(router, ctx);    // GET assets / reserved-assets / market-lots
    registerItemsRead(router, ctx);       // GET items, GET purchases, POST purchases check(+batch)
    registerItemsCreate(router, ctx);     // POST items (создание/редактирование лота)
    registerItemsLots(router, ctx);       // batch-proxy, account-lots batch + scan
    registerItemsLifecycle(router, ctx);  // DELETE items/:id, POST items/:id/unpublish
    registerCatalogPublic(router, ctx);   // listVisibleShopItems + public/items, app/items, my-purchases
    registerMyPurchasesDownload(router, ctx); // my-purchases/:id/download (владелец, JWT)
    registerPurchaseApi(router, ctx);     // purchase cancel(+batch), purchase, purchase-anon
    registerPurchaseChecks(router, ctx);  // purchase/batch, check, verify-ton-connect, check-batch
    registerDelivery(router, ctx);        // public-view, verify-public, download

    return router;
}
