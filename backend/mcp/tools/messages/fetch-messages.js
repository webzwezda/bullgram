// bullgram_userbot_messages — fetch messages from a chat with optional time window.
// Plan 01 Phase 5.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function fetchMessagesHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'fetch_messages requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  if (!args?.chat_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
  }
  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);

  return userbotService.fetchMessages(userbot, {
    chatId: args.chat_id,
    since: args?.since,
    until: args?.until,
    limit: args?.limit,
    cursor: args?.cursor
  });
}

registerOperation('bullgram_userbot_messages', {
  handler: fetchMessagesHandler,
  requiredScopes: ['mcp:userbot:read', 'api:userbot:read'],
  requiresIntegrationToken: true,
  rateLimitClass: 'read',
  title: 'Fetch messages',
  description: 'Fetch messages from a chat with optional time window. Returns newest-first, cursor-paginated.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'chat_id'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      chat_id: { type: 'string', description: 'Telegram chat ID (channels start with -100).' },
      since: { type: 'string', format: 'date-time' },
      until: { type: 'string', format: 'date-time' },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      cursor: { type: 'string' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'GET', path: '/userbots/{userbot_id}/messages', tags: ['userbots'], summary: 'Fetch messages' }
  }
});
