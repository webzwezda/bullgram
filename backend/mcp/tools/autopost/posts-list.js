// bullgram_autopost_posts_list — список постов (строк autopost_items) бота, свежие сверху.
//
// Механика — зеркало checklist_list: курсор created_at|id (парсер читает только
// created_at-половину), фильтр статуса применяется в коде после fetch — статус
// очереди меняется джобами, ловить его в SQL нет смысла на этом масштабе.
//
// Главная ценность для агента — agent_note: приватная заметка из post_create,
// не рендерится в Telegram. После сброса сессии агент восстанавливает контекст
// своих постов («этот пост о привычках, привычки в вики/папка X») отсюда.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';

const STATUSES = ['posted', 'queued', 'scheduled', 'sending', 'editing', 'failed'];

export async function postsListHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'posts_list requires authenticated user', {});
  }

  const { bot_id, status, limit = 20, cursor } = args || {};

  if (!isValidUuid(bot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_id" must be a UUID.', {});
  }
  if (status != null && !STATUSES.includes(status)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, `Argument "status" must be one of: ${STATUSES.join(', ')}.`, {});
  }

  // --- Load bot, verify ownership ---
  const { data: bot, error: botErr } = await supabase
    .from('autopost_bots')
    .select('id, owner_id')
    .eq('id', bot_id)
    .maybeSingle();
  if (botErr) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'DB error loading bot', { cause: botErr.message });
  }
  if (!bot || bot.owner_id !== req.user.id) {
    throw new MCPError(ERROR_CODES.NOT_FOUND, 'Bot not found or not owned by current token owner.', {});
  }

  const cappedLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
  let query = supabase
    .from('autopost_items')
    .select('id, post_batch_id, caption, media_type, status, target_channel_id, posted_message_ids, scheduled_at, posted_at, agent_note, error_message, created_at')
    .eq('bot_id', bot_id)
    .order('created_at', { ascending: false });
  if (cursor) {
    // Зеркало listChecklists: парсер берёт только половину до '|' (created_at),
    // id-половина — задел на детерминированный тай-брейк.
    const [createdAtIso] = String(cursor).split('|');
    if (createdAtIso) query = query.lt('created_at', createdAtIso);
  }
  const { data, error } = await query.limit(cappedLimit);
  if (error) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'DB error loading posts', { cause: error.message });
  }

  const rows = data || [];
  const items = rows
    .filter((row) => !status || row.status === status)
    .map((row) => ({
      id: row.id,
      post_batch_id: row.post_batch_id ?? null,
      caption: row.caption || '',
      media_type: row.media_type || null,
      status: row.status,
      target_channel_id: String(row.target_channel_id),
      posted_message_ids: Array.isArray(row.posted_message_ids) ? row.posted_message_ids : [],
      scheduled_at: row.scheduled_at ?? null,
      posted_at: row.posted_at ?? null,
      agent_note: row.agent_note ?? null,
      error_message: row.error_message ?? null
    }));

  const last = rows[rows.length - 1];
  return {
    items,
    next_cursor: rows.length === cappedLimit && last ? `${last.created_at}|${last.id}` : null
  };
}

registerOperation('bullgram_autopost_posts_list', {
  handler: postsListHandler,
  requiredScopes: ['mcp:autopost:read', 'api:autopost:read'],
  requiresIntegrationToken: true,
  rateLimitClass: 'read',
  title: 'List autopost posts',
  description:
    'Список постов (строк очереди) бота, свежие сверху: id, caption, media_type, статус (posted/queued/scheduled/sending/editing/failed), posted_message_ids, scheduled_at, ошибка публикации. ' +
    'Отдаёт agent_note — приватную заметку агента из post_create (не показывается в Telegram): читай её после сброса сессии, чтобы восстановить контекст своих постов. ' +
    'Фильтр status и курсор (next_cursor → cursor) — для растущей истории; limit 1–100.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['bot_id'],
    properties: {
      bot_id: {
        type: 'string',
        format: 'uuid',
        description: 'Autopost bot ID (UUID from GET /autopost/bots)'
      },
      status: {
        type: 'string',
        enum: STATUSES,
        description: 'Optional filter by queue status. Omit to get all.'
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: 20
      },
      cursor: {
        type: 'string',
        description: 'Opaque cursor from the previous response (next_cursor). Pass as-is for the next page.'
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'GET', path: '/autopost/bots/{bot_id}/posts', tags: ['autopost'], summary: 'List autopost posts (filter by status, cursor pagination)' }
  }
});
