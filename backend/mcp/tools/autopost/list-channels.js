// bullgram_autopost_list_channels — list channels connected to an autopost bot.
//
// Дополняет bullgram_autopost_post_create: чтобы publish-запрос дошёл, нужно
// знать target_channel_id (Telegram chat id канала, подключённого к боту).

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';

export async function listAutopostChannelsHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'list_autopost_channels requires authenticated user', {});
  }

  const { bot_id } = args || {};
  if (!isValidUuid(bot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_id" must be a UUID.', {});
  }

  const { data: bot, error: botErr } = await supabase
    .from('autopost_bots')
    .select('id, owner_id, username')
    .eq('id', bot_id)
    .maybeSingle();
  if (botErr) throw botErr;
  if (!bot || bot.owner_id !== req.user.id) {
    throw new MCPError(ERROR_CODES.NOT_FOUND, 'Bot not found or not owned by current token owner.', {});
  }

  const { data: channels, error: chErr } = await supabase
    .from('channels')
    .select('id, tg_chat_id, title, visibility, suggest_button_enabled, auto_accept_suggestions, max_suggestions_per_day, seed_reaction_emoji, buttons_config')
    .eq('autopost_bot_id', bot_id)
    .order('created_at', { ascending: false });
  if (chErr) throw chErr;

  const items = (channels || []).map((c) => ({
    id: c.id,
    target_channel_id: String(c.tg_chat_id),
    title: c.title || null,
    visibility: c.visibility || null,
    suggest_button_enabled: Boolean(c.suggest_button_enabled),
    auto_accept_suggestions: Boolean(c.auto_accept_suggestions),
    max_suggestions_per_day: c.max_suggestions_per_day ?? null,
    seed_reaction_emoji: c.seed_reaction_emoji || null,
    buttons: Array.isArray(c.buttons_config) ? c.buttons_config : []
  }));

  return {
    bot_id: bot.id,
    bot_username: bot.username || null,
    channels: items,
    count: items.length
  };
}

registerOperation('bullgram_autopost_list_channels', {
  handler: listAutopostChannelsHandler,
  requiredScopes: ['mcp:autopost:read', 'api:autopost:read'],
  requiresIntegrationToken: true,
  rateLimitClass: 'read',
  title: 'List autopost bot channels',
  description: 'Lists channels connected to an autopost bot. Returns target_channel_id (Telegram chat id) needed for Create autopost, plus current buttons/reaction config so external integrations can preview what will be attached to a post.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['bot_id'],
    properties: {
      bot_id: {
        type: 'string',
        format: 'uuid',
        description: 'Autopost bot ID (UUID from GET /autopost/bots)'
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'GET', path: '/autopost/bots/{bot_id}/channels', tags: ['autopost'], summary: 'List channels of an autopost bot' }
  }
});
