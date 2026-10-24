/**
 * Юнит-тесты отстойника (план 2026-10-25-shop-quarantine.md).
 * Офлайн, детерминированные: гейты продажи и job автопроверки гоняем на
 * моке supabase в стиле test-broadcast-cleanup.js, Telegram не трогаем —
 * в job передаём инъекционный checkFn.
 *
 * Покрывает: double-guard transferShopAssets (передаём только online),
 * hasActiveShopPurchases (pending/paid vs completed vs нет таблицы),
 * purgeRestrictedUserbotAccount (skip при живой покупке, полный purge без неё),
 * runListedHealthCheck (restricted → unpublish + событие + чистка прокси;
 * expired → только unpublish; online → ничего; свежий аккаунт — скип).
 */
import { transferShopAssets } from '../services/shop-transfer.service.js';
import { hasActiveShopPurchases, purgeRestrictedUserbotAccount } from '../utils/restricted-userbot-ops.js';
import { runListedHealthCheck } from '../jobs/listed-userbot-health.job.js';

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
const UB_ID = '11111111-1111-4111-8111-111111111111';
const PROXY_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const PURCHASE_ID = '44444444-4444-4444-8444-444444444444';

// --- Мок supabase: thenable-билдер с фильтрами eq/in + update/delete/insert ---
function makeMockSupabase(tablesInit = {}, { tableErrors = {} } = {}) {
    const tables = {};
    for (const [name, rows] of Object.entries(tablesInit)) tables[name] = rows.map((r) => ({ ...r }));
    const predFor = (filters) => (row) => filters.every(([col, op, val]) => {
        const cell = row[col];
        if (op === 'eq') return String(cell) === String(val);
        if (op === 'in') return (val || []).some((v) => String(cell) === String(v));
        return true;
    });
    const db = {
        from(table) {
            const rows = tables[table] ?? (tables[table] = []);
            const filters = [];
            const selectOpts = {};
            const matches = () => rows.filter(predFor(filters));
            const builder = {
                _cols: '',
                select(cols, opts = {}) { builder._cols = String(cols || ''); Object.assign(selectOpts, opts || {}); return builder; },
                eq(col, val) { filters.push([col, 'eq', val]); return builder; },
                in(col, vals) { filters.push([col, 'in', vals]); return builder; },
                order() { return builder; },
                limit(n) { limitCount = n; return builder; },
                insert(payload) {
                    const list = Array.isArray(payload) ? payload : [payload];
                    for (const p of list) rows.push({ ...p });
                    return Promise.resolve({ data: list.map((p) => ({ ...p })), error: null });
                },
                update(patch) {
                    const updateBuilder = {
                        eq(col, val) { filters.push([col, 'eq', val]); return updateBuilder; },
                        in(col, vals) { filters.push([col, 'in', vals]); return updateBuilder; },
                        select() { return updateBuilder; },
                        then(resolve) {
                            let count = 0;
                            for (const row of rows) {
                                if (predFor(filters)(row)) { Object.assign(row, patch); count++; }
                            }
                            resolve({ data: null, error: null, count });
                        }
                    };
                    return updateBuilder;
                },
                delete() {
                    const deleteBuilder = {
                        eq(col, val) { filters.push([col, 'eq', val]); return deleteBuilder; },
                        in(col, vals) { filters.push([col, 'in', vals]); return deleteBuilder; },
                        then(resolve) {
                            const before = rows.length;
                            const keep = rows.filter((row) => !predFor(filters)(row));
                            rows.length = 0;
                            rows.push(...keep);
                            resolve({ data: null, error: null, count: before - keep.length });
                        }
                    };
                    return deleteBuilder;
                },
                maybeSingle: async () => ({ data: matches()[0] || null, error: null }),
                single: async () => ({ data: matches()[0] || null, error: null }),
                then(resolve) {
                    const tableError = tableErrors[table];
                    if (tableError) {
                        resolve({ data: null, error: { ...tableError } });
                        return;
                    }
                    // Проекция колонок как в PostgREST: ловит код, который читает
                    // невыбранные поля (select — не украшение, а контракт).
                    const cols = String(builder._cols || '').split(',').map(s => s.trim()).filter(Boolean);
                    const project = (row) => (cols.includes('*') || !cols.length
                        ? { ...row }
                        : Object.fromEntries(cols.filter(c => c in row).map(c => [c, row[c]])));
                    resolve({
                        data: selectOpts.head ? [] : matches().map(project),
                        error: null,
                        count: selectOpts.count === 'exact' ? matches().length : null
                    });
                }
            };
            let limitCount = null;
            void limitCount;
            return builder;
        }
    };
    db._tables = tables;
    return db;
}

function baseTables(overrides = {}) {
    return {
        tg_accounts: [{
            id: UB_ID, owner_id: OWNER, account_type: 'userbot',
            tg_username: 'testbot', runtime_status: 'online',
            session_data: 'enc', proxy_id: PROXY_ID
        }],
        proxies: [{
            id: PROXY_ID, owner_id: OWNER, host: '1.2.3.4', port: 1080,
            username: 'u', password: 'p', is_working: true, provision_source: null
        }],
        shop_items: [{
            id: ITEM_ID, owner_id: OWNER, status: 'published', visibility: 'public', title: 'Лот'
        }],
        shop_item_assets: [{
            id: 'sa1', shop_item_id: ITEM_ID, asset_type: 'userbot', asset_id: UB_ID, label: null, sort_order: 0
        }],
        shop_purchases: [],
        telegram_error_events: [],
        userbot_restore_sources: [],
        userbot_inbox_notifications: [],
        ...overrides
    };
}

const SELLER_ITEM = { id: ITEM_ID, status: 'published' };
const ASSETS = [{ asset_type: 'userbot', asset_id: UB_ID }];

console.log('— transferShopAssets: double-guard отстойника —');

{
    const supabase = makeMockSupabase(baseTables({
        tg_accounts: baseTables().tg_accounts.map((row) => ({ ...row, runtime_status: 'error' }))
    }));
    const purchase = { buyer_owner_id: BUYER, seller_owner_id: OWNER };
    const error = await capture(transferShopAssets(supabase, purchase, SELLER_ITEM, ASSETS));
    assert(error, 'error-аккаунт: трансфер падает');
    assert(error?.quarantinedAssetId === UB_ID, 'ошибка помечает quarantinedAssetId');
    assert(supabase._tables.tg_accounts[0].owner_id === OWNER, 'владелец не сменился');
    assert(supabase._tables.shop_items[0].status === 'published', 'лот не помечен sold');
}

{
    const supabase = makeMockSupabase(baseTables());
    const purchase = { buyer_owner_id: BUYER, seller_owner_id: OWNER };
    const error = await capture(transferShopAssets(supabase, purchase, SELLER_ITEM, ASSETS));
    assert(!error, 'online-аккаунт: трансфер проходит');
    assert(supabase._tables.tg_accounts[0].owner_id === BUYER, 'владелец сменился на покупателя');
    assert(supabase._tables.shop_items[0].status === 'sold', 'лот помечен sold');
}

{
    const supabase = makeMockSupabase(baseTables({
        tg_accounts: baseTables().tg_accounts.map((row) => ({ ...row, runtime_status: 'pending_activation' }))
    }));
    const purchase = { buyer_owner_id: BUYER, seller_owner_id: OWNER };
    const error = await capture(transferShopAssets(supabase, purchase, SELLER_ITEM, ASSETS));
    assert(error, 'pending_activation: трансфер не проходит (safe-mode не продаётся)');
    assert(supabase._tables.tg_accounts[0].owner_id === OWNER, 'владелец не сменился');
}

console.log('— hasActiveShopPurchases —');

{
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [{ id: PURCHASE_ID, shop_item_id: ITEM_ID, status: 'paid', ownership_transfer_status: 'pending' }]
    }));
    assert(await hasActiveShopPurchases(supabase, OWNER, UB_ID) === true, 'paid без завершённого трансфера = живая покупка');
}

{
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [{ id: PURCHASE_ID, shop_item_id: ITEM_ID, status: 'paid', ownership_transfer_status: 'completed' }]
    }));
    assert(await hasActiveShopPurchases(supabase, OWNER, UB_ID) === false, 'завершённая покупка не живая');
}

{
    const supabase = makeMockSupabase(baseTables(), {
        tableErrors: { shop_item_assets: { message: 'relation "shop_item_assets" does not exist' } }
    });
    assert(await hasActiveShopPurchases(supabase, OWNER, UB_ID) === false, 'нет таблиц магазина = покупок нет');
}

console.log('— purgeRestrictedUserbotAccount —');

{
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [{ id: PURCHASE_ID, shop_item_id: ITEM_ID, status: 'pending', ownership_transfer_status: 'pending' }]
    }));
    const account = supabase._tables.tg_accounts[0];
    const result = await purgeRestrictedUserbotAccount(supabase, OWNER, account);
    assert(result.deleted === false && result.reason === 'active_purchase', 'пурж отложен при живой покупке');
    assert(supabase._tables.tg_accounts.length === 1, 'аккаунт не удалён');
    assert(supabase._tables.proxies.length === 1, 'прокси не тронут');
}

{
    const supabase = makeMockSupabase(baseTables());
    const account = supabase._tables.tg_accounts[0];
    const result = await purgeRestrictedUserbotAccount(supabase, OWNER, account);
    assert(result.deleted === true, 'пурж проходит без покупок');
    assert(supabase._tables.tg_accounts.length === 0, 'аккаунт удалён');
    assert(supabase._tables.proxies.length === 0, 'личный прокси удалён');
    assert(supabase._tables.shop_items[0].status === 'draft', 'лот снят с витрины');
}

console.log('— runListedHealthCheck (инъекционный checkFn) —');

const userbotServiceStub = {};

{
    const supabase = makeMockSupabase(baseTables());
    await runListedHealthCheck(supabase, userbotServiceStub, {
        checkFn: async () => ({ status: 'expired', reason: 'Сессия умерла.' })
    });
    assert(supabase._tables.shop_items[0].status === 'draft', 'expired: лот снят');
    assert(supabase._tables.tg_accounts[0].runtime_status === 'expired', 'expired: статус записан');
    assert(supabase._tables.telegram_error_events.length === 0, 'expired: без restriction-события');
    assert(supabase._tables.proxies.length === 1, 'expired: прокси не тронут');
}

{
    const supabase = makeMockSupabase(baseTables());
    await runListedHealthCheck(supabase, userbotServiceStub, {
        checkFn: async () => ({ status: 'restricted', reason: 'SpamBot подтвердил блокировку.' })
    });
    assert(supabase._tables.shop_items[0].status === 'draft', 'restricted: лот снят');
    assert(supabase._tables.tg_accounts[0].runtime_status === 'restricted', 'restricted: статус записан');
    const events = supabase._tables.telegram_error_events;
    assert(events.length === 1 && events[0].is_restriction === true, 'restricted: is_restriction-событие записано');
    assert(events[0].restriction_kind === 'account_restricted', 'restricted: restriction_kind account_restricted');
    assert(supabase._tables.proxies.length === 0, 'restricted: личный прокси почищен');
    assert(supabase._tables.tg_accounts[0].proxy_id === null, 'restricted: прокси отвязан от аккаунта');
}

{
    const supabase = makeMockSupabase(baseTables());
    await runListedHealthCheck(supabase, userbotServiceStub, {
        checkFn: async () => ({ status: 'online', reason: 'Аккаунт живой, сессия отвечает.' })
    });
    assert(supabase._tables.shop_items[0].status === 'published', 'online: лот остаётся опубликованным');
    assert(supabase._tables.telegram_error_events.length === 0, 'online: без событий');
}

{
    const freshIso = new Date().toISOString();
    const supabase = makeMockSupabase(baseTables({
        tg_accounts: baseTables().tg_accounts.map((row) => ({ ...row, last_checked_at: freshIso }))
    }));
    let checkCalls = 0;
    await runListedHealthCheck(supabase, userbotServiceStub, {
        checkFn: async () => { checkCalls += 1; return { status: 'error', reason: 'x' }; }
    });
    assert(checkCalls === 0, 'свежая проверка (< 1ч) не повторяется');
}

console.log(failures === 0 ? '\nВсе проверки отстойника прошли' : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
