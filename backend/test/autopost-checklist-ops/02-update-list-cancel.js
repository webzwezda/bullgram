/**
 * Сценарий: checklist_update (маппинг NOT_FOUND / ITEM_NOT_FOUND /
 * CHECKLIST_CANCELLED, happy path, кап 25 + запрет pre-load), checklist_list
 * (фильтр статуса), checklist_cancel (NOT_FOUND + happy), чужой бот в update.
 * Секции 10-15 исходного test-autopost-checklist-ops.js, порядок сохранён.
 * Экспортирует run() — хост вызывает сценарии строго по порядку.
 */
import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import { updateChecklistHandler } from '../../mcp/tools/autopost/checklist-update.js';
import { checklistListHandler } from '../../mcp/tools/autopost/checklist-list.js';
import { cancelChecklistHandler } from '../../mcp/tools/autopost/checklist-cancel.js';
import { AutopostService } from '../../services/autopost.service.js';
import {
    capture, assert, makeDb, makeChecklist, makeItem, seedLifecycleBot,
    REQ, BOT_ID, OTHER_BOT_ID, CHANNEL_TG_ID, CL_ID
} from './shared.js';

export async function run() {

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

}
