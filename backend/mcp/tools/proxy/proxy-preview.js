// bullrun_proxy_preview — parse raw proxy paste text and return preview.
// Plan 01 Phase 3: moved from agent-mcp.routes.js inline handler.

import { parseProxyPasteInput } from '../../../utils/agent-tools.js';
import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';

export async function proxyPreviewHandler({ args }) {
  const raw = String(args?.raw || '').trim();
  if (!raw) {
    throw new MCPError(
      ERROR_CODES.INVALID_PARAMS,
      'Argument "raw" is required (string with proxy text).',
      { auditStatus: 'error' }
    );
  }
  const parsed = parseProxyPasteInput(raw);
  return {
    success: true,
    parsed,
    message: 'Proxy parsed. Show preview and ask user for confirmation before importing.'
  };
}

registerOperation('bullrun_proxy_preview', {
  handler: proxyPreviewHandler,
  requiredScopes: ['mcp:proxy:write', 'api:proxy:write'],
  requiresIntegrationToken: false,
  rateLimitClass: 'read',
  title: 'Bullgram proxy preview',
  description: 'Parses raw proxy paste text and returns a structured preview before saving.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['raw'],
    properties: {
      raw: {
        type: 'string',
        description: 'Raw proxy text, including dirty vendor formats.'
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/proxies/preview', tags: ['proxies'], summary: 'Preview raw proxy paste' }
  }
});
