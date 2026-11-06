/**
 * Сценарий: checklist_create (чужой канал, dedup, 23505-гонка, ветки публикации
 * publish_now / pin / scheduled_at / queued) и checklist_state (NOT_FOUND,
 * happy path). Секции 1-9 исходного test-autopost-checklist-ops.js, порядок
 * сохранён. Экспортирует run() — хост вызывает сценарии строго по порядку.
 */
import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import { createChecklistHandler } from '../../mcp/tools/autopost/checklist-create.js';
import { checklistStateHandler } from '../../mcp/tools/autopost/checklist-state.js';
import {
    capture, assert, makeDb, makeChecklist, makeItem, seedLifecycleBot,
    BASE_ARGS, REQ, BOT_ID, OTHER_BOT_ID, CHANNEL_TG_ID, CL_ID
} from './shared.js';

export async function run() {

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

}
