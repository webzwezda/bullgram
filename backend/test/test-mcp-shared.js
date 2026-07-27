/**
 * Unit tests for shared/ modules used by both MCP and REST transports.
 * Plan 01 Phase 7.
 *
 * Запуск: node test/test-mcp-shared.js
 *
 * Covers: errors, pagination, utils, rate-limiter, scope-guard, content-sanitizer.
 * Pure functions only — no Supabase, no network, no Telegram.
 */
import {
  MCPError,
  HttpError,
  ERROR_CODES,
  makeJsonRpcResult,
  makeJsonRpcError,
  mapMcpErrorToHttp
} from '../shared/errors.js';
import { encodeCursor, decodeCursor, buildPage } from '../shared/pagination.js';
import {
  hashArgs,
  mapErrorToAuditStatus,
  getFilteredToolDefinitions,
  normalizeChatId,
  isValidUuid,
  truncateForLog,
  withTimeout
} from '../shared/utils.js';
import {
  InMemoryRateLimiter,
  defaultTokenLimits,
  userbotLimits
} from '../shared/rate-limiter.js';
import {
  assertIntegrationToken,
  assertToolAllowed,
  assertAccountAllowed
} from '../shared/scope-guard.js';
import {
  sanitizeMessage,
  summarizeMedia,
  summarizeSender,
  summarizeForward,
  sanitizeDialog,
  sanitizeParticipant
} from '../shared/content-sanitizer.js';

let failures = 0;
let passes = 0;
function ok(label) {
  passes++;
  console.log(`  ✓ ${label}`);
}
function fail(label, expected, actual) {
  failures++;
  console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
}
function assertEqual(actual, expected, label) {
  const a = actual instanceof Date ? actual.toISOString() : actual;
  const e = expected instanceof Date ? expected.toISOString() : expected;
  if (JSON.stringify(a) === JSON.stringify(e)) ok(label);
  else fail(label, e, a);
}
function assertThrows(fn, predicate, label) {
  try {
    fn();
    fail(label, 'throw', 'no throw');
  } catch (e) {
    if (predicate(e)) ok(label);
    else fail(label, 'matching error', e?.message || String(e));
  }
}
async function assertRejects(promiseFactory, predicate, label) {
  try {
    await promiseFactory();
    fail(label, 'throw', 'no throw');
  } catch (e) {
    if (predicate(e)) ok(label);
    else fail(label, 'matching error', e?.message || String(e));
  }
}

console.log('--- errors.MCPError ---');
{
  const err = new MCPError(ERROR_CODES.RATE_LIMITED, 'too fast', { auditStatus: 'rate_limited', retryAfterSec: 5 });
  assertEqual(err.code, ERROR_CODES.RATE_LIMITED, 'code');
  assertEqual(err.auditStatus, 'rate_limited', 'auditStatus from data');
  assertEqual(err.retryAfterSec, 5, 'retryAfterSec from data');
  assertEqual(err.name, 'MCPError', 'name');
}
{
  const err = new MCPError(ERROR_CODES.FORBIDDEN_ACCOUNT, 'nope');
  assertEqual(err.auditStatus, 'forbidden_account', 'auditStatus derived from code');
  assertEqual(err.data, undefined, 'no data → undefined (not null)');
}

console.log('--- errors.HttpError ---');
{
  const err = new HttpError(ERROR_CODES.NOT_FOUND, 'missing', 404, { what: 'userbot' });
  assertEqual(err.status, 404, 'status');
  assertEqual(err.details.what, 'userbot', 'details preserved');
}

console.log('--- errors.makeJsonRpcResult / makeJsonRpcError ---');
{
  const r = makeJsonRpcResult(7, { ok: true });
  assertEqual(r, { jsonrpc: '2.0', id: 7, result: { ok: true } }, 'result shape');
  const e = makeJsonRpcError(7, ERROR_CODES.INVALID_PARAMS, 'bad', { hint: 'x' });
  assertEqual(e, { jsonrpc: '2.0', id: 7, error: { code: ERROR_CODES.INVALID_PARAMS, message: 'bad', data: { hint: 'x' } } }, 'error shape with data');
  const e2 = makeJsonRpcError(null, ERROR_CODES.PARSE_ERROR, 'unparseable');
  assertEqual(e2, { jsonrpc: '2.0', id: null, error: { code: ERROR_CODES.PARSE_ERROR, message: 'unparseable' } }, 'error shape without data, null id');
}

console.log('--- errors.mapMcpErrorToHttp ---');
{
  assertEqual(mapMcpErrorToHttp(ERROR_CODES.RATE_LIMITED), 429, 'RATE_LIMITED → 429');
  assertEqual(mapMcpErrorToHttp(ERROR_CODES.INSUFFICIENT_SCOPE), 403, 'INSUFFICIENT_SCOPE → 403');
  assertEqual(mapMcpErrorToHttp(ERROR_CODES.SAFE_MODE_BLOCKED), 423, 'SAFE_MODE_BLOCKED → 423');
  assertEqual(mapMcpErrorToHttp(ERROR_CODES.ACCOUNT_RESTRICTED), 410, 'ACCOUNT_RESTRICTED → 410');
  assertEqual(mapMcpErrorToHttp(ERROR_CODES.TELEGRAM_ERROR), 502, 'TELEGRAM_ERROR → 502');
  assertEqual(mapMcpErrorToHttp(ERROR_CODES.INTEGRATION_TOKEN_REQUIRED), 401, 'INTEGRATION_TOKEN_REQUIRED → 401');
  assertEqual(mapMcpErrorToHttp(9999), 500, 'unknown code → 500');
}

console.log('--- pagination.encodeCursor / decodeCursor ---');
{
  const c = encodeCursor({ offset_id: 42 });
  assertEqual(typeof c, 'string', 'cursor is string');
  assertEqual(decodeCursor(c), { offset_id: 42 }, 'round-trip');
  assertEqual(decodeCursor(null), null, 'null in → null out');
  assertEqual(decodeCursor(''), null, 'empty in → null out');
}
{
  // base64url payload (no padding) — confirm we accept spec-compliant input
  const valid = Buffer.from(JSON.stringify({ a: 1 })).toString('base64url');
  assertEqual(decodeCursor(valid), { a: 1 }, 'base64url payload');
}
{
  // malformed cursor must throw INVALID_CURSOR
  assertThrows(
    () => decodeCursor('!!!notbase64!!!'),
    (e) => e instanceof MCPError && e.code === ERROR_CODES.INVALID_CURSOR,
    'malformed cursor throws INVALID_CURSOR'
  );
  // valid base64 of non-object JSON
  const arr = Buffer.from('[1,2,3]').toString('base64url');
  assertThrows(
    () => decodeCursor(arr),
    (e) => e instanceof MCPError && e.code === ERROR_CODES.INVALID_CURSOR,
    'array payload rejected'
  );
  // missing required key
  const c = encodeCursor({ offset: 5 });
  assertThrows(
    () => decodeCursor(c, ['offset_id']),
    (e) => e instanceof MCPError && e.code === ERROR_CODES.INVALID_CURSOR && /offset_id/.test(e.message),
    'missing required key rejected'
  );
}

console.log('--- pagination.buildPage ---');
{
  const page = buildPage([1, 2, 3], { offset_id: 99 });
  assertEqual(page.items, [1, 2, 3], 'items passed through');
  assertEqual(typeof page.cursor, 'string', 'cursor encoded');
  assertEqual(page.has_more, true, 'has_more true when cursorPayload present');
  const end = buildPage([], null);
  assertEqual(end.cursor, null, 'null cursor when no payload');
  assertEqual(end.has_more, false, 'has_more false when no payload');
}

console.log('--- utils.hashArgs ---');
{
  const a = hashArgs({ userbot_id: 'X', chat_id: 'C', cursor: 'abc', limit: 50 });
  const b = hashArgs({ chat_id: 'C', userbot_id: 'X', cursor: 'different', limit: 100 });
  assertEqual(a, b, 'cursor/limit stripped + order-independent');
  assertEqual(typeof a, 'string', 'hash is string');
  assertEqual(a.length, 64, 'sha256 hex length');
  assertEqual(hashArgs(null), null, 'null in → null out');
  assertEqual(hashArgs(undefined), null, 'undefined in → null out');
}

console.log('--- utils.mapErrorToAuditStatus ---');
{
  assertEqual(mapErrorToAuditStatus(null), 'error', 'null → error');
  assertEqual(mapErrorToAuditStatus({ auditStatus: 'custom_x' }), 'custom_x', 'auditStatus wins');
  assertEqual(mapErrorToAuditStatus({ code: ERROR_CODES.RATE_LIMITED }), 'rate_limited', 'RATE_LIMITED numeric code');
  assertEqual(mapErrorToAuditStatus({ code: ERROR_CODES.ACCOUNT_RESTRICTED }), 'account_restricted', 'ACCOUNT_RESTRICTED numeric code');
  assertEqual(mapErrorToAuditStatus({ code: 9999 }), 'error', 'unknown numeric code → error');
  assertEqual(mapErrorToAuditStatus({ code: 'RATE_LIMITED' }), 'error', 'string symbolic code (legacy) → error fallback');
}

console.log('--- utils.getFilteredToolDefinitions ---');
{
  const operations = {
    a: { transports: { mcp: true }, requiredScopes: ['mcp:userbot:read'], title: 'A', description: 'a tool', inputSchema: { type: 'object' } },
    b: { transports: { mcp: true, rest: { method: 'POST', path: '/x' } }, requiredScopes: ['mcp:userbot:write', 'api:userbot:write'], title: 'B' },
    c: { transports: { rest: { method: 'GET', path: '/y' } }, requiredScopes: ['mcp:userbot:read'] }
  };
  const readTools = getFilteredToolDefinitions(['mcp:userbot:read'], operations);
  assertEqual(readTools.length, 1, 'read scope sees only A (B needs write, C no mcp transport)');
  assertEqual(readTools[0].name, 'a', 'first tool is a');
  const writeTools = getFilteredToolDefinitions(['mcp:userbot:write'], operations);
  assertEqual(writeTools.length, 1, 'write scope sees only B');
  assertEqual(writeTools[0].name, 'b', 'tool is b');
  const empty = getFilteredToolDefinitions([], operations);
  assertEqual(empty.length, 0, 'no scopes → no tools');
}

console.log('--- utils.normalizeChatId ---');
{
  assertEqual(normalizeChatId('-100123'), '-100123', 'negative preserved');
  assertEqual(normalizeChatId(' 42 '), '42', 'whitespace trimmed');
  assertEqual(normalizeChatId('abc'), null, 'non-numeric → null');
  assertEqual(normalizeChatId(null), null, 'null → null');
  assertEqual(normalizeChatId(''), null, 'empty → null');
}

console.log('--- utils.isValidUuid ---');
{
  assertEqual(isValidUuid('11111111-2222-3333-4444-555555555555'), true, 'valid uuid');
  assertEqual(isValidUuid('not-uuid'), false, 'plain string rejected');
  assertEqual(isValidUuid(null), false, 'null rejected');
  assertEqual(isValidUuid(123), false, 'non-string rejected');
}

console.log('--- utils.truncateForLog ---');
{
  assertEqual(truncateForLog('short'), 'short', 'short passthrough');
  assertEqual(truncateForLog(null), null, 'null passthrough');
  const long = 'A'.repeat(600);
  const t = truncateForLog(long, 100);
  assertEqual(t.length, 112, 'truncated to max + ellipsis (100 + "…[truncated]" = 112)');
  assertEqual(t.endsWith('…[truncated]'), true, 'ends with ellipsis marker');
  assertEqual(truncateForLog({ a: 1 }).startsWith('{'), true, 'object stringified');
}

console.log('--- utils.withTimeout ---');
{
  const fast = new Promise((r) => setTimeout(() => r('ok'), 10));
  const result = await withTimeout(fast, 1000, 'fast');
  assertEqual(await result, 'ok', 'fast resolves before timeout');
  // Note: withTimeout resolves to either the promise value or rejects with timeout.
  // When the promise wins, await withTimeout returns the value.
  // We don't test the slow path because it's hard to clean up the lingering promise.
}

console.log('--- withTimeout: timeout path ---');
{
  const slow = new Promise(() => {}); // never resolves
  await assertRejects(
    () => withTimeout(slow, 30, 'never'),
    (e) => /never timed out/.test(e.message),
    'slow promise rejected with label'
  );
}

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

console.log('--- content-sanitizer.sanitizeMessage ---');
{
  const msg = {
    id: 100,
    date: new Date('2026-07-27T10:00:00Z'),
    sender: { id: 7, username: 'alice', firstName: 'Alice', bot: false, verified: true },
    senderId: 7,
    text: 'hi',
    media: null,
    replyTo: { replyToMsgId: 99 },
    fwdFrom: null
  };
  const s = sanitizeMessage(msg);
  assertEqual(s.id, '100', 'id stringified');
  assertEqual(s.date, '2026-07-27T10:00:00.000Z', 'date ISO');
  assertEqual(s.sender.username, 'alice', 'sender preserved');
  assertEqual(s.text, 'hi', 'text preserved');
  assertEqual(s.has_media, false, 'has_media false');
  assertEqual(s.media, null, 'media null');
  assertEqual(s.reply_to_message_id, '99', 'reply_to stringified');
  assertEqual(s.forward_from, null, 'forward_from null');
  assertEqual(s.untrusted_content, true, 'untrusted_content flag');
  assertEqual(typeof s._sanitization_note, 'string', 'sanitization note attached');
}
{
  // Long text truncation
  const t = sanitizeMessage({ id: 1, text: 'X'.repeat(5000) });
  assertEqual(t.text_truncated, true, 'long text flagged');
  assertEqual(t.text.endsWith('…[truncated]'), true, 'long text truncated with marker');
  assertEqual(t.text.length < 5000, true, 'truncated shorter than original');
}
{
  // Missing sender falls back to senderId
  const s = sanitizeMessage({ id: 1, senderId: 999, text: '' });
  assertEqual(s.sender.id, '999', 'fallback to senderId');
  assertEqual(s.sender.username, null, 'no username');
}

console.log('--- content-sanitizer.summarizeMedia ---');
{
  assertEqual(summarizeMedia(null), null, 'null media');
  assertEqual(summarizeMedia({ photo: { id: 'p1', sizes: [{ size: { value: 10 } }, { size: { value: 50 } }] } }).kind, 'photo', 'photo kind');
  assertEqual(summarizeMedia({ photo: { id: 'p1', sizes: [] } }).size_bytes, null, 'photo no sizes → null');
  assertEqual(summarizeMedia({ document: { mimeType: 'image/png', size: { value: 100 }, attributes: [{ fileName: 'a.png' }] } }).file_name, 'a.png', 'document filename');
  assertEqual(summarizeMedia({ webpage: { url: 'https://x', title: 'T', description: 'D' } }).kind, 'link_preview', 'webpage → link_preview');
  assertEqual(summarizeMedia({ contact: { phoneNumber: '+1', firstName: 'A' } }).kind, 'contact', 'contact');
  assertEqual(summarizeMedia({ geo: { lat: 1, long: 2 } }).kind, 'geo', 'geo');
  assertEqual(summarizeMedia({ poll: { poll: { question: 'Q?' } } }).question, 'Q?', 'poll question');
  assertEqual(summarizeMedia({ game: { title: 'G' } }).kind, 'game', 'game');
  assertEqual(summarizeMedia({ invoice: { title: 'I', currency: 'TON', totalAmount: 1000 } }).total_amount, '1000', 'invoice totalAmount stringified');
  assertEqual(summarizeMedia({ weird: true }).kind, 'unknown', 'unknown kind');
}

console.log('--- content-sanitizer.summarizeSender ---');
{
  const s = summarizeSender(null, 42);
  assertEqual(s.id, '42', 'fallback to senderId');
  assertEqual(s.is_bot, false, 'is_bot false');
  assertEqual(s.is_verified, false, 'is_verified false');
  const full = summarizeSender({ id: 1, username: 'u', firstName: 'F', lastName: 'L', bot: true, verified: true }, null);
  assertEqual(full.username, 'u', 'username');
  assertEqual(full.last_name, 'L', 'last_name');
  assertEqual(full.is_bot, true, 'is_bot true');
}

console.log('--- content-sanitizer.summarizeForward ---');
{
  assertEqual(summarizeForward(null), null, 'null forward');
  const f = summarizeForward({
    fromId: { className: 'PeerChannel', channelId: '-100123' },
    fromName: 'News',
    date: 1722000000
  });
  assertEqual(f.from_channel_id, '-100123', 'channel id');
  assertEqual(f.from_user_id, null, 'no user id');
  assertEqual(f.from_sender_name, 'News', 'name preserved');
  assertEqual(typeof f.date, 'string', 'date ISO string');
}

console.log('--- content-sanitizer.sanitizeDialog ---');
{
  const ch = sanitizeDialog({ entity: { className: 'Channel', id: -1001, title: 'News', username: 'news' }, unreadCount: 3, message: { id: 50 } });
  assertEqual(ch.kind, 'channel', 'channel kind');
  assertEqual(ch.name, 'News', 'title');
  assertEqual(ch.unread_count, 3, 'unread');
  assertEqual(ch.last_message_id, '50', 'last_message_id stringified');

  const mg = sanitizeDialog({ entity: { className: 'Channel', megagroup: true, title: 'Dev' } });
  assertEqual(mg.kind, 'megagroup', 'megagroup kind');

  const grp = sanitizeDialog({ entity: { className: 'Chat', title: 'Small' } });
  assertEqual(grp.kind, 'group', 'group kind');

  const pv = sanitizeDialog({ entity: { className: 'User', firstName: 'Bob', lastName: 'X' } });
  assertEqual(pv.kind, 'private', 'private kind');
  assertEqual(pv.name, 'Bob X', 'private name fallback');

  const unk = sanitizeDialog({ entity: { className: 'Other' }, title: 'Unknown' });
  assertEqual(unk.kind, 'unknown', 'unknown kind');
}

console.log('--- content-sanitizer.sanitizeParticipant ---');
{
  const admin = sanitizeParticipant({ user: { id: 8, firstName: 'A', bot: false, verified: false }, adminRights: {} });
  assertEqual(admin.is_admin, true, 'admin detected via adminRights');
  assertEqual(admin.first_name, 'A', 'first_name');

  const plain = sanitizeParticipant({ user: { id: 9, firstName: 'P' } });
  assertEqual(plain.is_admin, false, 'no adminRights → not admin');

  const bare = sanitizeParticipant({ id: 10, username: 'bare' });
  assertEqual(bare.id, '10', 'bare id');
  assertEqual(bare.username, 'bare', 'bare username');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
