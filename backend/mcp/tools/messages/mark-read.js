// bullgram_userbot_chat_read — отметить чат прочитанным у юзербота.
// Волна 2 userbot-ops (план 2026-09-17). Косметика: гасит «непрочитанно»,
// чтобы inbox/центр юзерботов не копил фальшивые счётчики.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function markReadHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'chat_read requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  if (!args?.chat_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
  }
  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);

  return userbotService.markChatRead(userbot, { chatId: args.chat_id });
}

registerOperation('bullgram_userbot_chat_read', {
  handler: markReadHandler,
  requiredScopes: ['mcp:userbot:write', 'api:userbot:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Mark chat as read',
  description:
    'Отмечает чат прочитанным у юзербота (гасит счётчик непрочитанных в самом Telegram). ' +
    'Мини-инструкция: вызывай после того, как агент прочитал и обработал сообщения через fetch-messages, чтобы диалог не висел «непрочитанным». ' +
    'Юзербот должен видеть чат (состоять в нём или иметь с ним диалог).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'chat_id'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      chat_id: { type: 'string', description: 'ID чата для отметки прочитанным.' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/userbots/{userbot_id}/chats/{chat_id}/read', tags: ['userbots'], summary: 'Mark chat as read' }
  }
});
