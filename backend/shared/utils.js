// Shared utilities for the unified dispatcher.
// Plan 01 Phase 1.

import crypto from 'node:crypto';

import { mapMcpErrorToHttp, ERROR_CODES } from './errors.js';

const CODE_TO_AUDIT_STATUS = {
  [ERROR_CODES.RATE_LIMITED]: 'rate_limited',
  [ERROR_CODES.INSUFFICIENT_SCOPE]: 'insufficient_scope',
  [ERROR_CODES.FORBIDDEN_ACCOUNT]: 'forbidden_account',
  [ERROR_CODES.SAFE_MODE_BLOCKED]: 'safe_mode_blocked',
  [ERROR_CODES.ACCOUNT_RESTRICTED]: 'account_restricted',
  [ERROR_CODES.INTEGRATION_TOKEN_REQUIRED]: 'integration_token_required',
  [ERROR_CODES.TELEGRAM_ERROR]: 'telegram_error'
};

const VOLATILE_ARG_KEYS = new Set(['cursor', 'limit']);

export function hashArgs(args) {
  if (!args || typeof args !== 'object') return null;
  const stable = {};
  for (const key of Object.keys(args).sort()) {
    if (VOLATILE_ARG_KEYS.has(key)) continue;
    stable[key] = args[key];
  }
  try {
    const json = JSON.stringify(stable);
    return crypto.createHash('sha256').update(json, 'utf8').digest('hex');
  } catch (e) {
    return null;
  }
}

export function mapErrorToAuditStatus(error) {
  if (!error) return 'error';
  if (error.auditStatus) return error.auditStatus;
  if (Number.isFinite(error.code) && CODE_TO_AUDIT_STATUS[error.code]) {
    return CODE_TO_AUDIT_STATUS[error.code];
  }
  return 'error';
}

export { mapMcpErrorToHttp };

export function getFilteredToolDefinitions(tokenScopes, operations) {
  const scopes = Array.isArray(tokenScopes) ? tokenScopes : [];
  const list = Array.isArray(operations)
    ? operations.map((op) => ({ ...op, name: op.name }))
    : Object.entries(operations || {}).map(([name, op]) => ({ ...op, name: op.name || name }));
  const result = [];
  for (const op of list) {
    if (!op?.transports?.mcp) continue;
    const requiredScopes = op.requiredScopes || [];
    if (!requiredScopes.some((s) => scopes.includes(s))) continue;
    result.push({
      name: op.name,
      title: op.title || op.name,
      description: op.description || '',
      inputSchema: op.inputSchema || { type: 'object', additionalProperties: false, properties: {} }
    });
  }
  return result;
}

export function normalizeChatId(value) {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;
  if (!/^-?\d+$/.test(str)) return null;
  return str;
}

export function isValidUuid(value) {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function truncateForLog(value, max = 500) {
  if (value == null) return value;
  const str = typeof value === 'string' ? value : (() => { try { return JSON.stringify(value); } catch { return String(value); } })();
  if (str.length <= max) return str;
  return str.slice(0, max) + '…[truncated]';
}

export function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
