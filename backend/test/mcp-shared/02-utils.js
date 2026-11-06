/**
 * Сценарий: utils (hashArgs / mapErrorToAuditStatus / getFilteredToolDefinitions /
 * normalizeChatId / isValidUuid / truncateForLog / withTimeout) из test-mcp-shared.
 * Экспортирует run() — хост вызывает сценарии строго по порядку.
 */
import { assertEqual, assertRejects } from './shared.js';
import {
  hashArgs,
  mapErrorToAuditStatus,
  getFilteredToolDefinitions,
  normalizeChatId,
  isValidUuid,
  truncateForLog,
  withTimeout
} from '../../shared/utils.js';
import { ERROR_CODES } from '../../shared/errors.js';

export async function run() {

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

}
