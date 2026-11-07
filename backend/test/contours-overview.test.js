/**
 * Offline tests for GET /api/official-bot/contours actor-rights grouping.
 * Запуск: node test/test-contours-overview.js
 *
 * Strategy: no network, no Supabase, no Telegram traffic.
 * Только чистая функция buildActorRightsByTarget из routes/official-bot.routes.js:
 *   - пустой/битый вход → {}
 *   - группировка по 4 каноническим target'ам контура
 *   - сортировка: official_bot первым, дальше юзерботы; внутри типа — свежий checked_at первым
 *   - отсутствие checked_at трактуется как самая старая запись
 *   - форма элемента строго { actor_type, actor_id, state, is_admin, checked_at },
 *     is_admin приводится к boolean, лишние поля отбрасываются
 */
import { buildActorRightsByTarget } from '../routes/official-bot.routes.js';

let failures = 0;
let passes = 0;
function ok(label) { passes++; console.log(`  ✓ ${label}`); }
function fail(label, expected, actual) {
  failures++;
  console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
}
function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
  else fail(label, expected, actual);
}

// --- пустые и битые входы ---
assertEqual(buildActorRightsByTarget([]), {}, 'пустой массив → пустой объект');
assertEqual(buildActorRightsByTarget(null), {}, 'null → пустой объект (fail-soft)');
assertEqual(buildActorRightsByTarget(undefined), {}, 'undefined → пустой объект (fail-soft)');
assertEqual(buildActorRightsByTarget('nope'), {}, 'строка вместо массива → пустой объект (fail-soft)');
assertEqual(
  buildActorRightsByTarget([{ actor_type: 'userbot', actor_id: 'u1', state: 'ok', is_admin: true, checked_at: null, target: '   ' }]),
  {},
  'строка с пустым target не попадает в результат'
);

// --- группировка по 4 каноническим target'ам ---
const FOUR_TARGETS = ['public_channel', 'paid_channel', 'public_chat', 'paid_chat'];
const rowsAllTargets = FOUR_TARGETS.map((target, idx) => ({
  bot_id: 'b1',
  actor_type: 'official_bot',
  actor_id: 'bot-1',
  target,
  state: 'ok',
  is_admin: true,
  checked_at: `2026-09-16T10:0${idx}:00Z`
}));
const groupedAll = buildActorRightsByTarget(rowsAllTargets);
assertEqual(Object.keys(groupedAll).sort(), [...FOUR_TARGETS].sort(), 'группировка по всем 4 target\'ам контура');
assertEqual(groupedAll.public_channel.length, 1, 'в каждой группе по одному актору');

// --- сортировка: official_bot первым, юзерботы следом, свежий checked_at первым ---
const T = (h, m) => `2026-09-16T${h}:${m}:00Z`;
const mixed = buildActorRightsByTarget([
  { bot_id: 'b1', actor_type: 'userbot', actor_id: 'ub-old', target: 'paid_channel', state: 'needs_promote', is_admin: false, checked_at: T('12', '00') },
  { bot_id: 'b1', actor_type: 'userbot', actor_id: 'ub-new', target: 'paid_channel', state: 'ok', is_admin: true, checked_at: T('15', '00') },
  { bot_id: 'b1', actor_type: 'official_bot', actor_id: 'bot-1', target: 'paid_channel', state: 'ok', is_admin: true, checked_at: T('13', '00') },
  { bot_id: 'b1', actor_type: 'userbot', actor_id: 'ub-mid', target: 'paid_channel', state: 'error', is_admin: false, checked_at: T('14', '00') }
]);
assertEqual(
  mixed.paid_channel.map((a) => a.actor_id),
  ['bot-1', 'ub-new', 'ub-mid', 'ub-old'],
  'official_bot первый, юзерботы по убыванию checked_at'
);

// --- отсутствие checked_at — самая старая запись ---
const noTimestamp = buildActorRightsByTarget([
  { bot_id: 'b1', actor_type: 'userbot', actor_id: 'ub-no-ts', target: 'public_chat', state: 'unknown', is_admin: false, checked_at: null },
  { bot_id: 'b1', actor_type: 'userbot', actor_id: 'ub-with-ts', target: 'public_chat', state: 'ok', is_admin: true, checked_at: T('09', '30') }
]);
assertEqual(
  noTimestamp.public_chat.map((a) => a.actor_id),
  ['ub-with-ts', 'ub-no-ts'],
  'строка без checked_at считается самой старой'
);

// --- форма элемента: только 5 полей, is_admin → boolean, лишнее отбрасывается ---
const shaped = buildActorRightsByTarget([
  { bot_id: 'b1', actor_type: 'official_bot', actor_id: 123, target: 'paid_chat', state: 42, is_admin: 'yes', checked_at: T('10', '00'), flags: { x: 1 }, message: 'лишнее' }
]);
assertEqual(
  shaped.paid_chat[0],
  { actor_type: 'official_bot', actor_id: '123', state: '42', is_admin: true, checked_at: T('10', '00') },
  'форма элемента и приведение типов'
);
const shapedFalse = buildActorRightsByTarget([
  { bot_id: 'b1', actor_type: 'userbot', actor_id: 'ub1', target: 'paid_chat', state: null, is_admin: 0, checked_at: undefined }
]);
assertEqual(
  shapedFalse.paid_chat[0],
  { actor_type: 'userbot', actor_id: 'ub1', state: 'unknown', is_admin: false, checked_at: null },
  'нулевые значения → state unknown, is_admin false, checked_at null'
);

// --- разные боты не смешиваются: группировка только по target, вызывающий фильтрует по bot_id ---
const twoBots = buildActorRightsByTarget([
  { bot_id: 'b1', actor_type: 'official_bot', actor_id: 'bot-1', target: 'paid_channel', state: 'ok', is_admin: true, checked_at: T('10', '00') },
  { bot_id: 'b2', actor_type: 'official_bot', actor_id: 'bot-2', target: 'paid_channel', state: 'error', is_admin: false, checked_at: T('11', '00') }
]);
assertEqual(twoBots.paid_channel.length, 2, 'строки разных ботов группируются вместе по target (фильтр по bot_id — на вызывающем)');

console.log(`\ncontours overview actor-rights: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
