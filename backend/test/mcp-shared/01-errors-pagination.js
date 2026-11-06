/**
 * Сценарий: errors (MCPError / HttpError / jsonrpc / mapMcpErrorToHttp)
 * и pagination (cursor round-trip / buildPage) из test-mcp-shared.
 * Экспортирует run() — хост вызывает сценарии строго по порядку.
 */
import { assertEqual, assertThrows } from './shared.js';
import {
  MCPError,
  HttpError,
  ERROR_CODES,
  makeJsonRpcResult,
  makeJsonRpcError,
  mapMcpErrorToHttp
} from '../../shared/errors.js';
import { encodeCursor, decodeCursor, buildPage } from '../../shared/pagination.js';

export async function run() {

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

}
