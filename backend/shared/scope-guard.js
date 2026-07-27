// Scope and account-allowlist checks shared by all operations.
// Plan 01 Phase 1.

import { MCPError, ERROR_CODES } from './errors.js';

export function assertIntegrationToken(auth) {
  const kind = auth?.kind;
  if (kind !== 'integration_token') {
    throw new MCPError(
      ERROR_CODES.INTEGRATION_TOKEN_REQUIRED,
      'This operation requires an integration token (brmcp_... or brapi_...). Issue one at /app/integrations.',
      { auditStatus: 'integration_token_required' }
    );
  }
}

export function assertToolAllowed(tokenScopes, requiredScopes) {
  const scopes = Array.isArray(tokenScopes) ? tokenScopes : [];
  const required = Array.isArray(requiredScopes) ? requiredScopes : [];
  if (!required.length) return;
  const ok = required.some((scope) => scopes.includes(scope));
  if (!ok) {
    throw new MCPError(
      ERROR_CODES.INSUFFICIENT_SCOPE,
      `Token is missing one of: ${required.join(', ')}. Issue a new token at /app/integrations.`,
      { auditStatus: 'insufficient_scope', details: { required_scopes: required, present_scopes: scopes } }
    );
  }
}

export function assertAccountAllowed(token, userbotId) {
  if (!userbotId) return;
  const metadata = token?.metadata && typeof token.metadata === 'object' ? token.metadata : {};
  const allowed = metadata.allowed_userbot_ids;
  if (allowed === undefined || allowed === null) return; // all allowed
  if (!Array.isArray(allowed) || allowed.length === 0) {
    throw new MCPError(
      ERROR_CODES.FORBIDDEN_ACCOUNT,
      'Token has empty allowed_userbot_ids — no userbots accessible. Update the token allowlist at /app/integrations.',
      { auditStatus: 'forbidden_account', details: { userbot_id: userbotId } }
    );
  }
  if (!allowed.includes(userbotId)) {
    throw new MCPError(
      ERROR_CODES.FORBIDDEN_ACCOUNT,
      `userbot_id ${userbotId} is not in the token's allowed_userbot_ids list.`,
      { auditStatus: 'forbidden_account', details: { userbot_id: userbotId, allowed: allowed.length } }
    );
  }
}
