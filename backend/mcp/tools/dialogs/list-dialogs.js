// bullrun_userbot_dialogs — list dialogs (chats/channels/DMs) for a userbot.
// Plan 01 Phase 5.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from '../account/health.js';

export async function listDialogsHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'list_dialogs requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);

  const type = validateDialogType(args?.type);
  const search = args?.search ? String(args.search).trim().slice(0, 200) : undefined;

  return userbotService.listDialogs(userbot, {
    limit: args?.limit,
    cursor: args?.cursor,
    type,
    search
  });
}

function validateDialogType(value) {
  if (!value) return undefined;
  const allowed = ['channel', 'group', 'megagroup', 'private'];
  const v = String(value).toLowerCase();
  if (!allowed.includes(v)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, `Argument "type" must be one of: ${allowed.join(', ')}.`, {});
  }
  return v;
}

registerOperation('bullrun_userbot_dialogs', {
  handler: listDialogsHandler,
  requiredScopes: ['mcp:userbot:read', 'api:userbot:read'],
  requiresIntegrationToken: true,
  rateLimitClass: 'read',
  title: 'List userbot dialogs',
  description: 'Enumerates chats/channels/DMs the userbot is a member of. Cursor-paginated.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      type: { type: 'string', enum: ['channel', 'group', 'megagroup', 'private'] },
      search: { type: 'string', maxLength: 200 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      cursor: { type: 'string' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'GET', path: '/userbots/{userbot_id}/dialogs', tags: ['userbots'], summary: 'List dialogs' }
  }
});
