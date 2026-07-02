// Integration test for the production MTProto bridge.
//
// Boots the real MtprotoBridgeService against a real userbot, then opens a WS
// to /api/mtproto-bridge and pipes GramJS through it. Validates that the
// service-end of the bridge (audit logging, multi-use token, JSON handshake,
// SocksClient TCP forward) works identically to the Phase 0 spike.
//
// Run:   SUPABASE_URL=https://bullgram.xyz TELEGRAM_WEB_ENABLED=true \
//        node test/test-mtproto-bridge.js <userbot_id>
//
// Requires backend server running on localhost:3000 with TELEGRAM_WEB_ENABLED=true.

import 'dotenv/config';
import { WebSocket as WsClient } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Mutex } from 'async-mutex';

const USERBOT_ID = process.argv[2];
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const BRIDGE_WS_URL = process.env.BRIDGE_WS_URL || 'ws://localhost:3000/api/mtproto-bridge';
const ADMIN_JWT = process.env.ADMIN_JWT;

if (!USERBOT_ID) {
  console.error('Usage: node test/test-mtproto-bridge.js <userbot_id>');
  console.error('Set env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_JWT (admin user JWT for auth)');
  process.exit(1);
}

if (!ADMIN_JWT) {
  console.error('ADMIN_JWT env var required (Supabase JWT of an admin who owns the userbot)');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

class TestBridgeSocket {
  constructor() {
    this.stream = Buffer.alloc(0);
    this.closed = true;
    this._mutex = new Mutex();
    this._handshakeDone = false;
  }

  async readExactly(number) {
    let out = Buffer.alloc(0);
    while (number > 0) {
      const chunk = await this.read(number);
      out = Buffer.concat([out, chunk]);
      number -= chunk.length;
    }
    return out;
  }

  async read(number) {
    if (this.closed) throw new Error('closed');
    await this.canRead;
    if (this.closed) throw new Error('closed');
    const out = this.stream.slice(0, number);
    this.stream = this.stream.slice(number);
    if (this.stream.length === 0) {
      this.canRead = new Promise((r) => { this.resolveRead = r; });
    }
    return out;
  }

  async readAll() {
    if (this.closed || !(await this.canRead)) throw new Error('closed');
    const out = this.stream;
    this.stream = Buffer.alloc(0);
    this.canRead = new Promise((r) => { this.resolveRead = r; });
    return out;
  }

  async connect(port, ip) {
    this.stream = Buffer.alloc(0);
    this.canRead = new Promise((r) => { this.resolveRead = r; });
    this.closed = false;
    this._handshakeDone = false;

    const url = `${BRIDGE_WS_URL}?bridge_token=${encodeURIComponent(this.bridgeToken)}`;
    console.log(`[test-socket] Connecting to ${BRIDGE_WS_URL} (target ${ip}:${port})`);
    this.client = new WsClient(url);

    return new Promise((resolve, reject) => {
      this.client.on('open', () => {
        this.client.send(JSON.stringify({ ip, port, dcId: this.dcId || null }));
      });

      this.client.on('message', async (data, isBinary) => {
        if (!this._handshakeDone) {
          if (isBinary) {
            reject(new Error('expected text ACK'));
            return;
          }
          const text = data.toString('utf8');
          if (text === 'ok') {
            this._handshakeDone = true;
            console.log('[test-socket] Bridge ACK received');
            resolve(this);
          } else if (text.startsWith('error:')) {
            reject(new Error(text));
          } else {
            reject(new Error('unexpected handshake: ' + text));
          }
          return;
        }
        const release = await this._mutex.acquire();
        try {
          this.stream = Buffer.concat([this.stream, data]);
          if (this.resolveRead) this.resolveRead(true);
        } finally {
          release();
        }
      });

      this.client.on('error', (err) => {
        console.error(`[test-socket] WS error: ${err.message}`);
        if (!this._handshakeDone) reject(err);
      });

      this.client.on('close', () => {
        if (this.resolveRead) this.resolveRead(false);
        this.closed = true;
      });
    });
  }

  write(data) {
    if (this.closed) throw new Error('closed');
    if (this.client) this.client.send(data);
  }

  async close() {
    if (this.client) this.client.close();
    this.closed = true;
  }

  toString() { return 'TestBridgeSocket'; }
}

async function fetchBridgeToken(userbotId) {
  const res = await fetch(`${BACKEND_URL}/api/userbot-web/web-session/${userbotId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ADMIN_JWT}`,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`issueBridgeToken HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function loadSessionForBridgeToken(userbotId) {
  const { data: userbot, error } = await supabase
    .from('tg_accounts')
    .select('session_data')
    .eq('id', userbotId)
    .single();
  if (error || !userbot) {
    throw new Error('failed to load userbot directly: ' + (error?.message || 'not found'));
  }
  return userbot.session_data;
}

async function main() {
  console.log(`[test] Fetching bridge token for ${USERBOT_ID}...`);
  const tokenInfo = await fetchBridgeToken(USERBOT_ID);
  console.log(`[test] Token issued:`, {
    bridgeToken: tokenInfo.bridgeToken.slice(0, 8) + '...',
    wsUrl: tokenInfo.wsUrl,
    expiresAt: new Date(tokenInfo.expiresAt).toISOString()
  });
  console.log(`[test] Fingerprint: api_id=${tokenInfo.fingerprint.api_id}, deviceModel=${tokenInfo.fingerprint.deviceModel}`);

  const sessionData = await loadSessionForBridgeToken(USERBOT_ID);
  const { decrypt } = await import('../utils/crypto.js');
  const decrypted = decrypt(sessionData);
  const { token } = JSON.parse(decrypted);

  const socket = new TestBridgeSocket();
  socket.bridgeToken = tokenInfo.bridgeToken;

  console.log('[test] Connecting GramJS through production bridge...');
  const session = new StringSession(token);
  const client = new TelegramClient(session, tokenInfo.fingerprint.api_id, tokenInfo.fingerprint.api_hash, {
    connectionRetries: 3,
    useWSS: false,
    networkSocket: socket,
    deviceModel: tokenInfo.fingerprint.deviceModel,
    systemVersion: tokenInfo.fingerprint.systemVersion,
    appVersion: tokenInfo.fingerprint.appVersion,
    systemLangCode: tokenInfo.fingerprint.systemLangCode,
    langCode: tokenInfo.fingerprint.langCode
  });

  client._updateLoop = async () => {};

  let exitCode = 0;
  try {
    await client.connect();
    console.log('[test] Connected!');

    const me = await client.getMe();
    console.log(`[test] getMe OK: id=${me.id}, name=${me.firstName || ''}`);

    const dialogs = await client.getDialogs({ limit: 5 });
    console.log(`[test] getDialogs OK: ${dialogs.length} dialogs`);
    for (const d of dialogs) {
      console.log(`       - ${d.title || '(no title)'} (id=${d.id})`);
    }

    console.log('[test] ========================');
    console.log('[test] BRIDGE SERVICE SUCCESS');
    console.log('[test] ========================');
  } catch (err) {
    console.error('[test] BRIDGE SERVICE FAILED:', err.message);
    console.error(err.stack);
    exitCode = 1;
  } finally {
    try { await client.disconnect(); } catch {}
    try { await socket.close(); } catch {}
    process.exit(exitCode);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
