// bullgram_autopost_checklist_create — создать чек-лист и опубликовать его в каналы автопостера.
//
// Чек-лист — интерактивный список дел с inline-кнопками: домочадцы отмечают пункты
// прямо в Telegram («⬜ картошка» → «✅ картошка — Вася»), состояние живёт в БД,
// агент читает итог через checklist_state. Кнопки и реакции канала на чек-лист
// не влияют: клавиатура принадлежит пунктам списка.
//
// Три режима публикации (один механизм autopost_items, разные статусы):
//   * publish_now: true   → публикует синхронно, в ответе published[].posted_message_ids
//   * scheduled_at: 'ISO' → строки очереди со статусом scheduled на точное время
//   * иначе               → очередь (status=queued), scheduler возьмёт ближайшие слоты
//
// dedup_key — для крон-путей: повторный вызов с тем же ключом вернёт существующий
// список с already_exists=true и НЕ задублирует пост (unique-гонка тоже покрыта).

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { AutopostService } from '../../../services/autopost.service.js';
import { validateChecklistInput, computeChecklistStatus } from '../../../services/autopost/checklist.js';

// Ответ create/state: компактная карточка списка (items_count вместо полного массива).
function mapCreatedChecklist(checklist, itemsCount) {
    return {
        id: checklist.id,
        title: checklist.title || '',
        status: 'active',
        items_count: itemsCount,
        expires_at: checklist.expires_at ?? null
    };
}

// Для already_exists: список существующий — статус вычисляемый (мог быть отменён/истечён).
async function mapExistingChecklist(supabase, checklist) {
    const { data: items, error } = await supabase
        .from('autopost_checklist_items')
        .select('id')
        .eq('checklist_id', checklist.id);
    if (error) {
        throw new MCPError(ERROR_CODES.INTERNAL, 'DB error loading checklist items', { cause: error.message });
    }
    return {
        id: checklist.id,
        title: checklist.title || '',
        status: computeChecklistStatus(checklist),
        items_count: (items || []).length,
        expires_at: checklist.expires_at ?? null
    };
}

export async function createChecklistHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'checklist_create requires authenticated user', {});
  }

  const {
    bot_id,
    target_channel_ids,
    title = '',
    items,
    publish_now = false,
    scheduled_at = null,
    expires_at = null,
    dedup_key = null,
    pin = false,
    agent_note = null
  } = args || {};

  if (!isValidUuid(bot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_id" must be a UUID.', {});
  }
  if (!Array.isArray(target_channel_ids) || target_channel_ids.length === 0) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "target_channel_ids" must be a non-empty array of channel IDs.', {});
  }
  const channelIds = [...new Set(target_channel_ids.map(String))];

  const titleStr = String(title ?? '').trim();
  // Капы (1–25 пунктов, текст 1–100, заголовок 0–200, dedup_key ≤128) — в валидаторе.
  const verdict = validateChecklistInput({ title: titleStr, items, dedupKey: dedup_key });
  if (!verdict.ok) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, verdict.error, {});
  }
  const itemTexts = items.map((raw) => String(raw ?? '').trim());

  let scheduledAtValue = null;
  if (scheduled_at) {
    const d = new Date(scheduled_at);
    if (Number.isNaN(d.getTime())) {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'scheduled_at must be ISO 8601 date', {});
    }
    scheduledAtValue = d.toISOString();
  }
  let expiresAtValue = null;
  if (expires_at) {
    const d = new Date(expires_at);
    if (Number.isNaN(d.getTime())) {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'expires_at must be ISO 8601 date', {});
    }
    expiresAtValue = d.toISOString();
  }
  const dedupKey = dedup_key != null && String(dedup_key).trim() !== '' ? String(dedup_key).trim() : null;

  // Приватная заметка агента: не рендерится в Telegram, читается через
  // checklist_state / checklist_list. Пустая строка → null (заметки нет).
  let agentNoteValue = null;
  if (agent_note !== undefined && agent_note !== null) {
    if (typeof agent_note !== 'string') {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "agent_note" must be a string (≤ 2000 characters).', {});
    }
    const trimmed = agent_note.trim();
    if (trimmed.length > 2000) {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "agent_note" must be ≤ 2000 characters.', {});
    }
    agentNoteValue = trimmed === '' ? null : trimmed;
  }

  // --- Load bot, verify ownership ---
  const { data: bot, error: botErr } = await supabase
    .from('autopost_bots')
    .select('id, owner_id, is_active, bot_token, username')
    .eq('id', bot_id)
    .maybeSingle();
  if (botErr) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'DB error loading bot', { cause: botErr.message });
  }
  if (!bot || bot.owner_id !== req.user.id) {
    throw new MCPError(ERROR_CODES.NOT_FOUND, 'Bot not found or not owned by current token owner.', {});
  }

  // --- Load channels, verify all are connected to this bot ---
  const { data: channels, error: chErr } = await supabase
    .from('channels')
    .select('id, tg_chat_id, title, visibility, autopost_bot_id')
    .in('tg_chat_id', channelIds)
    .eq('autopost_bot_id', bot_id);
  if (chErr) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'DB error loading channels', { cause: chErr.message });
  }

  const foundIds = new Set((channels || []).map(c => String(c.tg_chat_id)));
  const missing = channelIds.filter(id => !foundIds.has(id));
  if (missing.length > 0) {
    throw new MCPError(
      ERROR_CODES.INVALID_PARAMS,
      `Channels not connected to this bot: ${missing.join(', ')}. Add the bot as admin in each channel and wait for the bot to detect it.`,
      { missing_channels: missing }
    );
  }

  const service = new AutopostService(supabase);

  // --- dedup: повторный вызов возвращает существующий список, дубль в чат не улетает ---
  if (dedupKey) {
    const { data: existing, error: dupErr } = await supabase
      .from('autopost_checklists')
      .select('*')
      .eq('bot_id', bot_id)
      .eq('dedup_key', dedupKey)
      .maybeSingle();
    if (dupErr) {
      throw new MCPError(ERROR_CODES.INTERNAL, 'DB error checking dedup_key', { cause: dupErr.message });
    }
    if (existing) {
      return { checklist: await mapExistingChecklist(supabase, existing), already_exists: true };
    }
  }

  // --- PUBLISH NOW: lifecycle-проверки ДО записи в БД (зеркало create-post) —
  // иначе TOOL_DISABLED оставил бы созданный список без строк очереди.
  let tgBot = null;
  if (publish_now) {
    if (!bot.is_active) {
      throw new MCPError(
        ERROR_CODES.TOOL_DISABLED,
        'Bot is_active=false. Enable it in /app/autopost first.',
        {}
      );
    }

    tgBot = service.getBot(bot_id);
    if (!tgBot) {
      // Авто-restart по образцу scheduler'а (autopost-scheduler.job.js:65-83)
      service.startBot(bot_id, bot.bot_token);
      // Telegraf.launch() — async, но Map-запись появляется синхронно. 1.5с хватает.
      await new Promise(r => setTimeout(r, 1500));
      tgBot = service.getBot(bot_id);
    }
    if (!tgBot) {
      throw new MCPError(
        ERROR_CODES.TOOL_DISABLED,
        'Bot is starting up. Retry the request in a few seconds.',
        { retryable: true }
      );
    }
  }

  // --- Insert checklist ---
  const { data: checklist, error: insertErr } = await supabase
    .from('autopost_checklists')
    .insert({
      owner_id: bot.owner_id,
      bot_id,
      title: titleStr,
      created_by: 'agent',
      expires_at: expiresAtValue,
      dedup_key: dedupKey,
      agent_note: agentNoteValue
    })
    .select()
    .single();
  if (insertErr) {
    if (insertErr.code === '23505' && dedupKey) {
      // Гонка: параллельный create с тем же dedup_key успел вставить первым —
      // возвращаем существующий список (это штатный путь, не ошибка).
      const { data: existing } = await supabase
        .from('autopost_checklists')
        .select('*')
        .eq('bot_id', bot_id)
        .eq('dedup_key', dedupKey)
        .maybeSingle();
      if (existing) {
        return { checklist: await mapExistingChecklist(supabase, existing), already_exists: true };
      }
    }
    throw new MCPError(ERROR_CODES.INTERNAL, 'DB error creating checklist', { cause: insertErr.message });
  }

  // --- Insert items (position = index) ---
  const { error: itemsErr } = await supabase.from('autopost_checklist_items').insert(
    itemTexts.map((text, idx) => ({ checklist_id: checklist.id, bot_id, text, position: idx }))
  );
  if (itemsErr) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'DB error creating checklist items', { cause: itemsErr.message });
  }

  // Событие created — лента памяти агента. Best-effort: список уже создан.
  const { error: evErr } = await supabase.from('autopost_checklist_events').insert({
    checklist_id: checklist.id,
    action: 'created',
    actor_source: 'agent'
  });
  if (evErr) {
    console.warn('[MCP checklist_create] created event failed (non-fatal):', evErr.message);
  }

  const response = { checklist: mapCreatedChecklist(checklist, itemTexts.length) };

  // --- PUBLISH NOW path: строка очереди на каждый канал, публикация сразу ---
  if (publish_now) {
    const { items: queuedItems } = await service.addPostItem({
      botId: bot_id,
      targetChannelIds: channelIds,
      fileIds: [],
      caption: titleStr,
      status: 'queued',
      checklistId: checklist.id
    });

    const published = [];
    let pinned = false;
    for (const item of queuedItems) {
      const channel = channels.find(c => String(c.tg_chat_id) === String(item.target_channel_id));
      try {
        const { messageIds, discussionMessageIds } = await service.publishItem(tgBot, item, channel, bot.username, { actorSource: 'agent' });
        published.push({
          target_channel_id: item.target_channel_id,
          status: 'posted',
          posted_message_ids: messageIds || [],
          discussion_message_ids: discussionMessageIds || [],
          error: null
        });
        // pin: после первой успешной публикации, один раз, non-fatal —
        // без прав бота на закрепление список просто не закрепится, но будет жить.
        if (pin && !pinned && messageIds && messageIds.length > 0) {
          pinned = true;
          try {
            await tgBot.telegram.pinChatMessage(String(item.target_channel_id), messageIds[0]);
          } catch (pinErr) {
            console.warn('[MCP checklist_create] pin failed (non-fatal):', pinErr?.message || pinErr);
          }
        }
      } catch (err) {
        // Зеркало create-post: item вручную уводим в failed, результат — не 5xx.
        await supabase
          .from('autopost_items')
          .update({
            status: 'failed',
            error_message: String(err?.message || err).slice(0, 1000)
          })
          .eq('id', item.id);
        published.push({
          target_channel_id: item.target_channel_id,
          status: 'failed',
          posted_message_ids: null,
          discussion_message_ids: null,
          error: String(err?.message || err).slice(0, 500)
        });
      }
    }

    response.published = published;
    return response;
  }

  // --- QUEUE / SCHEDULED path ---
  const status = scheduledAtValue ? 'scheduled' : 'queued';
  const { items: queuedItems } = await service.addPostItem({
    botId: bot_id,
    targetChannelIds: channelIds,
    fileIds: [],
    caption: titleStr,
    status,
    checklistId: checklist.id
  });

  if (scheduledAtValue) {
    // Явный слот — единый timestamp для всех строк batch'а (зеркало create-post).
    await supabase
      .from('autopost_items')
      .update({ scheduled_at: scheduledAtValue })
      .in('id', queuedItems.map((i) => i.id));
    response.scheduled_at = scheduledAtValue;
  } else {
    // Очередь: collapseQueue пересчитывает слоты per-channel и внутри сам
    // прогоняет scheduleNextBatch (обе ветки is_suggestion) — как в create-post.
    for (const cid of channelIds) {
      await service.collapseQueue(bot_id, cid);
    }
  }

  return response;
}

registerOperation('bullgram_autopost_checklist_create', {
  handler: createChecklistHandler,
  requiredScopes: ['mcp:autopost:write', 'api:autopost:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Create autopost checklist',
  description:
    'Создаёт чек-лист и публикует его в каналы автопостера: заголовок + строка прогресса «Выполнено N из M» + по inline-кнопке на пункт. Домочадцы отмечают пункты прямо в Telegram («⬜ картошка» → «✅ картошка — Вася»), состояние хранится в БД. ' +
    'Как вести список: вечером создай список с scheduled_at на утро (или publish_now=true, чтобы вышел сразу); утром читай checklist_state (include_events=true — для памяти: кто и когда отметил). ' +
    'dedup_key обязателен во всех крон-путях: повторный вызов с тем же ключом вернёт существующий список с already_exists=true и НЕ задублирует пост. ' +
    'expires_at — TTL разового списка (потом статус станет expired). pin=true — закрепить опубликованное сообщение (для долгоживущих списков в группе; без прав на закрепление — non-fatal). ' +
    'agent_note — заметка для себя, не показывается в Telegram: контекст списка, отсылки к вики. Читается через checklist_state/checklist_list. ' +
    'target_channel_ids — только каналы, подключённые к этому боту.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['bot_id', 'target_channel_ids', 'items'],
    properties: {
      bot_id: {
        type: 'string',
        format: 'uuid',
        description: 'Autopost bot ID (UUID from GET /autopost/bots or /app/autopost URL)'
      },
      target_channel_ids: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'Channels to publish the checklist to (fan-out: state is shared across all of them). Telegram chat IDs as strings. Each must be connected to this bot.'
      },
      title: {
        type: 'string',
        default: '',
        maxLength: 200,
        description: 'Checklist title (first line of the message and caption of queue rows). Empty allowed.'
      },
      items: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'Checklist items, 1–25, each 1–100 chars. One inline button per item.'
      },
      publish_now: {
        type: 'boolean',
        default: false,
        description: 'true = publish immediately and synchronously (response.published[].posted_message_ids). false (default) = enqueue per channel schedule.'
      },
      scheduled_at: {
        type: 'string',
        format: 'date-time',
        description: 'ISO 8601. Only when publish_now=false. Pins a specific slot for all channels (status=scheduled). Typical: evening create, morning slot.'
      },
      expires_at: {
        type: 'string',
        format: 'date-time',
        description: 'ISO 8601. Optional TTL: after this moment the checklist status becomes expired and taps stop counting (keyboards are removed lazily).'
      },
      dedup_key: {
        type: 'string',
        maxLength: 128,
        description: 'Idempotency key for cron paths. A repeat call with the same key returns the existing checklist with already_exists=true instead of double-posting. Always pass it in scheduled jobs.'
      },
      pin: {
        type: 'boolean',
        default: false,
        description: 'true = pin the published message after the first successful post (once, non-fatal without pin rights).'
      },
      agent_note: {
        type: 'string',
        maxLength: 2000,
        description: 'Private note to self, never rendered in Telegram: checklist context, wiki references. Read it back via checklist_state/checklist_list.'
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/autopost/bots/{bot_id}/checklists', tags: ['autopost'], summary: 'Create autopost checklist (interactive to-do list)' }
  }
});
