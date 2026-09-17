// bullgram_autopost_checklist_update — правка живого чек-листа без потери отметок.
//
// add — дописать пункты, rename — переименовать по item_id (отметка остаётся на
// пункте: id — стабильный ключ, текст — нет), remove — удалить по item_id,
// reset — массово снять отметки (для циклических списков). После правки
// клавиатуры во всех опубликованных копиях перерисовываются автоматически.
//
// Отменённый список править нельзя (клавиатуры уже сняты — перерисовка вернула бы их).

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { AutopostService } from '../../../services/autopost.service.js';
import { validateChecklistInput, renderChecklistSummary } from '../../../services/autopost/checklist.js';

export async function updateChecklistHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'checklist_update requires authenticated user', {});
  }

  const { bot_id, checklist_id, add, rename, remove, reset, agent_note } = args || {};

  if (!isValidUuid(bot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_id" must be a UUID.', {});
  }
  if (!isValidUuid(checklist_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "checklist_id" must be a UUID.', {});
  }

  const hasAdd = Array.isArray(add) && add.length > 0;
  const hasRename = Array.isArray(rename) && rename.length > 0;
  const hasRemove = Array.isArray(remove) && remove.length > 0;
  const hasReset = reset === true;
  // Заметка — полноценная правка: agent_note alone должен работать без add/rename.
  // '' = очистить; null/отсутствие = «не трогал» (сервис различает по typeof).
  let agentNoteValue;
  if (agent_note !== undefined && agent_note !== null) {
    if (typeof agent_note !== 'string') {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "agent_note" must be a string (≤ 2000 characters; пустая строка — очистить).', {});
    }
    if (agent_note.length > 2000) {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "agent_note" must be ≤ 2000 characters.', {});
    }
    agentNoteValue = agent_note;
  }
  const hasNote = agentNoteValue !== undefined;
  if (!hasAdd && !hasRename && !hasRemove && !hasReset && !hasNote) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Нужна хотя бы одна правка: add, rename, remove, reset или agent_note.', {});
  }

  if (hasAdd) {
    // Те же капы, что при создании (текст пункта 1–100, максимум 25).
    const verdict = validateChecklistInput({ items: add });
    if (!verdict.ok) {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, verdict.error, {});
    }
  }
  if (hasRename) {
    for (const r of rename) {
      if (!isValidUuid(r?.item_id)) {
        throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Каждый элемент rename должен нести item_id (UUID пункта из checklist_state).', {});
      }
      const text = String(r?.text ?? '').trim();
      if (text.length < 1 || text.length > 100) {
        throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Текст пункта в rename — от 1 до 100 символов.', {});
      }
    }
  }
  if (hasRemove) {
    for (const rawId of remove) {
      if (!isValidUuid(rawId)) {
        throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Каждый элемент remove должен быть UUID пункта.', {});
      }
    }
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
    state = await service.updateChecklist(
      bot_id,
      checklist_id,
      { add, rename, remove, reset, agentNote: agentNoteValue },
      { source: 'agent' }
    );
  } catch (err) {
    if (err?.message === 'NOT_FOUND') {
      throw new MCPError(ERROR_CODES.NOT_FOUND, 'Чек-лист удалён или не существует.', {});
    }
    if (err?.message === 'ITEM_NOT_FOUND') {
      throw new MCPError(ERROR_CODES.NOT_FOUND, 'Пункт не найден в этом списке. Возьми свежие item_id из checklist_state.', {});
    }
    if (err?.message === 'CHECKLIST_CANCELLED') {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Список закрыт — править нельзя.', {});
    }
    if (err?.message === 'TOO_MANY_ITEMS') {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'В списке максимум 25 пунктов.', {});
    }
    throw err;
  }

  return {
    checklist: state.checklist,
    items: state.items,
    summary: renderChecklistSummary(state.checklist, state.items)
  };
}

registerOperation('bullgram_autopost_checklist_update', {
  handler: updateChecklistHandler,
  requiredScopes: ['mcp:autopost:write', 'api:autopost:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Update autopost checklist',
  description:
    'Правит живой чек-лист без потери отметок. add — дописать пункты в конец; rename — переименовать по item_id (отметка и атрибуция остаются на пункте — бери свежие item_id из checklist_state); remove — удалить по item_id; reset=true — массово снять отметки. ' +
    'reset — для циклических списков: «покупки» после похода сбрасывай reset, а не пересоздавай. Клавиатуры во всех опубликованных копиях перерисуются автоматически, события (added/renamed/removed/reset) попадут в ленту. ' +
    'agent_note — приватная заметка для себя, не показывается в Telegram: контекст списка, отсылки к вики; пустая строка — очистить; читается через checklist_state/checklist_list. Можно передать agent_note без остальных правок. ' +
    'Нужна хотя бы одна правка за вызов; максимум 25 пунктов после add. Отменённый список править нельзя (INVALID_PARAMS).',
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
      add: {
        type: 'array',
        items: { type: 'string' },
        description: 'New items to append (each 1–100 chars). Existing items and their checks stay untouched.'
      },
      rename: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['item_id', 'text'],
          properties: {
            item_id: { type: 'string', format: 'uuid', description: 'Item UUID from checklist_state (stable key — the check survives the rename).' },
            text: { type: 'string', minLength: 1, maxLength: 100 }
          }
        },
        description: 'Renames by item_id — checks survive. Never match by text: duplicates make the match ambiguous.'
      },
      remove: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        description: 'Item UUIDs to remove.'
      },
      reset: {
        type: 'boolean',
        description: 'true = uncheck all items and clear attribution (cyclic lists: reset after each cycle instead of recreating).'
      },
      agent_note: {
        type: 'string',
        maxLength: 2000,
        description: 'Private note to self, never rendered in Telegram: checklist context, wiki references. Empty string clears it. Read it back via checklist_state/checklist_list.'
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'PATCH', path: '/autopost/bots/{bot_id}/checklists/{checklist_id}', tags: ['autopost'], summary: 'Update autopost checklist (add/rename/remove/reset)' }
  }
});
