-- Миграции 20260916210000 + 20260916220000: messaging router
-- (20260916220000 скоупит индекс идемпотентности на владельца — см. блок unique index ниже)
-- 1) userbot_send_log — леджер отправок юзерботов: источник квот (USERBOT_DM_HOURLY_CAP /
--    USERBOT_DM_DAILY_CAP), аудит и идемпотентность точечных отправок.
-- 2) tg_accounts.dm_paused_until / dm_pause_reason — реестр пауз актёра
--    (flood_wait → retry_after+30s; Spambot/флаги → 24ч). Пауза персистентна,
--    переживает рестарт pm2. Подробнее: docs/plans/2026-09-16-messaging-router.md

create table if not exists public.userbot_send_log (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null,
    actor_type text not null default 'userbot' check (actor_type in ('userbot', 'official_bot')),
    actor_id uuid not null,
    campaign_id uuid,
    tg_user_id text not null,
    status text not null check (status in ('sent', 'failed', 'skipped')),
    error_kind text,
    idempotency_key text,
    created_at timestamptz not null default now()
);

create unique index if not exists userbot_send_log_owner_idempotency_key
    on public.userbot_send_log (owner_id, idempotency_key)
    where idempotency_key is not null;

create index if not exists userbot_send_log_actor_created
    on public.userbot_send_log (actor_id, created_at);

create index if not exists userbot_send_log_owner_created
    on public.userbot_send_log (owner_id, created_at);

alter table public.userbot_send_log enable row level security;

drop policy if exists userbot_send_log_owner_all on public.userbot_send_log;
create policy userbot_send_log_owner_all on public.userbot_send_log
    for all to authenticated
    using (owner_id = auth.uid())
    with check (owner_id = auth.uid());

alter table public.tg_accounts add column if not exists dm_paused_until timestamptz;
alter table public.tg_accounts add column if not exists dm_pause_reason text;
