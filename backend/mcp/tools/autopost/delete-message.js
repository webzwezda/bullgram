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

  // --- Discussion-thread cleanup lookup (best-effort) ---
  // Если этот message_id — опубликованный пост автопостера и у него есть
  // форварды в группу обсуждений (discussion_message_ids), сносим их тоже:
  // иначе в привязанной группе останутся висящие копии удалённого поста.
  // Ошибки поиска не валят основной запрос — просто чистим без discussion.
  let discussionIds = [];
  let linkedChatId = null;
  try {
    const { data: item, error: itemErr } = await supabase
      .from('autopost_items')
      .select('id, discussion_message_ids')
      .eq('bot_id', bot_id)
      .eq('target_channel_id', String(chat_id))
      .contains('posted_message_ids', [messageId])
      .limit(1)
      .maybeSingle();
    if (itemErr) throw itemErr;
    const dmIds = Array.isArray(item?.discussion_message_ids)
      ? item.discussion_message_ids.map(Number).filter(Number.isInteger)
      : [];
    if (item && dmIds.length > 0) {
      const { data: channel } = await supabase
        .from('channels')
        .select('linked_chat_id')
        .eq('autopost_bot_id', bot_id)
        .eq('tg_chat_id', String(chat_id))
        .maybeSingle();
      if (channel?.linked_chat_id != null) {
        linkedChatId = channel.linked_chat_id;
        discussionIds = dmIds;
      }
    }
  } catch (e) {
    console.warn('[MCP delete_message] discussion lookup failed (non-fatal):', e?.message || e);
  }

  const discussionDeletedIds = [];
  async function cleanupDiscussionCopies() {
    if (discussionIds.length === 0 || linkedChatId == null) return;
    for (const dmId of discussionIds) {
      try {
        await tgBot.telegram.deleteMessage(String(linkedChatId), dmId);
        discussionDeletedIds.push(dmId);
      } catch (err) {
        const msg = String(err?.message || err);
        // Уже удалён/недоступен — норма для повторного вызова; остальное логируем.
        if (msg.includes('not found') || msg.includes('MESSAGE_ID_INVALID') || msg.includes("can't be deleted")) continue;
        console.warn(`[MCP delete_message] discussion delete failed (discussion=${linkedChatId} message=${dmId}, non-fatal):`, msg);
      }
    }
  }

  // --- Main delete ---
  let idempotent = false;
  try {
    await tgBot.telegram.deleteMessage(String(chat_id), messageId);
  } catch (err) {
    const msg = String(err?.message || err);
    // Telegram 400: "message to delete not found" / "MESSAGE_ID_INVALID" —
    // для rolling pinned post это норма (предыдущее сообщение уже удалено / не существует).
    // Возвращаем ok=true, idempotent=true чтобы клиент не падал.
    if (msg.includes('not found') || msg.includes('MESSAGE_ID_INVALID') || msg.includes("can't be deleted") || msg.includes('message can\'t be deleted')) {
      idempotent = true;
    } else {
      throw new MCPError(ERROR_CODES.INTERNAL, `Telegram deleteMessage failed: ${msg.slice(0, 300)}`, {});
    }
  }

  // Discussion-копии чистим даже при idempotent-пути: основной пост могли
  // удалить вручную, а форварды в обсуждении остались.
  await cleanupDiscussionCopies();

  const result = { ok: true, idempotent };
  if (discussionDeletedIds.length > 0) {
    result.discussion_deleted_ids = discussionDeletedIds;
  } else if (idempotent) {
    result.note = 'Message already deleted, not accessible, or bot lacks delete rights.';
  }
  return result;
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
