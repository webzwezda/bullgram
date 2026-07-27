// bullrun_infra_summary — summary of owner's proxies, userbots, and tier limits.
// Plan 01 Phase 3: moved from agent-mcp.routes.js inline handler.

import { buildAgentInfraPayload } from '../../../utils/agent-tools.js';
import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';

export async function infraSummaryHandler({ supabase, req }) {
  if (!req?.user?.id || !req?.profile) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'infra_summary requires authenticated user', {});
  }
  return buildAgentInfraPayload({
    supabase,
    user: req.user,
    profile: req.profile
  });
}

registerOperation('bullrun_infra_summary', {
  handler: infraSummaryHandler,
  requiredScopes: ['mcp:proxy:read', 'api:proxy:read'],
  requiresIntegrationToken: false,
  rateLimitClass: 'read',
  title: 'Bullgram infra summary',
  description: 'Returns summary of proxies, userbots, and tier limits for the current Bullgram account.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {}
  },
  transports: {
    mcp: true,
    rest: { method: 'GET', path: '/infra/summary', tags: ['infra'], summary: 'Infra summary' }
  }
});
