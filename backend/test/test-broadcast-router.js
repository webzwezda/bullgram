/**
 * Offline tests for broadcast delivery on the messaging router.
 * Запуск: node test/test-broadcast-router.js
 *
 * Strategy: no network, no Supabase, no Telegram traffic.
 *   - pure helpers tested directly (isActorPermanentlyUnavailable, hasDeliverableActor,
 *     isPureUserbotSenderType, isDeliverableCampaignStatus, planCampaignFinalization)
 *   - recipient outcome mapping via createBroadcastDeliverySender with a fake router
 *   - end-to-end mapping through the REAL MessagingRouter with fake supabase +
 *     fake sendUserbot (ledger inference for blocked-by-user, quota wait)
 *
 * Covered scenarios:
 *   - router result 'sent' → delivered, actualSenderUserbot берётся из actorId
 *   - router result failed(user_blocked) → blockedByUser
 *   - router result failed(flood_wait) → failed без blockedByUser
 *   - pool_exhausted + весь пул на квоте/паузе → quotaWait (строка остаётся pending)
 *   - pool_exhausted + попытки были + леджер без privacy → failed без blockedByUser
 *   - REAL router: privacy-ошибка юзербота → pool_exhausted → леджер → blockedByUser
 *   - REAL router: flood_wait → пауза актёра → quotaWait pending
 *   - REAL router: flood-пауза зеркалится на in-memory пул (P1-1) → quotaWait вместо failed,
 *     повторная доставка в том же тике без новых попыток
 *   - REAL router: дневная квота исчерпана → quotaWait без попыток
 *   - touchpoint-приоритет: pool порядок, touchpointActorId, commonChatId, campaignId, ownerId, baseDelayMs
 *   - official_only: ошибка бота классифицируется как раньше (blockedByUser)
 *   - dead-pool helper: пустой пул / все restricted / длинная пауза → нет живых; flood-пауза → жив
 *   - planCampaignFinalization: finalize sent/completed_with_errors, wait с heartbeat, wait без вставок
 *   - isDeliverableCampaignStatus: отменённая кампания не финализируется
 */
import { MessagingRouter } from '../services/messaging-router.service.js';
import {
    createBroadcastDeliverySender,
    hasDeliverableActor,
    isActorPermanentlyUnavailable,
    isDeliverableCampaignStatus,
    isPureUserbotSenderType,
    planCampaignFinalization
} from '../services/broadcast-delivery.service.js';

// Пинним капы: тесты не должны зависеть от амбиентного .env
process.env.USERBOT_DM_HOURLY_CAP = '20';
process.env.USERBOT_DM_DAILY_CAP = '50';
process.env.USERBOT_DM_JITTER_PERCENT = '20';

// Якорь времени: ДЕЙСТВИТЕЛЬНОЕ «сейчас». isPoolQuotaPaused в сервисе проверяет
// паузы актёров по реальным часам — фиксированный якорь из прошлого сломал бы это.
const NOW = Date.now();
const HOUR_MS = 60 * 60 * 1000;
const OWNER = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN = '22222222-2222-4222-8222-222222222222';

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
// Mock Supabase: in-memory userbot_send_log + tg_accounts.
// Поддержка: select head-count, eq/gte/in фильтры, insert, update.eq
// ---------------------------------------------------------------------------
function makeMockSupabase({ sendLog = [], accounts = [] } = {}) {
  const tables = {
    userbot_send_log: sendLog.map((row) => ({ ...row })),
    tg_accounts: accounts.map((row) => ({ ...row }))
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
        if (op === 'in') return (val || []).some((v) => String(cell) === String(v));
        return true;
      }));
      const builder = {
        select(_cols, opts = {}) { selectOpts = opts || {}; return builder; },
        eq(col, val) { filters.push([col, 'eq', val]); return builder; },
        gte(col, val) { filters.push([col, 'gte', val]); return builder; },
        in(col, vals) { filters.push([col, 'in', vals]); return builder; },
        insert(payload) {
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
    tg_username: `ub_${id}`, tg_account_id: id,
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

function makeRouter(supabase, sendImpl = null) {
  const calls = [];
  const router = new MessagingRouter({
    supabase,
    now: () => NOW,
    sleep: async () => {},
    random: () => 0.5,
    sendUserbot: async (account, tgUserId, text, options) => {
      calls.push({ id: String(account.id), tgUserId, text, options });
      if (sendImpl) return await sendImpl(account, tgUserId, text, options);
      return { success: true };
    }
  });
  return { router, calls };
}

function makeFakeRouter(deliverImpl, quota = { ok: true, reason: null }) {
  const deliverCalls = [];
  return {
    deliverCalls,
    deliver: async (args) => {
      deliverCalls.push(args);
      return deliverImpl(args);
    },
    isUnderQuota: async () => quota
  };
}

function makeSender(supabase, router, getBotById = () => null) {
  return createBroadcastDeliverySender({ supabase, getBotById, router });
}

function makeRow(tgUserId = '700', botId = null) {
  return { tg_user_id: tgUserId, bot_id: botId, channel_id: null };
}

async function deliverOne(sender, { senderType = 'userbot_only', userbots, matrix = null, row = null, botId = null } = {}) {
  return await sender.deliverToRecipient({
    ownerId: OWNER,
    campaignId: CAMPAIGN,
    messageText: 'привет',
    senderType,
    selectedUserbots: userbots,
    preparationMatrix: matrix,
    row: row || makeRow('700', botId),
    baseDelayMs: 1000
  });
}

// ---------------------------------------------------------------------------
// 1. Pure: sender-type helpers
// ---------------------------------------------------------------------------
console.log('\n[sender-type helpers]');
{
  assertTrue(isPureUserbotSenderType('userbot_only'), 'userbot_only — чисто юзерботный');
  assertTrue(isPureUserbotSenderType('userbot_pool_round_robin'), 'pool round robin — чисто юзерботный');
  assertTrue(!isPureUserbotSenderType('official_then_userbot'), 'official_then_userbot — с фолбэком');
  assertTrue(!isPureUserbotSenderType('official_only'), 'official_only — не юзерботный');
}

// ---------------------------------------------------------------------------
// 2. Pure: dead-pool helpers (очередь queue_error у чисто-юзерботных кампаний)
// ---------------------------------------------------------------------------
console.log('\n[hasDeliverableActor / isActorPermanentlyUnavailable]');
{
  assertTrue(!hasDeliverableActor([]), 'пустой пул → живых нет');
  assertTrue(!hasDeliverableActor([makeAccount('a', { runtime_status: 'restricted' })]), 'все restricted → живых нет');
  assertTrue(
    !hasDeliverableActor([makeAccount('a', { dm_paused_until: new Date(NOW + 24 * HOUR_MS).toISOString(), dm_pause_reason: 'account_flagged' })], { now: NOW }),
    'длинная пауза (flagged) → живых нет'
  );
  assertTrue(
    hasDeliverableActor([makeAccount('a', { dm_paused_until: new Date(NOW + 60 * 1000).toISOString(), dm_pause_reason: 'flood_wait' })], { now: NOW }),
    'flood-пауза — временная, актёр жив'
  );
  assertTrue(
    hasDeliverableActor([makeAccount('a', { runtime_status: 'restricted' }), makeAccount('b')]),
    'один живой среди мёртвых → пул годен'
  );
  assertTrue(isActorPermanentlyUnavailable(null), 'null-актёр — мёртв');
}

// ---------------------------------------------------------------------------
// 3. Pure: финализация и cancel-wins
// ---------------------------------------------------------------------------
console.log('\n[planCampaignFinalization]');
{
  const nowIso = new Date(NOW).toISOString();
  const allSent = planCampaignFinalization(
    [{ delivery_status: 'sent' }, { delivery_status: 'sent' }],
    { total: 2 },
    nowIso
  );
  assertEqual(allSent.action, 'finalize', 'все sent → финализируем');
  assertEqual(allSent.status, 'sent', 'без ошибок → sent');
  assertEqual(allSent.counts, { sent: 2, failed: 0, pending: 0, total: 2 }, 'счётчики');

  const withErrors = planCampaignFinalization(
    [{ delivery_status: 'sent' }, { delivery_status: 'failed' }],
    { total: 2 },
    nowIso
  );
  assertEqual(withErrors.status, 'completed_with_errors', 'есть failed → completed_with_errors');

  const withPending = planCampaignFinalization(
    [{ delivery_status: 'sent' }, { delivery_status: 'pending' }],
    { total: 2 },
    nowIso
  );
  assertEqual(withPending.action, 'wait', 'pending-строки → ждём, не финализируем');
  assertEqual(withPending.refreshHeartbeat, true, 'ждём со свежим heartbeat');
  assertEqual(withPending.meta.delivery_heartbeat_at, nowIso, 'heartbeat обновлён');
  assertEqual(withPending.status, null, 'статус не трогаем');

  const awaitingInsert = planCampaignFinalization([], { total: 5 }, nowIso);
  assertEqual(awaitingInsert.action, 'wait', 'строк нет, total обещан → ждём вставки');
  assertEqual(awaitingInsert.refreshHeartbeat, false, 'heartbeat не трогаем');

  const empty = planCampaignFinalization([], { total: 0 }, nowIso);
  assertEqual(empty.action, 'finalize', 'пустая кампания без обещаний → финализируем');
  assertEqual(empty.status, 'sent', 'пустая кампания → sent');
}

console.log('\n[isDeliverableCampaignStatus: cancel wins]');
{
  assertTrue(isDeliverableCampaignStatus('sending'), 'sending — доставляем и финализируем');
  assertTrue(!isDeliverableCampaignStatus('cancelled'), 'cancelled — стоп, финализация не перезапишет');
  assertTrue(!isDeliverableCampaignStatus('queued'), 'queued — не наша фаза');
  assertTrue(!isDeliverableCampaignStatus(null), 'null → false');
}

// ---------------------------------------------------------------------------
// 4. Outcome mapping: fake router
// ---------------------------------------------------------------------------
console.log('\n[outcome mapping: sent]');
{
  const sender = makeSender(makeMockSupabase(), makeFakeRouter(
    () => ({ status: 'sent', actorType: 'userbot', actorId: 'ub-2', errorKind: null, errorText: null })
  ));
  const result = await deliverOne(sender, {
    senderType: 'userbot_pool_round_robin',
    userbots: [makeAccount('ub-1'), makeAccount('ub-2')]
  });
  assertEqual(result.deliveryStatus, 'sent', 'router sent → delivered');
  assertEqual(result.sentViaUserbot, true, 'sentViaUserbot');
  assertEqual(result.actualSenderUserbot?.id, 'ub-2', 'sender stats из actorId роутера');
  assertEqual(result.blockedByUser, false, 'без blockedByUser');
  assertEqual(result.quotaWait, false, 'без quotaWait');
}

console.log('\n[outcome mapping: blocked by user]');
{
  const sender = makeSender(makeMockSupabase(), makeFakeRouter(
    () => ({ status: 'failed', actorType: 'userbot', actorId: 'ub-1', errorKind: 'user_blocked', errorText: 'получатель заблокировал юзербота' })
  ));
  const result = await deliverOne(sender, { userbots: [makeAccount('ub-1')] });
  assertEqual(result.deliveryStatus, 'failed', 'failed');
  assertEqual(result.blockedByUser, true, 'user_blocked → blockedByUser (dm_blocked writeback)');
}

console.log('\n[outcome mapping: other failures]');
{
  const sender = makeSender(makeMockSupabase(), makeFakeRouter(
    () => ({ status: 'failed', actorType: 'userbot', actorId: 'ub-1', errorKind: 'flood_wait', errorText: 'flood' })
  ));
  const result = await deliverOne(sender, { userbots: [makeAccount('ub-1')] });
  assertEqual(result.deliveryStatus, 'failed', 'failed');
  assertEqual(result.blockedByUser, false, 'flood_wait — не blockedByUser');
}

console.log('\n[outcome mapping: pool_exhausted, весь пул на квоте → quotaWait]');
{
  const sender = makeSender(makeMockSupabase(), makeFakeRouter(
    () => ({ status: 'failed', actorType: null, actorId: null, errorKind: 'pool_exhausted', errorText: 'пул недоступен' }),
    { ok: false, reason: 'daily_cap' }
  ));
  const result = await deliverOne(sender, { userbots: [makeAccount('ub-1'), makeAccount('ub-2')] });
  assertEqual(result.quotaWait, true, 'все на квоте → quotaWait');
  assertEqual(result.deliveryStatus, 'pending', 'строка остаётся pending');
  assertEqual(result.blockedByUser, false, 'без blockedByUser');
}

console.log('\n[outcome mapping: pool_exhausted, попытки были, леджер чистый → failed]');
{
  const sender = makeSender(makeMockSupabase(), makeFakeRouter(
    () => ({ status: 'failed', actorType: null, actorId: null, errorKind: 'pool_exhausted', errorText: 'пул недоступен' }),
    { ok: true, reason: null }
  ));
  const result = await deliverOne(sender, { userbots: [makeAccount('ub-1')] });
  assertEqual(result.quotaWait, false, 'квота есть — значит пытались');
  assertEqual(result.deliveryStatus, 'failed', 'попытки провалились → failed');
  assertEqual(result.blockedByUser, false, 'в леджере нет privacy → не blockedByUser');
}

console.log('\n[outcome mapping: touchpoint passthrough]');
{
  const fakeRouter = makeFakeRouter(
    () => ({ status: 'sent', actorType: 'userbot', actorId: 'ub-2', errorKind: null, errorText: null })
  );
  const sender = makeSender(makeMockSupabase(), fakeRouter);
  const matrix = new Map([
    ['700', [{ userbot_id: 'ub-2', confirmed: 1, via: 'shared_chat', chat_id: '-100555' }]]
  ]);
  const result = await deliverOne(sender, {
    senderType: 'userbot_pool_round_robin',
    userbots: [makeAccount('ub-1'), makeAccount('ub-2')],
    matrix
  });
  assertEqual(result.deliveryStatus, 'sent', 'доставлено');
  const call = fakeRouter.deliverCalls[0];
  assertEqual(call.ownerId, OWNER, 'ownerId проброшен в роутер');
  assertEqual(call.campaignId, CAMPAIGN, 'campaignId проброшен в роутер');
  assertEqual(call.touchpointActorId, 'ub-2', 'touchpointActorId из матрицы');
  assertEqual(call.commonChatId, '-100555', 'commonChatId для shared_chat');
  assertEqual(call.pool.map((u) => u.id), ['ub-1', 'ub-2'], 'весь пул передан; порядок решает роутер по touchpointActorId');
  assertEqual(call.baseDelayMs, 1000, 'baseDelayMs проброшен');
  assertEqual(call.eventSource, 'broadcast', 'eventSource = broadcast');
}

console.log('\n[outcome mapping: official bot leg preserved]');
{
  const officialOnlySender = createBroadcastDeliverySender({
    supabase: makeMockSupabase(),
    getBotById: () => ({ telegram: { sendMessage: async () => { throw new Error('Telegram API: 403 USER_IS_BLOCKED bot was blocked by the user'); } } }),
    router: makeFakeRouter(() => ({ status: 'sent', actorType: 'userbot', actorId: 'x', errorKind: null, errorText: null }))
  });
  const result = await officialOnlySender.deliverToRecipient({
    ownerId: OWNER,
    campaignId: CAMPAIGN,
    messageText: 'привет',
    senderType: 'official_only',
    selectedUserbots: [],
    preparationMatrix: null,
    row: makeRow('700', 'bot-1'),
    baseDelayMs: 1000
  });
  assertEqual(result.deliveryStatus, 'failed', 'бот не смог → failed');
  assertEqual(result.blockedByUser, true, 'USER_IS_BLOCKED → blockedByUser как раньше');
  assertEqual(result.sentViaUserbot, false, 'юзербот-нога не тронута');
}

// ---------------------------------------------------------------------------
// 5. REAL router: privacy error → леджер → blockedByUser
// ---------------------------------------------------------------------------
console.log('\n[real router: privacy error → blockedByUser via ledger]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const { router } = makeRouter(supabase, async () => {
    throw new Error('Не смог написать: пользователь закрыл приватность от юзербота.');
  });
  const sender = makeSender(supabase, router);
  const result = await deliverOne(sender, { userbots: supabase._tables.tg_accounts });
  assertEqual(result.deliveryStatus, 'failed', 'доставка не удалась');
  assertEqual(result.blockedByUser, true, 'privacy_restricted в леджере → blockedByUser');
  assertEqual(result.quotaWait, false, 'актёры пытались, не ждём');
  const failedRow = supabase._tables.userbot_send_log.find((r) => r.status === 'failed');
  assertEqual(failedRow?.error_kind, 'privacy_restricted', 'леджер хранит privacy_restricted');
  assertEqual(failedRow?.campaign_id, CAMPAIGN, 'леджер-строка связана с кампанией');
}

// ---------------------------------------------------------------------------
// 6. REAL router: flood_wait → пауза → quotaWait pending
// ---------------------------------------------------------------------------
console.log('\n[real router: flood_wait → quotaWait]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const { router } = makeRouter(supabase, async () => {
    throw Object.assign(new Error('FLOOD_WAIT_42'), { retry_after: 42 });
  });
  const sender = makeSender(supabase, router);
  const result = await deliverOne(sender, { userbots: supabase._tables.tg_accounts });
  assertEqual(result.quotaWait, true, 'актёр ушёл в flood-паузу → ждём');
  assertEqual(result.deliveryStatus, 'pending', 'строка pending');
  const paused = supabase._tables.tg_accounts.find((a) => a.id === 'ub-1');
  assertEqual(
    { until: paused.dm_paused_until, reason: paused.dm_pause_reason },
    { until: new Date(NOW + 42 * 1000 + 30 * 1000).toISOString(), reason: 'flood_wait' },
    'актёр запаузен роутером'
  );
}

// ---------------------------------------------------------------------------
// 6b. P1-1: flood-пауза зеркалится на in-memory пул → quotaWait вместо failed,
//     повторная доставка в том же тике без новых попыток к Telegram
// ---------------------------------------------------------------------------
console.log('\n[real router: весь пул во flood — stale-снимок пула видит паузу сразу]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1'), makeAccount('ub-2')] });
  const { router, calls } = makeRouter(supabase, async () => {
    throw Object.assign(new Error('FLOOD_WAIT_60'), { retry_after: 60 });
  });
  const sender = makeSender(supabase, router);
  // Копии строк: мок-БД мутирует свои объекты, значит in-memory пул обновляет
  // только зеркало роутера — как реальный снимок пула в джобе (load-once-per-claim).
  const stalePool = supabase._tables.tg_accounts.map((a) => ({ ...a }));
  const first = await deliverOne(sender, { senderType: 'userbot_pool_round_robin', userbots: stalePool });
  assertEqual(first.quotaWait, true, 'оба актора во flood → quotaWait, а не permanent failed');
  assertEqual(first.deliveryStatus, 'pending', 'строка остаётся pending');
  assertEqual(calls.length, 2, 'по одной честной попытке на актора');
  assertTrue(
    stalePool.every((a) => a.dm_pause_reason === 'flood_wait' && a.dm_paused_until != null),
    'in-memory пул несёт flood-паузы после первой доставки'
  );

  const second = await deliverOne(sender, { senderType: 'userbot_pool_round_robin', userbots: stalePool });
  assertEqual(second.quotaWait, true, 'повторная доставка тому же получателю — снова quotaWait');
  assertEqual(calls.length, 2, 'новых попыток к Telegram нет — паузу видно из памяти');
}

// ---------------------------------------------------------------------------
// 7. REAL router: дневная квота исчерпана → quotaWait без попыток
// ---------------------------------------------------------------------------
console.log('\n[real router: daily quota → quotaWait]');
{
  const supabase = makeMockSupabase({
    accounts: [makeAccount('ub-1')],
    sendLog: sentRows('ub-1', 50, 60 * 1000)
  });
  const { router, calls } = makeRouter(supabase);
  const sender = makeSender(supabase, router);
  const result = await deliverOne(sender, { userbots: supabase._tables.tg_accounts });
  assertEqual(result.quotaWait, true, 'квота исчерпана → quotaWait');
  assertEqual(result.deliveryStatus, 'pending', 'строка pending');
  assertEqual(calls.length, 0, 'попыток отправки нет');
}

// ---------------------------------------------------------------------------
// 8. REAL router: happy path через фабрику
// ---------------------------------------------------------------------------
console.log('\n[real router: happy path]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const { router, calls } = makeRouter(supabase);
  const sender = makeSender(supabase, router);
  const result = await deliverOne(sender, { userbots: supabase._tables.tg_accounts });
  assertEqual(result.deliveryStatus, 'sent', 'доставлено');
  assertEqual(result.actualSenderUserbot?.id, 'ub-1', 'sender stats из роутера');
  assertEqual(calls[0]?.options.campaign_id, CAMPAIGN, 'campaign_id ушёл в sender-опции');
  assertEqual(calls[0]?.options.event_source, 'broadcast', 'event_source = broadcast');
  const sentRow = supabase._tables.userbot_send_log[0];
  assertEqual(sentRow?.status, 'sent', 'успех записан в леджер');
}

// ---------------------------------------------------------------------------
// 9. Фабрика без роутера — программная ошибка
// ---------------------------------------------------------------------------
console.log('\n[factory guards]');
{
  let threw = false;
  try {
    createBroadcastDeliverySender({ supabase: makeMockSupabase(), getBotById: () => null });
  } catch (error) {
    threw = true;
  }
  assertTrue(threw, 'без router фабрика бросает');
}

console.log(`\n=== broadcast-router: ${passes} passed, ${failures} failed ===`);
if (failures > 0) process.exit(1);
