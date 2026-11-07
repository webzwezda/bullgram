// Юнит-тесты бесшовной выдачи managed-прокси в роутах подключения юзербота
// (BACKLOG §32: «зарегался → подключил ТГ → работает, без выбора прокси»).
// Офлайн, детерминированные: роуты регистрируются на фейковом express-роутере,
// Telegram не трогается (generateQR / connectWithProxyFallback / getMe — моки
// или не достигаются), алерт — на моке globalThis.fetch как в
// test/proxy-allocation.test.js.
//
// Файл создан рядом (в test/qr-auth.test.js моки не годятся — он про ротацию
// токена utils/qr-auth.js, не про роуты).
//
// Покрывает:
//  - qr-start: флаг on + без proxy_id → слот заклеймлен ДО Telegram, proxyData
//    собран зеркалом loadOwnedProxy (force_ipv6=true), метка на qr-сессии;
//    флаг off + без proxy_id → прежний 400 (БД не тронута); pool_empty →
//    пользовательский текст + алерт ровно один раз; падение generateQR после
//    claim → слот возвращён в пул.
//  - qr-status: успех → upsert записал proxy_id слота, привязка дообновлена
//    (where id + owner_id), сессия удалена; authState failed → слот в пул;
//    не-transient ошибка до создания аккаунта → слот в пул.
//  - import-session-file: флаг off → прежний 400; pool_empty → текст + алерт;
//    падение коннекта после claim → слот возвращён в пул. (Успешный импорт
//    офлайн не проверяется — там реальный TelegramClient.getMe; логика
//    привязки слота та же, что проверена через qr-status.)
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// Роуты тянут crypto.js (ENCRYPTION_KEY обязателен на импорте) и
// auth.middleware.js (создаёт supabase-клиент) — дамми-значения до импортов.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-dummy-encryption-key';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';

const { registerQr } = await import('../routes/userbot/qr.js');
const { registerSessions } = await import('../routes/userbot/sessions.js');
const { __resetPlatformAlertDedupForTests } = await import('../utils/platform-telegram-alert.js');

const OWNER = 'owner-seamless';
const FLAG = 'USERBOT_AUTO_ALLOCATE_PROXY_ENABLED';
// Флаг выключен, а в UI платформенный пункт выбран по умолчанию — текст
// подсказывает выбрать свой, не противореча селектору.
const LEGACY_QR_MESSAGE = 'Платформенный прокси сейчас недоступен — выбери свой прокси в списке.';
const LEGACY_IMPORT_MESSAGE = 'Платформенный прокси сейчас недоступен — выбери свой прокси в списке.';
const POOL_EMPTY_MESSAGE = 'Свободных платформенных прокси сейчас нет — подключите свой прокси или попробуйте позже.';
const ADMIN_PROFILE = { role: 'admin', product_tier: 'pro' };

const SLOT = {
    id: 'p-1',
    username: 'mp_1',
    host: '2001:db8::10',
    port: 25101,
    password: 'slot-pass',
    provision_source: 'manual_admin',
    inventory_group: 'self_use',
    is_working: true,
    last_check_ip: null,
    last_check_country: null,
    last_check_city: null,
    owner_id: null
};

function enableFlag() { process.env[FLAG] = 'true'; }
function disableFlag() { delete process.env[FLAG]; }

// ---------------------------------------------------------------------------
// Мок supabase: в дополнение к сервисному моку — upsert (с onConflict-вставкой
// новых строк), maybeSingle/single и цепочка upsert().select().single().
// ---------------------------------------------------------------------------
function makeMockSupabase({ proxies = [], accounts = [], onAfterSelect = null } = {}) {
    const tables = {
        proxies: proxies.map((row) => ({ ...row })),
        tg_accounts: accounts.map((row) => ({ ...row }))
    };
    const calls = [];

    function from(table) {
        const rows = tables[table] || (tables[table] = []);
        const state = { op: 'select', patch: null, wantCount: false, filters: [], orderCol: null, orderAsc: true, limitN: null, wantSingle: false, upsertConflict: [] };
        const matches = () => rows.filter((row) => state.filters.every(([col, test]) => test(row[col])));

        const builder = {
            select() {
                // upsert().select(...) в supabase-js — «сделать upsert и вернуть
                // колонки», поэтому op не переключаем.
                if (state.op !== 'upsert') state.op = 'select';
                return builder;
            },
            update(patch, opts = {}) {
                state.op = 'update';
                state.patch = patch;
                state.wantCount = opts?.count === 'exact';
                return builder;
            },
            upsert(patch, opts = {}) {
                state.op = 'upsert';
                state.patch = patch;
                state.upsertConflict = String(opts?.onConflict || '').split(',').map((col) => col.trim()).filter(Boolean);
                return builder;
            },
            eq(col, val) {
                state.filters.push([col, (cell) => String(cell) === String(val)]);
                return builder;
            },
            neq(col, val) {
                state.filters.push([col, (cell) => String(cell) !== String(val)]);
                return builder;
            },
            in(col, values) {
                const set = new Set((values || []).map((val) => String(val)));
                state.filters.push([col, (cell) => set.has(String(cell))]);
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
            maybeSingle() { state.wantSingle = true; return builder; },
            single() { state.wantSingle = true; return builder; },
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
                        if (state.wantSingle) {
                            resolve({ data: out[0] ?? null, error: null });
                        } else {
                            resolve({ data: out, error: null });
                        }
                        return;
                    }
                    if (state.op === 'update') {
                        const matched = matches();
                        for (const row of matched) Object.assign(row, state.patch);
                        resolve({ data: null, error: null, count: state.wantCount ? matched.length : null });
                        return;
                    }
                    // upsert: по onConflict-колонкам ищем существующую строку,
                    // иначе вставляем новую (обе мутируют общую таблицу).
                    let matched = rows;
                    if (state.upsertConflict.length) {
                        matched = rows.filter((row) => state.upsertConflict.every((col) => (
                            col in state.patch && String(row[col]) === String(state.patch[col])
                        )));
                    }
                    let resultRow;
                    if (matched.length) {
                        for (const row of matched) Object.assign(row, state.patch);
                        resultRow = matched[0];
                    } else {
                        resultRow = { ...state.patch };
                        rows.push(resultRow);
                    }
                    resolve({ data: state.wantSingle ? resultRow : null, error: null });
                } catch (error) {
                    reject(error);
                }
            }
        };
        return builder;
    }

    return { from, tables, calls };
}

// Фейковый express-роутер: запоминает зарегистрированные маршруты с цепочкой
// хендлеров; тест зовёт последний (после authenticateUser-мидлвари).
function makeRouter() {
    const routes = [];
    const router = {
        routes,
        get(path, ...handlers) { routes.push({ method: 'GET', path, handlers }); },
        post(path, ...handlers) { routes.push({ method: 'POST', path, handlers }); }
    };
    return router;
}

function findRoute(router, method, path) {
    return router.routes.find((route) => route.method === method && route.path === path);
}

function routeHandler(router, method, path) {
    const route = findRoute(router, method, path);
    if (!route) throw new Error(`route not registered: ${method} ${path}`);
    return route.handlers[route.handlers.length - 1];
}

function makeReqRes({ body = {}, files = null } = {}) {
    const log = { info() {}, warn() {}, error() {}, child() { return log; } };
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
    const req = { user: { id: OWNER }, profile: ADMIN_PROFILE, body, files, log, headers: {} };
    return { req, res };
}

// Мок userbotService для qr-роутов: generateQR паркует сессию в qrSessions
// (как настоящий), Telegram-цикл не запускает.
function makeQrService({ generateQRError = null } = {}) {
    const service = {
        qrSessions: new Map(),
        generateQRCalls: [],
        sweepStaleQrSessions: async () => {},
        stringifySessionData: () => 'raw-session-string',
        async generateQR(userId, proxyData, selection) {
            service.generateQRCalls.push({ userId, proxyData, selection });
            if (generateQRError) throw generateQRError;
            service.qrSessions.set(userId, {
                client: { disconnect: async () => {} },
                proxyData,
                fingerprint: { profileId: 'sys', profileLabel: 'Sys' },
                authState: 'pending',
                authError: null,
                createdAt: Date.now(),
                currentQrCode: null,
                passwordGate: null
            });
            return { success: true, qr_pending: true };
        }
    };
    return service;
}

// Authorized-сессия в карте (как будто QR уже отсканировали и Telegram
// авторизовал): save()/getMe() — моки, disconnect — no-op.
function makeAuthorizedSession({ claimedProxySlotId = 'p-1', getMeError = null } = {}) {
    return {
        client: {
            session: { save: () => 'saved-session-string' },
            getMe: async () => {
                if (getMeError) throw getMeError;
                return { id: 777000, username: 'seamless', firstName: 'S', lastName: '', phone: '' };
            },
            disconnect: async () => {}
        },
        proxyData: { proxy_id: claimedProxySlotId ? 'p-1' : null, proxy_host: '2001:db8::10', proxy_port: 25101, force_ipv6: true },
        claimedProxySlotId,
        fingerprint: { profileId: 'sys', profileLabel: 'Sys' },
        authState: 'authorized',
        authError: null,
        createdAt: Date.now(),
        currentQrCode: 'qr-image',
        passwordGate: null
    };
}

// Мок userbotService для sessions-роута: файловые валидации проходят,
// коннект — управляемый тестом.
function makeImportService({ connectError = null } = {}) {
    return {
        validateSessionSqliteFile: async () => {},
        validateConfigJsonFile: async () => ({ api_id: 1, api_hash: 'test-hash' }),
        extractSessionFromSqlite: async () => 'session-string-placeholder',
        _buildProxy: () => ({ ip: 'x', port: 1, socksType: 5 }),
        _getClientConfig: () => ({}),
        prepareServiceClient: () => {},
        _forceManagedIpv6Dc: () => {},
        connectWithProxyFallback: async () => {
            if (connectError) throw connectError;
            return { usedIpv6Fallback: false };
        },
        stringifySessionData: () => 'raw-session-string',
        saveRecoverySource: async () => {}
    };
}

// Алерт-харнес: мок fetch + env Telegram, дедуп сброшен на кейс.
async function withTelegramAlerts(run) {
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
        return await run(fetchCalls);
    } finally {
        globalThis.fetch = prevFetch;
        if (prevToken === undefined) delete process.env.TG_BOT_TOKEN; else process.env.TG_BOT_TOKEN = prevToken;
        if (prevChat === undefined) delete process.env.TG_ADMIN_CHAT_ID; else process.env.TG_ADMIN_CHAT_ID = prevChat;
        __resetPlatformAlertDedupForTests();
    }
}

beforeEach(disableFlag);
afterEach(disableFlag);

describe('qr-start: бесшовная выдача managed-слота', () => {
    it('флаг on + без proxy_id → слот заклеймлен, proxyData с force_ipv6, метка на сессии', async () => {
        enableFlag();
        const db = makeMockSupabase({ proxies: [{ ...SLOT }] });
        const service = makeQrService();
        const router = makeRouter();
        registerQr(router, { supabase: db, userbotService: service });
        const handler = routeHandler(router, 'POST', '/qr-start');
        const { req, res } = makeReqRes({ body: {} });

        await handler(req, res);

        assert.strictEqual(res.statusCode, 200, 'qr-start не требует proxy_id при включенном флаге');
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(service.generateQRCalls.length, 1);
        const sentProxyData = service.generateQRCalls[0].proxyData;
        assert.strictEqual(sentProxyData.proxy_id, 'p-1', 'в generateQR ушёл заклеймленный слот');
        assert.strictEqual(sentProxyData.proxy_host, '2001:db8::10');
        assert.strictEqual(sentProxyData.proxy_port, 25101);
        assert.strictEqual(sentProxyData.proxy_username, 'mp_1');
        assert.strictEqual(sentProxyData.proxy_password, 'slot-pass');
        assert.strictEqual(sentProxyData.force_ipv6, true, 'свежий слот: is_working=true, last_check_ip=null → force_ipv6');
        assert.strictEqual(sentProxyData.inventory_group, 'self_use');
        assert.strictEqual(db.tables.proxies[0].owner_id, OWNER, 'слот заклеймлен за владельцем');
        assert.strictEqual(service.qrSessions.get(OWNER).claimedProxySlotId, 'p-1', 'метка claim на qr-сессии');
    });

    it('флаг off + без proxy_id → прежний 400, БД не тронута', async () => {
        const db = makeMockSupabase({ proxies: [{ ...SLOT }] });
        const service = makeQrService();
        const router = makeRouter();
        registerQr(router, { supabase: db, userbotService: service });
        const handler = routeHandler(router, 'POST', '/qr-start');
        const { req, res } = makeReqRes({ body: {} });

        await handler(req, res);

        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.body.error, LEGACY_QR_MESSAGE);
        assert.strictEqual(db.calls.length, 0, 'ни одного запроса в БД');
        assert.strictEqual(service.generateQRCalls.length, 0);
        assert.strictEqual(db.tables.proxies[0].owner_id, null);
    });

    it('pool_empty → 400 с текстом про платформенные прокси + алерт ровно один раз', async () => {
        enableFlag();
        const db = makeMockSupabase({ proxies: [{ ...SLOT, owner_id: 'someone-else' }] });
        const service = makeQrService();
        const router = makeRouter();
        registerQr(router, { supabase: db, userbotService: service });
        const handler = routeHandler(router, 'POST', '/qr-start');
        const { req, res } = makeReqRes({ body: {} });

        await withTelegramAlerts(async (fetchCalls) => {
            await handler(req, res);

            assert.strictEqual(res.statusCode, 400);
            assert.strictEqual(res.body.error, POOL_EMPTY_MESSAGE);
            assert.strictEqual(service.generateQRCalls.length, 0);
            assert.strictEqual(db.tables.proxies[0].owner_id, 'someone-else', 'чужой слот не тронут');
            assert.strictEqual(fetchCalls.length, 1, 'алерт ушел один раз (дубль погашен дедупом)');
            assert.strictEqual(JSON.parse(fetchCalls[0].options.body).chat_id, '100200300');
            const alertText = JSON.parse(fetchCalls[0].options.body).text;
            assert.ok(alertText.includes('pool_empty'), 'в алерте видна причина исчерпания');
        });
    });

    it('generateQR упал после claim → слот возвращён в пул', async () => {
        enableFlag();
        const db = makeMockSupabase({ proxies: [{ ...SLOT }] });
        const service = makeQrService({ generateQRError: new Error('proxy connect boom') });
        const router = makeRouter();
        registerQr(router, { supabase: db, userbotService: service });
        const handler = routeHandler(router, 'POST', '/qr-start');
        const { req, res } = makeReqRes({ body: {} });

        await handler(req, res);

        assert.strictEqual(res.statusCode, 500);
        assert.strictEqual(db.tables.proxies[0].owner_id, null, 'слот вернулся в пул после провала');
        assert.equal(service.qrSessions.has(OWNER), false, 'сессия не запаркована');
    });
});

describe('qr-status: привязка и возврат слота', () => {
    function setup({ session, proxies, accounts = [] }) {
        const db = makeMockSupabase({ proxies, accounts });
        const service = makeQrService();
        service.qrSessions.set(OWNER, session);
        const router = makeRouter();
        registerQr(router, { supabase: db, userbotService: service });
        const handler = routeHandler(router, 'GET', '/qr-status');
        const { req, res } = makeReqRes({ body: {} });
        return { db, handler, req, res };
    }

    it('успех → аккаунт получил proxy_id слота, слот остаётся у владельца', async () => {
        enableFlag();
        const { db, handler, req, res } = setup({
            session: makeAuthorizedSession(),
            proxies: [{ ...SLOT, owner_id: OWNER }],
            accounts: []
        });

        await handler(req, res);

        assert.strictEqual(res.body.status, 'success');
        const saved = db.tables.tg_accounts[0];
        assert.ok(saved, 'аккаунт создан upsert-ом');
        assert.strictEqual(saved.owner_id, OWNER);
        assert.strictEqual(saved.account_type, 'userbot');
        assert.strictEqual(saved.tg_account_id, '777000');
        assert.strictEqual(saved.proxy_id, 'p-1', 'аккаунт получил proxy_id заклеймленного слота');
        assert.strictEqual(db.tables.proxies[0].owner_id, OWNER, 'слот потреблён, не возвращён в пул');
    });

    it('QR failed → слот возвращён в пул', async () => {
        const { db, handler, req, res } = setup({
            session: { ...makeAuthorizedSession(), authState: 'failed', authError: 'Прокси не смог подключиться.' },
            proxies: [{ ...SLOT, owner_id: OWNER }],
            accounts: []
        });

        await handler(req, res);

        assert.strictEqual(res.body.status, 'failed');
        assert.strictEqual(db.tables.proxies[0].owner_id, null, 'несостоявшееся подключение отпустило слот');
        assert.strictEqual(db.tables.tg_accounts.length, 0, 'аккаунт не создан');
    });

    it('не-transient ошибка (getMe упал) → слот возвращён в пул, 500', async () => {
        const { db, handler, req, res } = setup({
            session: makeAuthorizedSession({ getMeError: new Error('RPC collective FAIL') }),
            proxies: [{ ...SLOT, owner_id: OWNER }],
            accounts: []
        });

        await handler(req, res);

        assert.strictEqual(res.statusCode, 500);
        assert.strictEqual(db.tables.proxies[0].owner_id, null, 'слот не завис за мёртвым подключением');
        assert.strictEqual(db.tables.tg_accounts.length, 0);
    });
});

describe('import-session-file: бесшовная выдача managed-слота', () => {
    const FILES = {
        sessionFile: [{ path: '/tmp/test-import.session', originalname: 'test-import.session' }],
        jsonFile: [{ path: '/tmp/test-import.json', originalname: 'test-import.json' }]
    };

    function setup({ db, service }) {
        const router = makeRouter();
        registerSessions(router, { supabase: db, userbotService: service });
        const handler = routeHandler(router, 'POST', '/import-session-file');
        const { req, res } = makeReqRes({ body: {}, files: FILES });
        return { handler, req, res };
    }

    it('флаг off + без proxy_id → прежний 400, БД не тронута', async () => {
        const db = makeMockSupabase({ proxies: [{ ...SLOT }] });
        const { handler, req, res } = setup({ db, service: makeImportService() });

        await handler(req, res);

        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.body.error, LEGACY_IMPORT_MESSAGE);
        assert.strictEqual(db.calls.length, 0);
        assert.strictEqual(db.tables.proxies[0].owner_id, null);
    });

    it('pool_empty → 400 с текстом про платформенные прокси + алерт ровно один раз', async () => {
        enableFlag();
        const db = makeMockSupabase({ proxies: [{ ...SLOT, owner_id: 'someone-else' }] });
        const { handler, req, res } = setup({ db, service: makeImportService() });

        await withTelegramAlerts(async (fetchCalls) => {
            await handler(req, res);

            assert.strictEqual(res.statusCode, 400);
            assert.strictEqual(res.body.error, POOL_EMPTY_MESSAGE);
            assert.strictEqual(fetchCalls.length, 1);
            assert.ok(JSON.parse(fetchCalls[0].options.body).text.includes('pool_empty'));
            assert.strictEqual(db.tables.proxies[0].owner_id, 'someone-else');
        });
    });

    it('коннект упал после claim → слот возвращён в пул', async () => {
        enableFlag();
        const db = makeMockSupabase({ proxies: [{ ...SLOT }] });
        const service = makeImportService({ connectError: new Error('socks proxy down') });
        const { handler, req, res } = setup({ db, service });

        await handler(req, res);

        assert.strictEqual(res.statusCode, 500);
        assert.strictEqual(db.tables.proxies[0].owner_id, null, 'провал коннекта вернул слот в пул');
        assert.strictEqual(db.tables.tg_accounts.length, 0, 'аккаунт не создан');
    });
});
