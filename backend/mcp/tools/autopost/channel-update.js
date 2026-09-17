// bullgram_autopost_channel_update — настройка канала автопостера: таймзона и слоты публикации.
//
// Зеркало админского PATCH /api/autopost/bots/:botId/channels/:channelId
// (routes/autopost.routes.js), но в агентском контуре: минимум полей, максимум
// понятности. channel_id — это tg_chat_id (Telegram chat id из list_channels),
// а не внутренний uuid строки channels.
//
// Смена posting_times пересобирает очередь канала (collapseQueue): уже
// посчитанные слоты сбрасываются в queued и раскладываются заново по новым
// временам. Смена таймзоны просто сдвигает интерпретацию слотов при следующем
// планировании — без перестановки очереди.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { AutopostService } from '../../../services/autopost.service.js';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function updateChannelHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'channel_update requires authenticated user', {});
  }

  const { bot_id, channel_id, timezone, posting_times } = args || {};

  if (!isValidUuid(bot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_id" must be a UUID.', {});
  }
  if (channel_id == null || String(channel_id).trim() === '') {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "channel_id" is required (Telegram chat id of a channel connected to this bot).', {});
  }

  const hasTimezone = timezone !== undefined && timezone !== null;
  const hasTimes = posting_times !== undefined && posting_times !== null;
  if (!hasTimezone && !hasTimes) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Нужен хотя бы один параметр: timezone или posting_times.', {});
  }

  let tzValue;
  if (hasTimezone) {
    tzValue = String(timezone).trim();
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tzValue });
    } catch {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Неизвестная таймзона (IANA, напр. Asia/Vladivostok).', {});
    }
  }

  let timesValue;
  if (hasTimes) {
    if (!Array.isArray(posting_times) || posting_times.length < 1 || posting_times.length > 10) {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'posting_times — массив строк «HH:MM» (1–10 слотов).', {});
    }
    timesValue = posting_times.map((t) => String(t).trim());
    if (timesValue.some((t) => !TIME_RE.test(t))) {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Каждый слот — строка «HH:MM» (00:00–23:59), например «10:00».', {});
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

  // --- Load channel scoped to this bot (по паре tg_chat_id + autopost_bot_id,
  // как в admin PATCH — чужой/не привязанный канал штатный NOT_FOUND) ---
  const { data: channel, error: chErr } = await supabase
    .from('channels')
    .select('id, tg_chat_id, title, timezone, posting_times, posts_per_day')
    .eq('tg_chat_id', channel_id)
    .eq('autopost_bot_id', bot_id)
    .maybeSingle();
  if (chErr) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'DB error loading channel', { cause: chErr.message });
  }
  if (!channel) {
    throw new MCPError(ERROR_CODES.NOT_FOUND, 'Канал не найден или не привязан к этому боту.', {});
  }

  const updates = {};
  if (hasTimezone) updates.timezone = tzValue;
  if (hasTimes) updates.posting_times = timesValue;

  const { error: updErr } = await supabase
    .from('channels')
    .update(updates)
    .eq('id', channel.id)
    .eq('autopost_bot_id', bot_id);
  if (updErr) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'DB error updating channel', { cause: updErr.message });
  }

  // Пересборка слотов — только при смене времён публикации.
  if (hasTimes) {
    const service = new AutopostService(supabase);
    await service.collapseQueue(bot_id, channel.tg_chat_id);
  }

  return {
    channel: {
      tg_chat_id: String(channel.tg_chat_id),
      title: channel.title || null,
      timezone: hasTimezone ? tzValue : (channel.timezone || null),
      posting_times: hasTimes ? timesValue : (channel.posting_times || null),
      posts_per_day: channel.posts_per_day ?? null
    }
  };
}

registerOperation('bullgram_autopost_channel_update', {
  handler: updateChannelHandler,
  requiredScopes: ['mcp:autopost:write', 'api:autopost:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Update autopost channel settings',
  description:
    'настройка канала: таймзона и слоты публикации. timezone=\'Asia/Vladivostok\' + posting_times=[\'10:00\'] → ежедневные слоты в 10:00 по Владивостоку; ' +
    'checklist_create/post_create без scheduled_at лягут в ближайший слот. Для точечного времени — scheduled_at в UTC (например 10:00 Владивостока = 00:00Z). ' +
    'channel_id — Telegram chat id канала из list_channels. Нужен хотя бы один из параметров; смена posting_times пересобирает очередь канала.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['bot_id', 'channel_id'],
    properties: {
      bot_id: {
        type: 'string',
        format: 'uuid',
        description: 'Autopost bot ID (UUID from GET /autopost/bots)'
      },
      channel_id: {
        type: 'string',
        description: 'Telegram chat ID of the channel (tg_chat_id from list_channels, e.g. "-1001234567890"). Must be connected to this bot.'
      },
      timezone: {
        type: 'string',
        description: 'IANA timezone for slot calculation, e.g. "Asia/Vladivostok". Omit to keep current.'
      },
      posting_times: {
        type: 'array',
        items: { type: 'string', pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' },
        minItems: 1,
        maxItems: 10,
        description: 'Daily publication slots "HH:MM" in the channel timezone (1–10). Changing these re-collapses the channel queue.'
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'PATCH', path: '/autopost/bots/{bot_id}/channels/{channel_id}', tags: ['autopost'], summary: 'Update autopost channel settings (timezone, posting_times)' }
  }
});
