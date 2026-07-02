/**
 * Юнит-тесты компилятора "Лучшее за месяц".
 * Запуск: node test/test-autopost-bestof.js
 *
 * Покрывает monthBoundsUtc (границы месяца по UTC), composeBestOfMonth
 * (фильтр по каналу/статусу/media_type, сортировка, лимит) и formatMonthLabel.
 */
import { composeBestOfMonth, monthBoundsUtc, formatMonthLabel } from '../services/autopost/best-of.js';

let failures = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        failures++;
    }
}

console.log('--- best-of.monthBoundsUtc ---');
{
    const jan = monthBoundsUtc(2026, 1);
    assert(jan.start === '2026-01-01T00:00:00.000Z', 'Jan start UTC');
    assert(jan.end === '2026-02-01T00:00:00.000Z', 'Jan end → Feb start UTC');

    const dec = monthBoundsUtc(2025, 12);
    assert(dec.start === '2025-12-01T00:00:00.000Z', 'Dec start UTC');
    assert(dec.end === '2026-01-01T00:00:00.000Z', 'Dec end → Jan next year UTC');

    // Feb leap year 2028
    const feb2028 = monthBoundsUtc(2028, 2);
    assert(feb2028.start === '2028-02-01T00:00:00.000Z', 'Feb 2028 start');
    assert(feb2028.end === '2028-03-01T00:00:00.000Z', 'Feb 2028 end (leap)');
}

console.log('\n--- best-of.formatMonthLabel ---');
{
    assert(formatMonthLabel(2026, 1) === 'Январь 2026', 'Jan label');
    assert(formatMonthLabel(2026, 12) === 'Декабрь 2026', 'Dec label');
    assert(formatMonthLabel(2026, 6) === 'Июнь 2026', 'Jun label');
}

console.log('\n--- best-of.composeBestOfMonth ---');

// Mock supabase: цепочка методов, накапливающая фильтры, thenable на конце.
function makeMock(rows) {
    const calls = { eqs: [], gts: [], gtes: [], lts: [], orders: [] };
    const chain = {
        _rows: rows,
        from() { return chain; },
        select() { return chain; },
        eq(field, value) { calls.eqs.push([field, value]); return chain; },
        gt(field, value) { calls.gts.push([field, value]); return chain; },
        gte(field, value) { calls.gtes.push([field, value]); return chain; },
        lt(field, value) { calls.lts.push([field, value]); return chain; },
        order(field, opts) { calls.orders.push([field, opts]); return chain; },
        then(resolve) {
            resolve({ data: chain._rows, error: null });
        },
        _calls: calls
    };
    return chain;
}

// Happy path: 3 поста-фото, разные реакции — сортировка по reaction_total DESC.
{
    const rows = [
        { id: 'a', file_id: 'f1', file_ids: [], caption: 'low', reaction_total: 5, posted_at: '2026-06-01T10:00:00Z', media_type: 'photo' },
        { id: 'b', file_id: 'f2', file_ids: [], caption: 'high', reaction_total: 50, posted_at: '2026-06-15T10:00:00Z', media_type: 'photo' },
        { id: 'c', file_id: 'f3', file_ids: [], caption: 'mid', reaction_total: 25, posted_at: '2026-06-20T10:00:00Z', media_type: 'photo' }
    ];
    // Presort simulating DB: DESC by reaction_total, ASC by posted_at
    rows.sort((a, b) => b.reaction_total - a.reaction_total);
    const mock = makeMock(rows);
    const { items, totalWithReactions } = await composeBestOfMonth(mock, 'bot-1', 'chan-1', 2026, 6);

    assert(items.length === 3, 'returns 3 items');
    assert(items[0].id === 'b', 'highest reactions first (50)');
    assert(items[1].id === 'c', 'mid next (25)');
    assert(items[2].id === 'a', 'low last (5)');
    assert(totalWithReactions === 3, 'totalWithReactions counts all');

    // Verify the query chain hit the right filters.
    const eqFields = mock._calls.eqs.map(([f]) => f);
    assert(eqFields.includes('bot_id'), 'filter by bot_id');
    assert(eqFields.includes('target_channel_id'), 'filter by target_channel_id');
    assert(eqFields.includes('status'), 'filter by status=posted');
    assert(mock._calls.gtes.length === 1 && mock._calls.gtes[0][0] === 'posted_at', 'gte posted_at (start of month)');
    assert(mock._calls.lts.length === 1 && mock._calls.lts[0][0] === 'posted_at', 'lt posted_at (end of month)');
    assert(mock._calls.gts.length === 1 && mock._calls.gts[0][0] === 'reaction_total', 'gt reaction_total > 0');
}

// Фильтрация: только посты с медиа-файлом; video/animation тоже проходят (Фаза 2).
{
    const rows = [
        { id: 'photo1', file_id: 'f1', file_ids: [], caption: 'photo', reaction_total: 10, posted_at: '2026-06-01T10:00:00Z', media_type: 'photo' },
        { id: 'video1', file_id: 'f2', file_ids: [], caption: 'video', reaction_total: 100, posted_at: '2026-06-02T10:00:00Z', media_type: 'video' },
        { id: 'anim1', file_id: 'f3', file_ids: [], caption: 'gif', reaction_total: 80, posted_at: '2026-06-03T10:00:00Z', media_type: 'animation' },
        { id: 'text1', file_id: null, file_ids: [], caption: 'text only', reaction_total: 90, posted_at: '2026-06-04T10:00:00Z', media_type: 'photo' }
    ];
    // Mock не сортирует реально — претордерим так, как БД вернула бы (DESC reactions).
    rows.sort((a, b) => b.reaction_total - a.reaction_total);
    const { items, totalWithReactions } = await composeBestOfMonth(makeMock(rows), 'bot-1', 'chan-1', 2026, 6);

    // text1 (без file_id) исключается; photo/video/animation остаются.
    assert(items.length === 3, 'photo + video + animation qualify, text-only excluded');
    assert(items[0].id === 'video1', 'video1 has top reactions (100)');
    assert(items[1].id === 'anim1', 'anim1 next (80)');
    assert(items[2].id === 'photo1', 'photo1 last (10)');
    assert(totalWithReactions === 4, 'totalWithReactions counts pre-filter (4)');
}

// Лимит 10: при 15 постах возвращаем ровно 10, totalWithReactions = 15.
{
    const rows = Array.from({ length: 15 }, (_, i) => ({
        id: `p${i}`,
        file_id: `f${i}`,
        file_ids: [],
        caption: '',
        reaction_total: 100 - i,
        posted_at: `2026-06-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
        media_type: 'photo'
    }));
    const { items, totalWithReactions } = await composeBestOfMonth(makeMock(rows), 'bot-1', 'chan-1', 2026, 6);
    assert(items.length === 10, 'limited to 10');
    assert(totalWithReactions === 15, 'totalWithReactions reports full count');
    assert(items[0].reaction_total === 100, 'highest reactions first');
    assert(items[9].reaction_total === 91, '10th item is 91');
}

// Пустой месяц.
{
    const { items, totalWithReactions } = await composeBestOfMonth(makeMock([]), 'bot-1', 'chan-1', 2026, 6);
    assert(items.length === 0, 'empty month → empty items');
    assert(totalWithReactions === 0, 'empty month → total 0');
}

if (failures > 0) {
    console.error(`\n❌ ${failures} test(s) failed`);
    process.exit(1);
}
console.log('\n✅ All best-of tests passed');
