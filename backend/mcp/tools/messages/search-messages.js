// bullrun_userbot_messages_search — server-side text search within a chat.
// Plan 01 Phase 5.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function searchMessagesHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'search_messages requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  if (!args?.chat_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
  }
  const query = String(args?.query || '').trim();
  if (query.length < 2) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "query" must be at least 2 characters.', {});
  }
  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);

  return userbotService.searchMessages(userbot, {
    chatId: args.chat_id,
    query,
    limit: args?.limit,
    cursor: args?.cursor
  });
}

registerOperation('bullrun_userbot_messages_search', {
  handler: searchMessagesHandler,
  requiredScopes: ['mcp:userbot:read', 'api:userbot:read'],
  requiresIntegrationToken: true,
  rateLimitClass: 'read',
  title: 'Search messages',
  description: 'Server-side text search within a chat. Returns matching messages newest-first.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'chat_id', 'query'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      chat_id: { type: 'string' },
      query: { type: 'string', minLength: 2, maxLength: 200 },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      cursor: { type: 'string' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'GET', path: '/userbots/{userbot_id}/messages/search', tags: ['userbots'], summary: 'Search messages' }
  }
});
