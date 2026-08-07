// bullgram_userbot_leave_chat — leave a channel/group.
// Used to clean up after evaluating a candidate source.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function leaveChatHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'leave_chat requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  if (!args?.chat_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
  }
  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);
  return userbotService.leaveChat(userbot, { chatId: args.chat_id });
}

registerOperation('bullgram_userbot_leave_chat', {
  handler: leaveChatHandler,
  requiredScopes: ['mcp:userbot:write', 'api:userbot:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Leave channel/group',
  description: 'Have a userbot leave a channel or group by chat_id. Use after evaluating a candidate source that turned out to be low quality.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'chat_id'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      chat_id: { type: 'string' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/userbots/{userbot_id}/leave', tags: ['userbots'], summary: 'Leave channel/group' }
  }
});
