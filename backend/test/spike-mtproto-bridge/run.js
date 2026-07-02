import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { decrypt } from '../../utils/crypto.js';
import { startBridge } from './bridge.js';
import { BullrunBridgeSocket } from './socket.js';

const USERBOT_ID = process.argv[2];
const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || '8765', 10);

if (!USERBOT_ID) {
  console.error('Usage: node test/spike-mtproto-bridge/run.js <userbot_id>');
  console.error('Set env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ENCRYPTION_KEY, BRIDGE_PORT (optional)');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  console.log(`[run] Loading userbot ${USERBOT_ID}...`);
  const { data: userbot, error } = await supabase
    .from('tg_accounts')
    .select('*, proxies(*)')
    .eq('id', USERBOT_ID)
    .eq('account_type', 'userbot')
    .single();

  if (error || !userbot) {
    console.error('[run] Failed to load userbot:', error?.message || 'not found');
    process.exit(1);
  }

  console.log(`[run] Userbot: ${userbot.tg_username || userbot.tg_account_id}`);
  console.log(`[run] Proxy: ${userbot.proxies ? `${userbot.proxies.host}:${userbot.proxies.port}` : '(none)'}`);

  const decrypted = decrypt(userbot.session_data);
  const parsed = JSON.parse(decrypted);
  const { token, fingerprint } = parsed;

  console.log(`[run] Session decrypted, api_id=${fingerprint.api_id}, deviceModel=${fingerprint.deviceModel}`);

  const proxyConfig = userbot.proxies ? {
    ip: userbot.proxies.host,
    port: userbot.proxies.port,
    socksType: 5,
    username: userbot.proxies.username,
    password: userbot.proxies.password
  } : null;

  console.log(`[run] Starting bridge on port ${BRIDGE_PORT}...`);
  const wss = startBridge({ port: BRIDGE_PORT, proxy: proxyConfig });

  await new Promise((r) => setTimeout(r, 500));

  process.env.BRIDGE_URL = `ws://localhost:${BRIDGE_PORT}`;

  console.log('[run] Connecting GramJS through bridge...');
  const session = new StringSession(token);
  const client = new TelegramClient(session, fingerprint.api_id, fingerprint.api_hash, {
    connectionRetries: 3,
    useWSS: false,
    networkSocket: BullrunBridgeSocket,
    deviceModel: fingerprint.deviceModel || 'BullRunSpike',
    systemVersion: fingerprint.systemVersion || '14',
    appVersion: fingerprint.appVersion || '1.0',
    systemLangCode: fingerprint.systemLangCode || 'en',
    langCode: fingerprint.langCode || 'en'
  });

  client.setLogLevel('info');

  let exitCode = 0;
  try {
    await client.connect();
    console.log('[run] Connected!');

    const me = await client.getMe();
    console.log(`[run] getMe OK: id=${me.id}, username=${me.username || '(none)'}, name=${me.firstName || ''}`);

    const dialogs = await client.getDialogs({ limit: 5 });
    console.log(`[run] getDialogs OK: ${dialogs.length} dialogs`);
    for (const d of dialogs) {
      console.log(`       - ${d.title || '(no title)'} (id=${d.id}, unread=${d.unreadCount})`);
    }

    console.log('[run] ========================================');
    console.log('[run] SPIKE SUCCESS — bridge works end-to-end');
    console.log('[run] ========================================');
  } catch (err) {
    console.error('[run] SPIKE FAILED:', err.message);
    console.error(err.stack);
    exitCode = 1;
  } finally {
    try { await client.disconnect(); } catch {}
    try { wss.close(); } catch {}
    process.exit(exitCode);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
