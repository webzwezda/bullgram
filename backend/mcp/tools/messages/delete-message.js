// bullgram_userbot_message_delete — удалить сообщения безвозвратно (revoke).
// Волна 2 userbot-ops (план 2026-09-17). Необратимо — требуется явный confirm: true.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function deleteMessageHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'delete_message requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  if (!args?.chat_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
  }
  if (args?.confirm !== true) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Удаление необратимо — передай confirm: true', {});
  }
  const ids = Array.isArray(args?.message_ids) ? args.message_ids : [];
  if (ids.length === 0 || ids.length > 100) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "message_ids" must be an array of 1-100 message IDs.', {});
  }
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "message_ids" must contain positive integers only.', {});
  }
  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);

  return userbotService.deleteSentMessages(userbot, {
    chatId: args.chat_id,
    messageIds: ids
  });
}

registerOperation('bullgram_userbot_message_delete', {
  handler: deleteMessageHandler,
  requiredScopes: ['mcp:userbot:write', 'api:userbot:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Delete messages',
  description:
    'Удаляет сообщения в чате безвозвратно (revoke — у всех участников). Операция необратима: требует явный confirm: true, без него вернётся ошибка. ' +
    'Мини-инструкция: удаляй только то, что отправил юзербот (чужие сообщения в каналах удалятся только при админ-правах, в ЛС — только свои). ' +
    'За один вызов — до 100 message_ids.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'chat_id', 'message_ids', 'confirm'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      chat_id: { type: 'string', description: 'ID чата, из которого удаляем.' },
      message_ids: {
        type: 'array',
        items: { type: 'integer', minimum: 1 },
        minItems: 1,
        maxItems: 100,
        description: 'ID сообщений (1-100 за вызов).'
      },
      confirm: { type: 'boolean', description: 'Обязателен true — подтверждение необратимого удаления.' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/userbots/{userbot_id}/messages/{chat_id}/delete', tags: ['userbots'], summary: 'Delete messages (irreversible, needs confirm)' }
  }
});
