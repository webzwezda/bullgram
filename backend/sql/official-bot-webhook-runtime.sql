alter table public.tg_accounts
  add column if not exists webhook_mode text not null default 'polling';

alter table public.tg_accounts
  add column if not exists webhook_secret text null;

alter table public.tg_accounts
  add column if not exists webhook_url text null;

alter table public.tg_accounts
  add column if not exists webhook_set_at timestamptz null;

alter table public.tg_accounts
  add column if not exists webhook_status text null;

alter table public.tg_accounts
  add column if not exists last_update_at timestamptz null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tg_accounts_webhook_mode_check'
  ) then
    alter table public.tg_accounts
      add constraint tg_accounts_webhook_mode_check
      check (webhook_mode in ('polling', 'webhook'));
  end if;
end $$;

create table if not exists public.official_bot_update_queue (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.tg_accounts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  telegram_update_id bigint not null,
  update_type text not null default 'unknown',
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'done', 'failed', 'dead')),
  attempts integer not null default 0
    check (attempts >= 0),
  created_at timestamptz not null default now(),
  processed_at timestamptz null,
  last_error text null,
  unique (bot_id, telegram_update_id)
);

create index if not exists official_bot_update_queue_status_created_idx
  on public.official_bot_update_queue (status, created_at);

create index if not exists official_bot_update_queue_bot_created_idx
  on public.official_bot_update_queue (bot_id, created_at desc);

create index if not exists official_bot_update_queue_owner_created_idx
  on public.official_bot_update_queue (owner_id, created_at desc);
