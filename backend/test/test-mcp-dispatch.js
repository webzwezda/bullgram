/**
 * Integration tests for the unified MCP dispatcher chain.
 * Plan 01 Phase 7.
 *
 * Запуск: node test/test-mcp-dispatch.js
 *
 * Strategy: mock supabase (in-memory insert/update + tg_accounts lookup),
 * mock userbotService (returns canned shapes or throws known errors),
 * exercise dispatchOperation end-to-end through every branch:
 *   - happy path (success status persisted in audit log)
 *   - unknown operation
 *   - integration-token requirement (JWT path rejected)
 *   - insufficient scope
 *   - account allowlist (empty / not in list)
 *   - rate limit exceeded
 *   - handler-thrown MCPError preserves auditStatus
 *   - handler-thrown plain Error → audit 'error' status
 *
 * The 10 production operation handlers register themselves via ../mcp/tools/index.js.
 */
import '../mcp/tools/index.js';

import { dispatchOperation } from '../shared/dispatch.js';
import { listOperationNames } from '../shared/operations.js';
import { rateLimiter } from '../shared/rate-limiter.js';
import { MCPError, ERROR_CODES } from '../shared/errors.js';

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
async function assertRejects(factory, predicate, label) {
  try {
    await factory();
    fail(label, 'reject', 'no throw');
  } catch (e) {
    if (predicate(e)) ok(label);
    else fail(label, 'matching error', e?.message || String(e));
  }
}

// ---------------------------------------------------------------------------
// Mock Supabase. Tables we care about:
//   - mcp_tool_log: insert + update by id
//   - tg_accounts:  select().eq().eq().maybeSingle()  (loadOwnedUserbot)
// Capture every insert/update for ordering assertions.
// ---------------------------------------------------------------------------
function makeMockSupabase({ tgAccount = null } = {}) {
  const logRows = new Map();
  let counter = 1;
  const trace = [];
  const supabase = {
    from(table) {
      if (table === 'tg_accounts') {
        return {
          select() {
            return {
              eq() { return this; },
              maybeSingle: async () => ({ data: tgAccount, error: null })
            };
          }
        };
      }
      if (table === 'mcp_tool_log') {
        return {
          insert(payload) {
            const row = { ...(Array.isArray(payload) ? payload[0] : payload), id: counter++ };
            logRows.set(row.id, row);
            trace.push({ phase: 'insert', status: row.status });
            return {
              select() {
                return { single: async () => ({ data: row, error: null }) };
              }
            };
          },
          update(patch) {
            return {
              eq(_col, val) {
                const r = logRows.get(val);
                if (r) Object.assign(r, patch);
                trace.push({ phase: 'update', status: patch.status, error_message: patch.error_message });
                return { then(resolve) { resolve({ data: null, error: null }); } };
              }
            };
          }
        };
      }
      throw new Error(`mock supabase: unmocked table ${table}`);
    }
  };
  supabase._trace = trace;
  supabase._rows = logRows;
  return supabase;
}

function makeMockUserbotService({ healthResult = { status: 'active' }, throwOnHealth = null } = {}) {
  return {
    getHealthSnapshot: async () => {
      if (throwOnHealth) throw throwOnHealth;
      return healthResult;
    },
    listDialogs: async () => ({ dialogs: [], cursor: null, has_more: false }),
    fetchMessages: async () => ({ messages: [], cursor: null, has_more: false }),
    searchMessages: async () => ({ messages: [], cursor: null, has_more: false }),
    listParticipants: async () => ({ participants: [], cursor: null, has_more: false }),
    sendTextMessage: async () => ({ message_id: '1', date: '2026-07-27T00:00:00Z' })
  };
}

function makeReq({
  kind = 'integration_token',
  tokenScopes = ['mcp:userbot:read'],
  allowedUserbotIds = undefined,
  rateLimitOverride = null,
  userId = 'owner-1'
} = {}) {
  const metadata = {};
  if (Array.isArray(allowedUserbotIds)) metadata.allowed_userbot_ids = allowedUserbotIds;
  if (rateLimitOverride) metadata.rate_limit_override = rateLimitOverride;
  return {
    ip: '127.0.0.1',
    id: 'req-test',
    headers: { 'user-agent': 'test-runner' },
    user: { id: userId },
    auth: { kind, user: { id: userId } },
    token: { id: 'token-1', scopes: tokenScopes, metadata }
  };
}

const SAMPLE_USERBOT_ID = '11111111-1111-1111-1111-111111111111';
const SAMPLE_USERBOT = { id: SAMPLE_USERBOT_ID, owner_id: 'owner-1', status: 'active', runtime_status: 'active' };

function resetRateLimiter() {
  rateLimiter.buckets?.clear();
  rateLimiter.lastConsumed?.clear();
}

// ---------------------------------------------------------------------------
console.log('--- registry has all 10 operations ---');
{
  const names = listOperationNames().sort();
  console.log(`  registered: ${names.length} operations`);
  const expected = [
    'bullgram_infra_summary', 'bullgram_proxy_preview', 'bullgram_proxy_import',
    'bullgram_userbot_list', 'bullgram_userbot_health',
    'bullgram_userbot_dialogs', 'bullgram_userbot_messages',
    'bullgram_userbot_messages_search', 'bullgram_userbot_participants',
    'bullgram_userbot_message_send'
  ].sort();
  assertEqual(names, expected, 'all 10 operations registered');
}

console.log('--- happy path: result returned, audit finalized as success ---');
{
  resetRateLimiter();
  const supabase = makeMockSupabase({ tgAccount: SAMPLE_USERBOT });
  const userbotService = makeMockUserbotService({ healthResult: { status: 'active', last_seen: 'now' } });
  const req = makeReq({ tokenScopes: ['mcp:userbot:read'] });

  const { result, rateLimit } = await dispatchOperation({
    supabase, req,
    operationName: 'bullgram_userbot_health',
    args: { userbot_id: SAMPLE_USERBOT_ID },
    userbotService, source: 'mcp'
  });
  assertEqual(result.status, 'active', 'handler result returned');
  assertEqual(typeof rateLimit.remaining, 'number', 'rate-limit metadata returned');
  assertEqual(rateLimit.allowed, true, 'rate-limit allowed=true on happy path');
  const trace = supabase._trace;
  assertEqual(trace.length >= 2, true, 'audit insert + finalization both happened');
  assertEqual(trace[0].phase, 'insert', 'insert before handler');
  assertEqual(trace[0].status, 'started', 'insert with status=started');
  assertEqual(trace[trace.length - 1].status, 'success', 'finalized as success');
}

console.log('--- unknown operation → METHOD_NOT_FOUND ---');
{
  resetRateLimiter();
  const supabase = makeMockSupabase();
  const userbotService = makeMockUserbotService();
  await assertRejects(
    () => dispatchOperation({
      supabase, req: makeReq(),
      operationName: 'does_not_exist',
      args: {},
      userbotService, source: 'mcp'
    }),
    (e) => e instanceof MCPError && e.code === ERROR_CODES.METHOD_NOT_FOUND,
    'unknown operation rejected'
  );
}

console.log('--- JWT path rejected for requiresIntegrationToken:true ---');
{
  resetRateLimiter();
  const supabase = makeMockSupabase();
  const userbotService = makeMockUserbotService();
  const req = makeReq({ kind: 'user_token' });
  await assertRejects(
    () => dispatchOperation({
      supabase, req,
      operationName: 'bullgram_userbot_health',
      args: { userbot_id: SAMPLE_USERBOT_ID },
      userbotService, source: 'mcp'
    }),
    (e) => e instanceof MCPError && e.code === ERROR_CODES.INTEGRATION_TOKEN_REQUIRED,
    'user_token kind rejected'
  );
}

console.log('--- insufficient scope → INSUFFICIENT_SCOPE ---');
{
  resetRateLimiter();
  const supabase = makeMockSupabase();
  const userbotService = makeMockUserbotService();
  // bullgram_userbot_message_send requires mcp:userbot:write
  const req = makeReq({ tokenScopes: ['mcp:userbot:read'] });
  await assertRejects(
    () => dispatchOperation({
      supabase, req,
      operationName: 'bullgram_userbot_message_send',
      args: { userbot_id: SAMPLE_USERBOT_ID, chat_id: '1', text: 'hi' },
      userbotService, source: 'mcp'
    }),
    (e) => e instanceof MCPError && e.code === ERROR_CODES.INSUFFICIENT_SCOPE,
    'read-only token blocked from write tool'
  );
}

console.log('--- account allowlist: empty array → FORBIDDEN_ACCOUNT ---');
{
  resetRateLimiter();
  const supabase = makeMockSupabase();
  const userbotService = makeMockUserbotService();
  const req = makeReq({ tokenScopes: ['mcp:userbot:read'], allowedUserbotIds: [] });
  await assertRejects(
    () => dispatchOperation({
      supabase, req,
      operationName: 'bullgram_userbot_health',
      args: { userbot_id: SAMPLE_USERBOT_ID },
      userbotService, source: 'mcp'
    }),
    (e) => e instanceof MCPError && e.code === ERROR_CODES.FORBIDDEN_ACCOUNT,
    'empty allowlist blocks'
  );
}

console.log('--- account allowlist: id not in list → FORBIDDEN_ACCOUNT ---');
{
  resetRateLimiter();
  const supabase = makeMockSupabase();
  const userbotService = makeMockUserbotService();
  const req = makeReq({
    tokenScopes: ['mcp:userbot:read'],
    allowedUserbotIds: ['22222222-2222-2222-2222-222222222222']
  });
  await assertRejects(
    () => dispatchOperation({
      supabase, req,
      operationName: 'bullgram_userbot_health',
      args: { userbot_id: SAMPLE_USERBOT_ID },
      userbotService, source: 'mcp'
    }),
    (e) => e instanceof MCPError && e.code === ERROR_CODES.FORBIDDEN_ACCOUNT && /not in/.test(e.message),
    'id not in allowlist blocked with helpful message'
  );
}

console.log('--- rate limit exceeded → RATE_LIMITED ---');
{
  resetRateLimiter();
  const supabase = makeMockSupabase({ tgAccount: SAMPLE_USERBOT });
  const userbotService = makeMockUserbotService();
  // Tiny per-minute so we exhaust quickly
  const req = makeReq({
    tokenScopes: ['mcp:userbot:read'],
    rateLimitOverride: { read_per_minute: 2 }
  });

  let blockedAt = -1;
  let lastError = null;
  for (let i = 0; i < 6; i++) {
    try {
      await dispatchOperation({
        supabase, req,
        operationName: 'bullgram_userbot_health',
        args: { userbot_id: SAMPLE_USERBOT_ID },
        userbotService, source: 'mcp'
      });
    } catch (e) {
      lastError = e;
      if (e instanceof MCPError && e.code === ERROR_CODES.RATE_LIMITED) {
        blockedAt = i;
        break;
      }
    }
  }
  assertEqual(blockedAt > 0, true, `rate limit tripped at iteration ${blockedAt}`);
  assertEqual(lastError?.retryAfterSec >= 1, true, `retryAfterSec=${lastError?.retryAfterSec} positive`);
}

console.log('--- handler-thrown MCPError preserves code + auditStatus ---');
{
  resetRateLimiter();
  const supabase = makeMockSupabase({ tgAccount: SAMPLE_USERBOT });
  const userbotService = makeMockUserbotService({
    throwOnHealth: new MCPError(ERROR_CODES.SAFE_MODE_BLOCKED, 'userbot is in safe-mode', { auditStatus: 'safe_mode_blocked' })
  });
  const req = makeReq({ tokenScopes: ['mcp:userbot:read'] });
  await assertRejects(
    () => dispatchOperation({
      supabase, req,
      operationName: 'bullgram_userbot_health',
      args: { userbot_id: SAMPLE_USERBOT_ID },
      userbotService, source: 'mcp'
    }),
    (e) => e instanceof MCPError && e.code === ERROR_CODES.SAFE_MODE_BLOCKED && e.auditStatus === 'safe_mode_blocked',
    'handler-thrown MCPError surfaces with auditStatus preserved'
  );
  // Audit should be finalized as safe_mode_blocked
  const updates = supabase._trace.filter((t) => t.phase === 'update');
  assertEqual(updates.length > 0, true, 'audit update ran');
  assertEqual(updates[updates.length - 1].status, 'safe_mode_blocked', 'audit status from MCPError');
}

console.log('--- handler-thrown plain Error → audit "error" status, message preserved ---');
{
  resetRateLimiter();
  const supabase = makeMockSupabase({ tgAccount: SAMPLE_USERBOT });
  const userbotService = makeMockUserbotService({
    throwOnHealth: new Error('something exploded')
  });
  const req = makeReq({ tokenScopes: ['mcp:userbot:read'] });
  await assertRejects(
    () => dispatchOperation({
      supabase, req,
      operationName: 'bullgram_userbot_health',
      args: { userbot_id: SAMPLE_USERBOT_ID },
      userbotService, source: 'mcp'
    }),
    (e) => /something exploded/.test(e.message),
    'plain Error re-thrown with original message'
  );
  const updates = supabase._trace.filter((t) => t.phase === 'update');
  assertEqual(updates[updates.length - 1].status, 'error', 'audit finalized as "error"');
  assertEqual(updates[updates.length - 1].error_message, 'something exploded', 'error_message persisted');
}

console.log('--- audit insert happens BEFORE handler runs ---');
{
  resetRateLimiter();
  let handlerRan = false;
  const supabase = makeMockSupabase({ tgAccount: SAMPLE_USERBOT });
  const userbotService = {
    getHealthSnapshot: async () => {
      handlerRan = true;
      return { ok: true };
    }
  };
  const req = makeReq({ tokenScopes: ['mcp:userbot:read'] });
  await dispatchOperation({
    supabase, req,
    operationName: 'bullgram_userbot_health',
    args: { userbot_id: SAMPLE_USERBOT_ID },
    userbotService, source: 'mcp'
  });
  assertEqual(handlerRan, true, 'handler ran');
  assertEqual(supabase._trace[0].phase, 'insert', 'first trace event is insert');
  assertEqual(supabase._trace[0].status, 'started', 'insert status is started');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
