/**
 * Сценарий: media endpoints (wave 2026-11-21) —
 *   GET  /userbots/{id}/chats/{chat}/messages/{mid}/media  (binary stream)
 *   POST /userbots/{id}/chats/{chat}/messages/{mid}/media/save (JSON + signed URL)
 *   GET  /media/{token}  (public signed link)
 * Хост вызывает сценарии строго по порядку.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'ci-dummy-key-not-used-tests-mock-everything';

import { startApp, fetchJSON, bearer, makeMockSupabase, makeMockUserbotService,
         counters, SAMPLE_USERBOT_ID, SAMPLE_TOKEN_PLAINTEXT, OWNER_ID } from './shared.js';
import { MCPError, ERROR_CODES } from '../../shared/errors.js';

const MEDIA_BYTES = 'PING';
const SAMPLE_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

function fail(label, detail) {
  counters.failures++;
  console.error(`  ✗ ${label}${detail ? `: ${detail}` : ''}`);
}

function tokenFor() {
  return [{
    id: 'tok-1',
    owner_id: OWNER_ID,
    purpose: 'api',
    scopes: ['api:userbot:read'],
    token_hash: crypto.createHash('sha256').update(SAMPLE_TOKEN_PLAINTEXT).digest('hex'),
    revoked_at: null
  }];
}

const BIN_PATH = `/api/external/v1/userbots/${SAMPLE_USERBOT_ID}/chats/-100123/messages/169729/media`;
const SAVE_PATH = `/api/external/v1/userbots/${SAMPLE_USERBOT_ID}/chats/-100123/messages/169729/media/save`;

export async function run() {

console.log('--- external-rest: media binary stream + signed link ---');
{
  const mediaFile = path.join(os.tmpdir(), 'bullgram-rest-media-169729.bin');
  fs.writeFileSync(mediaFile, MEDIA_BYTES);

  const supabase = makeMockSupabase({ tokens: tokenFor(), tgAccounts: [{ id: SAMPLE_USERBOT_ID, owner_id: OWNER_ID, session_data: 'x' }] });
  const userbotService = makeMockUserbotService({ mediaAbsolutePath: mediaFile });
  const { port, close } = await startApp({ supabase, userbotService });

  try {
    // 1. Binary stream via the REST endpoint.
    const bin = await fetch(`http://127.0.0.1:${port}${BIN_PATH}`, bearer(SAMPLE_TOKEN_PLAINTEXT));
    const body = await bin.text();
    if (bin.status !== 200) fail('binary GET status', String(bin.status));
    else if (body !== MEDIA_BYTES) fail('binary body mismatch', JSON.stringify(body));
    else if (bin.headers.get('x-media-sha256') !== SAMPLE_SHA) fail('X-Media-SHA256 header', bin.headers.get('x-media-sha256'));
    else if (!(bin.headers.get('content-type') || '').startsWith('application/octet-stream')) fail('content-type', bin.headers.get('content-type'));
    else console.log('  ✓ binary GET streams bytes with Content-Type + X-Media-SHA256');

    // 2. media_save → signed URL → public fetch (no auth header).
    const saved = await fetchJSON(port, SAVE_PATH, { ...bearer(SAMPLE_TOKEN_PLAINTEXT), method: 'POST' });
    if (saved.status !== 200 || !saved.body?.download_url) {
      fail('media_save', `status ${saved.status}: ${JSON.stringify(saved.body)}`);
    } else {
      const urlOk = typeof saved.body.download_url === 'string'
        && saved.body.download_url.includes('/api/external/v1/media/')
        && typeof saved.body.expires_at === 'string'
        && saved.body.sha256 === SAMPLE_SHA;
      if (!urlOk) fail('media_save payload', JSON.stringify(saved.body));
      else {
        // The mock service "stored" the file — materialize it at the store path
        // the mock's file_path claims, so the signed-link route can serve it.
        const storeFile = path.join(process.cwd(), 'uploads-internal', 'chat-media',
          OWNER_ID, SAMPLE_USERBOT_ID, '-100123', '169729-sample.bin');
        fs.mkdirSync(path.dirname(storeFile), { recursive: true });
        fs.writeFileSync(storeFile, MEDIA_BYTES);
        const pub = await fetch(saved.body.download_url);
        const pubBody = await pub.text();
        if (pub.status !== 200) fail('signed link status', String(pub.status));
        else if (pubBody !== MEDIA_BYTES) fail('signed link body mismatch', JSON.stringify(pubBody));
        else console.log('  ✓ media_save returns signed URL; public fetch delivers bytes (no auth)');
        fs.rmSync(path.join(process.cwd(), 'uploads-internal', 'chat-media', OWNER_ID), { recursive: true, force: true });
      }

      // 3. Tampered token → 403.
      const tampered = saved.body.download_url.slice(0, -2) + 'xx';
      const badRes = await fetch(tampered);
      if (badRes.status !== 403) fail('tampered token status', `${badRes.status}, expected 403`);
      else console.log('  ✓ tampered signed link → 403');
    }

    // 4. MEDIA_TOO_LARGE surfaces as HTTP 413 envelope.
    const rejecting = makeMockUserbotService({
      mediaAbsolutePath: mediaFile,
      downloadChatMedia: async () => {
        throw new MCPError(ERROR_CODES.MEDIA_TOO_LARGE, 'Media is 999999 bytes, above the 1MB limit.', { size_bytes: 999999 });
      }
    });
    const supa2 = makeMockSupabase({ tokens: tokenFor(), tgAccounts: [{ id: SAMPLE_USERBOT_ID, owner_id: OWNER_ID, session_data: 'x' }] });
    const app2 = await startApp({ supabase: supa2, userbotService: rejecting });
    try {
      const res = await fetchJSON(app2.port, BIN_PATH, bearer(SAMPLE_TOKEN_PLAINTEXT));
      if (res.status !== 413) fail('MEDIA_TOO_LARGE http', `${res.status}, expected 413`);
      else if (res.body?.error?.code !== -32015) fail('MEDIA_TOO_LARGE code', JSON.stringify(res.body?.error));
      else console.log('  ✓ MEDIA_TOO_LARGE → HTTP 413 with code -32015');
    } finally {
      app2.close();
    }

    // 5. OpenAPI exposes the new paths (binary content + public signed link).
    const spec = await fetchJSON(port, '/api/external/v1/openapi.json');
    const binItem = spec.body?.paths?.['/userbots/{userbot_id}/chats/{chat_id}/messages/{message_id}/media']?.get;
    const hasSave = Boolean(spec.body?.paths?.['/userbots/{userbot_id}/chats/{chat_id}/messages/{message_id}/media/save']?.post);
    const binIsBinary = Boolean(binItem?.responses?.['200']?.content?.['application/octet-stream']);
    const hasLink = Boolean(spec.body?.paths?.['/media/{token}']?.get);
    if (hasSave && binItem && binIsBinary && hasLink) console.log('  ✓ openapi.json exposes media save/download (octet-stream) + signed link');
    else fail('openapi paths', `save=${hasSave} bin=${Boolean(binItem)} binIsBinary=${binIsBinary} link=${hasLink}`);
  } finally {
    fs.unlinkSync(mediaFile);
    close();
  }
}

}
