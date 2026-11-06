/**
 * Общие счётчики и ассерты для сценариев test-mcp-shared.
 * Живые биндинги: counters мутируется по мере проверок, хост-файл
 * (test/test-mcp-shared.js) читает его в финальной сводке.
 */
export const counters = { passes: 0, failures: 0 };

export function ok(label) {
  counters.passes++;
  console.log(`  ✓ ${label}`);
}
export function fail(label, expected, actual) {
  counters.failures++;
  console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
}
export function assertEqual(actual, expected, label) {
  const a = actual instanceof Date ? actual.toISOString() : actual;
  const e = expected instanceof Date ? expected.toISOString() : expected;
  if (JSON.stringify(a) === JSON.stringify(e)) ok(label);
  else fail(label, e, a);
}
export function assertThrows(fn, predicate, label) {
  try {
    fn();
    fail(label, 'throw', 'no throw');
  } catch (e) {
    if (predicate(e)) ok(label);
    else fail(label, 'matching error', e?.message || String(e));
  }
}
export async function assertRejects(promiseFactory, predicate, label) {
  try {
    await promiseFactory();
    fail(label, 'throw', 'no throw');
  } catch (e) {
    if (predicate(e)) ok(label);
    else fail(label, 'matching error', e?.message || String(e));
  }
}
