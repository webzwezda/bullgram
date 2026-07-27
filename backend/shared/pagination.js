// Cursor encode/decode for pagination across MCP and REST.
// Cursor format is internal and may change; clients treat it as opaque.

import { MCPError, ERROR_CODES } from './errors.js';

export function encodeCursor(payload) {
  if (payload == null) return null;
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(cursor, expectedKeys = null) {
  if (cursor == null || cursor === '') return null;
  let parsed;
  try {
    const json = Buffer.from(String(cursor), 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch (e) {
    throw new MCPError(
      ERROR_CODES.INVALID_CURSOR,
      'Cursor is malformed. Re-fetch the first page without a cursor.',
      { auditStatus: 'error' }
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MCPError(
      ERROR_CODES.INVALID_CURSOR,
      'Cursor payload must be a JSON object.',
      { auditStatus: 'error' }
    );
  }
  if (expectedKeys && expectedKeys.length) {
    for (const key of expectedKeys) {
      if (!(key in parsed)) {
        throw new MCPError(
          ERROR_CODES.INVALID_CURSOR,
          `Cursor missing required field: ${key}.`,
          { auditStatus: 'error' }
        );
      }
    }
  }
  return parsed;
}

export function buildPage(items, cursorPayload) {
  return {
    items,
    cursor: encodeCursor(cursorPayload),
    has_more: Boolean(cursorPayload)
  };
}
