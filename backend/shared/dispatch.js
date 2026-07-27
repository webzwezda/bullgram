// Unified dispatcher for MCP and REST transports.
// Plan 01 Phase 1.
//
// Both POST /api/mcp (JSON-RPC) and /api/external/v1/* (REST) call dispatchOperation.
// Auth, scope, allowlist, rate-limit, and audit-log checks happen here — never in
// the operation handler. The handler receives only ({ supabase, req, args, userbotService, source }).
//
// `auditId` is captured in the function scope (not res.locals) so both try and catch
// blocks see it. This eliminates the closure-capture bug from Revision 1.

import {
  MCPError,
  ERROR_CODES,
  mapMcpErrorToHttp
} from './errors.js';
import {
  assertAccountAllowed,
  assertIntegrationToken,
  assertToolAllowed
} from './scope-guard.js';
import {
  rateLimiter,
  defaultTokenLimits,
  userbotLimits
} from './rate-limiter.js';
import {
  writeAuditLogEntry,
  finalizeAuditLogEntry,
  logAuditError
} from './audit-log.js';
import {
  getOperation
} from './operations.js';
import {
  hashArgs,
  mapErrorToAuditStatus
} from './utils.js';

export async function dispatchOperation({
  supabase,
  req,
  operationName,
  args,
  userbotService,
  source = 'mcp'
}) {
  const operation = getOperation(operationName);
  if (!operation) {
    throw new MCPError(
      ERROR_CODES.METHOD_NOT_FOUND,
      `Unknown operation: ${operationName}`,
      { auditStatus: 'error' }
    );
  }

  const auth = req?.auth || {};
  const token = req?.token || auth?.integrationToken || null;
  const ownerId = req?.user?.id || auth?.user?.id || null;

  if (operation.requiresIntegrationToken) {
    assertIntegrationToken(auth);
  }

  assertToolAllowed(token?.scopes, operation.requiredScopes);

  const userbotId = args?.userbot_id || null;
  if (userbotId) {
    assertAccountAllowed(token, userbotId);
  }

  const tokenLimits = defaultTokenLimits(token?.metadata);
  const tokenClassLimit = operation.rateLimitClass === 'write' ? tokenLimits.write : tokenLimits.read;
  const tokenKey = token?.id ? `token:${token.id}:${operation.rateLimitClass}` : `user:${ownerId}:${operation.rateLimitClass}`;
  rateLimiter.consume({
    key: tokenKey,
    perMinute: tokenClassLimit,
    class: operation.rateLimitClass
  });

  if (userbotId) {
    rateLimiter.consume({
      key: `userbot:${userbotId}:${operation.rateLimitClass}`,
      perMinute: userbotLimits(operation.rateLimitClass),
      class: operation.rateLimitClass
    });
  }

  let auditId = null;
  const startedAt = Date.now();
  const argumentsHash = hashArgs(args);

  try {
    auditId = await writeAuditLogEntry(supabase, {
      token_id: token?.id || null,
      auth_kind: auth.kind,
      owner_id: ownerId,
      operation_name: operationName,
      source,
      userbot_id: userbotId,
      chat_id: args?.chat_id ? String(args.chat_id) : null,
      arguments_hash: argumentsHash,
      request_ip: req?.ip || null,
      user_agent: req?.headers?.['user-agent'] || null,
      request_id: req?.id || null
    });
  } catch (auditOpenError) {
    console.error('[dispatch] writeAuditLogEntry threw:', auditOpenError.message);
  }

  try {
    const result = await operation.handler({
      supabase,
      req,
      args,
      userbotService,
      source
    });
    if (auditId) {
      await finalizeAuditLogEntry(supabase, auditId, {
        status: 'success',
        latency_ms: Date.now() - startedAt
      });
    }
    return {
      result,
      rateLimit: rateLimiter.lastSeen(tokenKey)
    };
  } catch (error) {
    const statusCode = error?.code || null;
    if (auditId) {
      await finalizeAuditLogEntry(supabase, auditId, {
        status: mapErrorToAuditStatus(error),
        latency_ms: Date.now() - startedAt,
        error_code: statusCode,
        error_message: error?.message || null,
        telegram_error_event_id: error?.telegramErrorEventId || null
      });
    } else {
      // Audit open failed before the operation ran — record standalone error entry.
      await logAuditError(supabase, {
        token_id: token?.id || null,
        owner_id: ownerId,
        operation_name: operationName,
        source,
        error_code: statusCode,
        error_message: error?.message || null,
        request_ip: req?.ip || null,
        user_agent: req?.headers?.['user-agent'] || null,
        request_id: req?.id || null
      });
    }
    throw error;
  }
}

export { mapMcpErrorToHttp };
