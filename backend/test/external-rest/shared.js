/**
 * Общие ассерты, счётчики, моки и константы для сценариев test-external-rest.
 * Живые биндинги: counters мутируется по мере проверок, хост-файл
 * (test/test-external-rest.js) читает его в финальной сводке.
 */
import express from 'express';
import crypto from 'node:crypto';

import { buildExternalRouter } from '../../external/router.js';

export const counters = { passes: 0, failures: 0 };
export function ok(label) { counters.passes++; console.log(`  ✓ ${label}`); }
export function fail(label, expected, actual) {
  counters.failures++;
  console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
}
export function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
  else fail(label, expected, actual);
}

// ---------------------------------------------------------------------------
// Mock Supabase. Routes by table + handles enough chain methods to satisfy
// the dispatcher + auth middleware + loadOwnedUserbot.
// ---------------------------------------------------------------------------
export function sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

export function makeMockSupabase({ tokens = [], tgAccounts = [], profile = null } = {}) {
  const auditTrace = [];
  const auditRows = new Map();
  let auditId = 1;

  function chain(table) {
    const state = { table, filters: {}, single_mode: null };
    const builder = {
      select(_cols) { return this; },
      eq(col, val) { state.filters[col] = val; return this; },
      neq(col, val) { state.filters[col+'_neq'] = val; return this; },
      is(col, val) { if (val === null) state.filters[col+'_is_null'] = true; return this; },
      // postgrest .not(col, 'is', null) — нужен фильтру отлёжки в loadIntakeStockUserbotIds;
      // для моковых таблиц ниже фильтр не влияет, важно что метод существует.
      not(col, op, val) { if (op === 'is' && val === null) state.filters[col+'_not_null'] = true; return this; },
      order() { return this; },
      limit() { return this; },
      maybeSingle() { return Promise.resolve(resolveQuery()); },
      single() { return Promise.resolve(resolveQuery()); }
    };
    function resolveQuery() {
      if (table === 'integration_tokens') {
        const hash = state.filters.token_hash;
        const match = tokens.find((t) => t.token_hash === hash && !t.revoked_at);
        if (state.filters.purpose && match && match.purpose !== state.filters.purpose) {
          return { data: null, error: null };
        }
        return { data: match || null, error: null };
      }
      if (table === 'profiles') {
        return { data: profile, error: null };
      }
      if (table === 'tg_accounts') {
        // List queries (no maybeSingle) → return array. Single queries → return one row.
        const matches = tgAccounts.filter((a) =>
          (!state.filters.id || a.id === state.filters.id) &&
          (!state.filters.owner_id || a.owner_id === state.filters.owner_id)
        );
        if (state.single_mode === 'maybeSingle' || state.single_mode === 'single') {
          return { data: matches[0] || null, error: null };
        }
        return { data: matches, error: null };
      }
      return { data: null, error: null };
    }
    // Make the builder itself thenable so `await supabase.from(...).select(...)...`
    // (without .single/.maybeSingle at the end) resolves with { data, error }.
    builder.then = function (resolve, _reject) {
      return Promise.resolve(resolveQuery()).then(resolve);
    };
    // Wrap maybeSingle/single to set the mode flag before resolving.
    const origMaybe = builder.maybeSingle;
    const origSingle = builder.single;
    builder.maybeSingle = function () { state.single_mode = 'maybeSingle'; return origMaybe.call(builder); };
    builder.single = function () { state.single_mode = 'single'; return origSingle.call(builder); };

    return {
      ...builder,
      insert(payload) {
        if (table === 'mcp_tool_log') {
          const row = { ...payload, id: auditId++ };
          auditRows.set(row.id, row);
          auditTrace.push({ phase: 'insert', status: row.status });
          return {
            select() { return { single: async () => ({ data: row, error: null }) }; }
          };
        }
        return { select: () => ({ single: async () => ({ data: payload, error: null }) }) };
      },
      update(patch) {
        if (table === 'mcp_tool_log') {
          return {
            eq(_col, val) {
              const r = auditRows.get(val);
              if (r) Object.assign(r, patch);
              auditTrace.push({ phase: 'update', status: patch.status, error_message: patch.error_message });
              return Promise.resolve({ data: null, error: null });
            }
          };
        }
        return {
          eq() { return Promise.resolve({ data: null, error: null }); },
          select() {
            return {
              single: async () => ({ data: null, error: null }),
              maybeSingle: async () => ({ data: null, error: null })
            };
          }
        };
      }
    };
  }

  return {
    from: chain,
    _auditTrace: auditTrace,
    _auditRows: auditRows,
    auth: {
      getUser: async () => ({ data: { user: null }, error: new Error('not used in REST') })
    }
  };
}

export function makeMockUserbotService(overrides = {}) {
  return {
    getHealthSnapshot: async () => overrides.healthResult ?? { status: 'active', checked_at: '2026-07-27T00:00:00Z' },
    listDialogs: async () => ({ dialogs: [], cursor: null, has_more: false }),
    fetchMessages: async () => ({ messages: [], cursor: null, has_more: false }),
    searchMessages: async () => ({ messages: [], cursor: null, has_more: false }),
    listParticipants: async () => ({ participants: [], cursor: null, has_more: false }),
    sendTextMessage: async () => ({ message_id: '1', date: '2026-07-27T00:00:00Z' }),
    ...overrides
  };
}

// Helper: start a fresh app on a random port. Returns { port, close }.
export async function startApp({ supabase, userbotService }) {
  const app = express();
  app.use(express.json());
  app.use('/api/external/v1', buildExternalRouter({ supabase, userbotService }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({ port, close: () => server.close() });
    });
  });
}

export async function fetchJSON(port, path, opts = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, headers: res.headers, body };
}

export function bearer(value) {
  return { headers: { Authorization: `Bearer ${value}` } };
}

export const OWNER_ID = '9fd78a21-33b6-4d68-b0f7-a8ddf2e0bce3';
export const SAMPLE_USERBOT_ID = '11111111-1111-1111-1111-111111111111';
export const SAMPLE_TOKEN_PLAINTEXT = 'brapi_testtest_testtesttesttesttesttesttest';
export const SAMPLE_TOKEN = {
  id: 'tok-1',
  owner_id: OWNER_ID,
  purpose: 'api',
  scopes: ['api:userbot:read', 'api:userbot:write'],
  token_hash: sha256(SAMPLE_TOKEN_PLAINTEXT),
  revoked_at: null
};
