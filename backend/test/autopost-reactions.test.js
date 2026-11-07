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
import { computeReactionDelta, buildSeedReactionAttempts, buildSeedReactionPlans, normalizeSeedEmojiList } from '../services/autopost/handlers/reactions.js';

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

console.log('--- reactions.buildSeedReactionAttempts ---');

// U+FE0F (VS16) вырезается: Telegram ждёт каноничное '❤', с VS16 даёт REACTION_INVALID.
assert(JSON.stringify(buildSeedReactionAttempts('❤️')) === JSON.stringify(['❤']), '❤️ → [❤] (VS16 stripped)');
assert(JSON.stringify(buildSeedReactionAttempts('👎,👍')) === JSON.stringify(['👎', '👍']), 'plain pair preserved in order');
assert(JSON.stringify(buildSeedReactionAttempts('❤️, 👍 ,❤️')) === JSON.stringify(['❤', '👍']), 'trim + strip + dedupe: [❤,👍]');
assert(JSON.stringify(buildSeedReactionAttempts('')) === JSON.stringify([]), 'empty string → []');
assert(JSON.stringify(buildSeedReactionAttempts(null)) === JSON.stringify([]), 'null → []');
assert(JSON.stringify(buildSeedReactionAttempts(undefined)) === JSON.stringify([]), 'undefined → []');
assert(buildSeedReactionAttempts('👍,👎,🔥,🥰,🎉').length === 3, '5 emojis capped to 3 (maxAttempts default)');
assert(JSON.stringify(buildSeedReactionAttempts('👍,👎,🔥,🥰', { maxAttempts: 2 })) === JSON.stringify(['👍', '👎']), 'custom maxAttempts respected');
assert(JSON.stringify(buildSeedReactionAttempts('👍,, ,👎')) === JSON.stringify(['👍', '👎']), 'empty items dropped');
assert(JSON.stringify(buildSeedReactionAttempts('👍,👍,👍')) === JSON.stringify(['👍']), 'dedupe of identical emojis');
assert(buildSeedReactionAttempts(',,,').length === 0, 'only separators → no attempts, Telegram not called');

console.log('--- reactions.buildSeedReactionPlans ---');

// non-premium — прежнее поведение: одиночные попытки (лимит бота без премиума — 1 реакция).
assert(JSON.stringify(buildSeedReactionPlans(['👍', '🔥', '❤'])) === JSON.stringify([['👍'], ['🔥'], ['❤']]), 'non-premium → singles');
assert(JSON.stringify(buildSeedReactionPlans(['👍', '🔥', '❤'], { premium: false })) === JSON.stringify([['👍'], ['🔥'], ['❤']]), 'explicit premium:false → singles');
// premium — setMessageReaction заменяет предыдущий набор, поэтому попытка = один
// вызов со списком; деградация по префиксам вниз до одиночного.
assert(JSON.stringify(buildSeedReactionPlans(['👍', '🔥', '❤'], { premium: true })) === JSON.stringify([['👍', '🔥', '❤'], ['👍', '🔥'], ['👍']]), 'premium 3 → prefixes [[3],[2],[1]]');
assert(JSON.stringify(buildSeedReactionPlans(['👍', '🔥'], { premium: true })) === JSON.stringify([['👍', '🔥'], ['👍']]), 'premium 2 → prefixes [[2],[1]]');
assert(JSON.stringify(buildSeedReactionPlans(['👍'], { premium: true })) === JSON.stringify([['👍']]), 'premium 1 → single plan');
assert(JSON.stringify(buildSeedReactionPlans([], { premium: true })) === JSON.stringify([]), 'premium 0 → [] (Telegram not called)');
assert(JSON.stringify(buildSeedReactionPlans([], { premium: false })) === JSON.stringify([]), 'non-premium 0 → [] (Telegram not called)');
// Толерантность к сырой строке из настроек (нормальный путь — готовый список).
assert(JSON.stringify(buildSeedReactionPlans('❤️, 👍', { premium: true })) === JSON.stringify([['❤', '👍'], ['❤']]), 'raw string input normalized');

console.log('--- reactions.normalizeSeedEmojiList ---');

assert(normalizeSeedEmojiList('❤️,👍') === '❤,👍', 'normalized DB string: ❤️,👍 → ❤,👍');
assert(normalizeSeedEmojiList('') === '', 'empty string → empty string');
assert(normalizeSeedEmojiList(null) === '', 'null → empty string');
assert(normalizeSeedEmojiList('👍,👎,🔥,🥰,🎉') === '👍,👎,🔥', 'DB string capped to 3');

if (failures > 0) {
    console.error(`\n❌ ${failures} test(s) failed`);
    process.exit(1);
}
console.log('\n✅ All reactions tests passed');
