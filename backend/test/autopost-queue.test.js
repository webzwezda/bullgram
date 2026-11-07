/**
 * Юнит-тесты чистой логики очереди автопостера.
 * Запуск: node test/test-autopost-queue.js
 *
 * Покрывает только getNextSlots — scheduleNextBatch/collapseQueue/getStats
 * требуют supabase-клиента и тестируются в интеграционном режиме.
 */
import { getNextSlots } from '../services/autopost/queue.js';

let failures = 0;
function assertEqual(actual, expected, label) {
    const a = actual instanceof Date ? actual.toISOString() : actual;
    const e = expected instanceof Date ? expected.toISOString() : expected;
    if (a === e) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`);
        failures++;
    }
}

console.log('--- queue.getNextSlots: основная логика ---');
{
    // 2026-06-23 12:00 UTC = 15:00 MSK. Канал с 2 постами в 10:00 и 18:00 MSK.
    // Слоты должны идти с 18:00 MSK (=15:00 UTC) сегодняшнего дня, затем 10:00/18:00 следующих.
    const after = new Date('2026-06-23T12:00:00Z');
    const slots = getNextSlots(after, 2, ['10:00', '18:00'], 'Europe/Moscow', 4);
    assertEqual(slots[0], new Date('2026-06-23T15:00:00.000Z'), 'First slot = 18:00 MSK same day');
    assertEqual(slots[1], new Date('2026-06-24T07:00:00.000Z'), 'Second slot = 10:00 MSK next day');
    assertEqual(slots[2], new Date('2026-06-24T15:00:00.000Z'), 'Third slot = 18:00 MSK next day');
    assertEqual(slots[3], new Date('2026-06-25T07:00:00.000Z'), 'Fourth slot = 10:00 MSK day after');
}

console.log('\n--- queue.getNextSlots: кап по postsPerDay ---');
{
    // Указано 3 времени, но postsPerDay=1 — берём только первое (раньше по sort).
    const after = new Date('2026-06-23T00:00:00Z');
    const slots = getNextSlots(after, 1, ['18:00', '10:00', '14:00'], 'Europe/Moscow', 3);
    // sortedPostingTimes = ['10:00', '14:00', '18:00'], slice(0, 1) = ['10:00']
    assertEqual(slots[0], new Date('2026-06-23T07:00:00.000Z'), 'Only 10:00 slot used (10:00 MSK = 07:00 UTC)');
    assertEqual(slots[1], new Date('2026-06-24T07:00:00.000Z'), 'Next day 10:00 MSK');
    assertEqual(slots[2], new Date('2026-06-25T07:00:00.000Z'), 'Day after 10:00 MSK');
}

console.log('\n--- queue.getNextSlots: пустой postingTimes fallback ---');
{
    const after = new Date('2026-06-23T12:00:00Z');
    const slots = getNextSlots(after, 1, [], 'UTC', 1);
    assertEqual(slots[0], new Date('2026-06-24T12:00:00.000Z'), 'Empty times → fallback 12:00 UTC next day');
}

console.log('\n--- queue.getNextSlots: post сразу после слота ---');
{
    // after = точно время слота → слот пропускается (строгое >)
    const after = new Date('2026-06-23T07:00:00.000Z'); // 10:00 MSK exact
    const slots = getNextSlots(after, 1, ['10:00'], 'Europe/Moscow', 1);
    assertEqual(slots[0], new Date('2026-06-24T07:00:00.000Z'), 'Equal time → next day (strict >)');
}

console.log('\n--- queue.getNextSlots: переход через месяц ---');
{
    const after = new Date('2026-06-30T20:00:00Z');
    const slots = getNextSlots(after, 1, ['10:00'], 'Europe/Moscow', 2);
    assertEqual(slots[0], new Date('2026-07-01T07:00:00.000Z'), 'Last day of June → July 1');
    assertEqual(slots[1], new Date('2026-07-02T07:00:00.000Z'), 'Then July 2');
}

if (failures > 0) {
    console.error(`\n❌ ${failures} test(s) failed`);
    process.exit(1);
}
console.log('\n✅ All queue tests passed');
