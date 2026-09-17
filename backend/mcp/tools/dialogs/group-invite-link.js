// bullgram_userbot_group_invite_link — выпустить свежую или отозвать invite-ссылку.
// Волна 1 userbot-ops (план 2026-09-17). Без link — новая ссылка (ExportChatInvite);
// link+revoke — отзыв конкретной ссылки; revoke=true без link — отзыв текущей
// основной ссылки (GetFullChannel → fullChat.exportedInvite.link).

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function groupInviteLinkHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'group_invite_link requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  if (!args?.chat_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
  }
  const link = args?.link == null ? null : String(args.link).trim();
  const revoke = args?.revoke === true;

  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);
  return userbotService.exportGroupInviteLink(userbot, { chatId: args.chat_id, link, revoke });
}

registerOperation('bullgram_userbot_group_invite_link', {
  handler: groupInviteLinkHandler,
  requiredScopes: ['mcp:userbot:write', 'api:userbot:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Export/revoke invite link',
  description:
    'Выпускает свежую invite-ссылку группы/канала или отзывает ссылку. ' +
    'Без link и revoke — новая ссылка (invite_link в ответе). С link+revoke=true — отзыв той конкретной ссылки (revoked: true). ' +
    'revoke=true без link — отзывает текущую основную ссылку (Telegram сам подскажет её из fullChat); если активной ссылки нет — ошибка. ' +
    'Мини-инструкция: ссылка после group_create уже выпущена — эта операция нужна, чтобы перевыпустить утёкшую или закрыть старую. ' +
    'Операция выключена без флага USERBOT_GROUP_ADMIN_ENABLED в backend/.env.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'chat_id'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      chat_id: { type: 'string', description: 'Telegram chat ID группы/канала.' },
      link: { type: 'string', description: 'Конкретная invite-ссылка (обязательна для revoke).' },
      revoke: { type: 'boolean', default: false, description: 'true — отозвать ссылку: из аргумента link, а без link — текущую основную ссылку группы.' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/userbots/{userbot_id}/groups/{chat_id}/invite-link', tags: ['userbots'], summary: 'Export or revoke invite link' }
  }
});
