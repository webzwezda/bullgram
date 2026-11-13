/**
 * Сценарий: скачивание архива файлов сессии владельцем своего аккаунта
 * (GET /api/userbot/restore-sources/:accountId/archive — панель «Файлы
 * сессии» в кабинете). Роутовый паттерн test/shop-owner-download.test.js:
 * реальный роутер userbot.routes.js + последний хендлер цепочки (после
 * authenticateUser), supabase — мок из test/shop-delivery/shared.js,
 * архив — реальный adm-zip, блобы — реальный encrypt() (ENCRYPTION_KEY
 * тестовый).
 *
 * Покрывает: владелец качает (200, basename из маскированного номера,
 * состав zip, заголовки), чужой пользователь → 404, несуществующий
 * аккаунт → 404, без restore source → 404, цепочка authenticateUser
 * не оторвана.
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-0123456789ab';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
process.env.PLATFORM_TON_WALLET = process.env.PLATFORM_TON_WALLET || 'UQtestwalletforrunittests000';

import AdmZip from 'adm-zip';
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { ACC1, OWNER, makeMockSupabase, baseTables } from '../shop-delivery/shared.js';

// Фабрика роутов — динамическим импортом после env-строк (конвенция хостов).
const { default: userbotRoutes } = await import('../../routes/userbot.routes.js');

const ACCOUNT_ID = ACC1;
const FOREIGN_USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MISSING_ACCOUNT_ID = '46464646-4646-4646-8646-464646464646';
const ARCHIVE_PATH = '/restore-sources/:accountId/archive';

function findRouteHandlers(router, method, path) {
    for (const layer of router.stack) {
        if (layer.route && layer.route.methods[method] && layer.route.path === path) {
            return layer.route.stack.map((item) => item.handle);
        }
    }
    throw new Error(`route not registered: ${method} ${path}`);
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

let failures = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        failures += 1;
    }
}

export async function runRestoreArchive() {
console.log('— Скачивание архива своих файлов сессии (владелец) —');

{
    const supabase = makeMockSupabase(baseTables());
    const router = userbotRoutes(supabase);
    const handlers = findRouteHandlers(router, 'get', ARCHIVE_PATH);
    assert(handlers.length === 2 && handlers[0] === authenticateUser, 'archive: цепочка authenticateUser → хендлер не оторвана');
    const handler = handlers[handlers.length - 1];
    const res = makeRes();
    await handler({ params: { accountId: ACCOUNT_ID }, user: { id: OWNER }, ip: '9.9.9.9' }, res);
    assert(res.statusCode === 200, 'archive: владелец → 200');
    assert(res.headers['Content-Type'] === 'application/zip', 'archive: Content-Type zip');
    assert(res.headers['Content-Disposition'] === 'attachment; filename="account-13642.zip"', 'archive: имя из маскированного номера');
    assert(typeof res.headers['X-Archive-Sha256'] === 'string' && res.headers['X-Archive-Sha256'].length === 64, 'archive: sha256 в заголовке');
    const zip = new AdmZip(res.buffers[0]);
    const names = zip.getEntries().map((entry) => entry.entryName);
    assert(names.includes('account-13642.session'), 'archive: session в архиве');
    assert(names.includes('account-13642.json') && names.includes('tdata.zip'), 'archive: json и tdata в архиве');
    assert(zip.getEntry('account-13642.session').getData().toString() === 'SESSION-SQLITE-BYTES', 'archive: session распакован корректно');
}
{
    const supabase = makeMockSupabase(baseTables());
    const router = userbotRoutes(supabase);
    const handler = findRouteHandlers(router, 'get', ARCHIVE_PATH).pop();
    const res = makeRes();
    await handler({ params: { accountId: ACCOUNT_ID }, user: { id: FOREIGN_USER }, ip: '9.9.9.9' }, res);
    assert(res.statusCode === 404, 'archive: чужой аккаунт → 404 без деталей');
}
{
    const supabase = makeMockSupabase(baseTables());
    const router = userbotRoutes(supabase);
    const handler = findRouteHandlers(router, 'get', ARCHIVE_PATH).pop();
    const res = makeRes();
    await handler({ params: { accountId: MISSING_ACCOUNT_ID }, user: { id: OWNER }, ip: '9.9.9.9' }, res);
    assert(res.statusCode === 404, 'archive: несуществующий аккаунт → 404');
}
{
    const supabase = makeMockSupabase(baseTables({ userbot_restore_sources: [] }));
    const router = userbotRoutes(supabase);
    const handler = findRouteHandlers(router, 'get', ARCHIVE_PATH).pop();
    const res = makeRes();
    await handler({ params: { accountId: ACCOUNT_ID }, user: { id: OWNER }, ip: '9.9.9.9' }, res);
    assert(res.statusCode === 404 && res.body?.error === 'Файлы сессии для этого аккаунта не сохранены', 'archive: без restore source → 404 с честной причиной');
}

if (failures > 0) {
    throw new Error(`restore-archive: провалено проверок: ${failures}`);
}
}
