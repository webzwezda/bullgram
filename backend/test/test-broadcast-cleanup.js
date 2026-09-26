/**
 * Offline tests for broadcast membership cleanup (выход юзерботов из групп по окончании рассылки).
 * Запуск: node test/test-broadcast-cleanup.js
 *
 * Strategy: no network, no Supabase, no Telegram traffic.
 *   - recordPreparationJoin tested directly against a fake supabase (insert/upsert/silence)
 *   - job tick tested via createBroadcastMembershipCleanup with fake supabase,
 *     fake userbot client factory, injected kickViaPromoter / sleep / random
 *
 * Covered scenarios:
 *   (g) recordPreparationJoin: свежий join → insert; повтор → upsert granted_admin;
 *       ошибка БД / ошибка insert не роняют вызов; toMarkedChatId/resolveMarkedChatId
 *       (bare TL id → MARKED channels.tg_chat_id, приоритет target.chat_id)
 *   (a) свой канал + слот контура → skipped_protected, ноль Telegram-вызовов;
 *       join, записанный через helper с bare id, матчится с marked channels-строкой
 *   (b) restricted/missing актёр → skipped_restricted, ноль Telegram-вызовов
 *   (c) LeaveChannel успех → left + removed_at; basic-группа → DeleteChatUser с InputUserSelf
 *   (d) USER_NOT_PARTICIPANT → left c «уже не участник»
 *   (e) самовыход упал + kick через промоутера удался → kicked (аргументы фолбэка)
 *   (f) самовыход упал + промоутера нет → failed, removed_at остаётся null
 *       фолбэк-промоутер через Bot API: ban+unban бот-админом с can_restrict_members;
 *       unban проверяется (ретрай), сорвался — failed с пометкой «разбанить вручную»
 *       фолбэк-промоутер через юзербота-админа: GetParticipant + EditBanned ban+unban (+ретрай unban)
 *       meta.cleanup = {total, done, failed} пересчитывается из строк
 *       полностью обработанная кампания (meta.cleanup done+failed >= total) скипается;
 *       пустая подготовка — cleanup-мета не пишется вовсе
 *   (h) пейсинг: skip'и без sleep; между операциями sleep ~4s ±20%; батч ≤20 за тик
 *   (i) phaseJoin: persisted-скан переживает рестарт (пустой кэш → skip без записи);
 *       скана нет вовсе → не вступаем вслепую (warn, без записи); скан есть, чата в нём нет
 *       → join проходит и записывает MARKED tg_chat_id
 *   (j) кампании-кандидаты привязаны к pending join-строкам: старая кампания с работой
 *       не вытесняется 50+ новыми (starvation)
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-0123456789ab';
// phaseJoin-тесты: реальный sleep между join-операциями сжимаем до ~5s (env читается на вызове)
process.env.USERBOT_JOIN_SLEEP_MS = '5000';

import { Api } from 'telegram';

// crypto.js (через userbot.service) требует ENCRYPTION_KEY на импорте — импортируем динамически
// уже после заглушки. Сами модули сеть не трогают.
const { createBroadcastMembershipCleanup } = await import('../jobs/broadcast-membership-cleanup.job.js');
const {
    recordPreparationJoin,
    toMarkedChatId,
    resolveMarkedChatId,
    BroadcastPreparationService
} = await import('../services/broadcast-preparation.service.js');

const OWNER = '11111111-1111-4111-8111-111111111111';
const CAMP = '22222222-2222-4222-8222-222222222222';
const PREP = '33333333-3333-4333-8333-333333333333';
const UB1 = '44444444-4444-4444-8444-444444444444';
const UB2 = '55555555-5555-4555-8555-555555555555';
const NOW = 1758000000000;
const NOW_ISO = new Date(NOW).toISOString();

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
function assertTrue(cond, label, extra = null) {
  if (cond) ok(label);
  else fail(label, true, extra);
}

// ---------------------------------------------------------------------------
// Mock Supabase: in-memory таблицы, generic filter builder (eq/in/gte/filter/not/order/limit),
// insert, условный update (цепочка .eq(...).filter(...)), maybeSingle.
// ВАЖНО: isNull/isNotNull у мока НЕТ — как и у реального supabase-js 2.99 после
// .select()/.update(). Код джобы обязан фильтровать IS NULL через .filter('col', 'is', null).
// ---------------------------------------------------------------------------
function makeMockSupabase(tablesInit = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(tablesInit)) tables[name] = rows.map((r) => ({ ...r }));
  // поддержка jsonb-доступа как в PostgREST: 'meta->>preparation_id' → row.meta?.preparation_id
  const cellFor = (row, col) => {
    const m = String(col).match(/^(.+?)->>(\w+)$/);
    if (m) return row[m[1]]?.[m[2]];
    return row[col];
  };
  const predFor = (filters) => (row) => filters.every(([col, op, val]) => {
    const cell = cellFor(row, col);
    if (op === 'eq') return String(cell) === String(val);
    if (op === 'is') return val === null ? (cell === null || cell === undefined) : cell === val;
    if (op === 'in') return (val || []).some((v) => String(cell) === String(v));
    if (op === 'gte') return new Date(cell).getTime() >= new Date(val).getTime();
    if (op === 'isNull') return cell === null || cell === undefined;
    if (op === 'not.is') return !(cell === null || cell === undefined);
    return true;
  });
  const db = {
    from(table) {
      const rows = tables[table] ?? (tables[table] = []);
      const filters = [];
      const selectOpts = {};
      let orderSpec = null;
      let limitCount = null;
      const matches = () => rows.filter(predFor(filters));
      const builder = {
        select(_cols, opts = {}) { Object.assign(selectOpts, opts || {}); return builder; },
        eq(col, val) { filters.push([col, 'eq', val]); return builder; },
        in(col, vals) { filters.push([col, 'in', vals]); return builder; },
        gte(col, val) { filters.push([col, 'gte', val]); return builder; },
        isNull() { throw new TypeError('c.isNull is not a function — используй .filter(col, \'is\', null), см. комментарий у мока'); },
        filter(col, op, val) { filters.push([col, op, val]); return builder; },
        not(col, op, val) { filters.push([col, `not.${op}`, val]); return builder; },
        order(col, opts = {}) { orderSpec = { col, ascending: opts.ascending !== false }; return builder; },
        limit(n) { limitCount = n; return builder; },
        range() { return builder; },
        insert(payload) {
          const list = Array.isArray(payload) ? payload : [payload];
          for (const p of list) rows.push({ ...p });
          return Promise.resolve({ data: list.map((p) => ({ ...p })), error: null });
        },
        update(patch) {
          const applyUpdate = () => {
            let count = 0;
            for (const row of rows) {
              if (predFor(filters)(row)) { Object.assign(row, patch); count++; }
            }
            return count;
          };
          const updateBuilder = {
            eq(col, val) { filters.push([col, 'eq', val]); return updateBuilder; },
            in(col, vals) { filters.push([col, 'in', vals]); return updateBuilder; },
            isNull() { throw new TypeError('c.isNull is not a function — используй .filter(col, \'is\', null), см. комментарий у мока'); },
            filter(col, op, val) { filters.push([col, op, val]); return updateBuilder; },
            then(resolve) {
              const count = applyUpdate();
              resolve({ data: null, error: null, count });
            }
          };
          return updateBuilder;
        },
        maybeSingle: async () => ({ data: matches()[0] || null, error: null }),
        single: async () => ({ data: matches()[0] || null, error: null }),
        then(resolve) {
          let found = matches();
          if (!selectOpts.head) {
            if (orderSpec) {
              found = [...found].sort((a, b) => {
                const cmp = String(a[orderSpec.col] ?? '').localeCompare(String(b[orderSpec.col] ?? ''));
                return orderSpec.ascending ? cmp : -cmp;
              });
            }
            if (limitCount != null) found = found.slice(0, limitCount);
          }
          resolve({
            data: selectOpts.head ? [] : found,
            error: null,
            count: selectOpts.count === 'exact' ? matches().length : null
          });
        }
      };
      return builder;
    }
  };
  db._tables = tables;
  return db;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeCampaign(overrides = {}) {
  return {
    id: CAMP, owner_id: OWNER, status: 'sent',
    meta: { leave_groups_on_complete: true, preparation_id: PREP },
    created_at: NOW_ISO,
    ...overrides
  };
}

function makeJoin(overrides = {}) {
  return {
    id: overrides.id || `join-${Math.random().toString(16).slice(2, 10)}`,
    owner_id: OWNER, preparation_id: PREP, userbot_id: UB1,
    tg_chat_id: '-100555', chat_title: 'Чужая группа',
    granted_admin: false, joined_at: NOW_ISO,
    removed_at: null, remove_status: null, remove_error: null,
    ...overrides
  };
}

function makeAccount(overrides = {}) {
  return {
    id: UB1, owner_id: OWNER, account_type: 'userbot',
    runtime_status: 'ok', tg_username: 'ub1', tg_account_id: '424242',
    session_data: 'encrypted-session', proxy_id: null, proxies: null,
    ...overrides
  };
}

function makeClientFactory(impl = {}) {
  const calls = { created: [], invocations: [], disconnects: 0 };
  const factory = async (account) => {
    calls.created.push(String(account.id));
    return {
      getInputEntity: async (id) => {
        if (impl.getInputEntity) return impl.getInputEntity(id, account);
        throw new Error('PEER_UNRESOLVED');
      },
      invoke: async (request) => {
        calls.invocations.push({ account: String(account.id), className: request.className, request });
        if (impl.invoke) return impl.invoke(request, account);
        return {};
      },
      getDialogs: async () => (impl.dialogs ? impl.dialogs(account) : []),
      getMe: async () => ({ id: 4242, username: `ub_${account.id}` }),
      disconnect: async () => { calls.disconnects += 1; }
    };
  };
  factory.calls = calls;
  return factory;
}

function makeEnv({ tables = {}, clientImpl = {}, kickViaPromoter = null, random = () => 0.5, sleeps = null, supabase: presetSupabase = null } = {}) {
  const supabase = presetSupabase || makeMockSupabase(tables);
  const factory = makeClientFactory(clientImpl);
  const deps = {
    now: () => new Date(NOW),
    sleep: async (ms) => { if (sleeps) sleeps.push(ms); },
    random,
    userbotClientFactory: factory
  };
  if (kickViaPromoter) deps.kickViaPromoter = kickViaPromoter;
  const cleanup = createBroadcastMembershipCleanup(supabase, deps);
  return { supabase, factory, cleanup };
}

// --- phaseJoin harness: реальный сервис с заглушками вместо сети/БД ----------------------
function makePoolUserbot(overrides = {}) {
  return { id: UB1, tg_username: 'ub1', ...overrides };
}

function makePrepRow(overrides = {}) {
  return {
    id: PREP, owner_id: OWNER, status: 'joining', audience_type: 'manual_list',
    userbot_ids: [UB1], external_targets: [], phase_detail: {},
    ...overrides
  };
}

// Стабим всё, до чего phaseJoin дотягивается кроме join-петли: сеть не трогаем,
// sleep остаётся реальным (~5s через USERBOT_JOIN_SLEEP_MS) — как в проде.
function makeJoinService(supabase, prepRow, { pool = [makePoolUserbot()], target, joinImpl = null } = {}) {
  const service = new BroadcastPreparationService(supabase);
  const joinCalls = [];
  service.setStatus = async () => {};
  service.updatePhaseDetail = async () => {};
  service.getPreparationRow = async () => prepRow;
  service.loadPoolUserbots = async () => pool;
  service.buildJoinTargets = async () => [target];
  service.countRecentJoins = async () => 0;
  service.scanChatParticipants = async () => new Set();
  service.applyConfirmedTouchpoints = async () => {};
  service.userbotService.joinChatByInvite = async (userbot, args) => {
    joinCalls.push({ userbotId: String(userbot.id), invite: args?.inviteLink });
    if (joinImpl) return joinImpl(userbot, args);
    return { chat_id: '555', access_hash: '77', title: 'Целевая', kind: 'channel' };
  };
  return { service, joinCalls };
}

async function captureWarns(fn) {
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...args) => { warns.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.warn = realWarn;
  }
  return warns;
}

const peerChannel = () => new Api.InputPeerChannel({ channelId: BigInt(555), accessHash: BigInt(77) });
// В рантайме GramJS className содержит неймспейс: 'channels.LeaveChannel', 'messages.DeleteChatUser'
const isClass = (request, name) => String(request?.className || '').endsWith(name);

// ---------------------------------------------------------------------------
// (g) recordPreparationJoin
// ---------------------------------------------------------------------------
console.log('\n[recordPreparationJoin: fresh insert]');
{
  const supabase = makeMockSupabase({ broadcast_preparation_joins: [] });
  await recordPreparationJoin(supabase, {
    ownerId: OWNER, preparationId: PREP, userbotId: UB1, chatId: -100555, chatTitle: 'Чужая группа'
  });
  const rows = supabase._tables.broadcast_preparation_joins;
  assertEqual(rows.length, 1, 'одна строка вставлена');
  assertEqual(
    { owner_id: rows[0].owner_id, preparation_id: rows[0].preparation_id, userbot_id: rows[0].userbot_id },
    { owner_id: OWNER, preparation_id: PREP, userbot_id: UB1 },
    'скоуп строки: owner + preparation + userbot'
  );
  assertEqual(rows[0].tg_chat_id, '-100555', 'tg_chat_id приведён к строке');
  assertEqual(rows[0].granted_admin, false, 'granted_admin=false по умолчанию');
  assertEqual(rows[0].chat_title, 'Чужая группа', 'chat_title записан');
}

console.log('[recordPreparationJoin: retry upsert + granted_admin]');
{
  const supabase = makeMockSupabase({ broadcast_preparation_joins: [] });
  await recordPreparationJoin(supabase, { ownerId: OWNER, preparationId: PREP, userbotId: UB1, chatId: '-100555' });
  await recordPreparationJoin(supabase, { ownerId: OWNER, preparationId: PREP, userbotId: UB1, chatId: '-100555' });
  assertEqual(supabase._tables.broadcast_preparation_joins.length, 1, 'повторный join не дублирует строку');

  await recordPreparationJoin(supabase, {
    ownerId: OWNER, preparationId: PREP, userbotId: UB1, chatId: '-100555', grantedAdmin: true
  });
  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(supabase._tables.broadcast_preparation_joins.length, 1, 'после апдейта строка одна');
  assertEqual(row.granted_admin, true, 'granted_admin поднялся до true на той же строке');

  await recordPreparationJoin(supabase, { ownerId: OWNER, preparationId: PREP, userbotId: UB2, chatId: '-100555' });
  assertEqual(supabase._tables.broadcast_preparation_joins.length, 2, 'другой юзербот — отдельная строка');
}

console.log('[recordPreparationJoin: silence on db failure]');
{
  const broken = { from: () => { throw new Error('db down'); } };
  await recordPreparationJoin(broken, { ownerId: OWNER, preparationId: PREP, userbotId: UB1, chatId: '-100555' });
  ok('ошибка БД не роняет join-флоу');
}

console.log('[recordPreparationJoin: insert error замечен и не роняет флоу]');
{
  const failing = {
    from: () => {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        limit() { return builder; },
        maybeSingle: async () => ({ data: null, error: null }),
        insert: async () => ({ data: null, error: { message: 'duplicate key value' } })
      };
      return builder;
    }
  };
  const warns = await captureWarns(() => recordPreparationJoin(failing, {
    ownerId: OWNER, preparationId: PREP, userbotId: UB1, chatId: '-100555'
  }));
  assertTrue(warns.some((w) => w.includes('duplicate key value')), 'ошибка insert попала в warn', warns);
  ok('ошибка insert не роняет join-флоу');
}

// ---------------------------------------------------------------------------
// toMarkedChatId / resolveMarkedChatId: bare TL id → MARKED channels.tg_chat_id
// ---------------------------------------------------------------------------
console.log('\n[toMarkedChatId: bare → marked]');
{
  assertEqual(toMarkedChatId('channel', '3996170258'), '-1003996170258', 'channel → -100{bare}');
  assertEqual(toMarkedChatId('group', '3996170258'), '-3996170258', 'group → -{bare}');
  assertEqual(toMarkedChatId('channel', '-1003996170258'), '-1003996170258', 'уже marked channel — без изменений');
  assertEqual(toMarkedChatId('group', '-3996170258'), '-3996170258', 'уже marked basic-группа — без изменений');
  assertEqual(toMarkedChatId('channel', null), null, 'null → null');
  assertEqual(toMarkedChatId('channel', 'null'), null, '"null" → null');
  assertEqual(toMarkedChatId('channel', ''), null, 'пустая строка → null');
  assertEqual(resolveMarkedChatId('-100555', 'group', '777'), '-100555', 'target.chat_id marked приоритетнее kind');
  assertEqual(resolveMarkedChatId(null, 'channel', '555'), '-100555', 'без target.chat_id — derived из kind');
  assertEqual(resolveMarkedChatId(null, 'group', '555'), '-555', 'без target.chat_id — basic-группа');
}

// ---------------------------------------------------------------------------
// (a) протекция: свой канал + слот контура
// ---------------------------------------------------------------------------
console.log('\n[protection: own channel + contour slot]');
{
  const { supabase, factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [
        makeJoin({ id: 'j1', userbot_id: UB1, tg_chat_id: '-100999' }),
        makeJoin({ id: 'j2', userbot_id: UB2, tg_chat_id: '-100888' })
      ],
      channels: [
        { id: 'ch-1', owner_id: OWNER, tg_chat_id: '-100999' },
        { id: 'ch-2', owner_id: OWNER, tg_chat_id: '-100888' }
      ],
      sales_bot_contours: [{
        owner_id: OWNER, public_channel_id: 'ch-2', paid_channel_id: null,
        public_chat_id: null, paid_chat_id: null
      }],
      tg_accounts: [makeAccount({ id: UB1 }), makeAccount({ id: UB2 })]
    }
  });
  await cleanup.runCleanupTick();

  assertEqual(factory.calls.created.length, 0, 'клиент юзербота не создавался — ноль Telegram-вызовов');
  const rows = supabase._tables.broadcast_preparation_joins;
  assertTrue(rows.every((r) => r.remove_status === 'skipped_protected'), 'обе строки skipped_protected',
    rows.map((r) => r.remove_status));
  assertTrue(rows.every((r) => r.removed_at === NOW_ISO), 'removed_at выставлен');
  const campaign = supabase._tables.broadcast_campaigns[0];
  assertEqual(campaign.meta.cleanup, { total: 2, done: 2, failed: 0 }, 'meta.cleanup пересчитан');
}

// P0-регрессия: phaseJoin получил BARE id от Telegram, helper вывел MARKED →
// протекция по channels.tg_chat_id матчится, юзербота не выгоняет из своего канала
console.log('\n[protection: bare-vs-marked — join записан через helper, channels хранит marked]');
{
  const markedChatId = toMarkedChatId('channel', '3996170258'); // как phaseJoin из joined.chat_id
  const supabase = makeMockSupabase({});
  await recordPreparationJoin(supabase, {
    ownerId: OWNER, preparationId: PREP, userbotId: UB1, chatId: markedChatId, chatTitle: 'Свой канал'
  });
  assertEqual(supabase._tables.broadcast_preparation_joins[0].tg_chat_id, '-1003996170258', 'в join-строке MARKED id');

  supabase._tables.broadcast_campaigns = [makeCampaign()];
  supabase._tables.channels = [{ id: 'ch-own', owner_id: OWNER, tg_chat_id: '-1003996170258' }];
  supabase._tables.sales_bot_contours = [];
  supabase._tables.tg_accounts = [makeAccount()];

  const { factory, cleanup } = makeEnv({ supabase });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'skipped_protected', 'bare-vs-marked: строка защищена');
  assertEqual(factory.calls.created.length, 0, 'ноль Telegram-вызовов — своего канала не касаемся');
}

// ---------------------------------------------------------------------------
// (b) restricted / missing актёр
// ---------------------------------------------------------------------------
console.log('\n[actor state: restricted / missing]');
{
  const { supabase, factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [
        makeJoin({ id: 'j1', userbot_id: UB1, tg_chat_id: '-100555' }),
        makeJoin({ id: 'j2', userbot_id: UB2, tg_chat_id: '-100556' })
      ],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount({ id: UB1, runtime_status: 'restricted' })]
    }
  });
  await cleanup.runCleanupTick();

  assertEqual(factory.calls.created.length, 0, 'restricted/missing — клиент не создавался');
  const rows = supabase._tables.broadcast_preparation_joins;
  assertTrue(rows.every((r) => r.remove_status === 'skipped_restricted'), 'обе строки skipped_restricted',
    rows.map((r) => r.remove_status));
}

// ---------------------------------------------------------------------------
// (c) самовыход: LeaveChannel + DeleteChatUser
// ---------------------------------------------------------------------------
console.log('\n[self-leave: LeaveChannel success]');
{
  const { supabase, factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount()]
    },
    clientImpl: { getInputEntity: () => peerChannel() }
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'left', 'успешный выход → left');
  assertEqual(row.removed_at, NOW_ISO, 'removed_at выставлен');
  assertEqual(row.remove_error, null, 'без ошибки');
  const leave = factory.calls.invocations.find((c) => isClass(c, 'LeaveChannel'));
  assertTrue(leave, 'ушёл channels.LeaveChannel');
  assertTrue(factory.calls.disconnects >= 1, 'клиент отключён в finally');
  assertEqual(supabase._tables.broadcast_campaigns[0].meta.cleanup, { total: 1, done: 1, failed: 0 }, 'meta.cleanup');
}

console.log('[self-leave: basic group via DeleteChatUser]');
{
  const { factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount()]
    },
    clientImpl: { getInputEntity: () => new Api.InputPeerChat({ chatId: BigInt(777) }) }
  });
  await cleanup.runCleanupTick();

  const del = factory.calls.invocations.find((c) => isClass(c, 'DeleteChatUser'));
  assertTrue(del, 'basic-группа → messages.DeleteChatUser');
  assertEqual(String(del?.request.chatId), '777', 'chatId из InputPeerChat');
  assertTrue(del?.request.userId instanceof Api.InputUserSelf, 'userId = InputUserSelf (InputPeerSelf сервер отклоняет)');
}

// ---------------------------------------------------------------------------
// (d) USER_NOT_PARTICIPANT = уже вышел
// ---------------------------------------------------------------------------
console.log('\n[self-leave: USER_NOT_PARTICIPANT]');
{
  const { supabase, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount()]
    },
    clientImpl: {
      getInputEntity: () => peerChannel(),
      invoke: (request) => {
        if (isClass(request, 'LeaveChannel')) throw new Error('Telegram error: USER_NOT_PARTICIPANT');
        return {};
      }
    }
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'left', 'уже не участник → left');
  assertEqual(row.remove_error, 'уже не участник', 'remove_error с коротким текстом');
  assertEqual(row.removed_at, NOW_ISO, 'removed_at выставлен');
}

// ---------------------------------------------------------------------------
// (e) фолбэк: kick через промоутера удался
// ---------------------------------------------------------------------------
console.log('\n[kick fallback: promoter kicked]');
{
  const kickCalls = [];
  const { supabase, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount()]
    },
    clientImpl: {
      getInputEntity: () => peerChannel(),
      invoke: (request) => {
        if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
        return {};
      }
    },
    kickViaPromoter: async (args) => { kickCalls.push(args); return true; }
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'kicked', 'kick удался → kicked');
  assertEqual(row.removed_at, NOW_ISO, 'removed_at выставлен');
  assertEqual(kickCalls[0]?.ownerId, OWNER, 'фолбэку передан ownerId');
  assertEqual(kickCalls[0]?.chatId, '-100555', 'фолбэку передан chatId');
  assertEqual(kickCalls[0]?.joinerTgUserId, '424242', 'фолбэку передан tg_id joiner-а');
  assertEqual(kickCalls[0]?.joinerUserbotId, UB1, 'фолбэку передан userbot_id joiner-а');
}

// ---------------------------------------------------------------------------
// (f) фолбэк: промоутера нет → failed
// ---------------------------------------------------------------------------
console.log('\n[kick fallback: no promoter → failed]');
{
  const { supabase, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount()]
    },
    clientImpl: {
      getInputEntity: () => peerChannel(),
      invoke: (request) => {
        if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
        return {};
      }
    },
    kickViaPromoter: async () => false
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'failed', 'нет промоутера → failed');
  assertEqual(row.removed_at, null, 'removed_at остаётся null');
  assertTrue(String(row.remove_error || '').length > 0, 'remove_error заполнен');
  assertEqual(supabase._tables.broadcast_campaigns[0].meta.cleanup, { total: 1, done: 0, failed: 1 }, 'failed учтён в meta.cleanup');
}

// ---------------------------------------------------------------------------
// Фолбэк-промоутер №1: официальный бот-админ с can_restrict_members (Bot API ban+unban)
// ---------------------------------------------------------------------------
console.log('\n[default promoter: official bot via Bot API]');
{
  const realFetch = global.fetch;
  const botApiCalls = [];
  global.fetch = async (url, opts) => {
    const method = String(url).split('/').pop();
    botApiCalls.push({ method, body: JSON.parse(opts?.body || '{}') });
    const result = method === 'getChatMember'
      ? { status: 'administrator', can_restrict_members: true }
      : {};
    return { ok: true, json: async () => ({ ok: true, result }) };
  };
  try {
    const { supabase, cleanup } = makeEnv({
      tables: {
        broadcast_campaigns: [makeCampaign()],
        broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
        channels: [],
        sales_bot_contours: [],
        tg_accounts: [makeAccount(), makeAccount({
          id: 'bot-1', account_type: 'bot', tg_account_id: '999', session_data: '123:TOKEN'
        })]
      },
      clientImpl: {
        getInputEntity: () => peerChannel(),
        invoke: (request) => {
          if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
          return {};
        }
      }
    });
    await cleanup.runCleanupTick();

    const row = supabase._tables.broadcast_preparation_joins[0];
    assertEqual(row.remove_status, 'kicked', 'бот-админ с правом бана → kicked');
    const methods = botApiCalls.map((c) => c.method);
    assertTrue(methods.includes('getChatMember'), 'бот проверен через getChatMember');
    assertTrue(methods.includes('banChatMember'), 'kick = banChatMember');
    assertTrue(methods.includes('unbanChatMember'), '...и unbanChatMember');
    const ban = botApiCalls.find((c) => c.method === 'banChatMember');
    assertEqual(ban.body.user_id, 424242, 'банится именно joiner');
  } finally {
    global.fetch = realFetch;
  }
}

// kick завершён только после ПРОВЕРЕННОГО unban: первый unban сорвался → ретрай
console.log('\n[default promoter: unban проверяется — ретрай после сбоя]');
{
  const realFetch = global.fetch;
  let unbanAttempts = 0;
  global.fetch = async (url, opts) => {
    const method = String(url).split('/').pop();
    if (method === 'unbanChatMember') unbanAttempts += 1;
    let result = {};
    if (method === 'getChatMember') result = { status: 'administrator', can_restrict_members: true };
    const fail = method === 'unbanChatMember' && unbanAttempts === 1;
    return { ok: true, json: async () => (fail ? { ok: false, description: 'Try again later' } : { ok: true, result }) };
  };
  try {
    const { supabase, cleanup } = makeEnv({
      tables: {
        broadcast_campaigns: [makeCampaign()],
        broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
        channels: [],
        sales_bot_contours: [],
        tg_accounts: [makeAccount(), makeAccount({
          id: 'bot-1', account_type: 'bot', tg_account_id: '999', session_data: '123:TOKEN'
        })]
      },
      clientImpl: {
        getInputEntity: () => peerChannel(),
        invoke: (request) => {
          if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
          return {};
        }
      }
    });
    await cleanup.runCleanupTick();

    const row = supabase._tables.broadcast_preparation_joins[0];
    assertEqual(row.remove_status, 'kicked', 'unban прошёл на ретрае → kicked');
    assertEqual(unbanAttempts, 2, 'unban был ровно один ретрай');
  } finally {
    global.fetch = realFetch;
  }
}

// unban не прошёл ни разу → kick НЕ засчитан, юзербот мог остаться забаненным
console.log('\n[default promoter: unban сорвался дважды → failed с пометкой про ручной разбан]');
{
  const realFetch = global.fetch;
  let unbanAttempts = 0;
  global.fetch = async (url, opts) => {
    const method = String(url).split('/').pop();
    if (method === 'unbanChatMember') unbanAttempts += 1;
    let result = {};
    if (method === 'getChatMember') result = { status: 'administrator', can_restrict_members: true };
    const fail = method === 'unbanChatMember';
    return { ok: true, json: async () => (fail ? { ok: false, description: 'Try again later' } : { ok: true, result }) };
  };
  try {
    const { supabase, cleanup } = makeEnv({
      tables: {
        broadcast_campaigns: [makeCampaign()],
        broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
        channels: [],
        sales_bot_contours: [],
        tg_accounts: [makeAccount(), makeAccount({
          id: 'bot-1', account_type: 'bot', tg_account_id: '999', session_data: '123:TOKEN'
        })]
      },
      clientImpl: {
        getInputEntity: () => peerChannel(),
        invoke: (request) => {
          if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
          return {};
        }
      }
    });
    await cleanup.runCleanupTick();

    const row = supabase._tables.broadcast_preparation_joins[0];
    assertEqual(row.remove_status, 'failed', 'unban не прошёл → не kicked');
    assertTrue(String(row.remove_error || '').includes('разбанить вручную'), 'remove_error предупреждает про бан', row.remove_error);
    assertEqual(row.removed_at, null, 'removed_at остаётся null');
    assertEqual(unbanAttempts, 2, 'unban ретраился один раз, без бесконечных попыток');
  } finally {
    global.fetch = realFetch;
  }
}

// ---------------------------------------------------------------------------
// Фолбэк-промоутер №2: юзербот-админ с can_restrict_members (EditBanned ban+unban)
// ---------------------------------------------------------------------------
console.log('\n[default promoter: userbot admin via EditBanned]');
{
  const { supabase, factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1', userbot_id: UB1 })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount({ id: UB1 }), makeAccount({ id: UB2, tg_account_id: '525252' })]
    },
    clientImpl: {
      getInputEntity: () => peerChannel(),
      invoke: (request, account) => {
        if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
        if (isClass(request, 'GetParticipant')) {
          // промоутер UB2 — админ с правом бана; joiner UB1 промоутером не побывает (исключён из пула)
          if (String(account.id) === UB2) return { participant: { adminRights: { canRestrictMembers: true } } };
          return { participant: { adminRights: {} } };
        }
        return {};
      }
    }
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'kicked', 'юзербот-админ kickнул → kicked');
  const edits = factory.calls.invocations.filter((c) => isClass(c, 'EditBanned'));
  assertEqual(edits.length, 2, 'EditBanned ban + unban');
  assertEqual(edits[0]?.account, UB2, 'кик делал промоутер, не joiner');
}

// userbot-промоутер: первый unban сорвался → компенсация-ретрай, kick засчитан
console.log('\n[default promoter: userbot unban ретраится — kick засчитан]');
{
  let editBanned = [];
  const { supabase, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1', userbot_id: UB1 })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount({ id: UB1 }), makeAccount({ id: UB2, tg_account_id: '525252' })]
    },
    clientImpl: {
      getInputEntity: () => peerChannel(),
      invoke: (request, account) => {
        if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
        if (isClass(request, 'GetParticipant')) {
          if (String(account.id) === UB2) return { participant: { adminRights: { canRestrictMembers: true } } };
          return { participant: { adminRights: {} } };
        }
        if (isClass(request, 'EditBanned') && String(account.id) === UB2) {
          editBanned.push(request);
          if (editBanned.length === 2) throw new Error('USER_ADMIN_INVALID'); // первый unban сорвался
        }
        return {};
      }
    }
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'kicked', 'unban прошёл на ретрае → kicked');
  assertEqual(editBanned.length, 3, 'EditBanned ban + unban + ретрай unban');
}

// userbot-промоутер: unban сорвался дважды → kick НЕ засчитан, пометка про ручной разбан
console.log('\n[default promoter: userbot unban сорвался дважды → failed с пометкой]');
{
  let editBanned = [];
  const { supabase, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1', userbot_id: UB1 })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount({ id: UB1 }), makeAccount({ id: UB2, tg_account_id: '525252' })]
    },
    clientImpl: {
      getInputEntity: () => peerChannel(),
      invoke: (request, account) => {
        if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
        if (isClass(request, 'GetParticipant')) {
          if (String(account.id) === UB2) return { participant: { adminRights: { canRestrictMembers: true } } };
          return { participant: { adminRights: {} } };
        }
        if (isClass(request, 'EditBanned') && String(account.id) === UB2) {
          editBanned.push(request);
          if (editBanned.length >= 2) throw new Error('USER_ADMIN_INVALID'); // unban и его ретрай сорвались
        }
        return {};
      }
    }
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'failed', 'unban не прошёл → не kicked');
  assertTrue(String(row.remove_error || '').includes('разбанить вручную'), 'remove_error предупреждает про бан', row.remove_error);
  assertEqual(row.removed_at, null, 'removed_at остаётся null');
  assertEqual(editBanned.length, 3, 'ban + unban + единственный ретрай, без бесконечных попыток');
}

// ---------------------------------------------------------------------------
// meta.cleanup: полностью обработанная кампания скипается
// ---------------------------------------------------------------------------
console.log('\n[campaign skip: cleanup already complete]');
{
  const { factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign({
        meta: { leave_groups_on_complete: true, preparation_id: PREP, cleanup: { total: 1, done: 1, failed: 0 } }
      })],
      broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount()]
    }
  });
  await cleanup.runCleanupTick();

  assertEqual(factory.calls.created.length, 0, 'обработанная кампания — ноль вызовов');
}

// zero-join кампания: pending-строк нет → не кандидат, cleanup-мету {total:0} не пишем вовсе
console.log('\n[zero-join campaign: без join-строк — ни запросов по строкам, ни cleanup-меты]');
{
  const { factory, cleanup, supabase } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: []
    }
  });
  await cleanup.runCleanupTick();

  assertEqual(factory.calls.created.length, 0, 'ноль Telegram-вызовов');
  assertEqual(supabase._tables.broadcast_campaigns[0].meta.cleanup, undefined, 'пустой кампании cleanup-мета не пишется');
}

// старая кампания с живой работой не должна теряться за 50+ новыми (starvation)
console.log('\n[starvation: старая flagged-кампания с pending-строками обрабатывается]');
{
  const newerCampaigns = Array.from({ length: 55 }, (_unused, i) => ({
    id: `newer-${i}`, owner_id: OWNER, status: 'sent',
    meta: { leave_groups_on_complete: false },
    created_at: new Date(NOW + (i + 1) * 1000).toISOString()
  }));
  const { factory, cleanup, supabase } = makeEnv({
    tables: {
      broadcast_campaigns: [
        makeCampaign({ id: 'old-flagged', created_at: NOW_ISO }),
        ...newerCampaigns
      ],
      broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount()]
    },
    clientImpl: { getInputEntity: () => peerChannel() }
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'left', 'старейшая кампания обработана, несмотря на 55 новых');
  assertTrue(factory.calls.created.length >= 1, 'была реальная Telegram-операция');
}

// ---------------------------------------------------------------------------
// (h) пейсинг и батч
// ---------------------------------------------------------------------------
console.log('\n[pacing: skips without sleep]');
{
  const sleeps = [];
  const { factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [
        makeJoin({ id: 'j1', tg_chat_id: '-100999' }), // свой канал → skip
        makeJoin({ id: 'j2' })                          // реальная операция
      ],
      channels: [{ id: 'ch-1', owner_id: OWNER, tg_chat_id: '-100999' }],
      sales_bot_contours: [],
      tg_accounts: [makeAccount()]
    },
    clientImpl: { getInputEntity: () => peerChannel() },
    sleeps
  });
  await cleanup.runCleanupTick();

  assertEqual(sleeps.length, 0, 'skip + одна операция в конце — без sleep');
  assertEqual(factory.calls.invocations.length, 1, 'одна Telegram-операция');
}

console.log('[pacing: sleep между операциями ~4s ±20%]');
{
  const sleeps = [];
  const { cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1' }), makeJoin({ id: 'j2', userbot_id: UB2, tg_chat_id: '-100556' })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount(), makeAccount({ id: UB2, tg_account_id: '525252' })]
    },
    clientImpl: { getInputEntity: () => peerChannel() },
    sleeps,
    random: () => 0.5
  });
  await cleanup.runCleanupTick();

  assertEqual(sleeps.length, 1, 'один sleep между двумя операциями');
  assertTrue(sleeps[0] >= 3200 && sleeps[0] <= 4800, `sleep в диапазоне 4000±20% (получили ${sleeps[0]})`);
}

console.log('[batch: не больше 20 строк за тик]');
{
  const joins = Array.from({ length: 25 }, (_unused, i) => makeJoin({ id: `j${i}`, tg_chat_id: `-1005${String(i).padStart(2, '0')}` }));
  const accounts = joins.map((j) => makeAccount({ id: j.userbot_id, tg_account_id: '424242' }));
  const { factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: joins,
      channels: [],
      sales_bot_contours: [],
      tg_accounts: accounts
    },
    clientImpl: { getInputEntity: () => peerChannel() },
    sleeps: []
  });
  await cleanup.runCleanupTick();

  assertEqual(factory.calls.created.length, 20, 'за тик обработано ровно 20 строк');
}

// ---------------------------------------------------------------------------
// (i) phaseJoin: persisted-скан переживёт рестарт; вслепую не вступаем
// ---------------------------------------------------------------------------
const JOIN_TARGET = { raw: 'https://t.me/target', scope: 'owner', chat_id: '-100555', title: 'Целевая' };

// (a) рестарт посреди подготовки: in-memory кэш пуст, но phase_detail.scanned_chats живёт
console.log('\n[phaseJoin: restart — persisted-скан с чатом → skip, без записи]');
{
  const supabase = makeMockSupabase({});
  const prepRow = makePrepRow({ phase_detail: { scanned_chats: { [UB1]: ['-100555'] } } });
  const { service, joinCalls } = makeJoinService(supabase, prepRow, { target: JOIN_TARGET });
  await service.phaseJoin(prepRow);

  assertEqual(joinCalls.length, 0, 'чат в persisted-скане — Telegram join не вызывался');
  assertEqual((supabase._tables.broadcast_preparation_joins || []).length, 0, 'join-строка не записана (юзербот был там раньше)');
}

// (b) скана нет ни в кэше, ни в persisted → вслепую не вступаем
console.log('\n[phaseJoin: скана нет вовсе → warn, без join и без записи]');
{
  const supabase = makeMockSupabase({});
  const prepRow = makePrepRow({ phase_detail: {} });
  const { service, joinCalls } = makeJoinService(supabase, prepRow, { target: JOIN_TARGET });
  const warns = await captureWarns(() => service.phaseJoin(prepRow));

  assertEqual(joinCalls.length, 0, 'вслепую не вступаем');
  assertEqual((supabase._tables.broadcast_preparation_joins || []).length, 0, 'join-строка не записана');
  assertTrue(warns.some((w) => w.includes('не вступаем вслепую')), 'warn про join вслепую', warns);
}

// (c) скан есть, но целевого чата в нём нет → join проходит и записывает MARKED tg_chat_id
console.log('\n[phaseJoin: чат вне скана → join проходит, запись с MARKED id]');
{
  const supabase = makeMockSupabase({});
  const prepRow = makePrepRow({ phase_detail: { scanned_chats: { [UB1]: ['-100999'] } } });
  const { service, joinCalls } = makeJoinService(supabase, prepRow, { target: JOIN_TARGET });
  await service.phaseJoin(prepRow);

  assertEqual(joinCalls.length, 1, 'чат вне скана — join выполнен');
  const rows = supabase._tables.broadcast_preparation_joins;
  assertEqual(rows.length, 1, 'join записан');
  assertEqual(rows[0].tg_chat_id, '-100555', 'записан MARKED id (target.chat_id приоритетнее bare из joined)');
  assertEqual(joinCalls[0]?.userbotId, UB1, 'join делал юзербот из пула');
}

console.log(`\n=== broadcast-cleanup: ${passes} passed, ${failures} failed ===`);
if (failures > 0) process.exit(1);
