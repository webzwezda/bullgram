/**
 * Юнит-тесты delta-логики подсчёта реакций.
 * Запуск: node test/test-autopost-reactions.js
 *
 * Telegram присылает message_reaction индивидуально для каждого юзера:
 *   old_reaction: []       new_reaction: [{type:'👍'}]  → +1
 *   old_reaction: [{👍}]   new_reaction: []             → -1
 *   old_reaction: [{👍}]   new_reaction: [{❤️}]         →  0 (замена эмодзи)
 *   old_reaction: []       new_reaction: []             →  0 (no-op)
 */
import { computeReactionDelta } from '../services/autopost/handlers/reactions.js';

let failures = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        failures++;
    }
}

console.log('--- reactions.computeReactionDelta ---');

assert(computeReactionDelta({ old_reaction: [], new_reaction: [{ type: '👍' }] }) === 1, 'empty → reaction: +1');
assert(computeReactionDelta({ old_reaction: [{ type: '👍' }], new_reaction: [] }) === -1, 'reaction → empty: -1');
assert(computeReactionDelta({ old_reaction: [{ type: '👍' }], new_reaction: [{ type: '❤️' }] }) === 0, 'replace emoji: 0');
assert(computeReactionDelta({ old_reaction: [], new_reaction: [] }) === 0, 'empty → empty: 0');
assert(computeReactionDelta({ old_reaction: undefined, new_reaction: [{ type: '🔥' }] }) === 1, 'missing old_reaction treated as empty: +1');
assert(computeReactionDelta({ old_reaction: [{ type: '🔥' }], new_reaction: undefined }) === -1, 'missing new_reaction treated as empty: -1');
assert(computeReactionDelta({}) === 0, 'no fields: 0');
assert(computeReactionDelta(null) === 0, 'null safe: 0');

// Several emojis at once (paid Telegram premium reactions) — still +1, один юзер = один счётчик.
assert(computeReactionDelta({ old_reaction: [], new_reaction: [{ type: '👍' }, { type: '❤️' }] }) === 1, 'multi-emoji reaction counts as +1');

if (failures > 0) {
    console.error(`\n❌ ${failures} test(s) failed`);
    process.exit(1);
}
console.log('\n✅ All reactions tests passed');
