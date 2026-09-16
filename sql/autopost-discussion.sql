-- Миграция 20260916150000 (применена через Supabase MCP 2026-09-16).
-- SQL-копия по конвенции sql/ — схема не должна жить только в проде.
--
-- Autopost: нативная кнопка «Перейти к обсуждению».
-- Bot API не создаёт тред обсуждения при отправке поста в канал, поэтому
-- autopost форвардит опубликованные сообщения в привязанную группу обсуждений.
--   channels.linked_chat_id          — привязанная группа (Bot API getChat.linked_chat_id)
--   channels.discussion_forward_enabled — per-channel тумблер (по умолчанию выключен)
--   autopost_items.discussion_message_ids — message_id форвардов (зеркало posted_message_ids,
--       чтобы message_delete чистил и копии в обсуждении)
alter table public.channels
  add column if not exists linked_chat_id bigint,
  add column if not exists discussion_forward_enabled boolean not null default false;

alter table public.autopost_items
  add column if not exists discussion_message_ids bigint[] not null default '{}';
