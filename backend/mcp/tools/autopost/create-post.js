// bullgram_autopost_post_create — create a text post in an autopost channel.
//
// Используется внешними интеграциями (n8n, zapier, custom scripts) чтобы
// программно публиковать посты с кнопками. Кнопки и seed_reaction_emoji
// наследуются из настроек канала — их нельзя передать в payload.
//
// Два режима:
//   * publish_now: true  → пост уходит в канал синхронно, в ответе message_ids
//   * publish_now: false → пост становится в очередь (status=queued),
//                          scheduler ставит его в ближайший слот канала.
//                          С опциональным scheduled_at — точное время.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { AutopostService } from '../../../services/autopost.service.js';

export async function createPostHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'create_post requires authenticated user', {});
  }

  const { bot_id, target_channel_id, caption, publish_now = false, scheduled_at = null } = args || {};

  // --- Validation ---
  if (!isValidUuid(bot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_id" must be a UUID.', {});
  }
  if (!target_channel_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "target_channel_id" is required.', {});
  }
  const captionStr = String(caption || '').trim();
  if (!captionStr) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "caption" is required and must be non-empty.', {});
  }
  if (captionStr.length > 4096) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "caption" must be ≤ 4096 characters (Telegram limit).', {});
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

  // --- Load channel, verify it's connected to this bot ---
  const { data: channel, error: chErr } = await supabase
    .from('channels')
    .select('id, tg_chat_id, title, buttons_config, suggest_button_enabled, seed_reaction_emoji, autopost_bot_id')
    .eq('tg_chat_id', String(target_channel_id))
    .eq('autopost_bot_id', bot_id)
    .maybeSingle();
  if (chErr) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'DB error loading channel', { cause: chErr.message });
  }
  if (!channel) {
    throw new MCPError(
      ERROR_CODES.NOT_FOUND,
      'Channel not connected to this bot. Add the bot as admin in the channel and wait for the bot to detect it.',
      {}
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

    // Создаём item (status=queued), publishItem обновит на 'posted'.
    const item = await service.addPostItem({
      botId: bot_id,
      targetChannelId: channel.tg_chat_id,
      fileIds: [],
      caption: captionStr,
      status: 'queued',
      mediaType: 'text'
    });

    try {
      const messageIds = await service.publishItem(tgBot, item, channel, bot.username);
      return {
        item_id: item.id,
        status: 'posted',
        posted_message_ids: messageIds,
        channel_id: channel.id,
        channel_title: channel.title
      };
    } catch (err) {
      // Маркируем failed чтобы админ видел в /metrics
      await supabase
        .from('autopost_items')
        .update({
          status: 'failed',
          error_message: String(err?.message || err).slice(0, 1000)
        })
        .eq('id', item.id);
      throw new MCPError(
        ERROR_CODES.TELEGRAM_ERROR,
        `Publish failed: ${err?.message || err}`,
        {}
      );
    }
  }

  // --- QUEUE path ---
  let status = 'queued';
  let scheduledAtValue = null;

  if (scheduled_at) {
    const d = new Date(scheduled_at);
    if (Number.isNaN(d.getTime())) {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'scheduled_at must be ISO 8601 date', {});
    }
    scheduledAtValue = d.toISOString();
    status = 'scheduled';
  }

  const item = await service.addPostItem({
    botId: bot_id,
    targetChannelId: channel.tg_chat_id,
    fileIds: [],
    caption: captionStr,
    status,
    mediaType: 'text'
  });

  if (scheduledAtValue) {
    // Явный слот — не трогаем collapseQueue, scheduler сам подберет по времени
    await supabase
      .from('autopost_items')
      .update({ scheduled_at: scheduledAtValue })
      .eq('id', item.id);
  } else {
    // Сообщаем очереди пересчитать слоты (как media.js делает после вставки)
    await service.collapseQueue(bot_id, channel.tg_chat_id);
  }

  const { data: refreshed } = await supabase
    .from('autopost_items')
    .select('status, scheduled_at')
    .eq('id', item.id)
    .maybeSingle();

  return {
    item_id: item.id,
    status: refreshed?.status || status,
    scheduled_at: refreshed?.scheduled_at || scheduledAtValue,
    posted_message_ids: null,
    channel_id: channel.id,
    channel_title: channel.title
  };
}

registerOperation('bullgram_autopost_post_create', {
  handler: createPostHandler,
  requiredScopes: ['mcp:autopost:write', 'api:autopost:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Create autopost',
  description: 'Create a text post in an autopost channel. Inline buttons, suggest-button, and seed reaction are inherited from channel settings (cannot be overridden per-post). Set publish_now=true to publish synchronously (returns message_ids). Omit or set publish_now=false to enqueue — scheduler will place it per channel posts_per_day/posting_times. Optional scheduled_at (ISO 8601) pins a specific slot.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['bot_id', 'target_channel_id', 'caption'],
    properties: {
      bot_id: {
        type: 'string',
        format: 'uuid',
        description: 'Autopost bot ID (UUID from /api/external/v1/autopost/bots or /app/autopost URL)'
      },
      target_channel_id: {
        type: 'string',
        description: 'Telegram chat ID of the channel (bigint as string, e.g. "-1001234567890"). Channel must be connected to this bot.'
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
        description: 'true = send immediately and synchronously. false (default) = enqueue per channel schedule.'
      },
      scheduled_at: {
        type: 'string',
        format: 'date-time',
        description: 'ISO 8601 timestamp. Only when publish_now=false. Pins specific slot (status=scheduled). Skip collapseQueue.'
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/autopost/bots/{bot_id}/posts', tags: ['autopost'], summary: 'Create autopost text post' }
  }
});
