/**
 * Юнит-тесты для monthBoundsInTz и classifyMonthInTz.
 * Запуск: node test/test-autopost-tz-bounds.js
 *
 * Покрывает UTC, Europe/Moscow (UTC+3 без DST), Asia/Vladivostok (UTC+10),
 * годовой переход (December → January).
 */
import { monthBoundsInTz, classifyMonthInTz } from '../services/autopost/timezone.js';

let failures = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        failures++;
    }
}

console.log('--- timezone.monthBoundsInTz ---');

// UTC: 1-й день месяца == 1-й день месяца, никаких сдвигов.
{
    const jan = monthBoundsInTz(2026, 1, 'UTC');
    assert(jan.start === '2026-01-01T00:00:00.000Z', 'UTC Jan start');
    assert(jan.end === '2026-02-01T00:00:00.000Z', 'UTC Jan end');

    const dec = monthBoundsInTz(2025, 12, 'UTC');
    assert(dec.start === '2025-12-01T00:00:00.000Z', 'UTC Dec start');
    assert(dec.end === '2026-01-01T00:00:00.000Z', 'UTC Dec end → next year');
}

// Europe/Moscow = UTC+3, без DST.
// 2026-06-01 00:00 MSK == 2026-05-31 21:00 UTC
{
    const juneMsk = monthBoundsInTz(2026, 6, 'Europe/Moscow');
    assert(juneMsk.start === '2026-05-31T21:00:00.000Z', 'MSK June start = May 31 21:00 UTC');
    assert(juneMsk.end === '2026-06-30T21:00:00.000Z', 'MSK June end = Jun 30 21:00 UTC');
}

// Asia/Vladivostok = UTC+10.
// 2026-06-01 00:00 VLK == 2026-05-31 14:00 UTC
{
    const juneVlk = monthBoundsInTz(2026, 6, 'Asia/Vladivostok');
    assert(juneVlk.start === '2026-05-31T14:00:00.000Z', 'Vladivostok June start = May 31 14:00 UTC');
    assert(juneVlk.end === '2026-06-30T14:00:00.000Z', 'Vladivostok June end = Jun 30 14:00 UTC');
}

// December → January rollover в Moscow tz.
{
    const decMsk = monthBoundsInTz(2025, 12, 'Europe/Moscow');
    assert(decMsk.start === '2025-11-30T21:00:00.000Z', 'MSK Dec 2025 start = Nov 30 21:00 UTC');
    assert(decMsk.end === '2025-12-31T21:00:00.000Z', 'MSK Dec 2025 end = Dec 31 21:00 UTC');
}

// February in leap year (2028) — 29 дней.
{
    const febUtc = monthBoundsInTz(2028, 2, 'UTC');
    assert(febUtc.start === '2028-02-01T00:00:00.000Z', 'UTC Feb 2028 start');
    assert(febUtc.end === '2028-03-01T00:00:00.000Z', 'UTC Feb 2028 end = Mar 1 (leap)');
}

// Fallback: невалидная tz → getTzOffset возвращает Moscow (+3) из своего catch.
// Не падает, отдаёт какой-то валидный диапазон.
{
    const bounds = monthBoundsInTz(2026, 6, 'NotARealTimezone/XXX');
    assert(bounds.start.startsWith('2026-0'), 'invalid tz does not crash (start sane year/month)');
    assert(bounds.end > bounds.start, 'invalid tz: end > start');
}

// Default (no tz) → UTC.
{
    const noTz = monthBoundsInTz(2026, 6);
    assert(noTz.start === '2026-05-31T21:00:00.000Z' || noTz.start === '2026-06-01T00:00:00.000Z',
        'no-tz default behaves like UTC or MSK (depends on env default)');
}

console.log('\n--- timezone.classifyMonthInTz ---');

// Классификация в UTC.
assert(classifyMonthInTz('2026-06-15T10:00:00Z', 'UTC') === '2026-06', 'UTC mid-June → 2026-06');
assert(classifyMonthInTz('2026-06-01T00:00:00Z', 'UTC') === '2026-06', 'UTC June 1 start → 2026-06');
assert(classifyMonthInTz('2026-05-31T23:59:59Z', 'UTC') === '2026-05', 'UTC May 31 end → 2026-05');

// Классификация в Moscow: 2026-06-01 00:00 MSK = 2026-05-31 21:00 UTC → локально июнь.
assert(classifyMonthInTz('2026-05-31T21:00:00Z', 'Europe/Moscow') === '2026-06', 'MSK: UTC May 31 21:00 → local June');
assert(classifyMonthInTz('2026-05-31T20:59:59Z', 'Europe/Moscow') === '2026-05', 'MSK: UTC May 31 20:59 → local May');

// Классификация во Vladivostok: UTC+10.
assert(classifyMonthInTz('2026-05-31T14:00:00Z', 'Asia/Vladivostok') === '2026-06', 'Vladivostok: UTC May 31 14:00 → local June');
assert(classifyMonthInTz('2026-05-31T13:59:59Z', 'Asia/Vladivostok') === '2026-05', 'Vladivostok: UTC May 31 13:59 → local May');

// Edge: невалидная дата → null.
assert(classifyMonthInTz('not-a-date', 'UTC') === null, 'invalid date → null');
assert(classifyMonthInTz(null, 'UTC') === null, 'null date → null');

if (failures > 0) {
    console.error(`\n❌ ${failures} test(s) failed`);
    process.exit(1);
}
console.log('\n✅ All tz-bounds tests passed');
