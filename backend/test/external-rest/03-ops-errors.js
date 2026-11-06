/**
 * Сценарий: операции и ошибки — health (404/200), scope-гейт, allowlist,
 * коэрсия query-параметров, POST body, MCPError → конверт, buildErrorEnvelope.
 * Из test-external-rest. Экспортирует run() — хост вызывает сценарии строго по порядку.
 */
import { assertEqual } from './shared.js';
import {
  OWNER_ID,
  SAMPLE_TOKEN,
  SAMPLE_TOKEN_PLAINTEXT,
  SAMPLE_USERBOT_ID,
  makeMockSupabase,
  makeMockUserbotService,
  startApp,
  fetchJSON,
  bearer
} from './shared.js';
import { buildErrorEnvelope } from '../../external/errors.js';
import { ERROR_CODES, MCPError } from '../../shared/errors.js';

export async function run() {

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

}
