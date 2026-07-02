// Smoke test for MtprotoBridgeService: verifies token issuance, audit logging,
// and feature flag behavior without needing a real ADMIN_JWT.
//
// Run:   SUPABASE_URL=https://bullgram.xyz node test/test-mtproto-bridge-smoke.js <userbot_id> <admin_id>

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { UserbotService } from '../services/userbot.service.js';
import { MtprotoBridgeService } from '../services/mtproto-bridge.service.js';

const USERBOT_ID = process.argv[2] || '43cd7bf3-d38f-4e12-bcf5-c86c4906528b';
const ADMIN_ID = process.argv[3] || '9fd78a21-33b6-4d68-b0f7-a8ddf2e0bce3';

async function main() {
  process.env.TELEGRAM_WEB_ENABLED = 'true';
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const userbotService = new UserbotService(supabase, 4, '014b35b6184100b085b0d0572f9b5103');
  const bridge = new MtprotoBridgeService(supabase, userbotService);
  bridge.start();

  let pass = 0, fail = 0;
  const assert = (cond, msg) => {
    if (cond) { console.log(`  ✓ ${msg}`); pass++; }
    else { console.log(`  ✗ ${msg}`); fail++; }
  };

  console.log('\n[Test 1] Feature flag (disabled by default)');
  process.env.TELEGRAM_WEB_ENABLED = 'false';
  assert(bridge.isEnabled() === false, 'isEnabled()=false when env=false');

  console.log('\n[Test 2] Feature flag (enabled)');
  process.env.TELEGRAM_WEB_ENABLED = 'true';
  assert(bridge.isEnabled() === true, 'isEnabled()=true when env=true');

  console.log('\n[Test 3] Token issuance with valid userbot');
  const before = await supabase
    .from('telegram_web_audit')
    .select('id', { count: 'exact', head: true });
  const initialAuditCount = before.count || 0;

  const issued = await bridge.issueBridgeToken({
    userbotId: USERBOT_ID,
    adminId: ADMIN_ID,
    adminIp: '127.0.0.1',
    userAgent: 'test-mtproto-bridge-smoke'
  });

  assert(typeof issued.bridgeToken === 'string' && issued.bridgeToken.length === 64, 'bridgeToken is 64-char hex');
  assert(typeof issued.sessionToken === 'string' && issued.sessionToken.length === 32, 'sessionToken is 32-char hex');
  assert(issued.fingerprint && typeof issued.fingerprint.api_id === 'number', 'fingerprint has api_id');
  assert(issued.expiresAt > Date.now(), 'expiresAt is in the future');
  assert(issued.sessionData && typeof issued.sessionData.mainDcId === 'number', 'sessionData has mainDcId');
  assert(issued.sessionData.keys && Object.keys(issued.sessionData.keys).length > 0, 'sessionData has keys');
  assert(typeof issued.sessionData.keys[issued.sessionData.mainDcId] === 'string', 'mainDcId key present as hex');
  console.log(`    ↳ sessionData decoded: dc=${issued.sessionData.mainDcId}, keyHex=${issued.sessionData.keys[issued.sessionData.mainDcId].slice(0, 16)}…`);

  console.log('\n[Test 4] Audit row written for session_issued');
  await new Promise((r) => setTimeout(r, 300));
  const after = await supabase
    .from('telegram_web_audit')
    .select('id, action, admin_id, userbot_id, admin_ip, user_agent')
    .eq('userbot_id', USERBOT_ID)
    .eq('action', 'session_issued')
    .order('id', { ascending: false })
    .limit(1);
  assert(after.data && after.data.length === 1, 'one session_issued row exists');
  if (after.data?.[0]) {
    assert(after.data[0].admin_id === ADMIN_ID, 'admin_id matches');
    assert(after.data[0].admin_ip === '127.0.0.1', 'admin_ip matches');
  }

  console.log('\n[Test 5] Token lookup (multi-use)');
  const looked = bridge._findToken(issued.bridgeToken);
  assert(looked !== null, 'found by bridge_token');
  assert(looked.userbotId === USERBOT_ID, 'userbotId matches');
  assert(bridge._findToken('bogus') === null, 'bogus token rejected');

  console.log('\n[Test 6] Origin allowlist');
  assert(bridge._isOriginAllowed('https://bullgram.xyz') === true, 'bullgram.xyz allowed');
  assert(bridge._isOriginAllowed('https://app.bullgram.xyz') === true, 'subdomain allowed');
  assert(bridge._isOriginAllowed('http://localhost:5173') === true, 'localhost allowed');
  assert(bridge._isOriginAllowed('https://evil.com') === false, 'evil.com rejected');
  assert(bridge._isOriginAllowed('') === true, 'empty origin allowed (server-to-server)');

  console.log('\n[Test 7] Forbidden userbot (wrong admin)');
  process.env.TELEGRAM_WEB_ENABLED = 'true';
  try {
    await bridge.issueBridgeToken({
      userbotId: USERBOT_ID,
      adminId: '00000000-0000-0000-0000-000000000000',
      adminIp: '127.0.0.1',
      userAgent: 'test-forbidden'
    });
    assert(false, 'should throw FORBIDDEN');
  } catch (err) {
    assert(err.message === 'FORBIDDEN', 'FORBIDDEN thrown');
  }

  console.log('\n[Test 8] Bogus userbot');
  try {
    await bridge.issueBridgeToken({
      userbotId: '00000000-0000-0000-0000-000000000000',
      adminId: ADMIN_ID,
      adminIp: '127.0.0.1',
      userAgent: 'test-bogus'
    });
    assert(false, 'should throw USERBOT_NOT_FOUND');
  } catch (err) {
    assert(err.message === 'USERBOT_NOT_FOUND', 'USERBOT_NOT_FOUND thrown');
  }

  console.log('\n[Test 9] Token expiry eviction');
  const entry = bridge.tokens.get(issued.bridgeToken);
  entry.expiresAt = Date.now() - 1;
  bridge._evictExpired();
  assert(bridge.tokens.has(issued.bridgeToken) === false, 'expired token evicted');

  console.log('\n========================================');
  console.log(`SMOKE RESULT: ${pass} passed, ${fail} failed`);
  console.log('========================================\n');

  bridge.stop();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
