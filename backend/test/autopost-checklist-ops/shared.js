/**
 * Общие ассерты, константы, фикстуры, in-memory supabase (makeDb) и офлайн-бот
 * lifecycle для сценариев test-autopost-checklist-ops.
 * Живые биндинги: counters мутируется по мере проверок, хост-файл
 * (test/test-autopost-checklist-ops.js) читает его в финальной сводке.
 */
import { randomUUID } from 'node:crypto';
import { startAutopostBot } from '../../services/autopost/bot-lifecycle.js';

export const counters = { failures: 0 };
export function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        counters.failures++;
    }
}
export async function capture(promise) {
    try {
        await promise;
        return null;
    } catch (e) {
        return e;
    }
}

export const OWNER_ID = '9fd78a21-33b6-4d68-b0f7-a8ddf2e0bce3';
export const BOT_ID = 'b0b0b0b0-0000-4000-8000-000000000001';
export const OTHER_BOT_ID = 'b0b0b0b0-0000-4000-8000-000000000002';
export const CHANNEL_TG_ID = '-100111';
export const CL_ID = 'c1c1c1c1-0000-4000-8000-000000000001';
export const ITEM_ID = 'i0i0i0i0-0000-4000-8000-000000000001';
export const REQ = { user: { id: OWNER_ID } };

export function makeBot() {
    return { id: BOT_ID, owner_id: OWNER_ID, is_active: true, bot_token: '123456:AAtesttokenAAtesttokenAAtesttokenAA', username: 'checkbot' };
}
export function makeChannel() {
    return { id: 'ch1', tg_chat_id: CHANNEL_TG_ID, title: 'Семья', visibility: 'private', autopost_bot_id: BOT_ID };
}
export function makeChecklist(patch = {}) {
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
export function makeItem(patch = {}) {
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
export function makeDb({ bots = [makeBot()], channels = [makeChannel()], checklists = [], checklistItems = [], items = [], checklistInsertError = null, raceChecklist = null } = {}) {
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
        const state = { filters: {}, inFilters: [], gteFilters: [], ltFilters: [], orderKey: null, orderAsc: true, limitValue: null, mode: null };
        const b = {
            select() { return b; },
            eq(k, v) { state.filters[k] = v; return b; },
            in(k, arr) { state.inFilters.push([k, arr]); return b; },
            gte(k, v) { state.gteFilters.push([k, v]); return b; },
            lt(k, v) { state.ltFilters.push([k, v]); return b; },
            contains() { return b; },
            order(k, opts = {}) { state.orderKey = k; state.orderAsc = opts.ascending !== false; return b; },
            limit(n) { state.limitValue = n; return b; },
            maybeSingle() { state.mode = 'maybeSingle'; return Promise.resolve(run()); },
            single() { state.mode = 'single'; return Promise.resolve(run()); },
            then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); }
        };
        function run() {
            let rows = db[table].filter((row) => rowMatches(row, state));
            if (state.orderKey) {
                const dir = state.orderAsc ? 1 : -1;
                const cmp = (va, vb) => {
                    if (typeof va === 'number' && typeof vb === 'number') return va - vb;
                    const sa = String(va ?? '');
                    const sb = String(vb ?? '');
                    return sa < sb ? -1 : sa > sb ? 1 : 0;
                };
                // Array.prototype.sort стабильна (ES2019): равные ключи сохраняют порядок вставки.
                rows.sort((a, b) => dir * cmp(a[state.orderKey], b[state.orderKey]));
            }
            if (state.limitValue != null) rows = rows.slice(0, state.limitValue);
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
                    // UUID, как в real-БД: state/update-хендлеры валидируют checklist_id как UUID.
                    id: randomUUID(),
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
                    posted_at: null,
                    scheduled_at: null,
                    error_message: null,
                    is_suggestion: false,
                    // Зеркало дефолта real-БД: created_at now() — курсор posts_list на него опирается.
                    created_at: new Date().toISOString(),
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
export function seedLifecycleBot(botId) {
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

export const BASE_ARGS = { bot_id: BOT_ID, target_channel_ids: [CHANNEL_TG_ID] };
