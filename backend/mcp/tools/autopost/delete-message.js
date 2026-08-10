// bullgram_autopost_message_delete — delete a Telegram message posted by an autopost bot.
//
// Используется внешними интеграциями (n8n) для rolling pinned post pattern:
// перед публикацией нового сводочного поста удаляем предыдущий, сохранённый
// в bot_settings.<key>. Берёт bot_id, chat_id (string bigint), message_id (int).
// Идемпотентный — если сообщение уже удалено, возвращает ok=true, idempotent=true.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { AutopostService } from '../../../services/autopost.service.js';

export async function deleteMessageHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'delete_message requires authenticated user', {});
  }

  const { bot_id, chat_id, message_id } = args || {};

  if (!isValidUuid(bot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_id" must be a UUID.', {});
  }
  if (!chat_id) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
  }
  const messageId = Number(message_id);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "message_id" must be a positive integer.', {});
  }

  // Load bot, verify ownership
  const { data: bot, error: botErr } = await supabase
    .from('autopost_bots')
    .select('id, owner_id, is_active, bot_token')
    .eq('id', bot_id)
    .maybeSingle();
  if (botErr) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'DB error loading bot', { cause: botErr.message });
  }
  if (!bot || bot.owner_id !== req.user.id) {
    throw new MCPError(ERROR_CODES.NOT_FOUND, 'Bot not found or not owned by current token owner.', {});
  }

  const service = new AutopostService(supabase);

  let tgBot = service.getBot(bot_id);
  if (!tgBot) {
    // Авто-restart по образцу create-post.js
    service.startBot(bot_id, bot.bot_token);
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

  try {
    await tgBot.telegram.deleteMessage(String(chat_id), messageId);
  } catch (err) {
    const msg = String(err?.message || err);
    // Telegram 400: "message to delete not found" / "MESSAGE_ID_INVALID" —
    // для rolling pinned post это норма (предыдущее сообщение уже удалено / не существует).
    // Возвращаем ok=true, idempotent=true чтобы клиент не падал.
    if (msg.includes('not found') || msg.includes('MESSAGE_ID_INVALID') || msg.includes("can't be deleted") || msg.includes('message can\'t be deleted')) {
      return { ok: true, idempotent: true, note: 'Message already deleted, not accessible, or bot lacks delete rights.' };
    }
    throw new MCPError(ERROR_CODES.INTERNAL, `Telegram deleteMessage failed: ${msg.slice(0, 300)}`, {});
  }

  return { ok: true, idempotent: false };
}

registerOperation('bullgram_autopost_message_delete', {
  handler: deleteMessageHandler,
  requiredScopes: ['mcp:autopost:write', 'api:autopost:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Delete autopost message',
  description: 'Delete a Telegram message previously posted by an autopost bot. The bot must be admin in the target chat with delete rights. Idempotent — returns ok=true if the message is already gone or inaccessible. Used for rolling pinned-post patterns (delete previous, post new).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['bot_id', 'chat_id', 'message_id'],
    properties: {
      bot_id: {
        type: 'string',
        format: 'uuid',
        description: 'Autopost bot ID (the bot that originally posted the message).'
      },
      chat_id: {
        type: 'string',
        description: 'Telegram chat ID where the message lives (bigint as string, e.g. "-1001323964374").'
      },
      message_id: {
        type: 'integer',
        minimum: 1,
        description: 'Telegram message ID to delete (positive integer, returned in items[].posted_message_ids from POST /autopost/bots/{bot_id}/posts).'
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'DELETE', path: '/autopost/bots/{bot_id}/messages/{chat_id}/{message_id}', tags: ['autopost'], summary: 'Delete autopost Telegram message' }
  }
});
