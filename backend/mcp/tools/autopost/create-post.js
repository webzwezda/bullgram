// bullgram_autopost_post_create — create a text post in autopost channel(s).
//
// Используется внешними интеграциями (n8n, zapier, custom scripts) чтобы
// программно публиковать посты с кнопками. Кнопки и seed_reaction_emoji
// наследуются из настроек канала — их нельзя передать в payload.
//
// Поддерживает multi-target fan-out: один логический пост → N каналов.
// Каналы передаются массивом target_channel_ids; для back-compat принимается
// скалярный target_channel_id (обрабатывается как массив из одного).
//
// Два режима:
//   * publish_now: true  → пост уходит в каналы синхронно, в ответе items[].posted_message_ids
//   * publish_now: false → посты становятся в очередь (status=queued),
//                          scheduler ставит их в ближайшие слоты каналов.
//                          С опциональным scheduled_at — точное время для всех каналов.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { AutopostService } from '../../../services/autopost.service.js';

export async function createPostHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'create_post requires authenticated user', {});
  }

  const {
    bot_id,
    target_channel_id,
    target_channel_ids,
    caption,
    publish_now = false,
    scheduled_at = null
  } = args || {};

  // --- Validation: at least one target required ---
  const hasScalar = target_channel_id != null;
  const hasArray = Array.isArray(target_channel_ids) && target_channel_ids.length > 0;
  if (!hasScalar && !hasArray) {
    throw new MCPError(
      ERROR_CODES.INVALID_PARAMS,
      'Either target_channel_id (string) or target_channel_ids (non-empty array) is required.',
      {}
    );
  }

  if (!isValidUuid(bot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_id" must be a UUID.', {});
  }

  const scalarArr = hasScalar ? [String(target_channel_id)] : [];
  const arrayArr = hasArray ? target_channel_ids.map(String) : [];
  const channelIds = [...new Set([...scalarArr, ...arrayArr])];

  const captionStr = String(caption || '').trim();
  if (!captionStr) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "caption" is required and must be non-empty.', {});
  }
  if (captionStr.length > 4096) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "caption" must be ≤ 4096 characters (Telegram limit).', {});
  }

  let scheduledAtValue = null;
  if (scheduled_at) {
    const d = new Date(scheduled_at);
    if (Number.isNaN(d.getTime())) {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'scheduled_at must be ISO 8601 date', {});
    }
    scheduledAtValue = d.toISOString();
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
    .select('id, tg_chat_id, title, buttons_config, suggest_button_enabled, seed_reaction_emoji, autopost_bot_id')
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

  // --- PUBLISH NOW path ---
  if (publish_now) {
    if (!bot.is_active) {
      throw new MCPError(
        ERROR_CODES.TOOL_DISABLED,
        'Bot is_active=false. Enable it in /app/autopost first.',
        {}
      );
    }

    let tgBot = service.getBot(bot_id);
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

    // Single batch INSERT — все N items разделяют один batch_id.
    const { items } = await service.addPostItem({
      botId: bot_id,
      targetChannelIds: channelIds,
      fileIds: [],
      caption: captionStr,
      status: 'queued',
      mediaType: 'text'
    });

    // Per-channel publish: каждый item публикуется со своим channel object
    // (так как buttons_config / seed_reaction_emoji могут отличаться).
    // Результат всегда 200 — клиент смотрит items[].status чтобы понять,
    // какие каналы прошли, какие упали.
    const results = [];
    for (const item of items) {
      const channel = channels.find(c => String(c.tg_chat_id) === String(item.target_channel_id));
      try {
        const messageIds = await service.publishItem(tgBot, item, channel, bot.username);
        results.push({
          id: item.id,
          target_channel_id: item.target_channel_id,
          channel_id: channel?.id || null,
          channel_title: channel?.title || null,
          status: 'posted',
          posted_message_ids: messageIds || [],
          scheduled_at: null,
          error: null
        });
      } catch (err) {
        // publishItem уже обновил item до status=failed внутри себя через markFailed? Нет —
        // старый путь ловит exception и обновляет вручную. Делаем так же.
        await supabase
          .from('autopost_items')
          .update({
            status: 'failed',
            error_message: String(err?.message || err).slice(0, 1000)
          })
          .eq('id', item.id);
        results.push({
          id: item.id,
          target_channel_id: item.target_channel_id,
          channel_id: channel?.id || null,
          channel_title: channel?.title || null,
          status: 'failed',
          posted_message_ids: null,
          scheduled_at: null,
          error: String(err?.message || err).slice(0, 500)
        });
      }
    }

    // Determine batch_id from inserted items (they all share one)
    const batchId = items[0]?.post_batch_id || null;

    return {
      batch_id: batchId,
      items: results
    };
  }

  // --- QUEUE path ---
  let status = 'queued';
  if (scheduledAtValue) {
    status = 'scheduled';
  }

  const { items, batch_id } = await service.addPostItem({
    botId: bot_id,
    targetChannelIds: channelIds,
    fileIds: [],
    caption: captionStr,
    status,
    mediaType: 'text'
  });

  if (scheduledAtValue) {
    // Явный слот — единый timestamp для всех items в batch'е.
    // Не трогаем collapseQueue — scheduler сам возьмёт по времени.
    const itemIds = items.map(i => i.id);
    await supabase
      .from('autopost_items')
      .update({ scheduled_at: scheduledAtValue })
      .in('id', itemIds);
  } else {
    // Сообщаем очереди пересчитать слоты per-channel
    for (const cid of channelIds) {
      await service.collapseQueue(bot_id, cid);
    }
  }

  // Reload для финального status/scheduled_at (collapseQueue мог поменять)
  const itemIds = items.map(i => i.id);
  const { data: refreshed } = await supabase
    .from('autopost_items')
    .select('id, target_channel_id, status, scheduled_at')
    .in('id', itemIds);

  const refreshedMap = new Map((refreshed || []).map(r => [r.id, r]));
  const channelById = new Map(channels.map(c => [String(c.tg_chat_id), c]));

  const results = items.map(item => {
    const r = refreshedMap.get(item.id) || {};
    const ch = channelById.get(String(item.target_channel_id));
    return {
      id: item.id,
      target_channel_id: item.target_channel_id,
      channel_id: ch?.id || null,
      channel_title: ch?.title || null,
      status: r.status || status,
      posted_message_ids: null,
      scheduled_at: r.scheduled_at || scheduledAtValue,
      error: null
    };
  });

  return {
    batch_id,
    items: results
  };
}

registerOperation('bullgram_autopost_post_create', {
  handler: createPostHandler,
  requiredScopes: ['mcp:autopost:write', 'api:autopost:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Create autopost',
  description: 'Create a text post in one or more autopost channels. Inline buttons, suggest-button, and seed reaction are inherited from channel settings (cannot be overridden per-post). Pass target_channel_ids (array) for multi-target fan-out, or target_channel_id (string) for single-target back-compat. Set publish_now=true to publish synchronously (returns items[].posted_message_ids). Omit or set publish_now=false to enqueue — scheduler will place items per channel posts_per_day/posting_times. Optional scheduled_at (ISO 8601) pins a specific slot across all channels. Response is always 200 with items[].status showing posted|queued|scheduled|failed per channel.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['bot_id', 'caption'],
    properties: {
      bot_id: {
        type: 'string',
        format: 'uuid',
        description: 'Autopost bot ID (UUID from /api/external/v1/autopost/bots or /app/autopost URL)'
      },
      target_channel_id: {
        type: 'string',
        description: 'Single channel (legacy / back-compat). Prefer target_channel_ids. Telegram chat ID as string (bigint, e.g. "-1001234567890"). Channel must be connected to this bot.'
      },
      target_channel_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Channels to publish to (multi-target fan-out). Each must be connected to this bot. Each gets its own item row grouped by batch_id.'
      },
      caption: {
        type: 'string',
        minLength: 1,
        maxLength: 4096,
        description: 'Post text. Markdown supported (Telegram parse_mode=Markdown with safe fallback).'
      },
      publish_now: {
        type: 'boolean',
        default: false,
        description: 'true = send immediately and synchronously to all channels. false (default) = enqueue per channel schedule.'
      },
      scheduled_at: {
        type: 'string',
        format: 'date-time',
        description: 'ISO 8601 timestamp. Only when publish_now=false. Pins specific slot for all channels (status=scheduled). Skips collapseQueue.'
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/autopost/bots/{bot_id}/posts', tags: ['autopost'], summary: 'Create autopost text post (multi-target)' }
  }
});
