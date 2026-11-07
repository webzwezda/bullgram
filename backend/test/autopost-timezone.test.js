/**
 * Юнит-тесты чистых функций автопостера: timezone helpers.
 * Запуск: node test/test-autopost-timezone.js
 */
import { getTzOffset, getUtcDateForLocal, getLocalDateParts } from '../services/autopost/timezone.js';

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

console.log('--- timezone.getTzOffset ---');
{
    const msk = getTzOffset(new Date('2026-06-23T12:00:00Z'), 'Europe/Moscow');
    assertEqual(msk, 3 * 60 * 60 * 1000, 'Europe/Moscow offset = +3h');

    const utc = getTzOffset(new Date('2026-06-23T12:00:00Z'), 'UTC');
    assertEqual(utc, 0, 'UTC offset = 0');

    const ny = getTzOffset(new Date('2026-06-23T12:00:00Z'), 'America/New_York');
    assertEqual(ny, -4 * 60 * 60 * 1000, 'America/New_York offset = -4h (DST, June)');

    const bogus = getTzOffset(new Date('2026-06-23T12:00:00Z'), 'Not/A/Real_Zone');
    assertEqual(bogus, 3 * 60 * 60 * 1000, 'Invalid timezone falls back to +3h (Moscow)');
}

console.log('\n--- timezone.getUtcDateForLocal ---');
{
    // 10:00 local Moscow (= UTC+3) → 07:00 UTC
    const result = getUtcDateForLocal(2026, 5, 23, 10, 0, 'Europe/Moscow');
    assertEqual(result.toISOString(), '2026-06-23T07:00:00.000Z', '10:00 MSK → 07:00 UTC');

    // 12:00 UTC for UTC timezone
    const utcResult = getUtcDateForLocal(2026, 5, 23, 12, 0, 'UTC');
    assertEqual(utcResult.toISOString(), '2026-06-23T12:00:00.000Z', '12:00 UTC stays 12:00 UTC');

    // 09:00 New York (EDT, UTC-4 in June) → 13:00 UTC
    const nyResult = getUtcDateForLocal(2026, 5, 23, 9, 0, 'America/New_York');
    assertEqual(nyResult.toISOString(), '2026-06-23T13:00:00.000Z', '09:00 EDT → 13:00 UTC');

    // Midnight MSK → previous day 21:00 UTC
    const midnight = getUtcDateForLocal(2026, 5, 23, 0, 0, 'Europe/Moscow');
    assertEqual(midnight.toISOString(), '2026-06-22T21:00:00.000Z', '00:00 MSK → 21:00 prev day UTC');
}

console.log('\n--- timezone.getLocalDateParts ---');
{
    // 2026-06-23T22:00:00Z = 2026-06-24 in Moscow
    const msk = getLocalDateParts(new Date('2026-06-23T22:00:00Z'), 'Europe/Moscow');
    assertEqual(JSON.stringify(msk), JSON.stringify({ year: 2026, month: 5, day: 24 }), '22:00 UTC → next day in MSK');

    // 2026-06-23T22:00:00Z = still 2026-06-23 in NY (-4)
    const ny = getLocalDateParts(new Date('2026-06-23T22:00:00Z'), 'America/New_York');
    assertEqual(JSON.stringify(ny), JSON.stringify({ year: 2026, month: 5, day: 23 }), '22:00 UTC → same day in EDT');

    // Bogus timezone fallback to UTC parts
    const bogus = getLocalDateParts(new Date('2026-06-23T22:00:00Z'), 'Not/A/Zone');
    assertEqual(JSON.stringify(bogus), JSON.stringify({ year: 2026, month: 5, day: 23 }), 'Invalid tz falls back to UTC date parts');
}

if (failures > 0) {
    console.error(`\n❌ ${failures} test(s) failed`);
    process.exit(1);
}
console.log('\n✅ All timezone tests passed');
