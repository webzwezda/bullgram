// bullgram_autopost_checklist_state — текущее состояние чек-листа.
//
// Пункты с отметками (кто и когда отметил), человекочитаемый summary
// («Итог: 2 из 3 — картошка ✅ (Вася, 10:12)…») и вычисляемый статус
// (active/expired/cancelled). Опционально — лента событий для памяти агента.
//
// Исчезнувший checklist_id — штатный NOT_FOUND, а не авария: агент кэширует id
// в своей памяти и должен спокойно переживать удалённый/закрытый список.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { AutopostService } from '../../../services/autopost.service.js';
import { renderChecklistSummary } from '../../../services/autopost/checklist.js';

export async function checklistStateHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'checklist_state requires authenticated user', {});
  }

  const { bot_id, checklist_id, include_events = false, events_limit = 20 } = args || {};

  if (!isValidUuid(bot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_id" must be a UUID.', {});
  }
  if (!isValidUuid(checklist_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "checklist_id" must be a UUID.', {});
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

  let state;
  try {
    state = await service.getChecklistState(bot_id, checklist_id, {
      includeEvents: include_events === true,
      eventsLimit: Number(events_limit) || 20
    });
  } catch (err) {
    // Чужой/удалённый checklist_id под своим ботом — штатный NOT_FOUND (не IDOR, не 500).
    if (err?.message === 'NOT_FOUND') {
      throw new MCPError(ERROR_CODES.NOT_FOUND, 'Чек-лист удалён или не существует.', {});
    }
    throw err;
  }

  const response = {
    checklist: state.checklist,
    items: state.items,
    summary: renderChecklistSummary(state.checklist, state.items)
  };
  if (state.events) {
    response.events = state.events;
  }
  return response;
}

registerOperation('bullgram_autopost_checklist_state', {
  handler: checklistStateHandler,
  requiredScopes: ['mcp:autopost:read', 'api:autopost:read'],
  requiresIntegrationToken: true,
  rateLimitClass: 'read',
  title: 'Checklist state',
  description:
    'Текущее состояние чек-листа: пункты с отметками (кто и когда отметил), summary («Итог: 2 из 3 — картошка ✅ (Вася, 10:12)…») и вычисляемый статус active/expired/cancelled — закрытый или истёкший список не ошибка, а поле в ответе. ' +
    'Зови утром после ночной публикации или когда нужен прогресс: checklist_create вечером с scheduled_at → checklist_state утром. ' +
    'include_events=true добавит ленту событий (checked/unchecked/added/renamed/removed/reset/cancelled/published) — корми ею свою память, чтобы следующая сводка учитывала реальность. ' +
    'Исчезнувший id — штатный NOT_FOUND: просто создай список заново.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['bot_id', 'checklist_id'],
    properties: {
      bot_id: {
        type: 'string',
        format: 'uuid',
        description: 'Autopost bot ID (UUID from GET /autopost/bots)'
      },
      checklist_id: {
        type: 'string',
        format: 'uuid',
        description: 'Checklist ID from checklist_create response (checklist.id).'
      },
      include_events: {
        type: 'boolean',
        default: false,
        description: 'true = append events[] — история действий по списку (для памяти агента).'
      },
      events_limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: 20,
        description: 'How many recent events to return when include_events=true.'
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'GET', path: '/autopost/bots/{bot_id}/checklists/{checklist_id}', tags: ['autopost'], summary: 'Autopost checklist state (items, attribution, summary)' }
  }
});
