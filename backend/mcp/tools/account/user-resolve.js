// bullgram_userbot_user_resolve — резолв пользователя Telegram по @username или tg_user_id.
// Волна 2 userbot-ops (план 2026-09-17). Живой lookup в Telegram (не кеш) —
// фундамент access_hash для member_invite/member_promote. Скоупы any-of:
// проходит и read-, и write-токеном (это чтение, но ходит в Telegram).

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from './health.js';

export async function userResolveHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'user_resolve requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  const username = String(args?.username ?? '').trim();
  const tgUserId = String(args?.tg_user_id ?? '').trim();
  if (Boolean(username) === Boolean(tgUserId)) {
    throw new MCPError(
      ERROR_CODES.INVALID_PARAMS,
      'Pass exactly one of "username" or "tg_user_id".',
      {}
    );
  }
  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);

  return userbotService.resolveTelegramUser(userbot, {
    username: username || undefined,
    tgUserId: tgUserId || undefined
  });
}

registerOperation('bullgram_userbot_user_resolve', {
  handler: userResolveHandler,
  requiredScopes: ['mcp:userbot:read', 'api:userbot:read', 'mcp:userbot:write', 'api:userbot:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'read',
  title: 'Resolve Telegram user',
  description:
    'Резолвит пользователя Telegram по @username (@ можно опустить) или по tg_user_id — ровно один из аргументов. ' +
    'Возвращает id, username, имя/фамилию, verified и access_hash (нужен для приглашений и назначения админов). ' +
    'Это живой запрос в Telegram от юзербота: если юзербот не знает пользователя, Telegram может не отдать профиль.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      username: { type: 'string', description: '@username пользователя (собака optional).' },
      tg_user_id: { type: 'string', description: 'Числовой Telegram ID пользователя.' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/userbots/{userbot_id}/resolve', tags: ['userbots'], summary: 'Resolve a Telegram user (live lookup)' }
  }
});
