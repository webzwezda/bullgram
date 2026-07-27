// REST API authentication middleware.
// Plan 02 Phase 1.
//
// Accepts integration tokens with the `brapi_` prefix (purpose: 'api' or 'custom').
// Rejects `brmcp_` tokens with a clear error — the MCP token is for POST /api/mcp.
// Rejects user JWTs — REST is integration-only.
//
// On success: req.auth = { kind: 'integration_token', user, integrationToken }
// The dispatcher's scope-guard re-checks the integration-token kind before allowing
// tools that require it, so this middleware is the first line, not the only one.

import crypto from 'crypto';

import { authenticateIntegrationToken } from '../services/integration-tokens.service.js';
import { loadProfileForUser } from '../utils/agent-mcp-auth.js';
import { MCPError, ERROR_CODES } from '../shared/errors.js';

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

async function tryPurpose(supabase, authHeader, purpose, requestIp) {
  try {
    return await authenticateIntegrationToken(supabase, {
      authorizationHeader: authHeader,
      requiredScopes: [],
      purpose,
      requestIp
    });
  } catch (e) {
    // authenticateIntegrationToken throws when requiredScopes don't match — but we
    // pass empty requiredScopes, so the only throw is a DB error. Surface those.
    throw e;
  }
}

export async function authenticateRestToken(supabase, req) {
  const authHeader = req?.headers?.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new MCPError(
      ERROR_CODES.INTEGRATION_TOKEN_REQUIRED,
      'REST API requires a Bearer token. Issue an integration token at /app/integrations with purpose=api.',
      { auditStatus: 'integration_token_required' }
    );
  }
  const token = authHeader.split(' ')[1];
  if (!token) {
    throw new MCPError(
      ERROR_CODES.INTEGRATION_TOKEN_REQUIRED,
      'Bearer token is empty.',
      { auditStatus: 'integration_token_required' }
    );
  }

  // Reject MCP-purpose tokens with a clear message.
  if (token.startsWith('brmcp_')) {
    throw new MCPError(
      ERROR_CODES.INTEGRATION_TOKEN_REQUIRED,
      'This token is for the MCP endpoint (POST /api/mcp). Issue a brapi_ token for REST access at /app/integrations.',
      { auditStatus: 'integration_token_required' }
    );
  }

  if (!token.startsWith('brapi_')) {
    throw new MCPError(
      ERROR_CODES.INTEGRATION_TOKEN_REQUIRED,
      'REST API accepts brapi_ integration tokens only. User JWTs are not accepted.',
      { auditStatus: 'integration_token_required' }
    );
  }

  // Try both api and custom purposes — they share the brapi_ prefix.
  const fromApi = await tryPurpose(supabase, authHeader, 'api', req?.ip || '');
  const integration = fromApi || await tryPurpose(supabase, authHeader, 'custom', req?.ip || '');

  if (!integration?.ownerId) {
    throw new MCPError(
      ERROR_CODES.INTEGRATION_TOKEN_REQUIRED,
      'Token not found or revoked. Issue a new brapi_ token at /app/integrations.',
      { auditStatus: 'integration_token_required' }
    );
  }

  const user = {
    id: integration.ownerId,
    email: null,
    is_integration_token: true
  };
  const profile = await loadProfileForUser(supabase, user);

  return {
    kind: 'integration_token',
    user,
    profile,
    integrationToken: integration.token
  };
}

export function restAuthMiddleware(supabase) {
  return async (req, res, next) => {
    try {
      const auth = await authenticateRestToken(supabase, req);
      req.auth = auth;
      req.user = auth.user;
      req.token = auth.integrationToken;
      // Keep profile on req for downstream consumers that need tier info.
      req.profile = auth.profile;
      next();
    } catch (e) {
      next(e);
    }
  };
}

export { hashToken };
