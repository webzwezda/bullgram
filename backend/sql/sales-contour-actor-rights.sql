-- Миграция 20260916200000 (применена через Supabase MCP 2026-09-16). Ядро ensure-admin:
-- права официального бота и юзерботов по каждой площадке контура (bot × actor × target).
-- Код: ContourAdminRightsService (backend/services/contour-admin-rights.service.js),
-- роут POST /api/official-bot/contours/ensure-admin, jobs/bot-rights-monitor.job.js.
-- Файл идемпотентный: повторный прогон ничего не меняет.

create table if not exists public.sales_contour_actor_rights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  bot_id uuid not null references public.tg_accounts(id) on delete cascade,
  actor_type text not null check (actor_type in ('official_bot', 'userbot')),
  actor_id uuid not null references public.tg_accounts(id) on delete cascade,
  channel_id uuid null references public.channels(id) on delete set null,
  target text not null check (target in ('public_channel', 'public_chat', 'paid_channel', 'paid_chat')),
  state text not null default 'unknown' check (state in ('ok', 'owner_appointed', 'promote_forbidden', 'needs_promote', 'missing_membership', 'error', 'unknown')),
  is_admin boolean not null default false,
  flags jsonb not null default '{}',
  warnings jsonb not null default '[]',
  message text not null default '',
  checked_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bot_id, actor_type, actor_id, target)
);

create index if not exists sales_contour_actor_rights_owner_idx
  on public.sales_contour_actor_rights (owner_id);
