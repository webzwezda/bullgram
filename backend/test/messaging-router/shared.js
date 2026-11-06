/**
 * Общие фикстуры и ассерты для test/test-messaging-router.js.
 */
import { MessagingRouter, estimateCapacity, isActorEligible, resolveMessagingCaps } from '../../services/messaging-router.service.js';

export { estimateCapacity, isActorEligible, resolveMessagingCaps };

export const NOW = 1758000000000;
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const OWNER = '11111111-1111-4111-8111-111111111111';

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
// Mock Supabase: in-memory userbot_send_log + tg_accounts, generic filter builder.
// insert эмулирует partial unique index по idempotency_key (23505).
// ---------------------------------------------------------------------------
export function makeMockSupabase({ accounts = [], sendLog = [] } = {}) {
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
export function makeAccount(id, patch = {}) {
  return {
    id, owner_id: OWNER, account_type: 'userbot', runtime_status: 'ok',
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

export function makeRouter({ supabase, send = null, randomQueue = [] } = {}) {
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
