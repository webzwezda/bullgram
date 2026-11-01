/**
 * Юнит-тесты скана «Найти аккаунты для продажи» (account sale scan).
 * Офлайн, детерминированные: мок supabase в стиле test-account-intake.js
 * (select-projection, eq/neq/in/not/order-нооп, insert/update/delete), Telegram
 * не трогаем — проверка инъекцией checkFn, вердикт применяется РЕАЛЬНЫМ кодом
 * applyStockVerdict (intake-stock.service.js, тем же, что у джобы отлёжки) с
 * моком ManagedProxyService.
 *
 * Покрывает: loadScanCandidates (все статусы: online/safe-mode/restricted/
 * frozen + orphan без аккаунта + чужие владельцы и аккаунты без source
 * исключаются), runSaleScan (прогресс после каждого айтема; no_proxy без
 * check-вызова; restricted применяет карантинные эффекты с event_source
 * 'sale_scan' и чистит прокси; sellable-флаги; completed; всё упало → failed),
 * isScanStale / findActiveScan / sweepStaleScans, isMissingScanTableError.
 */
import {
    SALE_SCAN_MISSING_MIGRATION_MESSAGE,
    findActiveScan,
    isMissingScanTableError,
    isScanStale,
    loadScanCandidates,
    runSaleScan,
    scanItemLabel,
    sweepStaleScans
} from '../services/sale-scan.service.js';

let failures = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        failures++;
    }
}

let idSeq = 0;
function mockId() {
    idSeq += 1;
    return `00000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`;
}

// --- Мок supabase: thenable-билдер с eq/neq/in/lt + insert().select().single()
// (копия стиля test-account-intake.js — там мок не экспортируется) ---
function makeMockSupabase(tablesInit = {}, { tableErrors = {} } = {}) {
    const tables = {};
    for (const [name, rows] of Object.entries(tablesInit)) tables[name] = rows.map((r) => ({ ...r }));

    const db = {
        from(table) {
            const rows = tables[table] ?? (tables[table] = []);
            const filters = [];
            let cols = '*';
            const predFor = (filterList) => (row) => filterList.every(([col, op, val]) => {
                const cell = row[col];
                if (op === 'eq') return String(cell) === String(val);
                if (op === 'ne') return String(cell) !== String(val);
                if (op === 'in') return (val || []).some((v) => String(cell) === String(v));
                if (op === 'lt') return String(cell) < String(val);
                if (op === 'not_is') return cell !== null && cell !== undefined;
                return true;
            });
            const matches = () => rows.filter(predFor(filters));
            const project = (row) => {
                const colList = String(cols).split(',').map((s) => s.trim()).filter(Boolean);
                if (cols.includes('*') || !colList.length) return { ...row };
                return Object.fromEntries(colList.filter((c) => c in row).map((c) => [c, row[c]]));
            };
            const builder = {
                select(c = '*', _opts = {}) { cols = String(c || '*'); return builder; },
                eq(col, val) { filters.push([col, 'eq', val]); return builder; },
                ne(col, val) { filters.push([col, 'ne', val]); return builder; },
                neq(col, val) { filters.push([col, 'ne', val]); return builder; },
                in(col, vals) { filters.push([col, 'in', vals]); return builder; },
                lt(col, val) { filters.push([col, 'lt', val]); return builder; },
                not(col, op, val) {
                    if (op === 'is' && val === null) filters.push([col, 'not_is', null]);
                    return builder;
                },
                order() { return builder; },
                limit() { return builder; },
                insert(payload) {
                    const list = Array.isArray(payload) ? payload : [payload];
                    const injectedError = tableErrors[table]?.insert || null;
                    if (injectedError) {
                        const failed = {
                            select() { return failed; },
                            single: async () => ({ data: null, error: { ...injectedError } }),
                            then(resolve) { resolve({ data: null, error: { ...injectedError } }); }
                        };
                        return failed;
                    }
                    const inserted = list.map((p) => ({ id: p.id || mockId(), ...p }));
                    rows.push(...inserted);
                    const after = {
                        select(c = '*') { cols = String(c || '*'); return after; },
                        single: async () => ({ data: inserted[0] ? { ...inserted[0] } : null, error: null }),
                        then(resolve) { resolve({ data: inserted.map((r) => project(r)), error: null }); }
                    };
                    return after;
                },
                update(patch) {
                    const ub = {
                        eq(col, val) { filters.push([col, 'eq', val]); return ub; },
                        ne(col, val) { filters.push([col, 'ne', val]); return ub; },
                        neq(col, val) { filters.push([col, 'ne', val]); return ub; },
                        in(col, vals) { filters.push([col, 'in', vals]); return ub; },
                        lt(col, val) { filters.push([col, 'lt', val]); return ub; },
                        select() { return ub; },
                        then(resolve) {
                            let count = 0;
                            for (const row of rows) {
                                if (predFor(filters)(row)) { Object.assign(row, patch); count++; }
                            }
                            resolve({ data: null, error: null, count });
                        }
                    };
                    return ub;
                },
                delete() {
                    const db2 = {
                        eq(col, val) { filters.push([col, 'eq', val]); return db2; },
                        then(resolve) {
                            const keep = rows.filter((row) => !predFor(filters)(row));
                            const removed = rows.length - keep.length;
                            rows.length = 0;
                            rows.push(...keep);
                            resolve({ data: null, error: null, count: removed });
                        }
                    };
                    return db2;
                },
                maybeSingle: async () => {
                    const found = matches()[0];
                    return { data: found ? { ...found } : null, error: null };
                },
                single: async () => {
                    const found = matches()[0];
                    return { data: found ? { ...found } : null, error: null };
                },
                then(resolve) {
                    resolve({
                        data: matches().map(project),
                        error: null,
                        count: matches().length
                    });
                }
            };
            return builder;
        }
    };
    db._tables = tables;
    return db;
}

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const noSleep = async () => {};

function makeMockManagedProxy() {
    const calls = [];
    return {
        calls,
        async releaseManagedProxy(args) { calls.push(args); return true; },
        async releaseManagedProxyBatch({ records }) { return (records || []).length; }
    };
}

function makeAccountFixture(id, overrides = {}) {
    return {
        id,
        owner_id: OWNER,
        account_type: 'userbot',
        tg_account_id: null,
        tg_username: null,
        custom_label: null,
        runtime_status: 'pending_activation',
        session_data: 'enc',
        proxy_id: null,
        last_checked_at: null,
        health_summary: null,
        ...overrides
    };
}

console.log('— loadScanCandidates: все статусы, orphan, чужие владельцы —');

{
    const supabase = makeMockSupabase({
        userbot_restore_sources: [
            { account_id: 'acc-online', owner_id: OWNER, intake_batch_id: 'b1' },
            { account_id: 'acc-safe', owner_id: OWNER, intake_batch_id: 'b1' },
            { account_id: 'acc-restricted', owner_id: OWNER, intake_batch_id: 'b1' },
            { account_id: 'acc-frozen', owner_id: OWNER, intake_batch_id: null },
            { account_id: 'acc-orphan', owner_id: OWNER, intake_batch_id: 'b1' },
            { account_id: 'acc-other', owner_id: OTHER, intake_batch_id: 'b1' }
        ],
        tg_accounts: [
            makeAccountFixture('acc-online', { runtime_status: 'online' }),
            makeAccountFixture('acc-safe', { runtime_status: 'pending_activation' }),
            makeAccountFixture('acc-restricted', { runtime_status: 'restricted' }),
            makeAccountFixture('acc-frozen', { runtime_status: 'frozen' }),
            makeAccountFixture('acc-nosource', { runtime_status: 'online' }),
            makeAccountFixture('acc-other', { owner_id: OTHER, runtime_status: 'online' })
        ]
    });

    const { accounts, orphanCount } = await loadScanCandidates(supabase, OWNER);
    const ids = accounts.map((row) => row.id).sort();
    assert(ids.length === 4, 'кандидаты: 4 аккаунта владельца с restore source');
    assert(ids.join(',') === 'acc-frozen,acc-online,acc-restricted,acc-safe', 'все статусы в кандидатах (online/safe/restricted/frozen)');
    assert(orphanCount === 1, 'orphan: restore source без tg_accounts учтён один раз');
    assert(!ids.includes('acc-other'), 'чужой владелец не в кандидатах');
    assert(!ids.includes('acc-nosource'), 'аккаунт без restore source не в кандидатах');

    const { accounts: otherAccounts, orphanCount: otherOrphans } = await loadScanCandidates(supabase, OTHER);
    assert(otherAccounts.length === 1 && otherAccounts[0].id === 'acc-other', 'скан другого владельца видит только своё');
    assert(otherOrphans === 0, 'чужой orphan не попадает в чужой скан');
}

console.log('— scanItemLabel —');

{
    assert(scanItemLabel({ custom_label: '+79…001', tg_username: 'u', tg_account_id: '1', id: 'x' }) === '+79…001', 'label: custom_label первым');
    assert(scanItemLabel({ custom_label: null, tg_username: 'acc_user', tg_account_id: '555', id: 'x' }) === 'acc_user', 'label: юзернейм вторым');
    assert(scanItemLabel({ custom_label: null, tg_username: null, tg_account_id: '555', id: 'x' }) === '555', 'label: tg_account_id третьим');
    assert(scanItemLabel({ id: 'acc-plain' }) === 'acc-plain', 'label: id как последний резерв');
}

console.log('— runSaleScan: прогресс, no_proxy без коннекта, sellable-флаги, completed —');

{
    const supabase = makeMockSupabase({
        userbot_restore_sources: [
            { account_id: 'acc-online', owner_id: OWNER, intake_batch_id: 'b1' },
            { account_id: 'acc-noproxy', owner_id: OWNER, intake_batch_id: 'b1' },
            { account_id: 'acc-safe', owner_id: OWNER, intake_batch_id: 'b1' }
        ],
        tg_accounts: [
            makeAccountFixture('acc-online', { runtime_status: 'online', custom_label: '+79…001', proxy_id: 'px-1' }),
            makeAccountFixture('acc-noproxy', { tg_username: 'noproxy_user' }),
            makeAccountFixture('acc-safe', { proxy_id: 'px-2' })
        ],
        proxies: [
            { id: 'px-1', owner_id: OWNER, host: '10.0.0.1', port: 40001, username: 'mp_1', password: 'p', is_working: true, last_check_ip: '10.0.0.1', provision_source: 'manual_admin', inventory_group: 'self_use' },
            { id: 'px-2', owner_id: OWNER, host: '10.0.0.2', port: 40002, username: 'mp_2', password: 'p', is_working: true, last_check_ip: '10.0.0.2', provision_source: 'manual_admin', inventory_group: 'self_use' }
        ],
        telegram_error_events: [],
        shop_items: [],
        shop_item_assets: [],
        account_sale_scans: []
    });
    const mockProxy = makeMockManagedProxy();

    const { data: scanRow } = await supabase
        .from('account_sale_scans')
        .insert({ owner_id: OWNER, status: 'processing', total: 3, processed: 0, failed: 0, orphans: 1, items: [] })
        .select('id')
        .single();

    let meSeq = 555000111;
    const checkCalls = [];
    const progressSnapshots = [];
    const checkFn = async (_supabase, _service, account) => {
        const row = supabase._tables.account_sale_scans.find((r) => r.id === scanRow.id);
        progressSnapshots.push({ processed: row.processed, okItems: row.items.filter((i) => i.status === 'ok').length });
        checkCalls.push(account.id);
        meSeq += 1;
        return {
            status: 'online',
            reason: null,
            details: { session: 'alive', restriction: 'clear', spambot: { state: 'clear' } },
            me: { id: meSeq, username: `acc_${account.id}`, firstName: 'A', lastName: '', phone: '+79990000001' }
        };
    };
    const sleepDurations = [];
    const sleepFn = async (ms) => { sleepDurations.push(ms); };

    const result = await runSaleScan(supabase, {}, {
        ownerId: OWNER,
        scanId: scanRow.id,
        managedProxyService: mockProxy,
        deps: { checkFn, sleepFn }
    });

    const scan = supabase._tables.account_sale_scans.find((r) => r.id === scanRow.id);
    assert(result.status === 'completed' && scan.status === 'completed', 'финальный статус completed');
    assert(scan.processed === 3 && scan.failed === 0, 'прогресс 3/0');
    assert(scan.orphans === 1, 'orphans из POST не затёрт раннером');
    assert(checkCalls.join(',') === 'acc-online,acc-safe', 'чек вызван только для аккаунтов с прокси (2 раза)');
    assert(progressSnapshots[0].processed === 0 && progressSnapshots[0].okItems === 0, 'первый чек: прогресс ещё 0');
    assert(progressSnapshots[1].processed === 2 && progressSnapshots[1].okItems === 2, 'второй чек: прогресс после КАЖДОГО айтема (2 ok)');
    assert(sleepDurations.length === 2, 'пауза между айтемами (2 паузы на 3 айтема)');
    assert(mockProxy.calls.length === 0, 'без restricted чистки прокси нет');

    const [onlineItem, noProxyItem, safeItem] = scan.items;
    assert(onlineItem.status === 'ok' && onlineItem.verdict === 'online', 'айтем online: вердикт online');
    assert(onlineItem.sellable === true && onlineItem.in_quarantine === false, 'айтем online: sellable, не карантин');
    assert(onlineItem.label === '+79…001', 'айтем online: label из custom_label');
    assert(noProxyItem.verdict === 'no_proxy' && noProxyItem.status === 'ok', 'без прокси: вердикт no_proxy без коннекта');
    assert(String(noProxyItem.reason).includes('не привязан прокси'), 'без прокси: причина про прокси');
    assert(noProxyItem.sellable === false && noProxyItem.in_quarantine === false, 'без прокси: не sellable, не карантин');
    assert(noProxyItem.label === 'noproxy_user', 'без прокси: label из юзернейма');
    assert(safeItem.verdict === 'pending_activation', 'safe-mode с чистой проверкой остаётся pending_activation');
    assert(safeItem.sellable === true && safeItem.in_quarantine === false, 'safe-mode с чистой проверкой: sellable');

    const onlineRow = supabase._tables.tg_accounts.find((r) => r.id === 'acc-online');
    const safeRow = supabase._tables.tg_accounts.find((r) => r.id === 'acc-safe');
    const noProxyRow = supabase._tables.tg_accounts.find((r) => r.id === 'acc-noproxy');
    assert(onlineRow.runtime_status === 'online' && onlineRow.health_summary?.status === 'online', 'статусы записаны: online + health');
    assert(safeRow.runtime_status === 'pending_activation' && safeRow.health_summary?.status === 'online', 'safe-mode сохранён, health записан');
    assert(noProxyRow.health_summary === null && noProxyRow.last_checked_at === null, 'без прокси аккаунт не тронут');
    assert(supabase._tables.telegram_error_events.length === 0, 'здоровый сток без событий');
}

console.log('— runSaleScan: выздоровевший error-сток поднимается в online (регрессия run-2 2026-11-01) —');

{
    // Живая проверка доказала жизнь — статус становится правдивым, а не
    // консервирует error от флакнувшего предыдущего чека.
    const supabase = makeMockSupabase({
        userbot_restore_sources: [
            { account_id: 'acc-recovered', owner_id: OWNER, intake_batch_id: 'b1' }
        ],
        tg_accounts: [
            makeAccountFixture('acc-recovered', { runtime_status: 'error', custom_label: '+79…002', proxy_id: 'px-9', runtime_error: 'Telegram не отдал профиль аккаунта за отведенное время.' })
        ],
        proxies: [
            { id: 'px-9', owner_id: OWNER, host: '10.0.0.9', port: 40009, username: 'mp_9', password: 'p', is_working: true, last_check_ip: '10.0.0.9', provision_source: 'manual_admin', inventory_group: 'self_use' }
        ],
        telegram_error_events: [],
        shop_items: [],
        shop_item_assets: [],
        account_sale_scans: []
    });
    const mockProxy = makeMockManagedProxy();

    const { data: scanRow } = await supabase
        .from('account_sale_scans')
        .insert({ owner_id: OWNER, status: 'processing', total: 1, processed: 0, failed: 0, items: [] })
        .select('id')
        .single();

    const result = await runSaleScan(supabase, {}, {
        ownerId: OWNER,
        scanId: scanRow.id,
        managedProxyService: mockProxy,
        deps: {
            checkFn: async () => ({
                status: 'online',
                reason: 'Аккаунт живой, сессия отвечает.',
                details: { session: 'alive', restriction: 'clear', spambot: { state: 'clear' } },
                me: { id: 555000999, username: 'recovered_acc', firstName: 'R', lastName: '', phone: '+79990000009' }
            }),
            sleepFn: async () => {}
        }
    });

    const scan = supabase._tables.account_sale_scans.find((r) => r.id === scanRow.id);
    assert(scan.status === 'completed' && scan.processed === 1, 'скан завершён, 1/1');
    const item = scan.items[0];
    assert(item.verdict === 'online' && item.sellable === true, 'выздоровевший: вердикт online, sellable');
    assert(item.in_quarantine === false, 'выздоровевший: не карантин');
    assert(String(item.reason || '').includes('живой'), 'reason из живого результата');
    const accountRow = supabase._tables.tg_accounts.find((r) => r.id === 'acc-recovered');
    assert(accountRow.runtime_status === 'online', 'error-статус поднят в online живой проверкой');
    assert(accountRow.runtime_error === null, 'runtime_error очищен');
    assert(supabase._tables.proxies.length === 1, 'прокси не тронут');
}

console.log('— runSaleScan: restricted применяет карантин с event_source sale_scan —');

{
    const supabase = makeMockSupabase({
        userbot_restore_sources: [{ account_id: 'acc-restricted', owner_id: OWNER, intake_batch_id: 'b1' }],
        tg_accounts: [makeAccountFixture('acc-restricted', { proxy_id: 'px-r' })],
        proxies: [
            { id: 'px-r', owner_id: OWNER, host: '10.0.0.9', port: 40009, username: 'mp_r', password: 'p', is_working: true, last_check_ip: '10.0.0.9', provision_source: 'manual_admin', inventory_group: 'self_use' }
        ],
        telegram_error_events: [],
        shop_items: [],
        shop_item_assets: [],
        account_sale_scans: []
    });
    const mockProxy = makeMockManagedProxy();

    const { data: scanRow } = await supabase
        .from('account_sale_scans')
        .insert({ owner_id: OWNER, status: 'processing', total: 1, processed: 0, failed: 0, orphans: 0, items: [] })
        .select('id')
        .single();

    await runSaleScan(supabase, {}, {
        ownerId: OWNER,
        scanId: scanRow.id,
        managedProxyService: mockProxy,
        deps: {
            checkFn: async () => ({
                status: 'restricted',
                reason: 'SpamBot подтвердил блокировку.',
                details: { session: 'alive', restriction: 'restricted', spambot: { state: 'restricted' } },
                me: { id: 777000111, username: 'badacc', firstName: 'B', lastName: '', phone: '+79990000009' }
            }),
            sleepFn: noSleep
        }
    });

    const scan = supabase._tables.account_sale_scans.find((r) => r.id === scanRow.id);
    const account = supabase._tables.tg_accounts[0];
    const events = supabase._tables.telegram_error_events;

    assert(account.runtime_status === 'restricted', 'статус restricted записан');
    assert(account.proxy_id === null, 'прокси отвязан');
    assert(supabase._tables.proxies.length === 0, 'прокси удалён как в отстойнике');
    assert(mockProxy.calls.length === 1 && mockProxy.calls[0].port === 40009, 'release уходит в ManagedProxyService');
    assert(events.length === 1 && events[0].event_source === 'sale_scan', 'событие с event_source sale_scan');
    assert(events[0].is_restriction === true && events[0].restriction_kind === 'account_restricted', 'restriction-событие честное');
    assert(scan.status === 'completed' && scan.processed === 1 && scan.failed === 0, 'скан завершён (проблемный айтем — не failure скана)');
    const item = scan.items[0];
    assert(item.verdict === 'restricted' && item.in_quarantine === true && item.sellable === false, 'айтем restricted: карантин, не sellable');
    assert(item.reason === 'SpamBot подтвердил блокировку.', 'айтем: причина из проверки');
    assert(item.checked_at, 'айтем: checked_at записан');
}

console.log('— runSaleScan: всё упало → статус failed —');

{
    const supabase = makeMockSupabase({
        userbot_restore_sources: [{ account_id: 'acc-boom', owner_id: OWNER, intake_batch_id: 'b1' }],
        tg_accounts: [makeAccountFixture('acc-boom', { proxy_id: 'px-b' })],
        proxies: [
            { id: 'px-b', owner_id: OWNER, host: '10.0.0.3', port: 40003, username: 'mp_3', password: 'p', is_working: true, last_check_ip: '10.0.0.3', provision_source: 'manual_admin', inventory_group: 'self_use' }
        ],
        telegram_error_events: [],
        shop_items: [],
        shop_item_assets: [],
        account_sale_scans: []
    });

    const { data: scanRow } = await supabase
        .from('account_sale_scans')
        .insert({ owner_id: OWNER, status: 'processing', total: 1, processed: 0, failed: 0, orphans: 0, items: [] })
        .select('id')
        .single();

    const result = await runSaleScan(supabase, {}, {
        ownerId: OWNER,
        scanId: scanRow.id,
        deps: {
            checkFn: async () => { throw new Error('взрыв соединения'); },
            sleepFn: noSleep
        }
    });

    const scan = supabase._tables.account_sale_scans.find((r) => r.id === scanRow.id);
    assert(result.status === 'failed' && scan.status === 'failed', 'все айтемы упали → скан failed');
    assert(scan.processed === 0 && scan.failed === 1, 'прогресс 0/1');
    const item = scan.items[0];
    assert(item.status === 'failed' && item.reason === 'взрыв соединения', 'айтем failed с текстом ошибки');
    assert(item.sellable === false, 'упавший айтем не sellable');
    assert(item.in_quarantine === false, 'ошибка проверки — не карантин: аккаунт в базе не тронут');
    assert(supabase._tables.tg_accounts[0].runtime_status === 'pending_activation', 'упавший чек не трогает статус аккаунта');
    assert(supabase._tables.proxies.length === 1, 'упавший чек не трогает прокси');
}

console.log('— isScanStale / findActiveScan / sweepStaleScans —');

{
    const nowMs = Date.now();
    const twoHoursAgo = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date(nowMs).toISOString();

    assert(isScanStale({ status: 'processing', updated_at: twoHoursAgo }, nowMs), 'processing старше часа — stale');
    assert(!isScanStale({ status: 'processing', updated_at: nowIso }, nowMs), 'свежий processing — не stale');
    assert(!isScanStale({ status: 'completed', updated_at: twoHoursAgo }, nowMs), 'завершённый скан не stale');
    assert(isScanStale({ status: 'processing', updated_at: null }, nowMs), 'processing без updated_at — stale');
    assert(!isScanStale(null, nowMs), 'нет строки — не stale (guard)');

    const rows = [
        { id: 'done', status: 'completed', updated_at: nowIso },
        { id: 'active', status: 'processing', updated_at: nowIso },
        { id: 'stale', status: 'processing', updated_at: twoHoursAgo }
    ];
    assert(findActiveScan(rows)?.id === 'active', 'findActiveScan находит processing');
    assert(findActiveScan([{ id: 'done', status: 'completed' }]) === null, 'findActiveScan без активных → null');
    // stale-скан НЕ считается активным: свип переводит его в failed ДО проверки,
    // и POST не вечно блокируется после перезапуска сервера.
    const afterSweep = rows.map((row) => isScanStale(row, nowMs) ? { ...row, status: 'failed' } : row);
    assert(findActiveScan(afterSweep.filter((row) => row.id !== 'active')) === null, 'stale после свипа не блокирует новый скан');

    const supabase = makeMockSupabase({
        account_sale_scans: [
            { id: 'scan-stale', owner_id: OWNER, status: 'processing', updated_at: new Date(nowMs - 61 * 60 * 1000).toISOString(), error: null },
            { id: 'scan-fresh', owner_id: OWNER, status: 'processing', updated_at: nowIso, error: null },
            { id: 'scan-done', owner_id: OWNER, status: 'completed', updated_at: twoHoursAgo, error: null }
        ]
    });
    const sweepRows = supabase._tables.account_sale_scans.map((row) => ({ ...row }));
    await sweepStaleScans(supabase, OWNER, sweepRows);

    const staleRow = supabase._tables.account_sale_scans.find((r) => r.id === 'scan-stale');
    const freshRow = supabase._tables.account_sale_scans.find((r) => r.id === 'scan-fresh');
    const doneRow = supabase._tables.account_sale_scans.find((r) => r.id === 'scan-done');
    assert(staleRow.status === 'failed' && staleRow.error === 'Прерван перезапуском сервера.', 'свип: stale processing → failed с причиной');
    assert(freshRow.status === 'processing', 'свип: свежий processing не тронут');
    assert(doneRow.status === 'completed', 'свип: завершённый не тронут');
    assert(sweepRows.find((r) => r.id === 'scan-stale').status === 'failed', 'свип мутирует переданные rows');
}

console.log('— isMissingScanTableError —');

{
    assert(isMissingScanTableError({ message: 'relation "public.account_sale_scans" does not exist' }), 'текст с account_sale_scans распознан');
    assert(isMissingScanTableError({ code: '42P01', message: 'relation does not exist' }), 'код 42P01 распознан');
    assert(!isMissingScanTableError({ message: 'relation "public.shop_items" does not exist' }), 'чужая таблица не распознана');
    assert(SALE_SCAN_MISSING_MIGRATION_MESSAGE.includes('account sale scan'), 'сообщение про SQL упомянет миграцию');
}

console.log(failures === 0 ? '\nВсе проверки скана продажи прошли' : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
