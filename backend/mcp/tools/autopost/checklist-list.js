// bullgram_autopost_checklist_list — список чек-листов бота, свежие сверху.
//
// Статус вычисляемый (active/expired/cancelled) — фильтр по нему применяется
// на сервере. Курсор (created_at|id) — для растущей истории ежедневных списков.
//
// Используй, чтобы найти активные списки после потери памяти или выбрать
// просроченные для закрытия через checklist_cancel.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { AutopostService } from '../../../services/autopost.service.js';

export async function checklistListHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'checklist_list requires authenticated user', {});
  }

  const { bot_id, status, created_after, limit = 20, cursor } = args || {};

  if (!isValidUuid(bot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_id" must be a UUID.', {});
  }
  if (status != null && !['active', 'expired', 'cancelled'].includes(status)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "status" must be one of: active, expired, cancelled.', {});
  }
  if (created_after != null && Number.isNaN(new Date(created_after).getTime())) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'created_after must be ISO 8601 date', {});
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

  const service = new AutopostService(supabase);

  const { items, nextCursor } = await service.listChecklists(bot_id, {
    status: status || undefined,
    createdAfter: created_after || undefined,
    limit: Number(limit) || 20,
    cursor: cursor || undefined
  });

  return {
    items,
    next_cursor: nextCursor
  };
}

registerOperation('bullgram_autopost_checklist_list', {
  handler: checklistListHandler,
  requiredScopes: ['mcp:autopost:read', 'api:autopost:read'],
  requiresIntegrationToken: true,
  rateLimitClass: 'read',
  title: 'List autopost checklists',
  description:
    'Список чек-листов бота, свежие сверху: id, заголовок, вычисляемый статус (active/expired/cancelled), dedup_key, время создания, agent_note — твоя приватная заметка (в Telegram не показывается). ' +
    'Фильтр status — чтобы взять только живые (active) или просроченные (expired); created_after — «списки, созданные после»; next_cursor — пагинация для растущей истории. ' +
    'Точку входа после потери памяти ищи так: checklist_list со status=active → checklist_state по найденным id (там и agent_note, и отметки). Просроченные можно закрыть checklist_cancel.',
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
        enum: ['active', 'expired', 'cancelled'],
        description: 'Optional filter by computed status. Omit to get all.'
      },
      created_after: {
        type: 'string',
        format: 'date-time',
        description: 'ISO 8601. Only checklists created after this moment.'
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
    rest: { method: 'GET', path: '/autopost/bots/{bot_id}/checklists', tags: ['autopost'], summary: 'List autopost checklists (filter by status, cursor pagination)' }
  }
});
