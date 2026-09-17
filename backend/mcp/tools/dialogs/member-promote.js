// bullgram_userbot_member_promote — назначить/разжать админа в группе/канале юзербота.
// Волна 1 userbot-ops (план 2026-09-17). Юзербот обязан сам иметь право
// назначать админов (MTProto-флаг addAdmins), иначе FORBIDDEN.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

const RIGHTS_VALUES = ['all', 'post_only', 'revoke'];

export async function memberPromoteHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'member_promote requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  if (!args?.chat_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
  }
  const member = String(args?.member ?? '').trim();
  if (!member) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "member" is required.', {});
  }
  const rights = args?.rights == null ? 'all' : String(args.rights);
  if (!RIGHTS_VALUES.includes(rights)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "rights" must be one of: all, post_only, revoke.', {});
  }

  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);
  return userbotService.promoteGroupMember(userbot, { chatId: args.chat_id, member, rights });
}

registerOperation('bullgram_userbot_member_promote', {
  handler: memberPromoteHandler,
  requiredScopes: ['mcp:userbot:write', 'api:userbot:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Promote/demote admin',
  description:
    'Назначает участника админом группы/канала или снимает права. ' +
    'rights: all — полный админ (управление, посты, удаления, баны, приглашения, закрепы, назначение админов), post_only — только публиковать посты (для каналов), revoke — разжать (снять все права). ' +
    'Мини-инструкция: участник должен состоять в чате (сначала bullgram_userbot_member_invite); юзербот сам должен иметь право назначать админов — иначе получишь FORBIDDEN и нужно сначала выдать ему админку вручную в Telegram. ' +
    'Операция выключена без флага USERBOT_GROUP_ADMIN_ENABLED в backend/.env.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'chat_id', 'member'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      chat_id: { type: 'string', description: 'Telegram chat ID группы/канала.' },
      member: { type: 'string', description: '@username или числовой Telegram ID участника.' },
      rights: {
        type: 'string',
        enum: ['all', 'post_only', 'revoke'],
        default: 'all',
        description: 'Набор прав: all / post_only / revoke (разжать).'
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/userbots/{userbot_id}/groups/{chat_id}/promote', tags: ['userbots'], summary: 'Promote/demote group admin' }
  }
});
