// bullrun_userbot_message_send — send a text message.
// Plan 01 Phase 5.
//
// For DMs (chat_id > 0): respects USERBOT_DM_ENABLED flag.
// Per CLAUDE.md: warn that Telegram may refuse DMs to users without a prior dialog.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function sendMessageHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'send_message requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  if (!args?.chat_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
  }
  const text = String(args?.text || '');
  if (!text) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "text" is required.', {});
  }
  if (text.length > 4096) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "text" must be ≤ 4096 characters (Telegram limit).', {});
  }
  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);

  return userbotService.sendTextMessage(userbot, {
    chatId: args.chat_id,
    text,
    replyToMessageId: args?.reply_to_message_id
  });
}

registerOperation('bullrun_userbot_message_send', {
  handler: sendMessageHandler,
  requiredScopes: ['mcp:userbot:write', 'api:userbot:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Send message',
  description: 'Send a text message to a chat. For DMs (positive chat_id), requires USERBOT_DM_ENABLED=true. Telegram is more likely to deliver when the userbot already has a dialog with the target or shares a group.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'chat_id', 'text'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      chat_id: { type: 'string' },
      text: { type: 'string', minLength: 1, maxLength: 4096 },
      reply_to_message_id: { type: 'string' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/userbots/{userbot_id}/messages', tags: ['userbots'], summary: 'Send message' }
  }
});
