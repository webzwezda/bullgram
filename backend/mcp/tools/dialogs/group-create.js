// bullgram_userbot_group_create — создать группу или канал, где юзербот — владелец.
// Волна 1 userbot-ops (план 2026-09-17). Сразу возвращает invite-ссылку,
// чтобы дальше можно было звать участников через member_invite.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function groupCreateHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'group_create requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  const title = String(args?.title ?? '').trim();
  if (!title || title.length > 128) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "title" is required (1-128 chars).', {});
  }
  const kind = args?.kind == null ? 'group' : String(args.kind);
  if (!['group', 'channel'].includes(kind)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "kind" must be "group" or "channel".', {});
  }
  const about = args?.about == null ? '' : String(args.about).trim();
  if (about.length > 255) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "about" must be 255 chars or fewer.', {});
  }

  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);
  return userbotService.createGroupChat(userbot, { title, kind, about });
}

registerOperation('bullgram_userbot_group_create', {
  handler: groupCreateHandler,
  requiredScopes: ['mcp:userbot:write', 'api:userbot:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Create group/channel',
  description:
    'Создаёт группу или канал от имени юзербота (юзербот становится владельцем) и сразу выпускает invite-ссылку. ' +
    'Возвращает chat_id, access_hash, title, invite_link. ' +
    'Мини-инструкция: создай группу → пригласи участников через bullgram_userbot_member_invite (по invite-ссылке или напрямую) → при необходимости назначь админа через bullgram_userbot_member_promote. ' +
    'Операция выключена, если на сервере не включён флаг USERBOT_GROUP_ADMIN_ENABLED — тогда сообщи владельцу, что флаг нужно включить в backend/.env.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'title'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      title: { type: 'string', minLength: 1, maxLength: 128, description: 'Название группы или канала (1-128 символов).' },
      kind: {
        type: 'string',
        enum: ['group', 'channel'],
        default: 'group',
        description: 'group — обычная группа с чатом (по умолчанию), channel — канал (пишут только админы).'
      },
      about: { type: 'string', maxLength: 255, description: 'Описание (до 255 символов), необязательно.' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/userbots/{userbot_id}/groups', tags: ['userbots'], summary: 'Create group/channel owned by the userbot' }
  }
});
