// Shared error types and JSON-RPC helpers used by both MCP and REST transports.
// Plan 01 Phase 1 / Plan 02 uses the same canonical error codes.

export const MCP_PROTOCOL_VERSION = '2025-03-26';

export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  RATE_LIMITED: -32001,
  INSUFFICIENT_SCOPE: -32002,
  FORBIDDEN_ACCOUNT: -32003,
  SAFE_MODE_BLOCKED: -32004,
  ACCOUNT_RESTRICTED: -32005,
  TELEGRAM_ERROR: -32006,
  NOT_FOUND: -32007,
  CONFLICT: -32008,
  QUOTA_EXCEEDED: -32009,
  INTEGRATION_TOKEN_REQUIRED: -32010,
  DM_DISABLED: -32011,
  TOOL_DISABLED: -32012,
  INVALID_CURSOR: -32013
};

const MCP_CODE_TO_HTTP = {
  [ERROR_CODES.PARSE_ERROR]: 400,
  [ERROR_CODES.INVALID_REQUEST]: 400,
  [ERROR_CODES.METHOD_NOT_FOUND]: 404,
  [ERROR_CODES.INVALID_PARAMS]: 422,
  [ERROR_CODES.INTERNAL]: 500,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.INSUFFICIENT_SCOPE]: 403,
  [ERROR_CODES.FORBIDDEN_ACCOUNT]: 403,
  [ERROR_CODES.SAFE_MODE_BLOCKED]: 423,
  [ERROR_CODES.ACCOUNT_RESTRICTED]: 410,
  [ERROR_CODES.TELEGRAM_ERROR]: 502,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.CONFLICT]: 409,
  [ERROR_CODES.QUOTA_EXCEEDED]: 429,
  [ERROR_CODES.INTEGRATION_TOKEN_REQUIRED]: 401,
  [ERROR_CODES.DM_DISABLED]: 403,
  [ERROR_CODES.TOOL_DISABLED]: 503,
  [ERROR_CODES.INVALID_CURSOR]: 400
};

const CODE_TO_AUDIT_STATUS = {
  [ERROR_CODES.RATE_LIMITED]: 'rate_limited',
  [ERROR_CODES.INSUFFICIENT_SCOPE]: 'insufficient_scope',
  [ERROR_CODES.FORBIDDEN_ACCOUNT]: 'forbidden_account',
  [ERROR_CODES.SAFE_MODE_BLOCKED]: 'safe_mode_blocked',
  [ERROR_CODES.ACCOUNT_RESTRICTED]: 'account_restricted',
  [ERROR_CODES.INTEGRATION_TOKEN_REQUIRED]: 'integration_token_required',
  [ERROR_CODES.TELEGRAM_ERROR]: 'telegram_error'
};

export class MCPError extends Error {
  constructor(code, message, data = null) {
    super(message);
    this.name = 'MCPError';
    this.code = code;
    this.data = data || undefined;
    if (data?.auditStatus) this.auditStatus = data.auditStatus;
    else if (CODE_TO_AUDIT_STATUS[code]) this.auditStatus = CODE_TO_AUDIT_STATUS[code];
    if (data?.retryAfterSec) this.retryAfterSec = data.retryAfterSec;
    if (data?.telegramErrorEventId) this.telegramErrorEventId = data.telegramErrorEventId;
  }
}

export class HttpError extends Error {
  constructor(code, message, status, details = null) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = status;
    this.details = details || undefined;
    if (CODE_TO_AUDIT_STATUS[code]) this.auditStatus = CODE_TO_AUDIT_STATUS[code];
  }
}

export function makeJsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

export function makeJsonRpcError(id, code, message, data = null) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data ? { data } : {})
    }
  };
}

export function mapMcpErrorToHttp(code) {
  return MCP_CODE_TO_HTTP[code] ?? 500;
}
