/**
 * Offline tests for the messaging router (MessagingRouter + pure helpers).
 * Запуск: node test/test-messaging-router.js
 *
 * Strategy: no network, no Supabase, no Telegram traffic.
 *   - pure helpers tested directly (resolveMessagingCaps, estimateCapacity, isActorEligible)
 *   - orchestration tested with fake supabase (in-memory userbot_send_log + tg_accounts),
 *     fake sendUserbot, instant sleep, injected random
 *
 * Covered scenarios:
 *   - resolveMessagingCaps defaults + overrides + non-numeric/negative env
 *   - estimateCapacity math (pool 0 → days null, audience 0 → both 0)
 *   - isActorEligible (pending_activation, blocked statuses, dead proxy, future/past pause)
 *   - quota skip: hourly + daily (candidate пропускается, берётся следующий)
 *   - flood_wait: pause = retry_after + 30s, clamp 3600s, humanized fallback без секунд
 *   - account_flagged / session_revoked: пауза 24h (сырые и очеловеченные тексты)
 *   - rotation order: touchpoint first, затем по минимуму отправок
 *   - jitter bounds: ±jitterPercent от baseDelayMs, нет sleep перед первой попыткой
 *   - recordSend idempotency conflict → { recorded:false } без throw
 *   - deliver happy path + pool exhausted
 *   - flood-пауза зеркалится на in-memory пул (P1-1): повторный deliver без попыток
 *   - pauseActor/clearPause с owner-фильтром (P2-4)
 *   - ключ идемпотентности только на первой попытке (P2-5)
 */
import { MessagingRouter, estimateCapacity, isActorEligible, resolveMessagingCaps } from '../services/messaging-router.service.js';

// Пинним капы: тесты не должны зависеть от амбиентного .env
process.env.USERBOT_DM_HOURLY_CAP = '20';
process.env.USERBOT_DM_DAILY_CAP = '50';
process.env.USERBOT_DM_JITTER_PERCENT = '20';

const NOW = 1758000000000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const OWNER = '11111111-1111-4111-8111-111111111111';

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
// Mock Supabase: in-memory userbot_send_log + tg_accounts, generic filter builder.
// insert эмулирует partial unique index по idempotency_key (23505).
// ---------------------------------------------------------------------------
function makeMockSupabase({ accounts = [], sendLog = [] } = {}) {
  const tables = {
    tg_accounts: accounts.map((row) => ({ ...row })),
    userbot_send_log: sendLog.map((row) => ({ ...row }))
  };
  const supabase = {
    from(table) {
      const rows = tables[table] || [];
      const filters = [];
      let selectOpts = {};
      const matches = () => rows.filter((row) => filters.every(([col, op, val]) => {
        const cell = row[col];
        if (op === 'eq') return String(cell) === String(val);
        if (op === 'gte') return new Date(cell).getTime() >= new Date(val).getTime();
        return true;
      }));
      const builder = {
        select(_cols, opts = {}) { selectOpts = opts || {}; return builder; },
        eq(col, val) { filters.push([col, 'eq', val]); return builder; },
        gte(col, val) { filters.push([col, 'gte', val]); return builder; },
        maybeSingle: async () => ({ data: matches()[0] || null, error: null }),
        single: async () => {
          const found = matches();
          return found.length
            ? { data: found[0], error: null }
            : { data: null, error: { message: 'row not found', code: 'PGRST116' } };
        },
        insert(payload) {
          const key = payload?.idempotency_key;
          if (key && rows.some((row) => row.idempotency_key === key)) {
            return Promise.resolve({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint "userbot_send_log_idempotency_key"' }
            });
          }
          rows.push({ ...payload, created_at: payload.created_at || new Date().toISOString() });
          return Promise.resolve({ data: payload, error: null });
        },
        update(patch) {
          // thenable-билдер: поддерживает цепочку .eq(...) — роутер скопит фильтры
          // id + owner_id (defense in depth) и применит их на await
          const updateFilters = [];
          const applyUpdate = () => {
            for (const row of rows) {
              if (updateFilters.every(([col, val]) => String(row[col]) === String(val))) Object.assign(row, patch);
            }
          };
          const updateBuilder = {
            eq(col, val) { updateFilters.push([col, val]); return updateBuilder; },
            then(resolve) {
              applyUpdate();
              resolve({ data: null, error: null });
            }
          };
          return updateBuilder;
        },
        then(resolve) {
          const found = matches();
          resolve({
            data: selectOpts.head ? [] : found,
            error: null,
            count: selectOpts.count === 'exact' ? found.length : null
          });
        }
      };
      return builder;
    }
  };
  supabase._tables = tables;
  return supabase;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeAccount(id, patch = {}) {
  return {
    id, owner_id: OWNER, account_type: 'userbot', runtime_status: 'ok',
    proxy_id: null, proxies: null, dm_paused_until: null, dm_pause_reason: null,
    ...patch
  };
}

function sentRows(actorId, count, ageMs) {
  return Array.from({ length: count }, (_unused, i) => ({
    owner_id: OWNER,
    actor_type: 'userbot',
    actor_id: actorId,
    campaign_id: null,
    tg_user_id: '700',
    status: 'sent',
    error_kind: null,
    idempotency_key: `${actorId}-${ageMs}-${i}`,
    created_at: new Date(NOW - ageMs).toISOString()
  }));
}

function makeRouter({ supabase, send = null, randomQueue = [] } = {}) {
  const calls = [];
  const delays = [];
  const router = new MessagingRouter({
    supabase,
    now: () => NOW,
    sleep: async (ms) => { delays.push(ms); },
    random: () => (randomQueue.length ? randomQueue.shift() : 0.5),
    sendUserbot: async (account, tgUserId, text, options) => {
      calls.push({ id: String(account.id), tgUserId, text, options });
      if (!send) return { success: true };
      return await send(account, tgUserId, text, options);
    }
  });
  return { router, calls, delays };
}

// ---------------------------------------------------------------------------
// 1. Pure: resolveMessagingCaps
// ---------------------------------------------------------------------------
console.log('\n[resolveMessagingCaps]');
{
  assertEqual(resolveMessagingCaps({}), { hourlyCap: 20, dailyCap: 50, jitterPercent: 20 }, 'defaults');
  assertEqual(
    resolveMessagingCaps({ USERBOT_DM_HOURLY_CAP: '35', USERBOT_DM_DAILY_CAP: '80', USERBOT_DM_JITTER_PERCENT: '10' }),
    { hourlyCap: 35, dailyCap: 80, jitterPercent: 10 },
    'overrides from env'
  );
  assertEqual(
    resolveMessagingCaps({ USERBOT_DM_HOURLY_CAP: 'abc', USERBOT_DM_DAILY_CAP: '', USERBOT_DM_JITTER_PERCENT: 'x7' }),
    { hourlyCap: 20, dailyCap: 50, jitterPercent: 20 },
    'non-numeric → defaults'
  );
  assertEqual(
    resolveMessagingCaps({ USERBOT_DM_HOURLY_CAP: '-3', USERBOT_DM_DAILY_CAP: '-10', USERBOT_DM_JITTER_PERCENT: '-1' }),
    { hourlyCap: 20, dailyCap: 50, jitterPercent: 20 },
    'negative → defaults'
  );
}

// ---------------------------------------------------------------------------
// 2. Pure: estimateCapacity
// ---------------------------------------------------------------------------
console.log('\n[estimateCapacity]');
{
  assertEqual(
    estimateCapacity({ audienceSize: 120, poolSize: 3, dailyCap: 50 }),
    { audienceSize: 120, poolSize: 3, dailyCap: 50, botsNeeded: 3, days: 1 },
    '120 / (3×50) → 3 бота, 1 день'
  );
  assertEqual(
    estimateCapacity({ audienceSize: 120, poolSize: 1, dailyCap: 50 }),
    { audienceSize: 120, poolSize: 1, dailyCap: 50, botsNeeded: 3, days: 3 },
    'один бот растягивает на 3 дня'
  );
  assertEqual(
    estimateCapacity({ audienceSize: 101, poolSize: 2, dailyCap: 50 }),
    { audienceSize: 101, poolSize: 2, dailyCap: 50, botsNeeded: 3, days: 2 },
    'ceil по обеим формулам'
  );
  const impossible = estimateCapacity({ audienceSize: 120, poolSize: 0, dailyCap: 50 });
  assertEqual(impossible.botsNeeded, 3, 'pool 0 → botsNeeded считается');
  assertEqual(impossible.days, null, 'pool 0 → days null (невозможно)');
  assertEqual(
    estimateCapacity({ audienceSize: 0, poolSize: 0, dailyCap: 50 }),
    { audienceSize: 0, poolSize: 0, dailyCap: 50, botsNeeded: 0, days: 0 },
    'audience 0 + pool 0 → оба 0'
  );
  assertEqual(
    estimateCapacity({ audienceSize: 0, poolSize: 3, dailyCap: 50 }),
    { audienceSize: 0, poolSize: 3, dailyCap: 50, botsNeeded: 0, days: 0 },
    'audience 0 → оба 0 даже с пулом'
  );
}

// ---------------------------------------------------------------------------
// 3. Pure: isActorEligible
// ---------------------------------------------------------------------------
console.log('\n[isActorEligible]');
{
  assertTrue(!isActorEligible(null), 'null account → false');
  assertTrue(!isActorEligible(makeAccount('a', { runtime_status: 'pending_activation' })), 'pending_activation → false');
  assertTrue(!isActorEligible(makeAccount('a', { runtime_status: 'restricted' })), 'restricted → false');
  assertTrue(!isActorEligible(makeAccount('a', { runtime_status: 'expired' })), 'expired → false');
  assertTrue(!isActorEligible(makeAccount('a', { runtime_status: 'error' })), 'error → false');
  assertTrue(!isActorEligible(makeAccount('a', { proxy_id: 'p1', proxies: { is_working: false } })), 'dead proxy → false');
  assertTrue(isActorEligible(makeAccount('a', { proxy_id: 'p1', proxies: { is_working: true } })), 'live proxy → true');
  assertTrue(
    !isActorEligible(makeAccount('a', { dm_paused_until: new Date(NOW + 5000).toISOString() }), { now: NOW }),
    'future pause (ISO string) → false'
  );
  assertTrue(
    isActorEligible(makeAccount('a', { dm_paused_until: new Date(NOW - 5000).toISOString() }), { now: NOW }),
    'past pause → true'
  );
  assertTrue(
    isActorEligible(makeAccount('a', { dm_paused_until: new Date(NOW + 5000).toISOString() }), { now: NOW + 10000 }),
    'pause expired by now → true'
  );
  assertTrue(isActorEligible(makeAccount('a')), 'clean account → true');
}

// ---------------------------------------------------------------------------
// 4. Quotas: hourly и daily skip
// ---------------------------------------------------------------------------
console.log('\n[isUnderQuota]');
{
  const supabase = makeMockSupabase({
    sendLog: [...sentRows('ub-1', 20, 60 * 1000)]
  });
  const { router } = makeRouter({ supabase });
  assertEqual(
    await router.isUnderQuota('ub-1', { now: NOW }),
    { ok: false, reason: 'hourly_cap' },
    '20 отправок в час → hourly_cap'
  );
  assertEqual(await router.isUnderQuota('ub-2', { now: NOW }), { ok: true, reason: null }, 'чистый актёр → ok');
}

console.log('\n[quota skip: hourly]');
{
  const supabase = makeMockSupabase({
    accounts: [makeAccount('ub-1'), makeAccount('ub-2')],
    sendLog: sentRows('ub-1', 20, 60 * 1000)
  });
  const { router, calls, delays } = makeRouter({ supabase });
  const result = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  assertEqual(result.actorId, 'ub-2', 'исчерпавший часовой кап пропущен, доставил ub-2');
  assertEqual(calls.map((c) => c.id), ['ub-2'], 'одна попытка — только ub-2');
  assertEqual(delays, [], 'skip по квоте не даёт sleep');
}

console.log('\n[quota skip: daily]');
{
  const supabase = makeMockSupabase({
    accounts: [makeAccount('ub-1'), makeAccount('ub-2')],
    sendLog: [...sentRows('ub-1', 5, 60 * 1000), ...sentRows('ub-1', 45, 2 * HOUR_MS)]
  });
  const { router, calls } = makeRouter({ supabase });
  assertEqual(
    await router.isUnderQuota('ub-1', { now: NOW }),
    { ok: false, reason: 'daily_cap' },
    '5 в час, 50 в сутки → daily_cap'
  );
  const result = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  assertEqual(result.actorId, 'ub-2', 'исчерпавший дневной кап пропущен');
  assertEqual(calls.map((c) => c.id), ['ub-2'], 'попытка только по ub-2');
}

// ---------------------------------------------------------------------------
// 5. flood_wait: пауза retry_after + 30s, clamp 3600, очеловеченный фолбэк
// ---------------------------------------------------------------------------
console.log('\n[flood_wait pause]');
{
  const supabase = makeMockSupabase({
    accounts: [makeAccount('ub-1'), makeAccount('ub-2')]
  });
  const floodError = Object.assign(new Error('FLOOD_WAIT_42'), { retry_after: 42 });
  const { router, calls } = makeRouter({
    supabase,
    send: async (account) => {
      if (account.id === 'ub-1') throw floodError;
      return { success: true };
    }
  });
  const result = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  assertEqual(result.actorId, 'ub-2', 'после flood у первого — доставил второй');
  assertEqual(calls.map((c) => c.id), ['ub-1', 'ub-2'], 'обе попытки совершены');
  const paused = supabase._tables.tg_accounts.find((a) => a.id === 'ub-1');
  assertEqual(
    { until: paused.dm_paused_until, reason: paused.dm_pause_reason },
    { until: new Date(NOW + 42 * 1000 + 30 * 1000).toISOString(), reason: 'flood_wait' },
    'пауза = retry_after + 30s'
  );
  const failedRow = supabase._tables.userbot_send_log.find((r) => r.status === 'failed');
  assertTrue(!!failedRow, 'failed-попытка записана в леджер');
  assertEqual(failedRow?.error_kind, 'flood_wait', 'error_kind = flood_wait');
}

console.log('\n[flood_wait clamp 3600s]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const floodError = Object.assign(new Error('FLOOD_WAIT_9999'), { retry_after: 9999 });
  const { router } = makeRouter({
    supabase,
    send: async () => { throw floodError; }
  });
  await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  const paused = supabase._tables.tg_accounts.find((a) => a.id === 'ub-1');
  assertEqual(
    paused.dm_paused_until,
    new Date(NOW + 3600 * 1000 + 30 * 1000).toISOString(),
    'retry_after зажат одним часом'
  );
}

console.log('\n[flood_wait humanized without seconds → 1h fallback]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const { router } = makeRouter({
    supabase,
    // реальный путь sendMessage: getDirectMessageError теряет retry_after
    send: async () => { throw new Error('Telegram просит притормозить. По этому юзерботу сработал flood wait.'); }
  });
  await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  const paused = supabase._tables.tg_accounts.find((a) => a.id === 'ub-1');
  assertEqual(paused.dm_pause_reason, 'flood_wait', 'очеловеченный текст распознан как flood_wait');
  assertEqual(
    paused.dm_paused_until,
    new Date(NOW + 3600 * 1000 + 30 * 1000).toISOString(),
    'без секунд — консервативный час + 30s'
  );
}

// ---------------------------------------------------------------------------
// 6. account_flagged / session_revoked → пауза 24h (сырые и очеловеченные тексты)
// ---------------------------------------------------------------------------
console.log('\n[account_flagged / session_revoked pause 24h]');
{
  const supabase = makeMockSupabase({
    accounts: [makeAccount('ub-1'), makeAccount('ub-2'), makeAccount('ub-3')]
  });
  const { router } = makeRouter({
    supabase,
    send: async (account) => {
      if (account.id === 'ub-1') throw new Error('Telegram через SpamBot подтвердил, что этот аккаунт заблокирован за нарушения. Этим юзерботом больше нельзя писать.');
      if (account.id === 'ub-2') throw new Error('AUTH_KEY_UNREGISTERED');
      return { success: true };
    }
  });
  const result = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  assertEqual(result.actorId, 'ub-3', 'третий кандидат доставил');
  const accountsById = new Map(supabase._tables.tg_accounts.map((a) => [a.id, a]));
  assertEqual(
    { reason: accountsById.get('ub-1').dm_pause_reason, until: accountsById.get('ub-1').dm_paused_until },
    { reason: 'account_flagged', until: new Date(NOW + DAY_MS).toISOString() },
    'очеловеченный SpamBot-текст → account_flagged на 24h'
  );
  assertEqual(
    { reason: accountsById.get('ub-2').dm_pause_reason, until: accountsById.get('ub-2').dm_paused_until },
    { reason: 'session_revoked', until: new Date(NOW + DAY_MS).toISOString() },
    'AUTH_KEY_UNREGISTERED → session_revoked на 24h'
  );
}

// ---------------------------------------------------------------------------
// 7. Rotation: touchpoint первым, далее по минимуму отправок
// ---------------------------------------------------------------------------
console.log('\n[rotation order]');
{
  const makeEnv = () => makeMockSupabase({
    accounts: [makeAccount('ub-1'), makeAccount('ub-2'), makeAccount('ub-3')],
    sendLog: [...sentRows('ub-1', 5, HOUR_MS), ...sentRows('ub-2', 1, HOUR_MS)]
  });

  const supabaseA = makeEnv();
  const a = makeRouter({ supabase: supabaseA, send: async () => { throw new Error('что-то странное'); } });
  const resultA = await a.router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabaseA._tables.tg_accounts, baseDelayMs: 1000
  });
  assertEqual(resultA.errorKind, 'pool_exhausted', 'все упали → pool_exhausted');
  assertEqual(a.calls.map((c) => c.id), ['ub-3', 'ub-2', 'ub-1'], 'без touchpoint: наименее отправлявший первым');

  const supabaseB = makeEnv();
  const b = makeRouter({ supabase: supabaseB, send: async () => { throw new Error('что-то странное'); } });
  await b.router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabaseB._tables.tg_accounts, baseDelayMs: 1000, touchpointActorId: 'ub-2'
  });
  assertEqual(b.calls.map((c) => c.id), ['ub-2', 'ub-3', 'ub-1'], 'touchpoint-актёр идёт первым');

  assertEqual(a.delays.length, 2, 'между тремя попытками ровно 2 sleep');
}

// ---------------------------------------------------------------------------
// 8. Jitter bounds: ±jitterPercent от baseDelayMs, нет sleep перед первой попыткой
// ---------------------------------------------------------------------------
console.log('\n[jitter bounds]');
{
  const baseEnv = () => makeMockSupabase({
    accounts: [makeAccount('ub-1'), makeAccount('ub-2')]
  });
  const failFirst = async (account) => {
    if (account.id === 'ub-1') throw new Error('что-то странное');
    return { success: true };
  };

  const supabaseLow = baseEnv();
  const low = makeRouter({ supabase: supabaseLow, send: failFirst, randomQueue: [0] });
  await low.router.deliver({ ownerId: OWNER, tgUserId: '700', text: 'привет', pool: supabaseLow._tables.tg_accounts, baseDelayMs: 1000 });
  assertEqual(low.delays, [800], 'random=0 → base −20% = 800');

  const supabaseMid = baseEnv();
  const mid = makeRouter({ supabase: supabaseMid, send: failFirst, randomQueue: [0.5] });
  await mid.router.deliver({ ownerId: OWNER, tgUserId: '700', text: 'привет', pool: supabaseMid._tables.tg_accounts, baseDelayMs: 1000 });
  assertEqual(mid.delays, [1000], 'random=0.5 → ровно base = 1000');

  const supabaseHigh = baseEnv();
  const high = makeRouter({ supabase: supabaseHigh, send: failFirst, randomQueue: [1] });
  await high.router.deliver({ ownerId: OWNER, tgUserId: '700', text: 'привет', pool: supabaseHigh._tables.tg_accounts, baseDelayMs: 1000 });
  assertEqual(high.delays, [1200], 'random=1 → base +20% = 1200');

  const supabaseHappy = baseEnv();
  const happy = makeRouter({ supabase: supabaseHappy });
  await happy.router.deliver({ ownerId: OWNER, tgUserId: '700', text: 'привет', pool: supabaseHappy._tables.tg_accounts, baseDelayMs: 1000 });
  assertEqual(happy.delays, [], 'успех с первой попытки → sleep нет');
}

// ---------------------------------------------------------------------------
// 9. recordSend: идемпотентность
// ---------------------------------------------------------------------------
console.log('\n[recordSend idempotency]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const { router } = makeRouter({ supabase });
  assertEqual(
    await router.recordSend({ ownerId: OWNER, actorId: 'ub-1', tgUserId: '700', status: 'sent', idempotencyKey: 'k1' }),
    { recorded: true },
    'первая запись с ключом → recorded'
  );
  assertEqual(
    await router.recordSend({ ownerId: OWNER, actorId: 'ub-1', tgUserId: '700', status: 'sent', idempotencyKey: 'k1' }),
    { recorded: false },
    'повтор того же ключа → recorded:false, без throw'
  );
  assertEqual(
    await router.recordSend({ ownerId: OWNER, actorId: 'ub-1', tgUserId: '700', status: 'sent', idempotencyKey: 'k2' }),
    { recorded: true },
    'другой ключ → recorded'
  );
  assertEqual(supabase._tables.userbot_send_log.length, 2, 'в леджере 2 строки, дубль не записан');
}

// ---------------------------------------------------------------------------
// 10. deliver happy path
// ---------------------------------------------------------------------------
console.log('\n[deliver happy path]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const { router, calls, delays } = makeRouter({ supabase });
  const result = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет', pool: supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  assertEqual(
    result,
    { status: 'sent', actorType: 'userbot', actorId: 'ub-1', errorKind: null, errorText: null },
    'форма успешного результата'
  );
  assertEqual(
    calls[0],
    { id: 'ub-1', tgUserId: '700', text: 'привет', options: { event_source: 'messaging_router', event_type: 'messaging_router' } },
    'sender получил опции роутера (без common_chat_id)'
  );
  const row = supabase._tables.userbot_send_log[0];
  assertTrue(!!row, 'send-строка записана');
  assertEqual(
    { owner_id: row.owner_id, actor_id: row.actor_id, actor_type: row.actor_type, tg_user_id: row.tg_user_id, status: row.status, campaign_id: row.campaign_id },
    { owner_id: OWNER, actor_id: 'ub-1', actor_type: 'userbot', tg_user_id: '700', status: 'sent', campaign_id: null },
    'поля леджер-строки'
  );
  assertEqual(delays, [], 'одна попытка — без sleep');

  const withCommonChat = makeRouter({ supabase: makeMockSupabase({ accounts: [makeAccount('ub-1')] }) });
  await withCommonChat.router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет', pool: withCommonChat.router.supabase._tables.tg_accounts,
    commonChatId: '-100222', campaignId: 'camp-1'
  });
  assertEqual(
    withCommonChat.calls[0].options,
    { event_source: 'messaging_router', event_type: 'messaging_router', campaign_id: 'camp-1', common_chat_id: '-100222' },
    'common_chat_id и campaign_id пробрасываются в sender'
  );
}

// ---------------------------------------------------------------------------
// 11. deliver pool exhausted
// ---------------------------------------------------------------------------
console.log('\n[deliver pool exhausted]');
{
  const empty = makeRouter({ supabase: makeMockSupabase() });
  const emptyResult = await empty.router.deliver({ ownerId: OWNER, tgUserId: '700', text: 'привет', pool: [] });
  assertEqual(
    emptyResult,
    { status: 'failed', actorType: null, actorId: null, errorKind: 'pool_exhausted', errorText: 'Юзерботы пула недоступны: пауза, квота или ошибка Telegram.' },
    'пустой пул → pool_exhausted'
  );
  assertEqual(empty.calls.length, 0, 'пустой пул — отправок нет');

  const capped = makeRouter({
    supabase: makeMockSupabase({
      accounts: [makeAccount('ub-1')],
      sendLog: sentRows('ub-1', 50, 60 * 1000)
    })
  });
  const cappedResult = await capped.router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: capped.router.supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  assertEqual(cappedResult.errorKind, 'pool_exhausted', 'кандидат сверх квоты → pool_exhausted');
  assertEqual(capped.calls.length, 0, 'ни одной попытки отправки');
}

// ---------------------------------------------------------------------------
// 12. Паузы: pauseActor / getActorPause / clearPause roundtrip (owner-scoped)
// ---------------------------------------------------------------------------
console.log('\n[actor pause roundtrip]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const { router } = makeRouter({ supabase });
  assertEqual(await router.getActorPause('ub-1'), null, 'без паузы → null');
  await router.pauseActor('ub-1', new Date(NOW + 60 * 1000).toISOString(), 'flood_wait', OWNER);
  assertEqual(
    await router.getActorPause('ub-1'),
    { until: new Date(NOW + 60 * 1000).toISOString(), reason: 'flood_wait' },
    'pauseActor → getActorPause'
  );
  await router.clearPause('ub-1', OWNER);
  assertEqual(await router.getActorPause('ub-1'), null, 'clearPause → null');

  await router.pauseActor('ub-1', new Date(NOW + 60 * 1000).toISOString(), 'flood_wait', 'чужой-owner');
  assertEqual(await router.getActorPause('ub-1'), null, 'чужой owner не трогает чужую строку (owner-фильтр в update)');
}

// ---------------------------------------------------------------------------
// 13. P1-1: flood-пауза зеркалится на in-memory пул, повторный deliver без попыток
// ---------------------------------------------------------------------------
console.log('\n[flood pause mirrored onto in-memory pool]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const floodError = Object.assign(new Error('FLOOD_WAIT_42'), { retry_after: 42 });
  // Копии строк: мок-БД мутирует свои объекты, значит поля на копиях пула может
  // поставить только зеркало роутера — тест не полагается на мутацию мок-БД.
  const poolCopies = supabase._tables.tg_accounts.map((a) => ({ ...a }));
  const { router, calls } = makeRouter({
    supabase,
    send: async () => { throw floodError; }
  });
  const first = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: poolCopies, baseDelayMs: 1000
  });
  assertEqual(first.errorKind, 'pool_exhausted', 'единственный актор во flood → pool_exhausted');
  assertTrue(poolCopies[0].dm_paused_until != null, 'in-memory пул несёт dm_paused_until после flood');
  assertEqual(poolCopies[0].dm_pause_reason, 'flood_wait', 'in-memory пул несёт dm_pause_reason после flood');

  const second = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: poolCopies, baseDelayMs: 1000
  });
  assertEqual(
    second,
    { status: 'failed', actorType: null, actorId: null, errorKind: 'pool_exhausted', errorText: 'Юзерботы пула недоступны: пауза, квота или ошибка Telegram.' },
    'повторный deliver видит паузу в памяти → pool_exhausted (quotaWait-семантика)'
  );
  assertEqual(calls.length, 1, 'повторный deliver не дёргает sender (нет новой атаки по flood-сессии)');
}

// ---------------------------------------------------------------------------
// 14. P2-5: ключ идемпотентности держит только первая попытка deliver
// ---------------------------------------------------------------------------
console.log('\n[idempotency key on first attempt only]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1'), makeAccount('ub-2')] });
  const { router } = makeRouter({
    supabase,
    send: async (account) => {
      if (account.id === 'ub-1') throw new Error('что-то странное');
      return { success: true };
    }
  });
  const result = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabase._tables.tg_accounts, baseDelayMs: 1000, idempotencyKey: 'k-retry'
  });
  assertEqual(result.status, 'sent', 'ретрай после не-паузы доставил');
  const rows = supabase._tables.userbot_send_log;
  assertEqual(rows.length, 2, 'обе попытки в леджере');
  assertEqual(
    { status: rows[0]?.status, key: rows[0]?.idempotency_key, actor: rows[0]?.actor_id },
    { status: 'failed', key: 'k-retry', actor: 'ub-1' },
    'первая попытка держит ключ'
  );
  assertEqual(
    { status: rows[1]?.status, key: rows[1]?.idempotency_key, actor: rows[1]?.actor_id },
    { status: 'sent', key: null, actor: 'ub-2' },
    'вторая попытка записана без ключа'
  );
}

console.log(`\n=== messaging-router: ${passes} passed, ${failures} failed ===`);
if (failures > 0) process.exit(1);
