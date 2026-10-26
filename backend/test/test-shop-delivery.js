/**
 * Юнит-тесты выдачи аккаунт-лотов (account shop delivery, Wave 2).
 * Офлайн, детерминированные: гейты аккаунтов и файловая выдача — на моке
 * supabase в стиле test-shop-quarantine.js, архив собирается реальным
 * adm-zip, blob'ы шифруются реальным encrypt() (ENCRYPTION_KEY — тестовый).
 * Оплата в runShopPurchaseCheck инъекцией paymentCheckFn — сеть не трогаем.
 *
 * Покрывает: гейт аккаунт-лота (pending_activation свежий+online продаётся;
 * устаревший/frozen/без health — карантин), ослабленный guard трансфера,
 * batch-выставление (упавший аккаунт не мешает остальным), purchase-anon
 * (buyer null), kind-aware отстойник при брони, files-выдачу при оплате
 * (доставлен штамп + лот закрыт, трансфера нет), гибрид с покупателем
 * (трансфер + delivered), гибрид у анонима (files), ранний выход re-check
 * files-покупки, скачивание (состав zip, sha256/размер кэш, счётчик),
 * 409/410/429, public-view delivery, пурж files-выдач (restore source +
 * аккаунт + прокси + purged_at; гибрид не пуржится).
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-0123456789ab';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
process.env.PLATFORM_TON_WALLET = process.env.PLATFORM_TON_WALLET || 'UQtestwalletforrunittests000';

import crypto from 'crypto';

const AdmZip = (await import('adm-zip')).default;
const { encrypt } = await import('../utils/crypto.js');
const {
    ACCOUNT_LOT_NOT_READY_MESSAGE,
    ARCHIVE_EXPIRED_MESSAGE,
    buildAccountDeliveryView,
    findUnsellableAccountLot,
    prepareShopArchiveDelivery
} = await import('../services/shop-delivery.service.js');
const { transferShopAssets } = await import('../services/shop-transfer.service.js');
const { runSoldFilesPurge } = await import('../jobs/sold-files-purge.job.js');
const { createAccountLotsBatch, createOrRefreshBuyerPurchase, runShopPurchaseCheck } = await import('../routes/shop.routes.js');

let failures = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        failures++;
    }
}
async function capture(promise) {
    try {
        await promise;
        return null;
    } catch (e) {
        return e;
    }
}

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BUYER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACC1 = '11111111-1111-4111-8111-111111111111';
const ACC2 = '12121212-1212-4121-8121-121212121212';
const ACC_BAD = '13131313-1313-4131-8131-131313131313';
const PROXY_ID = '22222222-2222-4222-8222-222222222222';
const PROXY2_ID = '23232323-2323-4232-8232-232323232323';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_HYBRID = '34343434-3434-4343-8343-343434343434';
const PURCHASE_ID = '44444444-4444-4444-8444-444444444444';
const PURCHASE_HYBRID_ID = '45454545-4545-4545-8545-454545454545';

const FRESH_ISO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const STALE_ISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

// --- Мок supabase: thenable-билдер с проекцией select, insert/update/delete,
// фильтры eq/in/is/lt/not + json-пути вида payload->delivery->>mode ---
function makeMockSupabase(tablesInit = {}) {
    const tables = {};
    for (const [name, rows] of Object.entries(tablesInit)) tables[name] = rows.map((r) => ({ ...r }));

    const cellFor = (row, col) => {
        if (!col.includes('->')) return row?.[col];
        const segs = col.split('->').map((part, index) => (index > 0 && part.startsWith('>') ? part.slice(1) : part));
        let cur = row;
        for (const seg of segs) {
            if (cur == null) return undefined;
            cur = cur[seg];
        }
        return cur;
    };
    const applyOp = (row, col, op, val) => {
        const cell = cellFor(row, col);
        if (op === 'eq') return String(cell) === String(val);
        if (op === 'is') return (val === null || val === undefined) ? (cell === null || cell === undefined) : cell === val;
        if (op === 'lt') return cell != null && new Date(cell).getTime() < new Date(val).getTime();
        if (op === 'not') return !applyOp(row, col, val.op, val.value);
        if (op === 'in') return (val || []).some((v) => String(cell) === String(v));
        return true;
    };
    const predFor = (filters) => (row) => filters.every(([col, op, val]) => applyOp(row, col, op, val));

    const db = {
        from(table) {
            const rows = tables[table] ?? (tables[table] = []);
            const filters = [];
            let selectCols = '';
            const matches = () => rows.filter((row) => predFor(filters)(row));
            const project = (row) => {
                const cols = String(selectCols || '').split(',').map((s) => s.trim()).filter(Boolean);
                if (!cols.length || cols.includes('*')) return { ...row };
                return Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]]));
            };
            const builder = {
                select(cols) { selectCols = String(cols || ''); return builder; },
                eq(col, val) { filters.push([col, 'eq', val]); return builder; },
                is(col, val) { filters.push([col, 'is', val]); return builder; },
                lt(col, val) { filters.push([col, 'lt', val]); return builder; },
                not(col, op, val) { filters.push([col, 'not', { op, value: val }]); return builder; },
                in(col, vals) { filters.push([col, 'in', vals]); return builder; },
                order() { return builder; },
                limit() { return builder; },
                insert(payload) {
                    const list = Array.isArray(payload) ? payload : [payload];
                    const inserted = list.map((p) => ({ id: p.id || crypto.randomUUID(), ...p }));
                    rows.push(...inserted);
                    const insertBuilder = {
                        select(cols) { selectCols = String(cols || ''); return insertBuilder; },
                        single: async () => ({ data: inserted[0] ? project(inserted[0]) : null, error: null }),
                        maybeSingle: async () => ({ data: inserted[0] ? project(inserted[0]) : null, error: null }),
                        then(resolve) { resolve({ data: inserted.map(project), error: null }); }
                    };
                    return insertBuilder;
                },
                update(patch) {
                    const apply = () => {
                        const patched = [];
                        for (const row of rows) {
                            if (predFor(filters)(row)) { Object.assign(row, patch); patched.push(row); }
                        }
                        return patched;
                    };
                    const updateBuilder = {
                        eq(col, val) { filters.push([col, 'eq', val]); return updateBuilder; },
                        in(col, vals) { filters.push([col, 'in', vals]); return updateBuilder; },
                        select(cols) { selectCols = String(cols || ''); return updateBuilder; },
                        single: async () => { const patched = apply(); return { data: patched[0] ? { ...patched[0] } : null, error: null }; },
                        maybeSingle: async () => { const patched = apply(); return { data: patched[0] ? { ...patched[0] } : null, error: null }; },
                        then(resolve) { const patched = apply(); resolve({ data: null, error: null, count: patched.length }); }
                    };
                    return updateBuilder;
                },
                delete() {
                    const deleteBuilder = {
                        eq(col, val) { filters.push([col, 'eq', val]); return deleteBuilder; },
                        in(col, vals) { filters.push([col, 'in', vals]); return deleteBuilder; },
                        then(resolve) {
                            const doomed = rows.filter((row) => predFor(filters)(row));
                            const keep = rows.filter((row) => !predFor(filters)(row));
                            rows.length = 0;
                            rows.push(...keep);
                            resolve({ data: null, error: null, count: doomed.length });
                        }
                    };
                    return deleteBuilder;
                },
                maybeSingle: async () => { const m = matches(); return { data: m[0] ? project(m[0]) : null, error: null }; },
                single: async () => { const m = matches(); return { data: m[0] ? project(m[0]) : null, error: null }; },
                then(resolve) { const m = matches(); resolve({ data: m.map(project), error: null, count: m.length }); }
            };
            return builder;
        }
    };
    db._tables = tables;
    return db;
}

function accountRow(overrides = {}) {
    return {
        id: ACC1,
        owner_id: OWNER,
        account_type: 'userbot',
        custom_label: '+13…642',
        runtime_status: 'pending_activation',
        last_checked_at: FRESH_ISO,
        health_summary: { status: 'online' },
        proxy_id: PROXY_ID,
        ...overrides
    };
}

function restoreSourceRow(overrides = {}) {
    return {
        account_id: ACC1,
        owner_id: OWNER,
        session_blob_encrypted: encrypt(Buffer.from('SESSION-SQLITE-BYTES').toString('base64')),
        json_blob_encrypted: encrypt('{"app_id": 4, "device": "Desktop"}'),
        tdata_blob_encrypted: encrypt(Buffer.from('TDATA-ZIP-BYTES').toString('base64')),
        two_fa_secret_encrypted: encrypt('p@ssw0rd-2fa'),
        ...overrides
    };
}

function filesDelivery(deliveredAtIso, overrides = {}) {
    return {
        mode: 'files',
        downloads: [],
        downloads_max: 10,
        window_hours: 168,
        purged_at: null,
        sha256: null,
        size_bytes: null,
        ...overrides
    };
}

function accountItemRow(overrides = {}) {
    return {
        id: ITEM_ID,
        owner_id: OWNER,
        title: 'Аккаунт из приёмки',
        item_type: 'account',
        delivery_mode: 'files',
        price_ton: 12,
        status: 'published',
        visibility: 'public',
        sales_channel: 'both',
        payment_methods: ['ton'],
        transfer_mode: 'ownership_transfer',
        ...overrides
    };
}

function baseTables(overrides = {}) {
    return {
        tg_accounts: [accountRow()],
        proxies: [{
            id: PROXY_ID, owner_id: OWNER, host: '1.2.3.4', port: 1080,
            username: 'u3p', password: 'pw', is_working: true,
            provision_source: 'manual_admin', inventory_group: 'self_use'
        }],
        shop_items: [accountItemRow()],
        shop_item_assets: [{
            id: 'sa1', shop_item_id: ITEM_ID, asset_type: 'userbot', asset_id: ACC1, label: '+13…642', sort_order: 0
        }],
        shop_purchases: [],
        userbot_restore_sources: [restoreSourceRow()],
        ...overrides
    };
}

function pendingPurchase(overrides = {}) {
    return {
        id: PURCHASE_ID,
        shop_item_id: ITEM_ID,
        seller_owner_id: OWNER,
        buyer_owner_id: null,
        status: 'pending',
        amount_ton: 12,
        ownership_transfer_status: 'pending',
        ownership_transfer_error: null,
        delivered_at: null,
        created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        payload: { payment_method: 'ton', memo: 'shop_test1', seller_wallet: 'UQtestwalletforrunittests000' },
        ...overrides
    };
}

console.log('— Гейт аккаунт-лотов (создание/бронь/выдача) —');

{
    assert(findUnsellableAccountLot([accountRow()]) === null, 'pending_activation свежий + health online → продаётся');
    assert(findUnsellableAccountLot([accountRow({ last_checked_at: STALE_ISO })]) !== null, 'pending_activation устаревший → карантин');
    assert(findUnsellableAccountLot([accountRow({ health_summary: null })]) !== null, 'pending_activation без health → карантин');
    assert(findUnsellableAccountLot([accountRow({ runtime_status: 'frozen' })]) !== null, 'frozen → карантин');
    assert(findUnsellableAccountLot([accountRow({ runtime_status: 'restricted' })]) !== null, 'restricted → карантин');
    assert(findUnsellableAccountLot([accountRow({ runtime_status: 'online' })]) === null, 'online свежий → продаётся');
    assert(findUnsellableAccountLot([accountRow({ runtime_status: 'online', last_checked_at: STALE_ISO })]) !== null, 'online устаревший → карантин');
}

console.log('— transferShopAssets: ослабленный guard для intake-стока —');

{
    const supabase = makeMockSupabase(baseTables());
    const error = await capture(transferShopAssets(
        supabase,
        { buyer_owner_id: BUYER, seller_owner_id: OWNER },
        { id: ITEM_ID },
        [{ asset_type: 'userbot', asset_id: ACC1 }]
    ));
    assert(!error, 'pending_activation свежий+online: трансфер проходит');
    assert(supabase._tables.tg_accounts[0].owner_id === BUYER, 'владелец сменился на покупателя');
}
{
    const supabase = makeMockSupabase(baseTables({
        tg_accounts: [accountRow({ last_checked_at: STALE_ISO })]
    }));
    const error = await capture(transferShopAssets(
        supabase,
        { buyer_owner_id: BUYER, seller_owner_id: OWNER },
        { id: ITEM_ID },
        [{ asset_type: 'userbot', asset_id: ACC1 }]
    ));
    assert(error && error.quarantinedAssetId === ACC1, 'pending_activation устаревший: трансфер отменён');
    assert(supabase._tables.tg_accounts[0].owner_id === OWNER, 'владелец не сменился');
}
{
    const supabase = makeMockSupabase(baseTables({
        tg_accounts: [accountRow({ runtime_status: 'frozen' })]
    }));
    const error = await capture(transferShopAssets(
        supabase,
        { buyer_owner_id: BUYER, seller_owner_id: OWNER },
        { id: ITEM_ID },
        [{ asset_type: 'userbot', asset_id: ACC1 }]
    ));
    assert(error, 'frozen: трансфер отменён');
}

console.log('— Batch-выставление аккаунтов —');

{
    const supabase = makeMockSupabase(baseTables({
        tg_accounts: [
            accountRow({ id: ACC1 }),
            accountRow({ id: ACC2, custom_label: '+44…777' }),
            accountRow({ id: ACC_BAD, custom_label: '+55…111', runtime_status: 'frozen' })
        ],
        shop_items: [],
        shop_item_assets: [],
        userbot_restore_sources: []
    }));
    const result = await createAccountLotsBatch(supabase, {
        ownerId: OWNER,
        assetIds: [ACC1, ACC2, ACC_BAD],
        priceTon: 5,
        title: 'Аккаунт из приёмки',
        deliveryMode: 'hybrid'
    });
    assert(result.created === 2, 'batch: создано 2 лота, упавший аккаунт не помешал');
    const statusByAsset = Object.fromEntries(result.results.map((row) => [row.asset_id, row.status]));
    assert(statusByAsset[ACC1] === 'ok' && statusByAsset[ACC2] === 'ok' && statusByAsset[ACC_BAD] === 'failed', 'batch: ok/ok/failed по активам');
    assert(result.results.find((row) => row.asset_id === ACC_BAD).error === ACCOUNT_LOT_NOT_READY_MESSAGE, 'batch: frozen дал ошибку гейта');
    const items = supabase._tables.shop_items;
    assert(items.length === 2, 'batch: ровно 2 лота в БД');
    assert(items.every((item) =>
        item.item_type === 'account'
        && item.status === 'published'
        && item.visibility === 'public'
        && item.sales_channel === 'both'
        && item.transfer_mode === 'ownership_transfer'
        && item.delivery_mode === 'hybrid'
    ), 'batch: лоты опубликованы как account/hybrid');
    assert(supabase._tables.shop_item_assets.length === 2, 'batch: у каждого лота свой userbot-актив');
}

console.log('— Анонимная покупка (purchase-anon) —');

{
    const supabase = makeMockSupabase(baseTables());
    const { purchase } = await createOrRefreshBuyerPurchase({
        supabase,
        buyerOwnerId: null,
        itemId: ITEM_ID,
        paymentMethod: 'ton'
    });
    assert(purchase.buyer_owner_id === null, 'anon: buyer_owner_id null в ответе');
    assert(supabase._tables.shop_purchases[0].buyer_owner_id === null, 'anon: buyer_owner_id null в БД');
    assert(purchase.status === 'pending', 'anon: бронь создана pending');
}

console.log('— Kind-aware отстойник при брони —');

{
    const supabase = makeMockSupabase(baseTables({
        shop_items: [accountItemRow({ item_type: 'userbot', delivery_mode: null })]
    }));
    const error = await capture(createOrRefreshBuyerPurchase({
        supabase,
        buyerOwnerId: BUYER,
        itemId: ITEM_ID,
        paymentMethod: 'ton'
    }));
    assert(error?.statusCode === 400, 'userbot-лот: pending_activation брони не получает (легаси-блоклист)');
}
{
    const supabase = makeMockSupabase(baseTables({
        shop_items: [accountItemRow({ delivery_mode: 'hybrid' })]
    }));
    const { purchase } = await createOrRefreshBuyerPurchase({
        supabase,
        buyerOwnerId: BUYER,
        itemId: ITEM_ID,
        paymentMethod: 'ton'
    });
    assert(purchase.buyer_owner_id === BUYER, 'account-лот: свежий pending_activation бронируется');
}

console.log('— Выдача при оплате (runShopPurchaseCheck) —');

{
    const supabase = makeMockSupabase(baseTables({
        shop_items: [accountItemRow({ delivery_mode: 'files' })],
        shop_purchases: [pendingPurchase({ buyer_owner_id: null })]
    }));
    let paymentCalls = 0;
    const result = await runShopPurchaseCheck(supabase, supabase._tables.shop_purchases[0], {
        paymentCheckFn: async () => { paymentCalls += 1; return true; }
    });
    assert(result.ok === true && result.body.status === 'paid', 'files: оплата зачтена');
    const purchaseRow = supabase._tables.shop_purchases[0];
    assert(Boolean(purchaseRow.delivered_at), 'files: delivered_at проставлен');
    assert(purchaseRow.payload.delivery?.mode === 'files' && Array.isArray(purchaseRow.payload.delivery.downloads), 'files: payload.delivery оформлен');
    assert(purchaseRow.payload.delivery.downloads_max === 10 && purchaseRow.payload.delivery.window_hours === 168, 'files: квота/окно по дефолтам');
    assert(purchaseRow.ownership_transfer_status === 'pending', 'files: transfer-статус не completed (пурж имеет право сработать)');
    assert(supabase._tables.shop_items[0].status === 'sold' && supabase._tables.shop_items[0].visibility === 'private', 'files: лот закрыт');
    assert(supabase._tables.tg_accounts[0].owner_id === OWNER, 'files: аккаунт НЕ передан покупателю');
    assert(supabase._tables.proxies[0].owner_id === OWNER, 'files: прокси НЕ передан');
}
{
    const supabase = makeMockSupabase(baseTables({
        shop_items: [accountItemRow({ delivery_mode: 'hybrid' })],
        shop_purchases: [pendingPurchase({ buyer_owner_id: BUYER })]
    }));
    const result = await runShopPurchaseCheck(supabase, supabase._tables.shop_purchases[0], {
        paymentCheckFn: async () => true
    });
    assert(result.ok === true && result.body.ownership_transfer_status === 'completed', 'hybrid+buyer: трансфер проведён');
    const purchaseRow = supabase._tables.shop_purchases[0];
    assert(Boolean(purchaseRow.delivered_at), 'hybrid+buyer: delivered_at проставлен');
    assert(purchaseRow.payload.delivery?.mode === 'hybrid' && purchaseRow.payload.delivery?.transferred === true, 'hybrid+buyer: payload.delivery гибрид');
    assert(supabase._tables.tg_accounts[0].owner_id === BUYER, 'hybrid+buyer: аккаунт передан покупателю');
    assert(supabase._tables.tg_accounts[0].proxy_id === null && supabase._tables.proxies[0].owner_id === OWNER, 'hybrid+buyer: прокси без актива в лоте отвязан и остаётся у продавца (легаси-семантика transferShopAssets)');
    assert(supabase._tables.shop_items[0].status === 'sold', 'hybrid+buyer: лот продан');
}
{
    const supabase = makeMockSupabase(baseTables({
        shop_items: [accountItemRow({ delivery_mode: 'hybrid' })],
        shop_purchases: [pendingPurchase({ buyer_owner_id: null })]
    }));
    const result = await runShopPurchaseCheck(supabase, supabase._tables.shop_purchases[0], {
        paymentCheckFn: async () => true
    });
    assert(result.ok === true, 'hybrid+anon: оплата зачтена');
    assert(supabase._tables.shop_purchases[0].payload.delivery?.mode === 'files', 'hybrid+anon: выдача осталась files');
    assert(supabase._tables.tg_accounts[0].owner_id === OWNER, 'hybrid+anon: аккаунт не передан');
}
{
    const nowIso = new Date().toISOString();
    const supabase = makeMockSupabase(baseTables({
        shop_items: [accountItemRow({ status: 'sold', visibility: 'private', delivery_mode: 'files' })],
        shop_purchases: [pendingPurchase({
            status: 'paid',
            delivered_at: nowIso,
            payload: { payment_method: 'ton', memo: 'shop_x', seller_wallet: 'UQtestwalletforrunittests000', delivery: filesDelivery(nowIso) }
        })]
    }));
    let paymentCalls = 0;
    const result = await runShopPurchaseCheck(supabase, supabase._tables.shop_purchases[0], {
        paymentCheckFn: async () => { paymentCalls += 1; return true; }
    });
    assert(result.ok === true && result.body.status === 'paid', 'files re-check: ранний выход, sold-race не срабатывает');
    assert(paymentCalls === 0, 'files re-check: повторная проверка платежа не нужна');
}

console.log('— Публичное скачивание архива —');

{
    const nowIso = new Date().toISOString();
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [pendingPurchase({
            status: 'paid',
            delivered_at: nowIso,
            payload: { memo: 'shop_x', seller_wallet: 'UQtestwalletforrunittests000', delivery: filesDelivery(nowIso) }
        })]
    }));
    const result = await prepareShopArchiveDelivery(supabase, supabase._tables.shop_purchases[0], {
        ip: '9.9.9.9',
        rateCheck: () => true
    });
    assert(result.ok === true, 'download: выдача прошла');
    assert(result.archive.basename === 'account-13642', 'download: basename из маскированного номера');
    const zip = new AdmZip(result.archive.buffer);
    const names = zip.getEntries().map((entry) => entry.entryName);
    assert(names.includes('account-13642.session'), 'download: session в архиве');
    assert(names.includes('account-13642.json'), 'download: json в архиве');
    assert(names.includes('tdata.zip'), 'download: tdata в архиве');
    assert(names.includes('пароль-2fa.txt'), 'download: пароль 2FA в архиве');
    assert(names.includes('README.txt'), 'download: README в архиве');
    assert(zip.getEntry('account-13642.session').getData().toString() === 'SESSION-SQLITE-BYTES', 'download: session распакован корректно');
    assert(zip.getEntry('пароль-2fa.txt').getData().toString() === 'p@ssw0rd-2fa', 'download: пароль 2FA читается');
    const deliveryRow = supabase._tables.shop_purchases[0].payload.delivery;
    assert(deliveryRow.downloads.length === 1 && deliveryRow.downloads[0].ip === '9.9.9.9', 'download: счётчик +1 с ip');
    assert(deliveryRow.sha256 === result.archive.sha256 && deliveryRow.sha256.length === 64, 'download: sha256 закэширован');
    assert(deliveryRow.size_bytes === result.archive.sizeBytes && deliveryRow.size_bytes > 0, 'download: размер закэширован');
}
{
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [pendingPurchase({ status: 'pending' })]
    }));
    const result = await prepareShopArchiveDelivery(supabase, supabase._tables.shop_purchases[0], { rateCheck: () => true });
    assert(result.ok === false && result.statusCode === 409, 'download: неоплаченная покупка → 409');
}
{
    const oldIso = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [pendingPurchase({
            status: 'paid',
            delivered_at: oldIso,
            payload: { memo: 'shop_x', delivery: filesDelivery(oldIso) }
        })]
    }));
    const result = await prepareShopArchiveDelivery(supabase, supabase._tables.shop_purchases[0], { rateCheck: () => true });
    assert(result.ok === false && result.statusCode === 410 && result.error === ARCHIVE_EXPIRED_MESSAGE, 'download: окно истекло → 410');
}
{
    const nowIso = new Date().toISOString();
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [pendingPurchase({
            status: 'paid',
            delivered_at: nowIso,
            payload: { memo: 'shop_x', delivery: filesDelivery(nowIso, { purged_at: nowIso }) }
        })]
    }));
    const result = await prepareShopArchiveDelivery(supabase, supabase._tables.shop_purchases[0], { rateCheck: () => true });
    assert(result.ok === false && result.statusCode === 410, 'download: пуржнутое → 410');
}
{
    const nowIso = new Date().toISOString();
    const fullDownloads = Array.from({ length: 10 }, (_, index) => ({ at: nowIso, ip: `10.0.0.${index}` }));
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [pendingPurchase({
            status: 'paid',
            delivered_at: nowIso,
            payload: { memo: 'shop_x', delivery: filesDelivery(nowIso, { downloads: fullDownloads }) }
        })]
    }));
    const result = await prepareShopArchiveDelivery(supabase, supabase._tables.shop_purchases[0], { rateCheck: () => true });
    assert(result.ok === false && result.statusCode === 429, 'download: квота исчерпана → 429');
}
{
    const nowIso = new Date().toISOString();
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [pendingPurchase({
            status: 'paid',
            delivered_at: nowIso,
            payload: { memo: 'shop_x', delivery: filesDelivery(nowIso) }
        })]
    }));
    const result = await prepareShopArchiveDelivery(supabase, supabase._tables.shop_purchases[0], { rateCheck: () => false });
    assert(result.ok === false && result.statusCode === 429, 'download: rate-limit → 429');
}

console.log('— Публичное представление выдачи (public-view delivery) —');

{
    const view = buildAccountDeliveryView({
        status: 'pending',
        deliveredAt: null,
        itemDeliveryMode: 'hybrid',
        payloadDelivery: null,
        label: '+13…642'
    });
    assert(view.available === false && view.mode === 'hybrid' && view.label === '+13…642', 'view: pending → недоступно, режим из лота');
    assert(view.reason === 'Оплата ещё не подтверждена', 'view: pending → причина «не оплачено»');
}
{
    const nowIso = new Date().toISOString();
    const view = buildAccountDeliveryView({
        status: 'paid',
        deliveredAt: nowIso,
        itemDeliveryMode: 'files',
        payloadDelivery: filesDelivery(nowIso),
        label: '+13…642'
    });
    assert(view.available === true && Boolean(view.window_ends_at), 'view: files в окне → доступно с окном');
    assert(view.downloads_used === 0 && view.downloads_max === 10, 'view: счётчики квоты видны');
}
{
    const nowIso = new Date().toISOString();
    const view = buildAccountDeliveryView({
        status: 'paid',
        deliveredAt: nowIso,
        itemDeliveryMode: 'hybrid',
        payloadDelivery: { mode: 'hybrid', transferred: true, downloads: [] },
        label: '+13…642'
    });
    assert(view.available === true && view.window_ends_at === null, 'view: гибрид с трансфером → бессрочно');
}
{
    const nowIso = new Date().toISOString();
    const view = buildAccountDeliveryView({
        status: 'paid',
        deliveredAt: nowIso,
        itemDeliveryMode: 'files',
        payloadDelivery: filesDelivery(nowIso, { purged_at: nowIso }),
        label: '+13…642'
    });
    assert(view.available === false && view.reason === ARCHIVE_EXPIRED_MESSAGE, 'view: пуржнутое → «срок истёк»');
}

console.log('— Пурж files-выдач (sold-files-purge) —');

{
    const oldIso = new Date(Date.now() - 200 * 60 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase({
        tg_accounts: [
            accountRow({ id: ACC1 }),
            accountRow({ id: ACC2, custom_label: '+44…777', proxy_id: PROXY2_ID })
        ],
        proxies: [
            { id: PROXY_ID, owner_id: OWNER, host: '1.2.3.4', port: 1080, username: 'u3p', password: 'pw', provision_source: 'manual_admin' },
            { id: PROXY2_ID, owner_id: OWNER, host: '5.6.7.8', port: 1080, username: 'u4p', password: 'pw', provision_source: 'manual_admin' }
        ],
        shop_items: [accountItemRow(), accountItemRow({ id: ITEM_HYBRID, delivery_mode: 'hybrid' })],
        shop_item_assets: [
            { id: 'sa1', shop_item_id: ITEM_ID, asset_type: 'userbot', asset_id: ACC1, label: null, sort_order: 0 },
            { id: 'sa2', shop_item_id: ITEM_HYBRID, asset_type: 'userbot', asset_id: ACC2, label: null, sort_order: 0 }
        ],
        shop_purchases: [
            pendingPurchase({
                id: PURCHASE_ID,
                status: 'paid',
                delivered_at: oldIso,
                payload: { memo: 'shop_files', delivery: filesDelivery(oldIso) }
            }),
            pendingPurchase({
                id: PURCHASE_HYBRID_ID,
                shop_item_id: ITEM_HYBRID,
                buyer_owner_id: BUYER,
                status: 'paid',
                ownership_transfer_status: 'completed',
                delivered_at: oldIso,
                payload: { memo: 'shop_hybrid', delivery: { mode: 'hybrid', transferred: true } }
            })
        ],
        userbot_restore_sources: [
            restoreSourceRow({ account_id: ACC1 }),
            restoreSourceRow({ account_id: ACC2 })
        ]
    });
    const released = [];
    const proxyStub = {
        releaseManagedProxy: async (args) => { released.push(args.username); return true; }
    };
    await runSoldFilesPurge(supabase, { managedProxyService: proxyStub });

    assert(supabase._tables.tg_accounts.length === 1 && supabase._tables.tg_accounts[0].id === ACC2, 'purge: files-аккаунт удалён, гибридный остался');
    assert(supabase._tables.userbot_restore_sources.length === 1 && supabase._tables.userbot_restore_sources[0].account_id === ACC2, 'purge: restore source удалён только у files');
    assert(supabase._tables.proxies.length === 1 && supabase._tables.proxies[0].id === PROXY2_ID, 'purge: личный прокси files-аккаунта удалён');
    assert(released.length === 1 && released[0] === 'u3p', 'purge: managed-слот освобождён');
    const filesRow = supabase._tables.shop_purchases.find((row) => row.id === PURCHASE_ID);
    assert(Boolean(filesRow.payload.delivery.purged_at), 'purge: purged_at проставлен');
    const hybridRow = supabase._tables.shop_purchases.find((row) => row.id === PURCHASE_HYBRID_ID);
    assert(!hybridRow.payload.delivery.purged_at, 'purge: гибридная покупка не тронута');
}

console.log(failures === 0 ? '\nВсе проверки выдачи аккаунтов прошли' : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
