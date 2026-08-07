// bullgram_userbot_join_chat — join a channel/group by invite link.
// Reuses the userbot's existing authorized session (no separate login).

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function joinChatHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'join_chat requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  if (!args?.invite_link) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "invite_link" is required.', {});
  }

  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);
  return userbotService.joinChatByInvite(userbot, { inviteLink: args.invite_link });
}

registerOperation('bullgram_userbot_join_chat', {
  handler: joinChatHandler,
  requiredScopes: ['mcp:userbot:write', 'api:userbot:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Join channel/group',
  description: 'Have a userbot join a public channel/group by username or a private one by invite hash (t.me/+hash, t.me/joinchat/hash, t.me/username, @username). Returns the new chat_id.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'invite_link'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      invite_link: { type: 'string', maxLength: 500 }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/userbots/{userbot_id}/join', tags: ['userbots'], summary: 'Join channel/group by invite link' }
  }
});
