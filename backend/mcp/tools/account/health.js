// bullgram_userbot_health — runtime + SpamBot snapshot for one userbot.
// Plan 01 Phase 5.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';

export async function userbotHealthHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'health requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);
  return userbotService.getHealthSnapshot(userbot);
}

export async function loadOwnedUserbot(supabase, ownerId, userbotId) {
  const { data, error } = await supabase
    .from('tg_accounts')
    .select('*')
    .eq('id', userbotId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new MCPError(ERROR_CODES.NOT_FOUND, `Userbot ${userbotId} not found.`, {});
  }
  return data;
}

registerOperation('bullgram_userbot_health', {
  handler: userbotHealthHandler,
  requiredScopes: ['mcp:userbot:read', 'api:userbot:read'],
  requiresIntegrationToken: true,
  rateLimitClass: 'read',
  title: 'Userbot health snapshot',
  description: 'Reads userbot runtime status, recent Telegram error events, and cached SpamBot signal. Does not connect to Telegram.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'GET', path: '/userbots/{userbot_id}/health', tags: ['userbots'], summary: 'Userbot health snapshot' }
  }
});
