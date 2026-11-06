/**
 * Общие фикстуры и ассерты для test/test-broadcast-router.js.
 */
import { MessagingRouter } from '../../services/messaging-router.service.js';
import {
    createBroadcastDeliverySender,
    hasDeliverableActor,
    isActorPermanentlyUnavailable,
    isDeliverableCampaignStatus,
    isPureUserbotSenderType,
    planCampaignFinalization
} from '../../services/broadcast-delivery.service.js';

export {
    createBroadcastDeliverySender,
    hasDeliverableActor,
    isActorPermanentlyUnavailable,
    isDeliverableCampaignStatus,
    isPureUserbotSenderType,
    planCampaignFinalization
};

// Якорь времени: ДЕЙСТВИТЕЛЬНОЕ «сейчас». isPoolQuotaPaused в сервисе проверяет
// паузы актёров по реальным часам — фиксированный якорь из прошлого сломал бы это.
export const NOW = Date.now();
export const HOUR_MS = 60 * 60 * 1000;
export const OWNER = '11111111-1111-4111-8111-111111111111';
export const CAMPAIGN = '22222222-2222-4222-8222-222222222222';

export const state = { passes: 0, failures: 0 };
export function ok(label) { state.passes++; console.log(`  ✓ ${label}`); }
export function fail(label, expected, actual) {
  state.failures++;
  console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
}
export function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
  else fail(label, expected, actual);
}
export function assertTrue(cond, label, extra = null) {
  if (cond) ok(label);
  else fail(label, true, extra);
}

// ---------------------------------------------------------------------------
// Mock Supabase: in-memory userbot_send_log + tg_accounts.
// Поддержка: select head-count, eq/gte/in фильтры, insert, update.eq
// ---------------------------------------------------------------------------
export function makeMockSupabase({ sendLog = [], accounts = [] } = {}) {
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
export function makeAccount(id, patch = {}) {
  return {
    id, owner_id: OWNER, account_type: 'userbot', runtime_status: 'ok',
    tg_username: `ub_${id}`, tg_account_id: id,
    proxy_id: null, proxies: null, dm_paused_until: null, dm_pause_reason: null,
    ...patch
  };
}

export function sentRows(actorId, count, ageMs) {
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

export function makeRouter(supabase, sendImpl = null) {
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

export function makeFakeRouter(deliverImpl, quota = { ok: true, reason: null }) {
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

export function makeSender(supabase, router, getBotById = () => null) {
  return createBroadcastDeliverySender({ supabase, getBotById, router });
}

export function makeRow(tgUserId = '700', botId = null) {
  return { tg_user_id: tgUserId, bot_id: botId, channel_id: null };
}

export async function deliverOne(sender, { senderType = 'userbot_only', userbots, matrix = null, row = null, botId = null } = {}) {
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
