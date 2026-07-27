// Audit log writers shared between MCP and REST transports.
// Plan 01 Phase 1.
//
// Every operation flows through writeAuditLogEntry -> dispatch -> finalizeAuditLogEntry.
// The auditId is captured as a closure variable inside dispatchOperation (see dispatch.js)
// so both try and catch blocks see it — no res.locals indirection, no capture bug.

import { mapErrorToAuditStatus } from './utils.js';

const TABLE = 'mcp_tool_log';

const VALID_AUTH_KINDS = new Set(['integration_token', 'user_token', 'agent_token']);
const VALID_SOURCES = new Set(['mcp', 'rest']);

export async function writeAuditLogEntry(supabase, payload) {
  if (!supabase) return null;
  const authKind = VALID_AUTH_KINDS.has(payload.auth_kind) ? payload.auth_kind : 'user_token';
  const source = VALID_SOURCES.has(payload.source) ? payload.source : 'mcp';
  const row = {
    token_id: payload.token_id || null,
    auth_kind: authKind,
    owner_id: payload.owner_id || null,
    operation_name: payload.operation_name || null,
    source,
    userbot_id: payload.userbot_id || null,
    chat_id: payload.chat_id || null,
    arguments_hash: payload.arguments_hash || null,
    status: 'started',
    request_ip: payload.request_ip || null,
    user_agent: payload.user_agent || null,
    request_id: payload.request_id || null,
    started_at: new Date().toISOString()
  };
  const { data, error } = await supabase.from(TABLE).insert(row).select('id').single();
  if (error) {
    // Audit log failure must not block the operation — surface to logs only.
    console.error('[audit] writeAuditLogEntry failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function finalizeAuditLogEntry(supabase, auditId, payload) {
  if (!supabase || !auditId) return;
  const status = payload.status || (payload.error ? 'error' : 'success');
  const finalizedAt = new Date().toISOString();
  const patch = {
    status,
    latency_ms: Number.isFinite(payload.latency_ms) ? Math.round(payload.latency_ms) : null,
    finished_at: finalizedAt
  };
  if (payload.error_code) patch.error_code = String(payload.error_code).slice(0, 200);
  if (payload.error_message) patch.error_message = String(payload.error_message).slice(0, 1000);
  if (payload.telegram_error_event_id) patch.telegram_error_event_id = payload.telegram_error_event_id;
  const { error } = await supabase.from(TABLE).update(patch).eq('id', auditId);
  if (error) {
    console.error(`[audit] finalizeAuditLogEntry failed for id=${auditId}:`, error.message);
  }
}

export async function logAuditError(supabase, payload) {
  // Standalone error entry — for cases where audit open itself failed
  // but we still want to record the failure for observability.
  if (!supabase) return;
  const status = mapErrorToAuditStatus({ code: payload.error_code });
  const row = {
    token_id: payload.token_id || null,
    auth_kind: 'integration_token',
    owner_id: payload.owner_id || null,
    operation_name: payload.operation_name || null,
    source: VALID_SOURCES.has(payload.source) ? payload.source : 'mcp',
    status,
    error_code: payload.error_code || null,
    error_message: payload.error_message ? String(payload.error_message).slice(0, 1000) : null,
    request_ip: payload.request_ip || null,
    user_agent: payload.user_agent || null,
    request_id: payload.request_id || null,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString()
  };
  const { error } = await supabase.from(TABLE).insert(row);
  if (error) {
    console.error('[audit] logAuditError failed:', error.message);
  }
}
