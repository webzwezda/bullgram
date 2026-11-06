/**
 * Сценарий: rate-limiter (InMemoryRateLimiter / defaultTokenLimits / userbotLimits)
 * и scope-guard (assertIntegrationToken / assertToolAllowed / assertAccountAllowed)
 * из test-mcp-shared. Экспортирует run() — хост вызывает сценарии строго по порядку.
 */
import { assertEqual, assertThrows } from './shared.js';
import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import {
  InMemoryRateLimiter,
  defaultTokenLimits,
  userbotLimits
} from '../../shared/rate-limiter.js';
import {
  assertIntegrationToken,
  assertToolAllowed,
  assertAccountAllowed
} from '../../shared/scope-guard.js';

export async function run() {

console.log('--- rate-limiter.InMemoryRateLimiter ---');
{
  const rl = new InMemoryRateLimiter();
  // First consume at perMinute=60 should succeed
  const r1 = rl.consume({ key: 'k1', perMinute: 60, class: 'read' });
  assertEqual(r1.allowed, true, 'first consume allowed');
  assertEqual(r1.class, 'read', 'class echoed');
  assertEqual(r1.limit, 60, 'limit = perMinute');

  // Drain the bucket (we start at 60, refill ~0 between calls)
  let count = 1;
  let blocked = false;
  for (let i = 0; i < 200; i++) {
    try {
      rl.consume({ key: 'k1', perMinute: 60, class: 'read' });
      count++;
    } catch (e) {
      blocked = e instanceof MCPError && e.code === ERROR_CODES.RATE_LIMITED;
      break;
    }
  }
  assertEqual(count > 0 && count <= 60, true, `drained after ${count} consumes (≤60)`);
  assertEqual(blocked, true, 'blocked with RATE_LIMITED');

  // retryAfterSec must be a positive integer
  let retryAfter = null;
  try {
    rl.consume({ key: 'k1', perMinute: 60, class: 'read' });
  } catch (e) {
    retryAfter = e.retryAfterSec;
  }
  assertEqual(Number.isInteger(retryAfter) && retryAfter >= 1, true, `retryAfterSec=${retryAfter} is positive int`);

  // lastSeen returns the last consume metadata
  const last = rl.lastSeen('k1');
  assertEqual(last !== null, true, 'lastSeen returns last consume');
  assertEqual(last.allowed, false, 'last was a block');

  // Different key has its own bucket
  const r2 = rl.consume({ key: 'k2', perMinute: 60, class: 'write' });
  assertEqual(r2.allowed, true, 'different key has fresh bucket');
}

console.log('--- rate-limiter.defaultTokenLimits ---');
{
  const d = defaultTokenLimits({});
  assertEqual(d.read, 120, 'default read = 120/min');
  assertEqual(d.write, 30, 'default write = 30/min');
  const o = defaultTokenLimits({ rate_limit_override: { read_per_minute: 10, write_per_minute: 5 } });
  assertEqual(o.read, 10, 'override read');
  assertEqual(o.write, 5, 'override write');
  const bad = defaultTokenLimits({ rate_limit_override: { read_per_minute: 'nope' } });
  assertEqual(bad.read, 120, 'invalid override falls back to default');
}

console.log('--- rate-limiter.userbotLimits ---');
{
  assertEqual(userbotLimits('read'), 60, 'userbot read = 60/min');
  assertEqual(userbotLimits('write'), 10, 'userbot write = 10/min');
  assertEqual(userbotLimits(undefined), 60, 'undefined class → read default');
}

console.log('--- scope-guard.assertIntegrationToken ---');
{
  assertThrows(
    () => assertIntegrationToken({ kind: 'user_token' }),
    (e) => e instanceof MCPError && e.code === ERROR_CODES.INTEGRATION_TOKEN_REQUIRED,
    'user_token rejected'
  );
  assertThrows(
    () => assertIntegrationToken({}),
    (e) => e instanceof MCPError && e.code === ERROR_CODES.INTEGRATION_TOKEN_REQUIRED,
    'missing kind rejected'
  );
  // integration_token passes (no throw)
  let threw = false;
  try { assertIntegrationToken({ kind: 'integration_token' }); } catch { threw = true; }
  assertEqual(threw, false, 'integration_token passes');
}

console.log('--- scope-guard.assertToolAllowed ---');
{
  // empty required → always allowed
  let threw = false;
  try { assertToolAllowed(['mcp:userbot:read'], []); } catch { threw = true; }
  assertEqual(threw, false, 'empty required list passes');

  assertThrows(
    () => assertToolAllowed(['mcp:userbot:read'], ['mcp:userbot:write']),
    (e) => e instanceof MCPError && e.code === ERROR_CODES.INSUFFICIENT_SCOPE,
    'missing scope rejected'
  );
  // OR-match: only one required scope needs to match
  threw = false;
  try { assertToolAllowed(['api:userbot:write'], ['mcp:userbot:write', 'api:userbot:write']); } catch { threw = true; }
  assertEqual(threw, false, 'OR-match scope passes');
}

console.log('--- scope-guard.assertAccountAllowed ---');
{
  // null allowlist → all allowed
  let threw = false;
  try { assertAccountAllowed({ metadata: {} }, 'uuid-1'); } catch { threw = true; }
  assertEqual(threw, false, 'null allowlist passes');

  // undefined allowlist
  threw = false;
  try { assertAccountAllowed({ metadata: { allowed_userbot_ids: undefined } }, 'uuid-1'); } catch { threw = true; }
  assertEqual(threw, false, 'undefined allowlist passes');

  // empty array → block
  assertThrows(
    () => assertAccountAllowed({ metadata: { allowed_userbot_ids: [] } }, 'uuid-1'),
    (e) => e instanceof MCPError && e.code === ERROR_CODES.FORBIDDEN_ACCOUNT,
    'empty allowlist blocks'
  );
  // not in list
  assertThrows(
    () => assertAccountAllowed({ metadata: { allowed_userbot_ids: ['uuid-A'] } }, 'uuid-B'),
    (e) => e instanceof MCPError && e.code === ERROR_CODES.FORBIDDEN_ACCOUNT,
    'id not in list blocked'
  );
  // in list
  threw = false;
  try { assertAccountAllowed({ metadata: { allowed_userbot_ids: ['uuid-A', 'uuid-B'] } }, 'uuid-B'); } catch { threw = true; }
  assertEqual(threw, false, 'id in list passes');

  // no userbotId → no check
  threw = false;
  try { assertAccountAllowed({ metadata: { allowed_userbot_ids: [] } }, null); } catch { threw = true; }
  assertEqual(threw, false, 'null userbotId skips check');
}

}
