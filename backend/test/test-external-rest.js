/**
 * Integration tests for the external REST API.
 * Plan 02 Phase 4.
 *
 * Запуск: node test/test-external-rest.js
 *
 * Strategy: spin up a fresh Express app per test fixture, inject a mock Supabase
 * that routes table queries by name + first eq() value, mock userbotService.
 * Real HTTP requests via global fetch. Realistic end-to-end coverage including
 * OpenAPI generation, auth middleware, scope enforcement, dispatcher chain,
 * argument coercion, error envelope formatting.
 */
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';

import '../mcp/tools/index.js'; // side-effect register operations
import { buildExternalRouter } from '../external/router.js';
import { buildOpenApiSpec } from '../external/openapi.js';
import { buildErrorEnvelope } from '../external/errors.js';
import { ERROR_CODES, MCPError } from '../shared/errors.js';

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

// ---------------------------------------------------------------------------
// Mock Supabase. Routes by table + handles enough chain methods to satisfy
// the dispatcher + auth middleware + loadOwnedUserbot.
// ---------------------------------------------------------------------------
function sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function makeMockSupabase({ tokens = [], tgAccounts = [], profile = null } = {}) {
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

function makeMockUserbotService(overrides = {}) {
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
async function startApp({ supabase, userbotService }) {
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

async function fetchJSON(port, path, opts = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, headers: res.headers, body };
}

function bearer(value) {
  return { headers: { Authorization: `Bearer ${value}` } };
}

const OWNER_ID = '9fd78a21-33b6-4d68-b0f7-a8ddf2e0bce3';
const SAMPLE_USERBOT_ID = '11111111-1111-1111-1111-111111111111';
const SAMPLE_TOKEN_PLAINTEXT = 'brapi_testtest_testtesttesttesttesttesttest';
const SAMPLE_TOKEN = {
  id: 'tok-1',
  owner_id: OWNER_ID,
  purpose: 'api',
  scopes: ['api:userbot:read', 'api:userbot:write'],
  token_hash: sha256(SAMPLE_TOKEN_PLAINTEXT),
  revoked_at: null
};

// ---------------------------------------------------------------------------
console.log('--- GET /health (public, no auth) ---');
{
  const supabase = makeMockSupabase();
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  const { status, body } = await fetchJSON(port, '/api/external/v1/health');
  assertEqual(status, 200, 'HTTP 200');
  assertEqual(body.service, 'bullgram-external-api', 'service field');
  assertEqual(body.version, 'v1', 'version field');
  close();
}

console.log('--- GET /openapi.json (public) ---');
{
  const supabase = makeMockSupabase();
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  const { status, body } = await fetchJSON(port, '/api/external/v1/openapi.json');
  assertEqual(status, 200, 'HTTP 200');
  assertEqual(body.openapi, '3.0.3', 'openapi version');
  // 12 paths: 9 from operation registry (10 operations, /messages shared by GET + POST)
  // + 3 manual infra routes (/health, /me, /docs)
  assertEqual(Object.keys(body.paths).length, 12, 'paths count');
  assertEqual(!!body.components.securitySchemes.BearerAuth, true, 'BearerAuth scheme present');
  assertEqual(Array.isArray(body.tags), true, 'tags array present');
  close();
}

console.log('--- GET /docs (Scalar HTML) ---');
{
  const supabase = makeMockSupabase();
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  const res = await fetch(`http://127.0.0.1:${port}/api/external/v1/docs`);
  const text = await res.text();
  assertEqual(res.status, 200, 'HTTP 200');
  assertEqual(text.includes('<!doctype html>'), true, 'HTML doc returned');
  assertEqual(text.includes('api-reference'), true, 'Scalar api-reference div present');
  close();
}

console.log('--- GET /me without auth → 401 ---');
{
  const supabase = makeMockSupabase();
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  const { status, body } = await fetchJSON(port, '/api/external/v1/me');
  assertEqual(status, 401, 'HTTP 401');
  assertEqual(body.error.code, ERROR_CODES.INTEGRATION_TOKEN_REQUIRED, 'envelope code');
  close();
}

console.log('--- GET /me with brmcp_ token → 401 with clear message ---');
{
  const supabase = makeMockSupabase();
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  const { status, body } = await fetchJSON(port, '/api/external/v1/me', bearer('brmcp_x_y'));
  assertEqual(status, 401, 'HTTP 401');
  assertEqual(/MCP endpoint/.test(body.error.message), true, 'message points user to MCP-vs-REST distinction');
  close();
}

console.log('--- GET /me with valid brapi_ token → 200 ---');
{
  const profile = { id: OWNER_ID, product_tier: 'pro', role: 'user' };
  const supabase = makeMockSupabase({ tokens: [SAMPLE_TOKEN], profile });
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  const { status, body } = await fetchJSON(port, '/api/external/v1/me', bearer(SAMPLE_TOKEN_PLAINTEXT));
  assertEqual(status, 200, 'HTTP 200');
  assertEqual(body.auth_kind, 'integration_token', 'auth_kind');
  assertEqual(body.owner_id, OWNER_ID, 'owner_id');
  assertEqual(body.token.purpose, 'api', 'purpose echoed');
  assertEqual(body.tier, 'pro', 'tier echoed');
  close();
}

console.log('--- GET /userbots with valid token → 200, audit success ---');
{
  const profile = { id: OWNER_ID, product_tier: 'pro' };
  const tgAccounts = [{
    id: SAMPLE_USERBOT_ID, owner_id: OWNER_ID, account_type: 'userbot',
    tg_username: 'test_bot', tg_account_id: '123',
    runtime_status: 'active', proxy_id: null, last_update_at: null, created_at: '2026-01-01'
  }];
  const supabase = makeMockSupabase({ tokens: [SAMPLE_TOKEN], profile, tgAccounts });
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  const { status, body } = await fetchJSON(port, '/api/external/v1/userbots', bearer(SAMPLE_TOKEN_PLAINTEXT));
  assertEqual(status, 200, 'HTTP 200');
  assertEqual(body.userbots.length, 1, 'one userbot returned');
  assertEqual(body.userbots[0].id, SAMPLE_USERBOT_ID, 'userbot id');
  // Audit chain
  const inserts = supabase._auditTrace.filter((t) => t.phase === 'insert');
  const updates = supabase._auditTrace.filter((t) => t.phase === 'update');
  assertEqual(inserts.length >= 1, true, 'audit insert ran');
  assertEqual(updates.length >= 1, true, 'audit update ran');
  assertEqual(updates[updates.length - 1].status, 'success', 'audit status success');
  close();
}

console.log('--- GET /userbots/{id}/health with UUID path param + missing userbot → 404 ---');
{
  const profile = { id: OWNER_ID, product_tier: 'pro' };
  const supabase = makeMockSupabase({ tokens: [SAMPLE_TOKEN], profile, tgAccounts: [] });
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  const { status, body } = await fetchJSON(
    port,
    `/api/external/v1/userbots/${SAMPLE_USERBOT_ID}/health`,
    bearer(SAMPLE_TOKEN_PLAINTEXT)
  );
  assertEqual(status, 404, 'HTTP 404');
  assertEqual(body.error.code, ERROR_CODES.NOT_FOUND, 'NOT_FOUND code');
  assertEqual(/not found/.test(body.error.message), true, 'helpful message');
  close();
}

console.log('--- GET /userbots/{id}/health with real userbot → 200 with snapshot ---');
{
  const profile = { id: OWNER_ID, product_tier: 'pro' };
  const tgAccounts = [{ id: SAMPLE_USERBOT_ID, owner_id: OWNER_ID, account_type: 'userbot', status: 'active' }];
  const supabase = makeMockSupabase({ tokens: [SAMPLE_TOKEN], profile, tgAccounts });
  const userbotService = makeMockUserbotService({ healthResult: { status: 'active', last_seen: 'now' } });
  const { port, close } = await startApp({ supabase, userbotService });
  const { status, body } = await fetchJSON(
    port,
    `/api/external/v1/userbots/${SAMPLE_USERBOT_ID}/health`,
    bearer(SAMPLE_TOKEN_PLAINTEXT)
  );
  assertEqual(status, 200, 'HTTP 200');
  assertEqual(body.status, 'active', 'health result');
  close();
}

console.log('--- Scope enforcement: read-only token blocked from POST /proxies/preview ---');
{
  const profile = { id: OWNER_ID, product_tier: 'pro' };
  const readOnlyScopes = ['api:userbot:read'];
  const token = { ...SAMPLE_TOKEN, scopes: readOnlyScopes };
  const supabase = makeMockSupabase({ tokens: [token], profile });
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  const { status, body } = await fetchJSON(
    port,
    '/api/external/v1/proxies/preview',
    { ...bearer(SAMPLE_TOKEN_PLAINTEXT), method: 'POST', headers: { ...bearer(SAMPLE_TOKEN_PLAINTEXT).headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: 'socks5://x@1.2.3.4:1080' }) }
  );
  assertEqual(status, 403, 'HTTP 403');
  assertEqual(body.error.code, ERROR_CODES.INSUFFICIENT_SCOPE, 'INSUFFICIENT_SCOPE');
  assertEqual(/mcp:proxy:write/.test(body.error.message), true, 'required scope mentioned');
  close();
}

console.log('--- Account allowlist: empty list blocks the call ---');
{
  const profile = { id: OWNER_ID, product_tier: 'pro' };
  const tokenWithAllowlist = {
    ...SAMPLE_TOKEN,
    metadata: { allowed_userbot_ids: [] }
  };
  const supabase = makeMockSupabase({ tokens: [tokenWithAllowlist], profile });
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  const { status, body } = await fetchJSON(
    port,
    `/api/external/v1/userbots/${SAMPLE_USERBOT_ID}/health`,
    bearer(SAMPLE_TOKEN_PLAINTEXT)
  );
  assertEqual(status, 403, 'HTTP 403');
  assertEqual(body.error.code, ERROR_CODES.FORBIDDEN_ACCOUNT, 'FORBIDDEN_ACCOUNT');
  close();
}

console.log('--- Query param coercion: limit="50" → integer 50 ---');
{
  const profile = { id: OWNER_ID, product_tier: 'pro' };
  const supabase = makeMockSupabase({ tokens: [SAMPLE_TOKEN], profile, tgAccounts: [] });
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  // Just verify it doesn't blow up on integer coercion — the dispatcher will succeed with empty list.
  const { status } = await fetchJSON(
    port,
    '/api/external/v1/userbots?limit=10&include_reserved=true',
    bearer(SAMPLE_TOKEN_PLAINTEXT)
  );
  assertEqual(status, 200, 'HTTP 200 with coerced query params');
  close();
}

console.log('--- POST body extraction: /proxies/preview with raw in body ---');
{
  const profile = { id: OWNER_ID, product_tier: 'pro' };
  const writeToken = { ...SAMPLE_TOKEN, scopes: ['api:proxy:write', 'mcp:proxy:write'] };
  const supabase = makeMockSupabase({ tokens: [writeToken], profile });
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  const { status, body } = await fetchJSON(
    port,
    '/api/external/v1/proxies/preview',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${SAMPLE_TOKEN_PLAINTEXT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: 'socks5://user:pass@1.2.3.4:1080' })
    }
  );
  assertEqual(status, 200, 'HTTP 200');
  assertEqual(body.success, true, 'preview success');
  assertEqual(!!body.parsed, true, 'parsed result present');
  close();
}

console.log('--- Handler-thrown MCPError → correct envelope + status ---');
{
  const profile = { id: OWNER_ID, product_tier: 'pro' };
  const tgAccounts = [{ id: SAMPLE_USERBOT_ID, owner_id: OWNER_ID, account_type: 'userbot', status: 'active' }];
  const supabase = makeMockSupabase({ tokens: [SAMPLE_TOKEN], profile, tgAccounts });
  const userbotService = makeMockUserbotService({
    throwOnHealth: undefined,
    healthResult: null
  });
  userbotService.getHealthSnapshot = async () => {
    throw new MCPError(ERROR_CODES.SAFE_MODE_BLOCKED, 'userbot is safe-mode', { auditStatus: 'safe_mode_blocked' });
  };
  const { port, close } = await startApp({ supabase, userbotService });
  const { status, body } = await fetchJSON(
    port,
    `/api/external/v1/userbots/${SAMPLE_USERBOT_ID}/health`,
    bearer(SAMPLE_TOKEN_PLAINTEXT)
  );
  assertEqual(status, 423, 'HTTP 423 (Locked) for SAFE_MODE_BLOCKED');
  assertEqual(body.error.code, ERROR_CODES.SAFE_MODE_BLOCKED, 'SAFE_MODE_BLOCKED code');
  close();
}

console.log('--- buildErrorEnvelope: plain Error in production redacts message ---');
{
  const savedEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const env = buildErrorEnvelope(new Error('internal DB password=secret'));
  assertEqual(env.error.message, 'Internal server error.', 'production redacts message');
  process.env.NODE_ENV = savedEnv;
}

console.log('--- buildErrorEnvelope: MCPError preserves all fields ---');
{
  const err = new MCPError(ERROR_CODES.RATE_LIMITED, 'slow down', {
    auditStatus: 'rate_limited',
    retryAfterSec: 7,
    details: { bucket: 'k1' }
  });
  const env = buildErrorEnvelope(err);
  assertEqual(env.error.code, ERROR_CODES.RATE_LIMITED, 'code');
  assertEqual(env.error.retry_after_sec, 7, 'retry_after_sec preserved');
  // The envelope puts the entire MCPError.data object into details.
  assertEqual(env.error.details.details.bucket, 'k1', 'nested details.bucket preserved');
  assertEqual(env.error.details.auditStatus, 'rate_limited', 'auditStatus preserved inside details');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
