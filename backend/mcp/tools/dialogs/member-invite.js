// bullgram_userbot_member_invite — пригласить участников (@username) в группу/канал юзербота.
// Волна 1 userbot-ops (план 2026-09-17). Каждый участник приглашается отдельным
// вызовом channels.InviteToChannel — отказ одному не роняет остальных.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

const MEMBER_RE = /^@?[a-zA-Z0-9_]{4,32}$/;

export async function memberInviteHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'member_invite requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  if (!args?.chat_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
  }
  const members = args?.members;
  if (!Array.isArray(members) || members.length === 0 || members.length > 10) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "members" must be an array of 1-10 @usernames.', {});
  }
  for (const member of members) {
    if (!MEMBER_RE.test(String(member ?? '').trim())) {
      throw new MCPError(
        ERROR_CODES.INVALID_PARAMS,
        `member "${member}" must match @username format (4-32 chars: letters, digits, underscore).`,
        {}
      );
    }
  }

  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);
  return userbotService.inviteGroupMembers(userbot, { chatId: args.chat_id, members });
}

registerOperation('bullgram_userbot_member_invite', {
  handler: memberInviteHandler,
  requiredScopes: ['mcp:userbot:write', 'api:userbot:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Invite members',
  description:
    'Приглашает участников (1-10 @username за вызов) в группу или канал, где юзербот состоит. ' +
    'Возвращает per-member результаты: {member, status: ok|failed, error} — отказ одному (приватность, уже забанен) не мешает остальным. ' +
    'Мини-инструкция: приватный юзер юзербота должен «знать» (@username публичный) — иначе Telegram не даст приглашение; созданным группой через bullgram_userbot_group_create пользуйся сразу после создания. ' +
    'Операция выключена без флага USERBOT_GROUP_ADMIN_ENABLED в backend/.env.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'chat_id', 'members'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      chat_id: { type: 'string', description: 'Telegram chat ID группы/канала (например, из group_create).' },
      members: {
        type: 'array',
        items: { type: 'string', pattern: '^@?[a-zA-Z0-9_]{4,32}$' },
        minItems: 1,
        maxItems: 10,
        description: 'Юзернеймы участников (1-10), с @ или без.'
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/userbots/{userbot_id}/groups/{chat_id}/invite', tags: ['userbots'], summary: 'Invite members to group/channel' }
  }
});
