// bullgram_userbot_message_pin — закрепить или открепить сообщение в чате.
// Волна 2 userbot-ops (план 2026-09-17).

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function pinMessageHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'pin_message requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  if (!args?.chat_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
  }
  if (!Number.isInteger(args?.message_id) || args.message_id <= 0) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "message_id" must be a positive integer.', {});
  }
  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);

  return userbotService.pinChatMessage(userbot, {
    chatId: args.chat_id,
    messageId: args.message_id,
    unpin: args?.unpin === true
  });
}

registerOperation('bullgram_userbot_message_pin', {
  handler: pinMessageHandler,
  requiredScopes: ['mcp:userbot:write', 'api:userbot:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Pin / unpin message',
  description:
    'Закрепляет сообщение в чате (unpin=true — открепляет). В группах юзерботу нужны права на пин, иначе Telegram вернёт CHAT_PIN_FORBIDDEN. ' +
    'Мини-инструкция: удобно закреплять пост-инструкцию или актуальный прайс; открепление — тот же вызов с unpin: true.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'chat_id', 'message_id'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      chat_id: { type: 'string', description: 'ID чата.' },
      message_id: { type: 'integer', minimum: 1, description: 'ID сообщения для закрепления/открепления.' },
      unpin: { type: 'boolean', default: false, description: 'true — открепить вместо закрепления.' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/userbots/{userbot_id}/messages/{chat_id}/pin', tags: ['userbots'], summary: 'Pin or unpin a message' }
  }
});
