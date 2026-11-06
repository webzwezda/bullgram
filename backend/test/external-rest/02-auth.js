/**
 * Сценарий: auth — /me без токена → 401, brmcp_-токен → 401 с подсказкой,
 * валидный brapi_ → 200, /userbots с аудитом. Из test-external-rest.
 * Экспортирует run() — хост вызывает сценарии строго по порядку.
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
import { ERROR_CODES } from '../../shared/errors.js';

export async function run() {

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

}
