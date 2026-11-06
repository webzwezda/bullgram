/**
 * Сценарий: agent_note и журнал — post_create (заметка на весь batch, null без
 * заметки, кап 2000), posts_list (agent_note, фильтр статуса, курсор
 * created_at|id, чужой бот), чек-листовый agent_note (create/state/update/
 * ''-очистка/list, кап 2000). Секции 16-18 исходного
 * test-autopost-checklist-ops.js, порядок сохранён.
 * Экспортирует run() — хост вызывает сценарии строго по порядку.
 */
import { ERROR_CODES } from '../../shared/errors.js';
import { createChecklistHandler } from '../../mcp/tools/autopost/checklist-create.js';
import { checklistStateHandler } from '../../mcp/tools/autopost/checklist-state.js';
import { checklistListHandler } from '../../mcp/tools/autopost/checklist-list.js';
import { updateChecklistHandler } from '../../mcp/tools/autopost/checklist-update.js';
import { createPostHandler } from '../../mcp/tools/autopost/create-post.js';
import { postsListHandler } from '../../mcp/tools/autopost/posts-list.js';
import {
    capture, assert, makeDb, makeChannel,
    BASE_ARGS, REQ, BOT_ID, CHANNEL_TG_ID
} from './shared.js';

export async function run() {

console.log('--- post_create: agent_note пишется во все строки batch\'а; без заметки → null ---');
{
    // Два канала → две строки очереди, одна заметка на весь batch.
    const mock = makeDb({
        channels: [
            makeChannel(),
            { id: 'ch2', tg_chat_id: '-100222', title: 'Второй', visibility: 'private', autopost_bot_id: BOT_ID }
        ]
    });
    await createPostHandler({
        supabase: mock,
        req: REQ,
        args: {
            bot_id: BOT_ID,
            target_channel_ids: [CHANNEL_TG_ID, '-100222'],
            caption: 'напоминание о привычках',
            agent_note: 'этот пост о привычках, привычки в вики/папка X'
        }
    });
    const rows = mock.db.autopost_items;
    assert(rows.length === 2, 'two queue rows for two channels');
    assert(rows.every((r) => r.agent_note === 'этот пост о привычках, привычки в вики/папка X'), 'note on every batch row');
    assert(new Set(rows.map((r) => r.post_batch_id)).size === 1, 'rows share one batch_id');
    assert(rows.every((r) => ['queued', 'scheduled'].includes(r.status)), 'queued-branch statuses');
    assert(mock.calls.rpc.includes('autopost_collapse_queue'), 'collapseQueue ran for both channels');
}
{
    const mock = makeDb();
    await createPostHandler({
        supabase: mock,
        req: REQ,
        args: { bot_id: BOT_ID, target_channel_ids: [CHANNEL_TG_ID], caption: 'без заметки' }
    });
    assert(mock.db.autopost_items[0]?.agent_note === null, 'no agent_note → null on the row');
}
{
    const mock = makeDb();
    const err = await capture(createPostHandler({
        supabase: mock,
        req: REQ,
        args: { bot_id: BOT_ID, target_channel_ids: [CHANNEL_TG_ID], caption: 'x', agent_note: 'a'.repeat(2001) }
    }));
    assert(err?.code === ERROR_CODES.INVALID_PARAMS, 'agent_note > 2000 → INVALID_PARAMS');
    assert(mock.db.autopost_items.length === 0, 'no rows inserted on bad note');
}

console.log('--- posts_list: agent_note, фильтр статуса, курсор created_at|id ---');
{
    const mkPost = (id, createdAt, status, note) => ({
        id,
        bot_id: BOT_ID,
        target_channel_id: CHANNEL_TG_ID,
        post_batch_id: 'batch-1',
        caption: `пост ${id.slice(-1)}`,
        media_type: 'text',
        status,
        agent_note: note,
        created_at: createdAt,
        posted_message_ids: [],
        scheduled_at: null,
        posted_at: null,
        error_message: null,
        sort_order: 1
    });
    const mock = makeDb({
        items: [
            mkPost('aaaaaaaa-0000-4000-8000-000000000001', '2026-09-17T10:00:00.000Z', 'posted', 'старый пост про привычки'),
            mkPost('aaaaaaaa-0000-4000-8000-000000000002', '2026-09-17T11:00:00.000Z', 'queued', null),
            mkPost('aaaaaaaa-0000-4000-8000-000000000003', '2026-09-17T12:00:00.000Z', 'queued', 'свежий контекст')
        ]
    });

    const page1 = await postsListHandler({ supabase: mock, req: REQ, args: { bot_id: BOT_ID, limit: 2 } });
    assert(page1.items.length === 2, 'limit respected');
    assert(page1.items[0].id === 'aaaaaaaa-0000-4000-8000-000000000003', 'fresh first (created_at desc)');
    assert(page1.items[0].agent_note === 'свежий контекст', 'agent_note returned');
    assert(page1.items[0].target_channel_id === CHANNEL_TG_ID, 'target_channel_id as string');
    assert(page1.next_cursor === '2026-09-17T11:00:00.000Z|aaaaaaaa-0000-4000-8000-000000000002', 'cursor = created_at|id');

    const page2 = await postsListHandler({ supabase: mock, req: REQ, args: { bot_id: BOT_ID, limit: 2, cursor: page1.next_cursor } });
    assert(page2.items.length === 1 && page2.items[0].id === 'aaaaaaaa-0000-4000-8000-000000000001', 'cursor paginates to older page');
    assert(page2.next_cursor === null, 'short page → null cursor');

    const posted = await postsListHandler({ supabase: mock, req: REQ, args: { bot_id: BOT_ID, status: 'posted' } });
    assert(posted.items.length === 1 && posted.items[0].agent_note === 'старый пост про привычки', 'status filter + note');
    const bad = await capture(postsListHandler({ supabase: mock, req: REQ, args: { bot_id: BOT_ID, status: 'nope' } }));
    assert(bad?.code === ERROR_CODES.INVALID_PARAMS, 'unknown status → INVALID_PARAMS');
}
{
    const mock = makeDb({ bots: [] });
    const err = await capture(postsListHandler({ supabase: mock, req: REQ, args: { bot_id: BOT_ID } }));
    assert(err?.code === ERROR_CODES.NOT_FOUND, 'foreign bot → NOT_FOUND');
}

console.log('--- чек-листы: agent_note пишется, правится, чистится, читается ---');
{
    const mock = makeDb();
    const created = await createChecklistHandler({
        supabase: mock,
        req: REQ,
        args: { ...BASE_ARGS, items: ['картошка'], agent_note: 'чек-лист о привычках, привычки в вики/папка X' }
    });
    assert(mock.db.autopost_checklists[0]?.agent_note === 'чек-лист о привычках, привычки в вики/папка X', 'note stored on create');

    const state = await checklistStateHandler({ supabase: mock, req: REQ, args: { bot_id: BOT_ID, checklist_id: created.checklist.id } });
    assert(state.checklist.agent_note === 'чек-лист о привычках, привычки в вики/папка X', 'state returns agent_note');

    // agent_note без остальных правок — валидный вызов.
    const updated = await updateChecklistHandler({
        supabase: mock,
        req: REQ,
        args: { bot_id: BOT_ID, checklist_id: created.checklist.id, agent_note: 'другой контекст' }
    });
    assert(updated.checklist.agent_note === 'другой контекст', 'note-only update rewrites note');

    // Пустая строка — очистить (в БД null).
    const cleared = await updateChecklistHandler({
        supabase: mock,
        req: REQ,
        args: { bot_id: BOT_ID, checklist_id: created.checklist.id, agent_note: '' }
    });
    assert(cleared.checklist.agent_note === null, "empty string clears note (null)");

    const listed = await checklistListHandler({ supabase: mock, req: REQ, args: { bot_id: BOT_ID } });
    assert(listed.items.length === 1 && listed.items[0].agent_note === null, 'list returns cleared note');

    const tooLong = await capture(createChecklistHandler({
        supabase: mock,
        req: REQ,
        args: { ...BASE_ARGS, items: ['x'], agent_note: 'a'.repeat(2001) }
    }));
    assert(tooLong?.code === ERROR_CODES.INVALID_PARAMS, 'checklist agent_note > 2000 → INVALID_PARAMS');
    assert(mock.calls.checklistInserts === 1, 'no second checklist inserted on bad note');
}

}
