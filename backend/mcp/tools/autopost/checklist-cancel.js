// bullgram_autopost_checklist_cancel — закрыть чек-лист.
//
// Клавиатуры снимаются (тапи больше не считаются), queued/scheduled-строки
// очереди удаляются, опубликованные сообщения остаются в чатах. Событие
// cancelled попадает в ленту. Список закрыт навсегда — нужен новый, создавай
// через checklist_create (для цикличных списков сначала подумай про reset).

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { AutopostService } from '../../../services/autopost.service.js';

export async function cancelChecklistHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'checklist_cancel requires authenticated user', {});
  }

  const { bot_id, checklist_id } = args || {};

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
    state = await service.cancelChecklist(bot_id, checklist_id, { source: 'agent' });
  } catch (err) {
    if (err?.message === 'NOT_FOUND') {
      throw new MCPError(ERROR_CODES.NOT_FOUND, 'Чек-лист удалён или не существует.', {});
    }
    throw err;
  }

  return { checklist: state.checklist };
}

registerOperation('bullgram_autopost_checklist_cancel', {
  handler: cancelChecklistHandler,
  requiredScopes: ['mcp:autopost:write', 'api:autopost:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Cancel autopost checklist',
  description:
    'Закрывает чек-лист: клавиатуры снимаются во всех опубликованных копиях (тапи больше не считаются), несобранные строки очереди (queued/scheduled) удаляются, опубликованные сообщения остаются. Статус станет cancelled — это видно в checklist_state и checklist_list. ' +
    'Зови, когда список отработал или устарел. Закрытый список не открывается повторно — для нового цикла используй checklist_update с reset=true (цикличные списки) или создавай новый через checklist_create (с тем же dedup_key, если он был — сначала выбери новый ключ).',
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
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/autopost/bots/{bot_id}/checklists/{checklist_id}/cancel', tags: ['autopost'], summary: 'Cancel autopost checklist (remove keyboards + queue rows)' }
  }
});
