/**
 * Юнит-тесты скана «Найти аккаунты для продажи» (account sale scan).
 * Офлайн, детерминированные: мок supabase в стиле test-account-intake.js
 * (select-projection, eq/neq/in/not/order-нооп, insert/update/delete), Telegram
 * не трогаем — проверка инъекцией checkFn, вердикт применяется РЕАЛЬНЫМ кодом
 * applyStockVerdict (intake-stock.service.js, тем же, что у джобы отлёжки) с
 * моком ManagedProxyService.
 *
 * Покрывает: loadScanCandidates (все статусы: online/safe-mode/restricted/
 * frozen + рабочие QR-импорты БЕЗ restore source (has_tdata=false, не orphan)
 * + orphan без аккаунта + чужие владельцы исключаются), runSaleScan (прогресс
 * после каждого айтема; no_proxy без check-вызова; restricted применяет
 * карантинные эффекты с event_source 'sale_scan' и чистит прокси; sellable-
 * флаги по полному правилу владельца: tdata + отлёжка; completed; всё упало →
 * failed), правило продажи accountSaleRuleState (tdata/отлёжка/свежесть/
 * граница 48ч), attachListedItemIds (public-лот → listed_item_id, draft →
 * null), isScanStale / findActiveScan / sweepStaleScans, isMissingScanTableError.
 */
import {
    SALE_SCAN_MISSING_MIGRATION_MESSAGE,
    attachListedItemIds,
    findActiveScan,
    isMissingScanTableError,
    isScanStale,
    loadScanCandidates,
    runSaleScan,
    scanItemLabel,
    sweepStaleScans
} from '../services/sale-scan.service.js';
import {
    ACCOUNT_CHECK_STALE_MESSAGE,
    ACCOUNT_NO_TDATA_MESSAGE,
    ACCOUNT_NOT_READY_MESSAGE,
    accountSaleRuleState,
    getAccountMinRestHours
} from '../utils/account-sale-rules.js';

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
const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

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
        // Отлёжка по умолчанию давно пройдена — тесты правила переопределяют.
        created_at: THIRTY_DAYS_AGO,
        tg_phone: null,
        ...overrides
    };
}

console.log('— loadScanCandidates: все статусы, QR-импорты без source, orphan, чужие владельцы —');

{
    const supabase = makeMockSupabase({
        userbot_restore_sources: [
            { account_id: 'acc-online', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' },
            { account_id: 'acc-safe', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' },
            { account_id: 'acc-restricted', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: null },
            { account_id: 'acc-frozen', owner_id: OWNER, intake_batch_id: null, tdata_blob_encrypted: 'enc-tdata' },
            { account_id: 'acc-orphan', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' },
            { account_id: 'acc-other', owner_id: OTHER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' }
        ],
        tg_accounts: [
            makeAccountFixture('acc-online', { runtime_status: 'online' }),
            makeAccountFixture('acc-safe', { runtime_status: 'pending_activation' }),
            makeAccountFixture('acc-restricted', { runtime_status: 'restricted' }),
            makeAccountFixture('acc-frozen', { runtime_status: 'frozen' }),
            // Рабочий QR-импорт без restore source: кандидат с has_tdata=false.
            makeAccountFixture('acc-nosource', { runtime_status: 'online' }),
            makeAccountFixture('acc-other', { owner_id: OTHER, runtime_status: 'online' })
        ]
    });

    const { accounts, orphanCount } = await loadScanCandidates(supabase, OWNER);
    const ids = accounts.map((row) => row.id).sort();
    assert(ids.length === 5, 'кандидаты: 5 аккаунтов владельца (с restore source и без)');
    assert(ids.join(',') === 'acc-frozen,acc-nosource,acc-online,acc-restricted,acc-safe', 'все статусы в кандидатах (online/safe/restricted/frozen + QR-импорт)');
    assert(orphanCount === 1, 'orphan: restore source без tg_accounts учтён один раз');
    assert(!ids.includes('acc-other'), 'чужой владелец не в кандидатах');

    const hasTdataById = Object.fromEntries(accounts.map((row) => [row.id, row.has_tdata]));
    assert(hasTdataById['acc-online'] === true && hasTdataById['acc-safe'] === true, 'has_tdata=true у источников с tdata-блобом');
    assert(hasTdataById['acc-restricted'] === false, 'has_tdata=false у источника с пустым tdata-блобом');
    assert(hasTdataById['acc-nosource'] === false, 'QR-импорт без restore source: has_tdata=false для правила');
    assert(ids.includes('acc-nosource') && orphanCount === 1, 'QR-импорт без source — кандидат, а НЕ orphan');

    const { accounts: otherAccounts, orphanCount: otherOrphans } = await loadScanCandidates(supabase, OTHER);
    assert(otherAccounts.length === 1 && otherAccounts[0].id === 'acc-other', 'скан другого владельца видит только своё');
    assert(otherOrphans === 0, 'чужой orphan не попадает в чужой скан');
}

console.log('— accountSaleRuleState: tdata + отлёжка + свежесть —');

{
    const nowMs = Date.now();

    const noTdata = accountSaleRuleState({
        runtime_status: 'online',
        last_checked_at: new Date(nowMs).toISOString(),
        health_summary: { status: 'online' },
        created_at: THIRTY_DAYS_AGO,
        has_tdata: false
    }, { now: nowMs });
    assert(noTdata.sellable === false, 'правило: без tdata не sellable');
    assert(noTdata.reasons.includes(ACCOUNT_NO_TDATA_MESSAGE), `правило: причина «${ACCOUNT_NO_TDATA_MESSAGE}»`);

    const freshImport = accountSaleRuleState({
        runtime_status: 'pending_activation',
        last_checked_at: new Date(nowMs).toISOString(),
        health_summary: { status: 'online' },
        created_at: new Date(nowMs - 5 * 60 * 60 * 1000).toISOString(),
        has_tdata: true
    }, { now: nowMs });
    assert(freshImport.sellable === false, 'правило: отлёжка 5ч < 48ч не sellable');
    assert(
        freshImport.reasons.some((reason) => reason === 'Отлёжка 5ч из 48ч — дай аккаунту отлежаться'),
        'правило: причина «Отлёжка 5ч из 48ч — дай аккаунту отлежаться»'
    );

    const rested = accountSaleRuleState({
        runtime_status: 'online',
        last_checked_at: new Date(nowMs).toISOString(),
        health_summary: null,
        created_at: new Date(nowMs - 50 * 60 * 60 * 1000).toISOString(),
        has_tdata: true
    }, { now: nowMs });
    assert(rested.sellable === true && rested.reasons.length === 0, 'правило: отлёжка 50ч + tdata → sellable');

    const onBoundary = accountSaleRuleState({
        runtime_status: 'online',
        last_checked_at: new Date(nowMs).toISOString(),
        health_summary: null,
        created_at: new Date(nowMs - 48 * 60 * 60 * 1000).toISOString(),
        has_tdata: true
    }, { now: nowMs });
    assert(onBoundary.sellable === true, 'правило: ровно 48ч на границе → sellable');

    const staleCheck = accountSaleRuleState({
        runtime_status: 'online',
        last_checked_at: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
        health_summary: null,
        created_at: THIRTY_DAYS_AGO,
        has_tdata: true
    }, { now: nowMs });
    assert(staleCheck.sellable === false && staleCheck.reasons.includes(ACCOUNT_CHECK_STALE_MESSAGE), 'правило: устаревший чек → «Проверка устарела — запусти скан заново»');

    const frozen = accountSaleRuleState({
        runtime_status: 'frozen',
        last_checked_at: new Date(nowMs).toISOString(),
        health_summary: { status: 'online' },
        created_at: THIRTY_DAYS_AGO,
        has_tdata: true
    }, { now: nowMs });
    assert(frozen.sellable === false && frozen.reasons[0] === ACCOUNT_NOT_READY_MESSAGE, 'правило: плохой статус → текст «не готов к продаже» первым');

    assert(getAccountMinRestHours() === 48, 'getAccountMinRestHours: default 48');
    process.env.SHOP_ACCOUNT_MIN_REST_HOURS = '24';
    assert(getAccountMinRestHours() === 24, 'getAccountMinRestHours: env переопределяет');
    process.env.SHOP_ACCOUNT_MIN_REST_HOURS = '-5';
    assert(getAccountMinRestHours() === 48, 'getAccountMinRestHours: отрицательное игнорируется → default');
    delete process.env.SHOP_ACCOUNT_MIN_REST_HOURS;
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
            { account_id: 'acc-online', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' },
            { account_id: 'acc-noproxy', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' },
            { account_id: 'acc-safe', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' }
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
    assert(onlineItem.has_tdata === true && Number.isFinite(onlineItem.rest_hours), 'айтем online: has_tdata + rest_hours для карточки');
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
            { account_id: 'acc-recovered', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' }
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

console.log('— runSaleScan: живой вердикт, но правило продажи не пройдено (tdata/отлёжка) —');

{
    // Живая проверка чистая, но продавать нельзя: у одного нет tdata-блоба,
    // второй импортирован 5ч назад (отлёжка 5 из 48). Честные причины в
    // «Проблемных», карантин не трогается.
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase({
        userbot_restore_sources: [
            { account_id: 'acc-notdata', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: null },
            { account_id: 'acc-resting', owner_id: OWNER, intake_batch_id: 'b1', tdata_blob_encrypted: 'enc-tdata' }
        ],
        tg_accounts: [
            makeAccountFixture('acc-notdata', { custom_label: '+19…332', proxy_id: 'px-1' }),
            makeAccountFixture('acc-resting', { custom_label: '+20…443', proxy_id: 'px-2', created_at: fiveHoursAgo })
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
        .insert({ owner_id: OWNER, status: 'processing', total: 2, processed: 0, failed: 0, orphans: 0, items: [] })
        .select('id')
        .single();

    let ruleMeSeq = 555000100;
    await runSaleScan(supabase, {}, {
        ownerId: OWNER,
        scanId: scanRow.id,
        managedProxyService: mockProxy,
        deps: {
            // me.id уникальный по счётчику: одинаковый id у двух аккаунтов
            // ловит real-guard дублей в applyStockVerdict (вердикт — реальный код).
            checkFn: async () => {
                ruleMeSeq += 1;
                return {
                    status: 'online',
                    reason: 'Аккаунт живой, сессия отвечает.',
                    details: { session: 'alive', restriction: 'clear', spambot: { state: 'clear' } },
                    me: { id: ruleMeSeq, username: `rule_${ruleMeSeq}`, firstName: 'R', lastName: '', phone: '+79990000123' }
                };
            },
            sleepFn: noSleep
        }
    });

    const scan = supabase._tables.account_sale_scans.find((r) => r.id === scanRow.id);
    assert(scan.status === 'completed' && scan.processed === 2 && scan.failed === 0, 'скан завершён 2/0 — правило не ломает обход');
    const [noTdataItem, restingItem] = scan.items;
    assert(noTdataItem.verdict === 'pending_activation' && noTdataItem.status === 'ok', 'без tdata: вердикт живой (safe-mode сохраняется), айтем ok');
    assert(noTdataItem.sellable === false && noTdataItem.in_quarantine === false, 'без tdata: не sellable и не карантин');
    assert(noTdataItem.reason === ACCOUNT_NO_TDATA_MESSAGE, 'без tdata: причина — «Нет tdata-архива», не текст проверки');
    assert(noTdataItem.has_tdata === false, 'без tdata: has_tdata=false на айтеме');
    assert(restingItem.sellable === false && restingItem.reason === 'Отлёжка 5ч из 48ч — дай аккаунту отлежаться', 'свежий импорт: причина «Отлёжка 5ч из 48ч — дай аккаунту отлежаться»');
    assert(Number.isFinite(restingItem.rest_hours) && restingItem.rest_hours > 4 && restingItem.rest_hours < 6, 'свежий импорт: rest_hours ~5ч');
    const notDataRow = supabase._tables.tg_accounts.find((r) => r.id === 'acc-notdata');
    assert(notDataRow.runtime_status === 'pending_activation' && notDataRow.health_summary?.status === 'online', 'правило не переписывает статус аккаунта в базе (health записан)');
    assert(supabase._tables.proxies.length === 2 && mockProxy.calls.length === 0, 'правило не трогает прокси');
}

console.log('— attachListedItemIds: public-лот → listed_item_id, draft/продан → null —');

{
    const supabase = makeMockSupabase({
        shop_items: [
            { id: 'item-pub', owner_id: OWNER, status: 'published' },
            { id: 'item-draft', owner_id: OWNER, status: 'draft' }
        ],
        shop_item_assets: [
            { shop_item_id: 'item-pub', asset_type: 'userbot', asset_id: 'acc-live' },
            { shop_item_id: 'item-draft', asset_type: 'userbot', asset_id: 'acc-drafted' }
        ]
    });
    const scanRow = {
        id: 'scan-1',
        items: [
            { account_id: 'acc-live', sellable: true },
            { account_id: 'acc-drafted', sellable: false },
            { account_id: 'acc-free', sellable: false }
        ]
    };
    const enriched = await attachListedItemIds(supabase, OWNER, scanRow);
    const byId = Object.fromEntries(enriched.items.map((item) => [item.account_id, item.listed_item_id]));
    assert(byId['acc-live'] === 'item-pub', 'public-лот: listed_item_id проставлен');
    assert(byId['acc-drafted'] === null, 'draft-лот — не витрина: listed_item_id null');
    assert(byId['acc-free'] === null, 'без лота: listed_item_id null');
    assert(enriched.items[0].sellable === true, 'обогащение не теряет поля айтемов');
    assert(await attachListedItemIds(supabase, OWNER, null) === null, 'пустой скан проходит насквозь');
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
console.log('— loadScanCandidates: скоупы unlisted/listed —');

{
    const supabase = makeMockSupabase({
        userbot_restore_sources: [
            { account_id: 'acc-free', owner_id: OWNER },
            { account_id: 'acc-listed', owner_id: OWNER }
        ],
        tg_accounts: [
            makeAccountFixture('acc-free', { custom_label: '+79…001' }),
            makeAccountFixture('acc-listed', { custom_label: '+79…002' })
        ],
        shop_items: [
            { id: 'item-lot', owner_id: OWNER, status: 'published' }
        ],
        shop_item_assets: [
            { shop_item_id: 'item-lot', asset_type: 'userbot', asset_id: 'acc-listed' }
        ]
    });

    const unlisted = await loadScanCandidates(supabase, OWNER, 'unlisted');
    assert(unlisted.accounts.length === 1 && unlisted.accounts[0].id === 'acc-free', 'unlisted: только без активного лота');
    assert(unlisted.orphanCount === 0, 'unlisted: orphans считаются');

    const listed = await loadScanCandidates(supabase, OWNER, 'listed');
    assert(listed.accounts.length === 1 && listed.accounts[0].id === 'acc-listed', 'listed: только выставленные');
    assert(listed.orphanCount === 0, 'listed: orphan-блобы к скоупу не относятся');
}


console.log('— runSaleScan: QR-кандидат без restore source — report-only —');

{
    // Боевой импорт без блобов: вердикт показываем в списке, но статусы в базе
    // не трогаем — флак таймаута не должен помечать рабочий аккаунт error'ом.
    const supabase = makeMockSupabase({
        userbot_restore_sources: [],
        tg_accounts: [
            makeAccountFixture('acc-boevoi', { runtime_status: 'online', custom_label: '+79…003', proxy_id: 'px-7' })
        ],
        proxies: [
            { id: 'px-7', owner_id: OWNER, host: '10.0.0.7', port: 40007, username: 'mp_7', password: 'p', is_working: true, last_check_ip: '10.0.0.7', provision_source: 'manual_admin', inventory_group: 'self_use' }
        ],
        telegram_error_events: [],
        shop_items: [],
        shop_item_assets: [],
        account_sale_scans: []
    });
    const mockProxy = makeMockManagedProxy();

    const { data: scanRow } = await supabase
        .from('account_sale_scans')
        .insert({ owner_id: OWNER, scope: 'unlisted', status: 'processing', total: 1, processed: 0, failed: 0, items: [] })
        .select('id')
        .single();

    let applyCalls = 0;
    const result = await runSaleScan(supabase, {}, {
        ownerId: OWNER,
        scanId: scanRow.id,
        managedProxyService: mockProxy,
        deps: {
            checkFn: async () => ({ status: 'online', reason: 'Аккаунт живой, сессия отвечает.', details: null, me: { id: 555000777 } }),
            sleepFn: async () => {},
            applyVerdictFn: async () => { applyCalls += 1; return { verdictStatus: 'online', quarantined: false }; }
        }
    });

    const scan = supabase._tables.account_sale_scans.find((r) => r.id === scanRow.id);
    const item = scan.items[0];
    assert(applyCalls === 0, 'applyStockVerdict не звался (report-only)');
    assert(item.verdict === 'online' && item.sellable === false, 'вердикт виден, но не sellable (нет tdata)');
    const accountRow = supabase._tables.tg_accounts.find((r) => r.id === 'acc-boevoi');
    assert(accountRow.runtime_status === 'online' && accountRow.last_checked_at === null, 'боевой статус в базе не тронут');
    assert(supabase._tables.telegram_error_events.length === 0, 'без событий');
}

process.exit(failures === 0 ? 0 : 1);

