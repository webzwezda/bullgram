// bullgram_userbot_list — list userbots accessible to the caller.
// Plan 01 Phase 5.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { loadReservedUserbotIds } from '../../../utils/shop-reservations.js';

export async function listUserbotsHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'list_userbots requires authenticated user', {});
  }
  const limit = clampInt(args?.limit, 1, 200, 50);
  const includeReserved = Boolean(args?.include_reserved);

  const { data: accounts, error } = await supabase
    .from('tg_accounts')
    .select('id, tg_username, tg_account_id, runtime_status, proxy_id, last_update_at, created_at')
    .eq('owner_id', req.user.id)
    .eq('account_type', 'userbot')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  let reservedIds = new Set();
  if (!includeReserved) {
    reservedIds = await loadReservedUserbotIds(supabase, req.user.id);
  }

  const items = (accounts || [])
    .filter((a) => includeReserved || !reservedIds.has(String(a.id)))
    .map((a) => ({
      id: a.id,
      tg_username: a.tg_username || null,
      tg_account_id: a.tg_account_id ? String(a.tg_account_id) : null,
      runtime_status: a.runtime_status || null,
      proxy_id: a.proxy_id || null,
      last_seen_at: a.last_update_at || null
    }));

  return { userbots: items, count: items.length };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

registerOperation('bullgram_userbot_list', {
  handler: listUserbotsHandler,
  requiredScopes: ['mcp:userbot:read', 'api:userbot:read'],
  requiresIntegrationToken: true,
  rateLimitClass: 'read',
  title: 'List userbots',
  description: 'Lists userbot accounts owned by the token owner. Reserved-for-shop accounts are excluded by default.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      include_reserved: { type: 'boolean', default: false }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'GET', path: '/userbots', tags: ['userbots'], summary: 'List userbots' }
  }
});
