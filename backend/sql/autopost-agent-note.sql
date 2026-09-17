-- Миграция 20260918000000 (применена через Supabase MCP 2026-09-18).
-- SQL-копия по конвенции backend/sql/ — схема не должна жить только в проде.
-- Технический комментарий агента к чек-листу (не рендерится в Telegram):
-- агент пишет себе контекст («чек-лист о привычках, привычки в вики/папка X»),
-- чтобы переживать собственные сбросы сессии: поле возвращается в state/list.
alter table public.autopost_checklists add column if not exists agent_note text;

comment on column public.autopost_checklists.agent_note is
    'Служебная заметка агента (не показывается в Telegram): контекст списка, отсылки к вики/папкам. Видна только владельцу через checklist_state/list.';
