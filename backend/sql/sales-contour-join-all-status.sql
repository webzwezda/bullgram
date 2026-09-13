-- Статус фонового вступления юзербота в площадки контура (join-all).
-- Код: SalesContourService.startJoinAll / _runJoinAllInBackground / getJoinAllStatus.
-- Применялся к прод-БД как миграция 20260913121500 (Supabase MCP); файл идемпотентный.

alter table public.sales_bot_contours
  add column if not exists join_all_status text not null default 'idle',
  add column if not exists join_all_result jsonb,
  add column if not exists join_all_started_at timestamptz;
