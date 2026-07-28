// bullgram_userbot_participants — list participants of a chat.
// Plan 01 Phase 5.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function listParticipantsHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'list_participants requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  if (!args?.chat_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
  }
  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);

  return userbotService.listParticipants(userbot, {
    chatId: args.chat_id,
    limit: args?.limit,
    cursor: args?.cursor
  });
}

registerOperation('bullgram_userbot_participants', {
  handler: listParticipantsHandler,
  requiredScopes: ['mcp:userbot:read', 'api:userbot:read'],
  requiresIntegrationToken: true,
  rateLimitClass: 'read',
  title: 'List participants',
  description: 'Lists participants of a chat. Hard-capped at 5000 per chat. Use cursor for pagination.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'chat_id'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      chat_id: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
      cursor: { type: 'string' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'GET', path: '/userbots/{userbot_id}/participants', tags: ['userbots'], summary: 'List chat participants' }
  }
});
