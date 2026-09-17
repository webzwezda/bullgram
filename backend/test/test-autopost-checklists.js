/**
 * Юнит-тесты чек-листов автопостера (офлайн, детерминированные).
 * Запуск: node test/test-autopost-checklists.js
 *
 * Покрывает: рендер (текст+клавиатура, state-эмодзи, атрибуция, капы лейбла),
 * callback_data (pack/parse), валидацию входа (капы), вычисляемый статус,
 * summary-композер, чистую семантику правок (rename/add/remove/reset + события),
 * ветку чек-листа в sender.js (без БД — данные приходят через item.options).
 */
import {
    packCallbackData,
    parseCallbackData,
    buildChecklistMessage,
    renderChecklistSummary,
    validateChecklistInput,
    computeChecklistStatus,
    applyChecklistOps
} from '../services/autopost/checklist.js';
import { sendItemToChannel } from '../services/autopost/sender.js';

let failures = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        failures++;
    }
}

const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID2 = '00000000-0000-4000-8000-000000000001';

console.log('--- checklist.callbackData ---');

assert(packCallbackData(UUID) === `cli:${UUID}`, 'pack → cli:<uuid>');
assert(parseCallbackData(`cli:${UUID}`) === UUID, 'parse roundtrip → uuid');
assert(parseCallbackData('cli:not-a-uuid') === null, 'non-uuid payload → null');
assert(parseCallbackData(`CLI:${UUID}`) === null, 'wrong prefix case → null');
assert(parseCallbackData(`other:${UUID}`) === null, 'foreign prefix → null');
assert(parseCallbackData('') === null, 'empty → null');
assert(parseCallbackData(null) === null, 'null → null');

console.log('--- checklist.buildChecklistMessage: render ---');
{
    const checklist = { title: 'Покупки на завтра' };
    const items = [
        { id: UUID, text: 'картошка', position: 1, is_checked: true, checked_by_name: 'Вася', checked_at: '2026-09-17T10:12:00Z' },
        { id: UUID2, text: 'капуста', position: 2, is_checked: false }
    ];
    const { text, replyMarkup } = buildChecklistMessage(checklist, items, { showNames: true });

    assert(text.startsWith('Покупки на завтра\n'), 'text starts with title');
    assert(text.includes('Выполнено 1 из 2\n'), 'progress line "Выполнено 1 из 2"');
    assert(text.endsWith('Отмечайте выполненное — я запомню кто и когда'), 'hint line at the end');

    const rows = replyMarkup.inline_keyboard;
    assert(rows.length === 2, 'one button row per item');
    const [checkedBtn, uncheckedBtn] = rows.flat();
    assert(checkedBtn.text.startsWith('✅ ') && checkedBtn.text.includes('картошка — Вася'), 'checked: ✅ + name attribution');
    assert(uncheckedBtn.text === '⬜ капуста', 'unchecked: ⬜ plain text');
    assert(checkedBtn.callback_data === `cli:${UUID}`, 'callback_data = cli:<item uuid>');
    assert(uncheckedBtn.callback_data === `cli:${UUID2}`, 'callback_data carries own item id');
}

console.log('--- checklist.buildChecklistMessage: public channel (no names) ---');
{
    const items = [{ id: UUID, text: 'картошка', position: 1, is_checked: true, checked_by_name: 'Вася' }];
    const { replyMarkup } = buildChecklistMessage({ title: 'T' }, items, { showNames: false });
    const btn = replyMarkup.inline_keyboard.flat()[0];
    assert(btn.text === '✅ картошка', 'public channel: checked button without name');
}

console.log('--- checklist.buildChecklistMessage: label caps ---');
{
    const longText = 'а'.repeat(60); // больше капа 48
    const longName = 'б'.repeat(30); // больше капа 24
    const items = [{ id: UUID, text: longText, position: 1, is_checked: true, checked_by_name: longName }];
    const { replyMarkup } = buildChecklistMessage({ title: 'T' }, items, { showNames: true });
    const btn = replyMarkup.inline_keyboard.flat()[0];
    assert(btn.text.length === 64, `label capped at exactly 64 (got ${btn.text.length})`);
    assert(btn.text.startsWith('✅ '), 'capped label keeps checked emoji');
    assert(btn.text.includes(' — '), 'capped label keeps name attribution');

    // Неотмеченный длинный пункт тоже в капе.
    const items2 = [{ id: UUID, text: longText, position: 1, is_checked: false }];
    const { replyMarkup: rm2 } = buildChecklistMessage({ title: 'T' }, items2, { showNames: true });
    const btn2 = rm2.inline_keyboard.flat()[0];
    assert(btn2.text.length <= 64 && btn2.text.startsWith('⬜ '), `unchecked long label capped (got ${btn2.text.length})`);
    assert(btn2.text.slice(2).length === 48, 'item text truncated to 48 chars');
}

console.log('--- checklist.validateChecklistInput ---');
{
    assert(validateChecklistInput({ title: 'Покупки', items: ['картошка', ' капуста '] }).ok === true, 'valid input → ok');
    assert(validateChecklistInput({ title: '', items: ['один пункт'] }).ok === true, 'empty title allowed (0-200)');
    assert(validateChecklistInput({ title: undefined, items: ['один'] }).ok === true, 'missing title allowed');
    assert(validateChecklistInput({ title: 'T', items: ['a'], dedupKey: 'daily-2026-09-17' }).ok === true, 'dedup_key ok');

    assert(validateChecklistInput({ title: 'T', items: [] }).ok === false, '0 items → error');
    assert(validateChecklistInput({ title: 'T', items: undefined }).ok === false, 'missing items → error');
    assert(validateChecklistInput({ title: 'T', items: Array.from({ length: 26 }, (_, i) => `п${i}`) }).ok === false, '26 items → error');
    assert(validateChecklistInput({ title: 'T', items: ['   '] }).ok === false, 'whitespace-only item → error');
    assert(validateChecklistInput({ title: 'T', items: ['б'.repeat(101)] }).ok === false, 'item text 101 chars → error');
    assert(validateChecklistInput({ title: 'T', items: ['б'.repeat(100)] }).ok === true, 'item text exactly 100 → ok');
    assert(validateChecklistInput({ title: 'д'.repeat(201), items: ['a'] }).ok === false, 'title 201 chars → error');
    assert(validateChecklistInput({ title: 'д'.repeat(200), items: ['a'] }).ok === true, 'title exactly 200 → ok');
    assert(validateChecklistInput({ title: 'T', items: ['a'], dedupKey: 'x'.repeat(129) }).ok === false, 'dedup_key 129 chars → error');
    assert(validateChecklistInput({ title: 'T', items: ['a'], dedupKey: 'x'.repeat(128) }).ok === true, 'dedup_key exactly 128 → ok');
}

console.log('--- checklist.computeChecklistStatus ---');
{
    assert(computeChecklistStatus({}) === 'active', 'no dates → active');
    assert(computeChecklistStatus({ expires_at: '2999-01-01T00:00:00Z' }) === 'active', 'future expiry → active');
    assert(computeChecklistStatus({ expires_at: '2020-01-01T00:00:00Z' }) === 'expired', 'past expiry → expired');
    assert(computeChecklistStatus({ cancelled_at: '2020-01-01T00:00:00Z' }) === 'cancelled', 'cancelled_at → cancelled');
    assert(
        computeChecklistStatus({ cancelled_at: '2020-01-01T00:00:00Z', expires_at: '2019-01-01T00:00:00Z' }) === 'cancelled',
        'cancelled wins over expired (закрытый список не воскресает по TTL)'
    );
    assert(computeChecklistStatus(null) === 'active', 'null → active (safe)');
}

console.log('--- checklist.renderChecklistSummary ---');
{
    const checklist = { title: 'Покупки' };
    const items = [
        { text: 'картошка', position: 1, is_checked: true, checked_by_name: 'Вася', checked_at: '2026-09-17T10:12:00Z' },
        { text: 'капуста', position: 2, is_checked: false },
        { text: 'молоко', position: 3, is_checked: true, checked_by_name: 'Маша', checked_at: '2026-09-17T08:05:00Z' }
    ];
    const summary = renderChecklistSummary(checklist, items);
    assert(summary.startsWith('Итог: 2 из 3 — '), 'summary head "Итог: 2 из 3"');
    assert(summary.includes('картошка ✅ (Вася, 10:12)'), 'checked with name + HH:MM');
    assert(summary.includes('капуста ⬜'), 'unchecked plain');
    assert(summary.includes('молоко ✅ (Маша, 08:05)'), 'second checked item');

    const noChecks = renderChecklistSummary(checklist, [
        { text: 'картошка', position: 1, is_checked: false }
    ]);
    assert(noChecks === 'Итог: 0 из 1 — картошка ⬜', 'zero checked → "0 из 1"');

    const anonymous = renderChecklistSummary(checklist, [
        { text: 'картошка', position: 1, is_checked: true }
    ]);
    assert(anonymous.includes('картошка ✅'), 'checked without name/attribution → plain ✅');
}

console.log('--- checklist.applyChecklistOps ---');
{
    const itemA = { id: UUID, text: 'картошка', position: 1, is_checked: true, checked_by_tg_id: 111, checked_by_name: 'Вася', checked_at: '2026-09-17T10:12:00Z' };
    const itemB = { id: UUID2, text: 'капуста', position: 2, is_checked: false, checked_by_tg_id: null, checked_by_name: null, checked_at: null };
    const base = [itemA, itemB];

    // rename по item_id переносит текст, отметка остаётся на своём месте.
    const renamed = applyChecklistOps(base, { rename: [{ item_id: UUID, text: ' Молодой картофель ' }] });
    assert(renamed.items.find(i => i.id === UUID).text === 'Молодой картофель', 'rename updates text (trimmed)');
    assert(renamed.items.find(i => i.id === UUID).is_checked === true, 'rename preserves check on renamed item');
    assert(renamed.items.find(i => i.id === UUID).checked_by_name === 'Вася', 'rename preserves attribution');
    assert(JSON.stringify(renamed.events) === JSON.stringify([{ item_id: UUID, action: 'renamed' }]), 'rename → single renamed event');

    // add: позиция = max+1, две добавки подряд → max+1 и max+2.
    const added = applyChecklistOps(base, { add: ['хлеб', 'молоко'] });
    const addedSorted = [...added.items].sort((a, b) => a.position - b.position);
    assert(added.items.length === 4, 'add appends items');
    assert(addedSorted[2].position === 3 && addedSorted[2].text === 'хлеб', 'first add → position max+1');
    assert(addedSorted[3].position === 4 && addedSorted[3].text === 'молоко', 'second add → position max+2');
    assert(addedSorted[2].is_checked === false, 'added item starts unchecked');
    assert(added.events.every(e => e.action === 'added') && added.events.length === 2, 'adds → added events');
    assert(parseCallbackData(packCallbackData(added.events[0].item_id)) === added.events[0].item_id, 'added ids are valid uuids');

    // remove по item_id.
    const removed = applyChecklistOps(base, { remove: [UUID] });
    assert(removed.items.length === 1 && removed.items[0].id === UUID2, 'remove drops the right item');
    assert(JSON.stringify(removed.events) === JSON.stringify([{ item_id: UUID, action: 'removed' }]), 'remove → removed event with item_id');

    // reset: снимает отметки и атрибуцию у всех.
    const reset = applyChecklistOps(base, { reset: true });
    assert(reset.items.every(i => i.is_checked === false), 'reset unchecks all');
    assert(reset.items.every(i => i.checked_by_tg_id === null && i.checked_by_name === null && i.checked_at === null), 'reset clears attribution');
    assert(JSON.stringify(reset.events) === JSON.stringify([{ item_id: null, action: 'reset' }]), 'reset → single reset event (no item_id)');

    // Комбинированный порядок применения: reset → remove → rename → add.
    const combo = applyChecklistOps(base, {
        reset: true,
        remove: [UUID],
        rename: [{ item_id: UUID2, text: 'цветная капуста' }],
        add: ['хлеб']
    });
    assert(JSON.stringify(combo.events.map(e => e.action)) === JSON.stringify(['reset', 'removed', 'renamed', 'added']), 'ops applied in fixed order with matching event names');
    assert(combo.items.length === 2, 'combo result: 1 kept + 1 added');

    // Пустые ops — no-op.
    const noop = applyChecklistOps(base, {});
    assert(noop.items.length === 2 && noop.events.length === 0, 'no ops → no changes, no events');

    // Чужой/несуществующий item_id → ITEM_NOT_FOUND.
    const strangerId = '99999999-9999-4999-8999-999999999999';
    let renameThrow = false;
    try { applyChecklistOps(base, { rename: [{ item_id: strangerId, text: 'x' }] }); } catch (e) { renameThrow = e.message === 'ITEM_NOT_FOUND'; }
    assert(renameThrow, 'rename unknown id → ITEM_NOT_FOUND');

    let removeThrow = false;
    try { applyChecklistOps(base, { remove: [strangerId] }); } catch (e) { removeThrow = e.message === 'ITEM_NOT_FOUND'; }
    assert(removeThrow, 'remove unknown id → ITEM_NOT_FOUND');

    // Удалённый в том же вызове id больше не переименовать (remove → rename).
    let removedThenRenamed = false;
    try { applyChecklistOps(base, { remove: [UUID], rename: [{ item_id: UUID, text: 'x' }] }); } catch (e) { removedThenRenamed = e.message === 'ITEM_NOT_FOUND'; }
    assert(removedThenRenamed, 'remove before rename: renaming removed id → ITEM_NOT_FOUND');
}

console.log('--- sender.sendItemToChannel: checklist branch ---');
{
    let captured = null;
    const fakeTelegram = {
        async sendMessage(chatId, text, extra) {
            captured = { chatId, text, extra };
            return { message_id: 777 };
        }
    };
    const checklist = { title: 'Покупки на завтра' };
    const items = [
        { id: UUID, text: 'картошка', position: 1, is_checked: true, checked_by_name: 'Вася' },
        { id: UUID2, text: 'капуста', position: 2, is_checked: false }
    ];
    const item = {
        media_type: 'checklist',
        options: { checklist, items, showNames: true }
    };
    const ids = await sendItemToChannel(fakeTelegram, '-100123', item, { channel: null });

    assert(JSON.stringify(ids) === '[777]', 'returns [message_id]');
    assert(captured.chatId === '-100123', 'sends to target chat');
    assert(captured.text.includes('Покупки на завтра') && captured.text.includes('Выполнено 1 из 2'), 'message text = checklist render');
    assert(JSON.stringify(captured.extra) === JSON.stringify({ reply_markup: buildChecklistMessage(checklist, items, { showNames: true }).replyMarkup }), 'reply_markup = checklist keyboard, no parse_mode / channel buttons');
    assert(captured.extra.reply_markup.inline_keyboard.length === 2, 'keyboard has one button per item');
}

console.log('--- sender.sendItemToChannel: checklist without options (defensive) ---');
{
    let called = false;
    const fakeTelegram = {
        async sendMessage(chatId, text, extra) {
            called = true;
            return { message_id: 1 };
        }
    };
    const ids = await sendItemToChannel(fakeTelegram, '-100123', { media_type: 'checklist' }, {});
    assert(called && JSON.stringify(ids) === '[1]', 'no options → still renders, no crash');
}

if (failures > 0) {
    console.error(`\n❌ ${failures} test(s) failed`);
    process.exit(1);
}
console.log('\n✅ All checklist tests passed');
