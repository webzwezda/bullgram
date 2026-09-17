// bullgram_userbot_message_edit — отредактировать отправленное юзерботом сообщение.
// Волна 2 userbot-ops (план 2026-09-17). Только свои сообщения: чужие Telegram
// отклоняет с MESSAGE_EDIT_FORBIDDEN — вернётся как telegram_error.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function editMessageHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'edit_message requires authenticated user', {});
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
  const text = String(args?.text ?? '');
  if (!text.trim() || text.length > 4096) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "text" is required (1-4096 chars).', {});
  }
  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);

  return userbotService.editSentMessage(userbot, {
    chatId: args.chat_id,
    messageId: args.message_id,
    text
  });
}

registerOperation('bullgram_userbot_message_edit', {
  handler: editMessageHandler,
  requiredScopes: ['mcp:userbot:write', 'api:userbot:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Edit sent message',
  description:
    'Редактирует текст сообщения, отправленного юзерботом (только свои сообщения — чужие Telegram не даст менять). ' +
    'Мини-инструкция: возьми message_id из bullgram_userbot_message_send или fetch-messages → передай новый text целиком (1-4096 символов, без «диффов»). ' +
    'Если Telegram отвечает MESSAGE_EDIT_FORBIDDEN — сообщение не юзербота.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'chat_id', 'message_id', 'text'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      chat_id: { type: 'string', description: 'ID чата, где лежит сообщение.' },
      message_id: { type: 'integer', minimum: 1, description: 'ID сообщения для правки.' },
      text: { type: 'string', minLength: 1, maxLength: 4096, description: 'Новый текст сообщения (полная замена, 1-4096 символов).' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/userbots/{userbot_id}/messages/{chat_id}/edit', tags: ['userbots'], summary: 'Edit a message sent by the userbot' }
  }
});
