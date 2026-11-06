/**
 * Общие фикстуры и ассерты для test/test-broadcast-cleanup.js.
 * Хост импортирует этот модуль ДИНАМИЧЕСКИ — уже после установки ENCRYPTION_KEY
 * (crypto.js через userbot.service требует ключ на импорте), поэтому статические
 * импорты джобы и сервиса здесь безопасны. Сами модули сеть не трогают.
 */
import { Api } from 'telegram';
import { createBroadcastMembershipCleanup } from '../../jobs/broadcast-membership-cleanup.job.js';
import {
    recordPreparationJoin,
    toMarkedChatId,
    resolveMarkedChatId,
    BroadcastPreparationService
} from '../../services/broadcast-preparation.service.js';

export { recordPreparationJoin, toMarkedChatId, resolveMarkedChatId, BroadcastPreparationService };

export const OWNER = '11111111-1111-4111-8111-111111111111';
export const CAMP = '22222222-2222-4222-8222-222222222222';
export const PREP = '33333333-3333-4333-8333-333333333333';
export const UB1 = '44444444-4444-4444-8444-444444444444';
export const UB2 = '55555555-5555-4555-8555-555555555555';
export const NOW = 1758000000000;
export const NOW_ISO = new Date(NOW).toISOString();

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
// Mock Supabase: in-memory таблицы, generic filter builder (eq/in/gte/filter/not/order/limit),
// insert, условный update (цепочка .eq(...).filter(...)), maybeSingle.
// ВАЖНО: isNull/isNotNull у мока НЕТ — как и у реального supabase-js 2.99 после
// .select()/.update(). Код джобы обязан фильтровать IS NULL через .filter('col', 'is', null).
// ---------------------------------------------------------------------------
export function makeMockSupabase(tablesInit = {}) {
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
export function makeCampaign(overrides = {}) {
  return {
    id: CAMP, owner_id: OWNER, status: 'sent',
    meta: { leave_groups_on_complete: true, preparation_id: PREP },
    created_at: NOW_ISO,
    ...overrides
  };
}

export function makeJoin(overrides = {}) {
  return {
    id: overrides.id || `join-${Math.random().toString(16).slice(2, 10)}`,
    owner_id: OWNER, preparation_id: PREP, userbot_id: UB1,
    tg_chat_id: '-100555', chat_title: 'Чужая группа',
    granted_admin: false, joined_at: NOW_ISO,
    removed_at: null, remove_status: null, remove_error: null,
    ...overrides
  };
}

export function makeAccount(overrides = {}) {
  return {
    id: UB1, owner_id: OWNER, account_type: 'userbot',
    runtime_status: 'ok', tg_username: 'ub1', tg_account_id: '424242',
    session_data: 'encrypted-session', proxy_id: null, proxies: null,
    ...overrides
  };
}

export function makeClientFactory(impl = {}) {
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

export function makeEnv({ tables = {}, clientImpl = {}, kickViaPromoter = null, random = () => 0.5, sleeps = null, supabase: presetSupabase = null } = {}) {
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

export async function captureWarns(fn) {
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

export const peerChannel = () => new Api.InputPeerChannel({ channelId: BigInt(555), accessHash: BigInt(77) });
// В рантайме GramJS className содержит неймспейс: 'channels.LeaveChannel', 'messages.DeleteChatUser'
export const isClass = (request, name) => String(request?.className || '').endsWith(name);
