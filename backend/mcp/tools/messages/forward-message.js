// bullgram_userbot_message_forward — переслать сообщения в другой чат.
// Волна 2 userbot-ops (план 2026-09-17).

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function forwardMessageHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'forward_message requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  if (!args?.chat_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
  }
  if (!args?.to_chat_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "to_chat_id" is required.', {});
  }
  const ids = Array.isArray(args?.message_ids) ? args.message_ids : [];
  if (ids.length === 0 || ids.length > 100) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "message_ids" must be an array of 1-100 message IDs.', {});
  }
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "message_ids" must contain positive integers only.', {});
  }
  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);

  return userbotService.forwardSentMessages(userbot, {
    fromChatId: args.chat_id,
    messageIds: ids,
    toChatId: args.to_chat_id
  });
}

registerOperation('bullgram_userbot_message_forward', {
  handler: forwardMessageHandler,
  requiredScopes: ['mcp:userbot:write', 'api:userbot:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Forward messages',
  description:
    'Пересылает сообщения из одного чата юзербота в другой (chat_id — откуда, to_chat_id — куда). Юзербот должен видеть оба чата. ' +
    'Мини-инструкция: возьми message_ids из fetch-messages → укажи чат-получатель; за один вызов до 100 сообщений. ' +
    'Если Telegram отвечает CHANNEL_PRIVATE — юзербот не состоит в чате-получателе.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'chat_id', 'message_ids', 'to_chat_id'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      chat_id: { type: 'string', description: 'ID чата-источника.' },
      message_ids: {
        type: 'array',
        items: { type: 'integer', minimum: 1 },
        minItems: 1,
        maxItems: 100,
        description: 'ID сообщений для пересылки (1-100 за вызов).'
      },
      to_chat_id: { type: 'string', description: 'ID чата-получателя.' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/userbots/{userbot_id}/messages/{chat_id}/forward', tags: ['userbots'], summary: 'Forward messages to another chat' }
  }
});
