// bullgram_autopost_list_bots — list autopost bots owned by the token owner.
//
// Дополняет bullgram_autopost_post_create: чтобы publish-запрос был осмысленным,
// внешний интегратор (n8n) должен сначала узнать bot_id одного из своих ботов.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';

export async function listAutopostBotsHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'list_autopost_bots requires authenticated user', {});
  }

  const limit = clampInt(args?.limit, 1, 200, 50);
  const includeInactive = Boolean(args?.include_inactive);

  let query = supabase
    .from('autopost_bots')
    .select('id, username, is_active, posts_per_day, posting_times, created_at')
    .eq('owner_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) throw error;

  const items = (data || []).map((b) => ({
    id: b.id,
    username: b.username || null,
    is_active: Boolean(b.is_active),
    posts_per_day: b.posts_per_day ?? null,
    posting_times: Array.isArray(b.posting_times) ? b.posting_times : [],
    created_at: b.created_at || null
  }));

  return { bots: items, count: items.length };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

registerOperation('bullgram_autopost_list_bots', {
  handler: listAutopostBotsHandler,
  requiredScopes: ['mcp:autopost:read', 'api:autopost:read'],
  requiresIntegrationToken: true,
  rateLimitClass: 'read',
  title: 'List autopost bots',
  description: 'Lists autoposter bots owned by the token owner. Use this to find bot_id for Create autopost / List channels calls. Inactive bots are excluded by default.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      include_inactive: { type: 'boolean', default: false }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'GET', path: '/autopost/bots', tags: ['autopost'], summary: 'List autopost bots' }
  }
});
