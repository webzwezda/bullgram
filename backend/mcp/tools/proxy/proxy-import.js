// bullgram_proxy_import — save a proxy to Bullgram after preview + user confirmation.
// Plan 01 Phase 3: moved from agent-mcp.routes.js inline handler.

import {
  normalizeAdminInventoryGroup,
  parseProxyPasteInput,
  supportsProxyInventoryGroup,
  supportsProxyProvisionSource
} from '../../../utils/agent-tools.js';
import { enforceOwnedProxyQuota } from '../../../utils/product-tier.js';
import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';

export async function proxyImportHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'proxy_import requires authenticated user', {});
  }
  if (args?.confirmed !== true) {
    throw new MCPError(
      ERROR_CODES.INVALID_PARAMS,
      'Proxy import requires explicit confirmed=true after preview and user confirmation.',
      { auditStatus: 'error' }
    );
  }

  const isAdmin = req.profile?.role === 'admin';
  const parsed = parseProxyPasteInput(args?.raw || '');
  const nameValue = String(args?.name || '').trim() || `${parsed.host}:${parsed.port}`;
  const inventoryGroup = normalizeAdminInventoryGroup(args?.inventory_group);

  if (!isAdmin) {
    await enforceOwnedProxyQuota({
      supabase,
      ownerId: req.user.id,
      profile: req.profile
    });
  }

  const sourceSupported = await supportsProxyProvisionSource(supabase);
  const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);

  const proxyData = {
    owner_id: req.user.id,
    name: nameValue,
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    password: parsed.password,
    is_working: null,
    last_checked_at: null,
    last_check_ip: null,
    last_check_country: null,
    last_check_city: null,
    last_check_isp: null,
    last_check_error: null
  };

  if (sourceSupported) {
    proxyData.provision_source = isAdmin ? 'manual_admin' : 'manual_owned';
  }
  if (inventoryGroupSupported && isAdmin) {
    proxyData.inventory_group = inventoryGroup;
  }

  const { data: inserted, error } = await supabase
    .from('proxies')
    .insert([proxyData])
    .select('id, name, host, port')
    .single();

  if (error) throw error;

  return {
    success: true,
    proxy: inserted,
    parsed,
    message: 'Proxy saved from pasted text.'
  };
}

registerOperation('bullgram_proxy_import', {
  handler: proxyImportHandler,
  requiredScopes: ['mcp:proxy:write', 'api:proxy:write'],
  requiresIntegrationToken: false,
  rateLimitClass: 'write',
  title: 'Bullgram proxy import',
  description: 'Saves a proxy to Bullgram after explicit confirmation in a previous preview turn.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['raw', 'confirmed'],
    properties: {
      raw: {
        type: 'string',
        description: 'Raw proxy text (same format as in bullgram_proxy_preview).'
      },
      confirmed: {
        type: 'boolean',
        description: 'Explicit user confirmation after preview. Must be true to import.'
      },
      name: {
        type: 'string',
        description: 'Optional proxy name. Defaults to host:port.'
      },
      inventory_group: {
        type: 'string',
        enum: ['self_use', 'shop_sale'],
        description: 'Admin only: where to put the proxy.'
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/proxies/import', tags: ['proxies'], summary: 'Save proxy after preview' }
  }
});
