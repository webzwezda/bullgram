/**
 * Offline tests for lifecycle DM routing (retention / auto-kick / abandoned fallbacks).
 * Запуск: node test/test-lifecycle-dm.js
 *
 * Strategy: no network, no Supabase, no Telegram traffic.
 *   - jobs получают fake supabase (in-memory таблицы с честными eq/in/gt/lte/order-фильтрами)
 *   - MessagingRouter подменяется fake'ом через опциональный deps-параметр start* функций
 *   - setInterval перехватывается до вызова start*, тик вызывается вручную и await'ится
 *
 * Covered scenarios:
 *   - retention: пул из активных контурных связок бота (чужие юзерботы не подтягиваются)
 *   - retention: пустые связки → фолбэк на последний рабочий юзербот (пул из одного)
 *   - retention: common_chat_id канала подписки форвардится в router.deliver, eventSource=retention
 *   - abandoned: флаг ON → бот заблокирован → фолбэк через роутер, sent → reminded
 *   - abandoned: флаг OFF → старое поведение (skipped bot_blocked + reminded), роутер не зовётся
 *   - abandoned: pool_exhausted → access_event failed с error_kind + reminded (финальный исход)
 */
// Джобы берут реальный Date.now() (в отличие от роутера, injected now не принимают) —
// фиксьюры строим относительно живых часов, иначе окна выборки не поймают
const NOW = Date.now();
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const OWNER = '11111111-1111-4111-8111-111111111111';
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

// Перехватываем setInterval ДО первого вызова start* (джобы ставят интервал внутри стартера)
const capturedTicks = [];
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn) => { capturedTicks.push(fn); return 0; };

const { startRetention } = await import('../jobs/retention.job.js');
const { startAbandonedCart } = await import('../jobs/abandoned-cart.job.js');

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
// Fake supabase: in-memory таблицы; eq/in/gt/gte/lt/lte/order/limit честные,
// dotted-колонки (tariffs.owner_id) и or/is — no-op (тесты на них не завязаны).
// ---------------------------------------------------------------------------
function makeFakeSupabase(seed = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }));
  const inserts = [];
  const updates = [];

  const supabase = {
    from(table) {
      const rows = () => tables[table] || [];
      const filters = [];
      let limitCount = null;
      let orderSpec = null;
      const cmp = (a, b) => new Date(a).getTime() - new Date(b).getTime();
      const apply = () => {
        let found = rows().filter((row) => filters.every(([col, op, val]) => {
          if (String(col).includes('.')) return true;
          const cell = row[col];
          if (op === 'eq') return String(cell) === String(val);
          if (op === 'in') return (val || []).map(String).includes(String(cell));
          if (op === 'gt') return cmp(cell, val) > 0;
          if (op === 'gte') return cmp(cell, val) >= 0;
          if (op === 'lt') return cmp(cell, val) < 0;
          if (op === 'lte') return cmp(cell, val) <= 0;
          return true;
        }));
        if (orderSpec) {
          const { col, ascending } = orderSpec;
          found = [...found].sort((a, b) => (ascending ? 1 : -1) * String(a[col]).localeCompare(String(b[col])));
        }
        if (limitCount != null) found = found.slice(0, limitCount);
        return found;
      };
      const builder = {
        select() { return builder; },
        eq(col, val) { filters.push([col, 'eq', val]); return builder; },
        in(col, val) { filters.push([col, 'in', val]); return builder; },
        gt(col, val) { filters.push([col, 'gt', val]); return builder; },
        gte(col, val) { filters.push([col, 'gte', val]); return builder; },
        lt(col, val) { filters.push([col, 'lt', val]); return builder; },
        lte(col, val) { filters.push([col, 'lte', val]); return builder; },
        is() { return builder; },
        or() { return builder; },
        order(col, opts = {}) { orderSpec = { col, ascending: opts.ascending !== false }; return builder; },
        limit(n) { limitCount = n; return builder; },
        maybeSingle: async () => ({ data: apply()[0] || null, error: null }),
        single: async () => {
          const found = apply();
          return found.length
            ? { data: found[0], error: null }
            : { data: null, error: { message: 'row not found', code: 'PGRST116' } };
        },
        insert(row) { inserts.push({ table, row }); return Promise.resolve({ data: row, error: null }); },
        update(patch) {
          return {
            eq: async (col, val) => {
              updates.push({ table, patch, col, val });
              for (const row of rows()) {
                if (String(row[col]) === String(val)) Object.assign(row, patch);
              }
              return { data: null, error: null };
            }
          };
        },
        then(resolve) { resolve({ data: apply(), error: null, count: apply().length }); }
      };
      return builder;
    }
  };
  return { supabase, tables, inserts, updates };
}

// Fake router: пишет вызовы deliver, возвращает заготовленный исход
function makeFakeRouter(result) {
  const calls = [];
  return {
    calls,
    router: {
      async deliver(args) {
        calls.push(args);
        return typeof result === 'function' ? result(args) : { ...result };
      }
    }
  };
}

// Fake official bot: sendMessage всегда «юзер заблокировал бота» (403 → deliverViaBot: 'blocked')
function makeBlockedBot() {
  return {
    botInfo: { username: 'salesbot' },
    telegram: {
      getMe: async () => ({ username: 'salesbot' }),
      sendMessage: async () => {
        const err = new Error('Forbidden: bot was blocked by the user');
        err.code = 403;
        throw err;
      }
    }
  };
}

const SENT = { status: 'sent', actorType: 'userbot', actorId: null, errorKind: null, errorText: null };
const POOL_EXHAUSTED = {
  status: 'failed', actorType: null, actorId: null,
  errorKind: 'pool_exhausted', errorText: 'Юзерботы пула недоступны: пауза, квота или ошибка Telegram.'
};

function makeUserbot(id, createdAtOffset) {
  return {
    id, owner_id: OWNER, account_type: 'userbot', runtime_status: 'ok',
    proxy_id: null, proxies: { is_working: true }, tg_username: id,
    created_at: iso(createdAtOffset)
  };
}

// Консольный canary: console.error внутри сценария = что-то пошло не по сценарию
async function runScenario(name, fn) {
  const errors = [];
  const realError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); };
  try {
    await fn();
    console.log(`\n[${name}]`);
  } finally {
    console.error = realError;
  }
  if (errors.length > 0) {
    fail(`${name}: console.error canary`, 'нет неожиданных ошибок', errors);
  } else {
    ok(`${name}: console.error canary чист`);
  }
}

function accessEvents(state) {
  return state.inserts.filter((entry) => entry.table === 'access_events').map((entry) => entry.row);
}

// ---------------------------------------------------------------------------
// Фикстура retention: одна подписка, истекающая через 23 часа
// ---------------------------------------------------------------------------
function makeRetentionState({ bindings, accounts }) {
  return makeFakeSupabase({
    subscriptions: [{
      id: 'sub-1', tg_user_id: '700', channel_id: 'ch-1', status: 'active',
      expires_at: iso(23 * HOUR_MS), last_reminder_sent_at: null,
      channels: { owner_id: OWNER, bot_id: 'bot-1', title: 'Канал', tg_chat_id: '-100999' }
    }],
    invoices: [],
    payment_settings: [{ owner_id: OWNER, reminder_text: null }],
    official_bot_userbot_bindings: bindings || [],
    tg_accounts: accounts,
    shop_items: []
  });
}

// ---------------------------------------------------------------------------
// 1. retention: пул из контурных связок бота, common_chat_id форвардится
// ---------------------------------------------------------------------------
await runScenario('retention contour pool + common_chat_id', async () => {
  const state = makeRetentionState({
    bindings: [
      { bot_id: 'bot-1', userbot_id: 'ub-2', is_active: true },
      { bot_id: 'bot-1', userbot_id: 'ub-1', is_active: true }
    ],
    accounts: [
      makeUserbot('ub-1', -2 * DAY_MS),
      makeUserbot('ub-2', -1 * DAY_MS),
      makeUserbot('ub-3', -3 * HOUR_MS) // не в связках — в пул попасть не должен
    ]
  });
  const fake = makeFakeRouter({ ...SENT, actorId: 'ub-2' });
  process.env.USERBOT_RETENTION_DM_ENABLED = 'true';
  startRetention(state.supabase, () => null, { messagingRouter: fake.router });
  await capturedTicks.shift()();

  assertEqual(fake.calls.length, 1, 'deliver вызван ровно один раз');
  assertEqual(
    fake.calls[0].pool.map((a) => String(a.id)).sort(),
    ['ub-1', 'ub-2'],
    'пул = активные связки бота, ub-3 отсечён'
  );
  assertEqual(fake.calls[0].commonChatId, '-100999', 'common_chat_id канала подписки форвардится');
  assertEqual(fake.calls[0].eventSource, 'retention', 'eventSource = retention');
  assertEqual(fake.calls[0].ownerId, OWNER, 'owner_id скоуп подписки');
  assertTrue(!fake.calls[0].text.includes('*'), 'текст ушёл plain-text (без markdown-декора)');
  assertTrue(fake.calls[0].text.includes('Системное уведомление'), 'обёртка plain-text каркаса на месте');

  const events = accessEvents(state);
  assertEqual(events.length, 1, 'один access_event');
  assertEqual(
    { delivered_by: events[0].payload.delivered_by, userbot_id: events[0].payload.userbot_id, userbot_username: events[0].payload.userbot_username },
    { delivered_by: 'userbot', userbot_id: 'ub-2', userbot_username: 'ub-2' },
    'access_event: delivered_by userbot + актёр'
  );
  assertEqual(
    { reminded: state.tables.subscriptions[0].last_reminder_sent_at != null, marked: state.updates.some((u) => u.table === 'subscriptions' && u.patch.last_reminder_sent_at) },
    { reminded: true, marked: true },
    'подписка промаркирована после доставки'
  );
});

// ---------------------------------------------------------------------------
// 2. retention: пустые связки → фолбэк на последний рабочий юзербот
// ---------------------------------------------------------------------------
await runScenario('retention fallback to latest userbot', async () => {
  const state = makeRetentionState({
    bindings: [],
    accounts: [
      makeUserbot('ub-old', -5 * DAY_MS),
      makeUserbot('ub-latest', -3 * HOUR_MS)
    ]
  });
  const fake = makeFakeRouter({ ...SENT, actorId: 'ub-latest' });
  process.env.USERBOT_RETENTION_DM_ENABLED = 'true';
  startRetention(state.supabase, () => null, { messagingRouter: fake.router });
  await capturedTicks.shift()();

  assertEqual(fake.calls.length, 1, 'deliver вызван');
  assertEqual(
    fake.calls[0].pool.map((a) => String(a.id)),
    ['ub-latest'],
    'пул из одного — новейший элигибельный юзербот'
  );
  assertEqual(state.tables.subscriptions[0].last_reminder_sent_at != null, true, 'доставка промаркирована');
});

// ---------------------------------------------------------------------------
// 3. retention: pool_exhausted → failed-событие, БЕЗ маркировки (транзиентно)
// ---------------------------------------------------------------------------
await runScenario('retention pool_exhausted not marked', async () => {
  const state = makeRetentionState({
    bindings: [{ bot_id: 'bot-1', userbot_id: 'ub-1', is_active: true }],
    accounts: [makeUserbot('ub-1', -1 * DAY_MS)]
  });
  const fake = makeFakeRouter({ ...POOL_EXHAUSTED });
  process.env.USERBOT_RETENTION_DM_ENABLED = 'true';
  startRetention(state.supabase, () => null, { messagingRouter: fake.router });
  await capturedTicks.shift()();

  assertEqual(fake.calls.length, 1, 'deliver вызван');
  const events = accessEvents(state);
  assertEqual(
    { delivered_by: events[0]?.payload?.delivered_by, error_kind: events[0]?.payload?.error_kind },
    { delivered_by: 'failed', error_kind: 'pool_exhausted' },
    'access_event failed с error_kind pool_exhausted'
  );
  assertEqual(state.tables.subscriptions[0].last_reminder_sent_at, null, 'ретеншн не маркирует транзиентный фейл — ретрай следующим тиком');
});

// ---------------------------------------------------------------------------
// Фикстура abandoned: pending-счёт возрастом 2.5 часа, бот заблокирован юзером
// ---------------------------------------------------------------------------
function makeAbandonedState({ bindings, accounts }) {
  return makeFakeSupabase({
    invoices: [{
      id: 'inv-1', tg_user_id: '700', status: 'pending', reminded: false,
      created_at: iso(-2.5 * HOUR_MS), currency: 'TON', tariff_id: 'tar-1',
      tariffs: {
        id: 'tar-1', title: 'Тариф', trial_label: null, is_trial: false,
        price: 100, currency: 'TON', is_active: true, owner_id: OWNER, channel_id: 'ch-1'
      }
    }],
    subscriptions: [],
    channels: [{ id: 'ch-1', bot_id: 'bot-1', owner_id: OWNER }],
    payment_settings: [{ owner_id: OWNER, abandoned_text: null, abandoned_discount_percent: 0 }],
    official_bot_userbot_bindings: bindings || [],
    tg_accounts: accounts,
    shop_items: []
  });
}

async function runAbandonedTick(state, routerResult, flagValue) {
  const fake = makeFakeRouter(routerResult);
  if (flagValue === null) delete process.env.USERBOT_ABANDONED_DM_ENABLED;
  else process.env.USERBOT_ABANDONED_DM_ENABLED = flagValue;
  startAbandonedCart(state.supabase, () => makeBlockedBot(), { messagingRouter: fake.router });
  await capturedTicks.shift()();
  return fake;
}

// ---------------------------------------------------------------------------
// 4. abandoned: флаг ON → бот заблокирован → фолбэк через роутер, sent → reminded
// ---------------------------------------------------------------------------
await runScenario('abandoned blocked + flag on → userbot fallback', async () => {
  const state = makeAbandonedState({
    bindings: [{ bot_id: 'bot-1', userbot_id: 'ub-1', is_active: true }],
    accounts: [makeUserbot('ub-1', -1 * DAY_MS), makeUserbot('ub-2', -2 * DAY_MS)]
  });
  const fake = await runAbandonedTick(state, { ...SENT, actorId: 'ub-1' }, 'true');

  assertEqual(fake.calls.length, 1, 'фолбэк через роутер попытан');
  assertEqual(
    fake.calls[0].pool.map((a) => String(a.id)),
    ['ub-1'],
    'пул из контурных связок бота'
  );
  assertEqual(fake.calls[0].eventSource, 'abandoned', 'eventSource = abandoned');
  assertTrue(!fake.calls[0].text.includes('*'), 'текст без markdown-декора и без кнопки');
  assertTrue(fake.calls[0].text.includes('Системное уведомление'), 'тот же plain-text каркас, что у retention');

  const events = accessEvents(state);
  assertEqual(events.length, 1, 'один access_event');
  assertEqual(
    { delivered_by: events[0].payload.delivered_by, userbot_id: events[0].payload.userbot_id },
    { delivered_by: 'userbot', userbot_id: 'ub-1' },
    'access_event: delivered_by userbot'
  );
  assertEqual(
    { reminded: state.tables.invoices[0].reminded, reminded_at: state.tables.invoices[0].reminded_at != null },
    { reminded: true, reminded_at: true },
    'счёт помечен reminded (финальный исход)'
  );
});

// ---------------------------------------------------------------------------
// 5. abandoned: флаг OFF → старое поведение, роутер не зовётся
// ---------------------------------------------------------------------------
await runScenario('abandoned blocked + flag off → skip as before', async () => {
  const state = makeAbandonedState({
    bindings: [{ bot_id: 'bot-1', userbot_id: 'ub-1', is_active: true }],
    accounts: [makeUserbot('ub-1', -1 * DAY_MS)]
  });
  const fake = await runAbandonedTick(state, { ...SENT, actorId: 'ub-1' }, 'false');

  assertEqual(fake.calls.length, 0, 'роутер не вызывался');
  const events = accessEvents(state);
  assertEqual(
    { delivered_by: events[0]?.payload?.delivered_by, reason: events[0]?.payload?.reason },
    { delivered_by: 'skipped', reason: 'bot_blocked' },
    'старый скип bot_blocked'
  );
  assertEqual(state.tables.invoices[0].reminded, true, 'счёт помечен reminded');
});

// ---------------------------------------------------------------------------
// 6. abandoned: pool_exhausted → failed + reminded, бесконечного ретрая нет
// ---------------------------------------------------------------------------
await runScenario('abandoned pool_exhausted → failed + marked', async () => {
  const state = makeAbandonedState({
    bindings: [],
    accounts: [makeUserbot('ub-1', -1 * DAY_MS)]
  });
  const fake = await runAbandonedTick(state, { ...POOL_EXHAUSTED }, 'true');

  assertEqual(fake.calls.length, 1, 'фолбэк попытан (пул владельца не пуст)');
  const events = accessEvents(state);
  assertEqual(
    { delivered_by: events[0]?.payload?.delivered_by, error_kind: events[0]?.payload?.error_kind },
    { delivered_by: 'failed', error_kind: 'pool_exhausted' },
    'access_event failed с error_kind pool_exhausted'
  );
  assertEqual(state.tables.invoices[0].reminded, true, 'исчерпание пула — финальный исход, счёт помечен');
});

globalThis.setInterval = realSetInterval;

console.log(`\n=== lifecycle-dm: ${passes} passed, ${failures} failed ===`);
if (failures > 0) process.exit(1);
