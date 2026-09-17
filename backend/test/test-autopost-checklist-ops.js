/**
 * Юнит-тесты MCP-операций чек-листов автопостера (Фаза 2, офлайн, детерминированные).
 * Запуск: node test/test-autopost-checklist-ops.js
 *
 * Хендлеры checklist-* гоняются напрямую ({ supabase, req, args }) на моке supabase
 * (in-memory таблицы — стиль test-autopost-tier.js / test-autopost-bestof.js).
 *
 * Покрывает: чужой tg_chat_id → INVALID_PARAMS; чужой checklist_id под своим ботом →
 * NOT_FOUND (IDOR-гейт); dedup-повтор → already_exists без второй вставки;
 * unique-violation гонка (23505) → существующий возвращён; ветки публикации
 * publish_now / scheduled_at / queued; non-fatal pin; маппинг ошибок update
 * (NOT_FOUND / ITEM_NOT_FOUND / CHECKLIST_CANCELLED / TOO_MANY_ITEMS) и cancel.
 */
import { createChecklistHandler } from '../mcp/tools/autopost/checklist-create.js';
import { checklistStateHandler } from '../mcp/tools/autopost/checklist-state.js';
import { checklistListHandler } from '../mcp/tools/autopost/checklist-list.js';
import { updateChecklistHandler } from '../mcp/tools/autopost/checklist-update.js';
import { cancelChecklistHandler } from '../mcp/tools/autopost/checklist-cancel.js';
import { MCPError, ERROR_CODES } from '../shared/errors.js';
import { AutopostService } from '../services/autopost.service.js';
import { startAutopostBot, stopAutopostBot } from '../services/autopost/bot-lifecycle.js';

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

const OWNER_ID = '9fd78a21-33b6-4d68-b0f7-a8ddf2e0bce3';
const BOT_ID = 'b0b0b0b0-0000-4000-8000-000000000001';
const OTHER_BOT_ID = 'b0b0b0b0-0000-4000-8000-000000000002';
const CHANNEL_TG_ID = '-100111';
const CL_ID = 'c1c1c1c1-0000-4000-8000-000000000001';
const ITEM_ID = 'i0i0i0i0-0000-4000-8000-000000000001';
const REQ = { user: { id: OWNER_ID } };

function makeBot() {
    return { id: BOT_ID, owner_id: OWNER_ID, is_active: true, bot_token: '123456:AAtesttokenAAtesttokenAAtesttokenAA', username: 'checkbot' };
}
function makeChannel() {
    return { id: 'ch1', tg_chat_id: CHANNEL_TG_ID, title: 'Семья', visibility: 'private', autopost_bot_id: BOT_ID };
}
function makeChecklist(patch = {}) {
    return {
        id: CL_ID,
        owner_id: OWNER_ID,
        bot_id: BOT_ID,
        title: 'Покупки',
        created_by: 'agent',
        expires_at: null,
        cancelled_at: null,
        dedup_key: null,
        created_at: '2026-09-17T18:00:00.000Z',
        ...patch
    };
}
function makeItem(patch = {}) {
    return {
        id: ITEM_ID,
        checklist_id: CL_ID,
        bot_id: BOT_ID,
        text: 'картошка',
        position: 0,
        is_checked: false,
        checked_by_tg_id: null,
        checked_by_name: null,
        checked_at: null,
        ...patch
    };
}

/**
 * In-memory supabase: таблицы + цепочка фильтров (eq/in/gte/lt), thenable,
 * insert/update/delete/rpc. Конфиг: checklistInsertError (симуляция 23505-гонки,
 * опционально raceChecklist — «параллельный create успел» появляется в таблице).
 */
function makeDb({ bots = [makeBot()], channels = [makeChannel()], checklists = [], checklistItems = [], items = [], checklistInsertError = null, raceChecklist = null } = {}) {
    const db = {
        autopost_bots: [...bots],
        channels: [...channels],
        autopost_checklists: [...checklists],
        autopost_checklist_items: [...checklistItems],
        autopost_checklist_events: [],
        autopost_items: [...items]
    };
    const calls = { checklistInserts: 0, rpc: [] };
    let rowId = 1;

    function rowMatches(row, state) {
        for (const [k, v] of Object.entries(state.filters)) {
            if (String(row[k]) !== String(v)) return false;
        }
        for (const [k, arr] of state.inFilters) {
            if (!arr.map(String).includes(String(row[k]))) return false;
        }
        for (const [k, v] of state.gteFilters) {
            if (!(String(row[k]) >= String(v))) return false;
        }
        for (const [k, v] of state.ltFilters) {
            if (!(String(row[k]) < String(v))) return false;
        }
        return true;
    }

    function condsMatch(row, conds) {
        return conds.every(([k, v, isIn]) =>
            isIn ? v.map(String).includes(String(row[k])) : String(row[k]) === String(v)
        );
    }

    function chain(table) {
        const state = { filters: {}, inFilters: [], gteFilters: [], ltFilters: [], mode: null };
        const b = {
            select() { return b; },
            eq(k, v) { state.filters[k] = v; return b; },
            in(k, arr) { state.inFilters.push([k, arr]); return b; },
            gte(k, v) { state.gteFilters.push([k, v]); return b; },
            lt(k, v) { state.ltFilters.push([k, v]); return b; },
            contains() { return b; },
            order() { return b; },
            limit() { return b; },
            maybeSingle() { state.mode = 'maybeSingle'; return Promise.resolve(run()); },
            single() { state.mode = 'single'; return Promise.resolve(run()); },
            then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); }
        };
        function run() {
            const rows = db[table].filter((row) => rowMatches(row, state));
            return { data: state.mode ? (rows[0] ?? null) : rows, error: null };
        }

        b.insert = function (payload) {
            const rows = Array.isArray(payload) ? payload : [payload];
            if (table === 'autopost_checklists') {
                calls.checklistInserts++;
                if (checklistInsertError) {
                    // Гонка: «параллельный» вставщик успел — его строка появляется
                    // до ретрай-select'а хендлера.
                    if (raceChecklist) db.autopost_checklists.push({ ...raceChecklist });
                    return { select: () => ({ single: async () => ({ data: null, error: checklistInsertError }) }) };
                }
                const inserted = rows.map((r) => ({
                    id: `chk-${rowId++}`,
                    cancelled_at: null,
                    created_at: new Date().toISOString(),
                    ...r
                }));
                db.autopost_checklists.push(...inserted);
                return { select: () => ({ single: async () => ({ data: inserted[0], error: null }) }) };
            }
            if (table === 'autopost_checklist_items') {
                const inserted = rows.map((r) => ({
                    id: `itm-${rowId++}`,
                    is_checked: false,
                    checked_by_tg_id: null,
                    checked_by_name: null,
                    checked_at: null,
                    ...r
                }));
                db.autopost_checklist_items.push(...inserted);
                return Promise.resolve({ data: inserted, error: null });
            }
            if (table === 'autopost_items') {
                const inserted = rows.map((r) => ({
                    id: `ap-${rowId++}`,
                    media_type: 'text',
                    checklist_id: null,
                    posted_message_ids: [],
                    discussion_message_ids: [],
                    posted_at: null,
                    scheduled_at: null,
                    error_message: null,
                    is_suggestion: false,
                    ...r
                }));
                db.autopost_items.push(...inserted);
                return { select: () => Promise.resolve({ data: inserted, error: null }) };
            }
            if (table === 'autopost_checklist_events') {
                db.autopost_checklist_events.push(...rows.map((r) => ({ id: rowId++, created_at: new Date().toISOString(), ...r })));
                return Promise.resolve({ data: null, error: null });
            }
            return Promise.resolve({ data: null, error: null });
        };

        b.update = function (patch) {
            const conds = [];
            const ub = {
                eq(k, v) { conds.push([k, v, false]); return ub; },
                in(k, arr) { conds.push([k, arr, true]); return ub; },
                select() { return ub; },
                single() { return Promise.resolve({ data: null, error: null }); },
                then(resolve) {
                    for (const row of db[table]) {
                        if (condsMatch(row, conds)) Object.assign(row, patch);
                    }
                    resolve({ data: null, error: null });
                }
            };
            return ub;
        };

        b.delete = function () {
            const conds = [];
            const dbuilder = {
                eq(k, v) { conds.push([k, v, false]); return dbuilder; },
                in(k, arr) { conds.push([k, arr, true]); return dbuilder; },
                then(resolve) {
                    db[table] = db[table].filter((row) => !condsMatch(row, conds));
                    resolve({ data: null, error: null });
                }
            };
            return dbuilder;
        };

        return b;
    }

    return {
        from: chain,
        // collapseQueue зовёт supabase.rpc('autopost_collapse_queue', ...) — на
        // уровне клиента, не таблицы. Отвечаем ошибкой: мок уходит в fallback-ветку.
        rpc(name) {
            calls.rpc.push(name);
            return Promise.resolve({ data: null, error: { message: 'rpc unavailable in mock' } });
        },
        db,
        calls
    };
}

// --- Офлайн-бот в lifecycle-реестре: publishItem/pin/rerender идут через его
// telegram-методы, сети нет. launch подменён на never-resolving promise, чтобы
// запись не вылетела из Map (реальный launch в офлайне упал бы и вычистил её).
let lifecycleBot = null;
function seedLifecycleBot(botId) {
    if (lifecycleBot) return lifecycleBot;
    let captured = null;
    startAutopostBot(botId, '123456:AAtesttokenAAtesttokenAAtesttokenAA', (bot) => {
        captured = bot;
        bot.launch = () => new Promise(() => {});
    });
    captured.telegram.sendMessage = async () => ({ message_id: 777 });
    captured.telegram.editMessageText = async () => true;
    captured.telegram.editMessageReplyMarkup = async () => true;
    captured.telegram.pinChatMessage = async () => true;
    lifecycleBot = captured;
    return captured;
}

const BASE_ARGS = { bot_id: BOT_ID, target_channel_ids: [CHANNEL_TG_ID] };

console.log('--- checklist_create: чужой tg_chat_id → INVALID_PARAMS ---');
{
    const mock = makeDb({ channels: [] });
    const err = await capture(createChecklistHandler({
        supabase: mock,
        req: REQ,
        args: { ...BASE_ARGS, target_channel_ids: ['-100999'], items: ['картошка'] }
    }));
    assert(err instanceof MCPError, 'throws MCPError');
    assert(err?.code === ERROR_CODES.INVALID_PARAMS, `code INVALID_PARAMS (got ${err?.code})`);
    assert(JSON.stringify(err?.data?.missing_channels) === JSON.stringify(['-100999']), 'missing_channels listed');
    assert(mock.calls.checklistInserts === 0, 'no checklist inserted on bad channel');
}

console.log('--- checklist_state: чужой checklist_id под своим ботом → NOT_FOUND ---');
{
    // Чек-лист существует, но под другим ботом — штатный NOT_FOUND, не утечка данных.
    const mock = makeDb({
        checklists: [makeChecklist({ bot_id: OTHER_BOT_ID })],
        checklistItems: [makeItem()]
    });
    const err = await capture(checklistStateHandler({
        supabase: mock,
        req: REQ,
        args: { bot_id: BOT_ID, checklist_id: CL_ID }
    }));
    assert(err instanceof MCPError && err?.code === ERROR_CODES.NOT_FOUND, 'code NOT_FOUND');
    assert(err?.message === 'Чек-лист удалён или не существует.', 'Russian NOT_FOUND text');
}

console.log('--- checklist_state: happy path (items + summary + events) ---');
{
    const mock = makeDb({
        checklists: [makeChecklist()],
        checklistItems: [
            makeItem({ is_checked: true, checked_by_name: 'Вася', checked_at: '2026-09-17T10:12:00Z' }),
            makeItem({ id: 'i0i0i0i0-0000-4000-8000-000000000002', text: 'капуста', position: 1 })
        ]
    });
    // Лента: одна запись — include_events должен её отдать.
    await mock.from('autopost_checklist_events').insert({ checklist_id: CL_ID, action: 'created', actor_source: 'agent' });

    const res = await checklistStateHandler({
        supabase: mock,
        req: REQ,
        args: { bot_id: BOT_ID, checklist_id: CL_ID, include_events: true }
    });
    assert(res.checklist.id === CL_ID && res.checklist.status === 'active', 'checklist with computed status');
    assert(res.items.length === 2, 'two items');
    assert(res.summary.startsWith('Итог: 1 из 2 — '), `summary composed (got "${res.summary?.slice(0, 20)}…")`);
    assert(res.summary.includes('картошка ✅ (Вася, 10:12)'), 'summary carries attribution');
    assert(Array.isArray(res.events) && res.events.length === 1, 'events returned on include_events');
}

console.log('--- checklist_create: dedup-повтор → already_exists без второй вставки ---');
{
    const mock = makeDb({
        checklists: [makeChecklist({ dedup_key: 'daily-2026-09-17' })],
        checklistItems: [makeItem()]
    });
    const res = await createChecklistHandler({
        supabase: mock,
        req: REQ,
        args: { ...BASE_ARGS, items: ['картошка'], dedup_key: 'daily-2026-09-17' }
    });
    assert(res.already_exists === true, 'already_exists=true');
    assert(res.checklist.id === CL_ID, 'existing checklist returned');
    assert(res.checklist.items_count === 1, 'items_count from existing list');
    assert(mock.calls.checklistInserts === 0, 'no second insert');
    assert(res.published === undefined, 'nothing published on dedup hit');
}

console.log('--- checklist_create: unique-violation гонка (23505) → существующий возвращён ---');
{
    // Пречек промахивается (параллельный insert ещё не видно), insert ловит 23505,
    // ретрай-select находит победителя гонки.
    const mock = makeDb({
        checklistInsertError: { code: '23505', message: 'duplicate key value violates unique constraint "autopost_checklists_bot_dedup_uidx"' },
        raceChecklist: makeChecklist({ dedup_key: 'daily-2026-09-17' })
    });
    const res = await createChecklistHandler({
        supabase: mock,
        req: REQ,
        args: { ...BASE_ARGS, items: ['картошка'], dedup_key: 'daily-2026-09-17' }
    });
    assert(res.already_exists === true, 'already_exists=true on 23505 race');
    assert(res.checklist.id === CL_ID, 'race winner returned');
    assert(mock.calls.checklistInserts === 1, 'insert attempted exactly once');
    assert(mock.db.autopost_checklist_items.length === 0, 'no items inserted for lost race');
}

console.log('--- checklist_create: publish_now ветка (публикация + pin) ---');
{
    const seeded = seedLifecycleBot(BOT_ID);
    const pinCalls = [];
    seeded.telegram.pinChatMessage = async (chatId, messageId) => {
        pinCalls.push([String(chatId), messageId]);
        return true;
    };
    const mock = makeDb();
    const res = await createChecklistHandler({
        supabase: mock,
        req: REQ,
        args: { ...BASE_ARGS, title: 'Покупки', items: ['картошка', 'капуста'], publish_now: true, pin: true }
    });
    assert(res.checklist.status === 'active' && res.checklist.items_count === 2, 'fresh checklist card');
    assert(Array.isArray(res.published) && res.published.length === 1, 'one channel published');
    assert(res.published[0].status === 'posted', 'published status posted');
    assert(JSON.stringify(res.published[0].posted_message_ids) === '[777]', 'posted_message_ids from telegram');
    assert(JSON.stringify(res.published[0].discussion_message_ids) === '[]', 'no discussion forward for checklist');
    assert(JSON.stringify(pinCalls) === JSON.stringify([[CHANNEL_TG_ID, 777]]), 'pin called once with first message');
    const row = mock.db.autopost_items[0];
    assert(row?.status === 'posted' && row?.media_type === 'checklist' && row?.checklist_id === res.checklist.id, 'queue row posted as checklist');
    const actions = mock.db.autopost_checklist_events.map((e) => e.action);
    assert(actions.includes('created') && actions.includes('published'), 'created + published events');
    assert(mock.db.autopost_checklist_items.length === 2 && mock.db.autopost_checklist_items.every((i) => i.bot_id === BOT_ID), 'items inserted with bot_id');
}

console.log('--- checklist_create: pin без прав — non-fatal ---');
{
    const seeded = seedLifecycleBot(BOT_ID);
    seeded.telegram.pinChatMessage = async () => { throw new Error('need can_pin_rights'); };
    const mock = makeDb();
    const res = await createChecklistHandler({
        supabase: mock,
        req: REQ,
        args: { ...BASE_ARGS, title: 'T', items: ['пункт'], publish_now: true, pin: true }
    });
    assert(Array.isArray(res.published) && res.published[0].status === 'posted', 'publish unaffected by pin failure');
    assert(mock.db.autopost_items[0]?.status === 'posted', 'queue row still posted');
}

console.log('--- checklist_create: scheduled_at ветка ---');
{
    const mock = makeDb();
    const res = await createChecklistHandler({
        supabase: mock,
        req: REQ,
        args: { ...BASE_ARGS, title: 'Утро', items: ['зарядка'], scheduled_at: '2030-01-01T09:00:00Z' }
    });
    assert(res.published === undefined, 'nothing published synchronously');
    assert(res.scheduled_at === '2030-01-01T09:00:00.000Z', 'scheduled_at echoed in response');
    const row = mock.db.autopost_items[0];
    assert(row?.status === 'scheduled' && row?.scheduled_at === '2030-01-01T09:00:00.000Z', 'rows pinned to scheduled_at');
}

console.log('--- checklist_create: queued ветка (collapseQueue прогоняется) ---');
{
    const mock = makeDb();
    const res = await createChecklistHandler({
        supabase: mock,
        req: REQ,
        args: { ...BASE_ARGS, title: 'Очередь', items: ['дело'] }
    });
    assert(res.published === undefined && res.scheduled_at === undefined, 'no publish, no pinned slot in response');
    assert(mock.calls.rpc.includes('autopost_collapse_queue'), 'collapseQueue ran for the channel');
    const row = mock.db.autopost_items[0];
    assert(row?.checklist_id === res.checklist.id && row?.media_type === 'checklist', 'checklist row linked');
    assert(['queued', 'scheduled'].includes(row?.status), `row in planner status (got ${row?.status})`);
}

console.log('--- checklist_update: маппинг NOT_FOUND / ITEM_NOT_FOUND / CHECKLIST_CANCELLED ---');
{
    // NOT_FOUND: списка нет вообще.
    {
        const mock = makeDb();
        const err = await capture(updateChecklistHandler({
            supabase: mock,
            req: REQ,
            args: { bot_id: BOT_ID, checklist_id: CL_ID, add: ['хлеб'] }
        }));
        assert(err?.code === ERROR_CODES.NOT_FOUND && err?.message === 'Чек-лист удалён или не существует.', 'NOT_FOUND text');
    }
    // ITEM_NOT_FOUND: rename по чужому/несуществующему item_id.
    {
        const mock = makeDb({ checklists: [makeChecklist()], checklistItems: [makeItem()] });
        const err = await capture(updateChecklistHandler({
            supabase: mock,
            req: REQ,
            args: { bot_id: BOT_ID, checklist_id: CL_ID, rename: [{ item_id: '99999999-9999-4999-8999-999999999999', text: 'x' }] }
        }));
        assert(err?.code === ERROR_CODES.NOT_FOUND, `ITEM_NOT_FOUND → NOT_FOUND (got ${err?.code})`);
        assert(String(err?.message || '').startsWith('Пункт не найден в этом списке.'), 'ITEM_NOT_FOUND Russian text');
    }
    // CHECKLIST_CANCELLED: закрытый список править нельзя → INVALID_PARAMS.
    {
        const mock = makeDb({
            checklists: [makeChecklist({ cancelled_at: '2026-09-17T20:00:00.000Z' })],
            checklistItems: [makeItem()]
        });
        const err = await capture(updateChecklistHandler({
            supabase: mock,
            req: REQ,
            args: { bot_id: BOT_ID, checklist_id: CL_ID, reset: true }
        }));
        assert(err?.code === ERROR_CODES.INVALID_PARAMS, `CHECKLIST_CANCELLED → INVALID_PARAMS (got ${err?.code})`);
        assert(err?.message === 'Список закрыт — править нельзя.', 'CHECKLIST_CANCELLED Russian text');
    }
}

console.log('--- checklist_update: happy path (add + summary) ---');
{
    const mock = makeDb({
        checklists: [makeChecklist()],
        checklistItems: [makeItem({ is_checked: true, checked_by_name: 'Вася' })]
    });
    const res = await updateChecklistHandler({
        supabase: mock,
        req: REQ,
        args: { bot_id: BOT_ID, checklist_id: CL_ID, add: ['молоко'] }
    });
    assert(res.items.length === 2, 'item added');
    assert(res.summary.includes('молоко ⬜') && res.summary.includes('картошка ✅'), 'summary mixes checked and new items');
    assert(res.checklist.status === 'active', 'status active');
    const actions = mock.db.autopost_checklist_events.map((e) => e.action);
    assert(actions.includes('added'), 'added event recorded');
}

console.log('--- checklist_update: кап 25 пунктов в сервисе (TOO_MANY_ITEMS) ---');
{
    // 25 существующих пунктов + add 1 → сервис кидает TOO_MANY_ITEMS ПОСЛЕ
    // scope-проверки → хендлер маппит в INVALID_PARAMS, записи не происходит.
    const items25 = Array.from({ length: 25 }, (_, i) => makeItem({
        id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`,
        text: `пункт ${i}`,
        position: i
    }));
    const mock = makeDb({ checklists: [makeChecklist()], checklistItems: items25 });
    const err = await capture(updateChecklistHandler({
        supabase: mock,
        req: REQ,
        args: { bot_id: BOT_ID, checklist_id: CL_ID, add: ['ещё один'] }
    }));
    assert(err instanceof MCPError && err?.code === ERROR_CODES.INVALID_PARAMS, `over-cap add → INVALID_PARAMS (got ${err?.code})`);
    assert(err?.message === 'В списке максимум 25 пунктов.', 'over-cap Russian text');
    assert(mock.db.autopost_checklist_items.length === 25, 'no item inserted past the cap');

    // Прямой pre-load из хендлера убран (читал потенциально чужие строки до
    // NOT_FOUND-гейта): при чужом checklist_id items больше не читаются вовсе.
    let itemsLoads = 0;
    const origLoad = AutopostService.prototype.loadChecklistItems;
    AutopostService.prototype.loadChecklistItems = async function (...args) {
        itemsLoads++;
        return origLoad.apply(this, args);
    };
    try {
        const foreign = makeDb({
            checklists: [makeChecklist({ bot_id: OTHER_BOT_ID })],
            checklistItems: [makeItem()]
        });
        const nfErr = await capture(updateChecklistHandler({
            supabase: foreign,
            req: REQ,
            args: { bot_id: BOT_ID, checklist_id: CL_ID, add: ['x'] }
        }));
        assert(nfErr?.code === ERROR_CODES.NOT_FOUND, 'foreign checklist still NOT_FOUND');
        assert(itemsLoads === 0, 'handler did not pre-load items before scope check');
    } finally {
        AutopostService.prototype.loadChecklistItems = origLoad;
    }
}

console.log('--- checklist_list: фильтр по вычисляемому статусу ---');
{
    const mock = makeDb({
        checklists: [
            makeChecklist({ id: 'c2c2c2c2-0000-4000-8000-000000000002', title: 'живой' }),
            makeChecklist({ id: 'c3c3c3c3-0000-4000-8000-000000000003', title: 'истёк', expires_at: '2020-01-01T00:00:00Z', dedup_key: 'old-1' }),
            makeChecklist({ id: 'c4c4c4c4-0000-4000-8000-000000000004', title: 'закрыт', cancelled_at: '2020-01-01T00:00:00Z', dedup_key: 'old-2' })
        ]
    });
    const active = await checklistListHandler({ supabase: mock, req: REQ, args: { bot_id: BOT_ID, status: 'active' } });
    assert(active.items.length === 1 && active.items[0].title === 'живой', 'status=active filter');
    assert(active.items[0].status === 'active', 'computed status attached to rows');
    assert(active.next_cursor === null, 'short page → null cursor');

    const all = await checklistListHandler({ supabase: mock, req: REQ, args: { bot_id: BOT_ID } });
    assert(all.items.length === 3, 'no filter → all lists');
}

console.log('--- checklist_cancel: NOT_FOUND + happy path ---');
{
    {
        const mock = makeDb();
        const err = await capture(cancelChecklistHandler({
            supabase: mock,
            req: REQ,
            args: { bot_id: BOT_ID, checklist_id: CL_ID }
        }));
        assert(err?.code === ERROR_CODES.NOT_FOUND && err?.message === 'Чек-лист удалён или не существует.', 'cancel NOT_FOUND mapping');
    }
    {
        seedLifecycleBot(BOT_ID); // posted-копий нет — снятие клавиатур no-op
        const mock = makeDb({
            checklists: [makeChecklist()],
            checklistItems: [makeItem()],
            items: [{ bot_id: BOT_ID, target_channel_id: CHANNEL_TG_ID, caption: 'Покупки', status: 'queued', media_type: 'checklist', checklist_id: CL_ID }]
        });
        const res = await cancelChecklistHandler({
            supabase: mock,
            req: REQ,
            args: { bot_id: BOT_ID, checklist_id: CL_ID }
        });
        assert(res.checklist.status === 'cancelled', 'computed status cancelled');
        assert(mock.db.autopost_items.length === 0, 'queued rows removed');
        const actions = mock.db.autopost_checklist_events.map((e) => e.action);
        assert(actions.includes('cancelled'), 'cancelled event recorded');
    }
}

console.log('--- checklist_update: чужой бот → NOT_FOUND бота ---');
{
    const mock = makeDb({ bots: [] });
    const err = await capture(updateChecklistHandler({
        supabase: mock,
        req: REQ,
        args: { bot_id: BOT_ID, checklist_id: CL_ID, add: ['x'] }
    }));
    assert(err?.code === ERROR_CODES.NOT_FOUND, 'bot probe NOT_FOUND');
}

// --- Cleanup: не оставляем офлайн-бота в lifecycle-реестре процесса.
stopAutopostBot(BOT_ID);

if (failures > 0) {
    console.error(`\n❌ ${failures} test(s) failed`);
    process.exit(1);
}
console.log('\n✅ All checklist ops tests passed');
