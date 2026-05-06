alter table public.tg_accounts
  add column if not exists bot_kind text;

update public.tg_accounts
set bot_kind = 'sales'
where bot_kind is null;

alter table public.tg_accounts
  alter column bot_kind set default 'sales';

alter table public.tg_accounts
  alter column bot_kind set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tg_accounts_bot_kind_check'
  ) then
    alter table public.tg_accounts
      add constraint tg_accounts_bot_kind_check
      check (bot_kind in ('sales', 'template'));
  end if;
end $$;

create table if not exists public.sales_bot_contours (
  bot_id uuid primary key references public.tg_accounts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  paid_channel_id uuid not null references public.channels(id) on delete restrict,
  public_chat_id uuid null references public.channels(id) on delete set null,
  userbot_mode text not null default 'none'
    check (userbot_mode in ('none', 'single', 'pool')),
  selected_userbot_id uuid null references public.tg_accounts(id) on delete set null,
  selected_userbot_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(selected_userbot_ids) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_bot_contours_distinct_targets_check
    check (public_chat_id is null or public_chat_id <> paid_channel_id),
  constraint sales_bot_contours_userbot_mode_payload_check
    check (
      (userbot_mode = 'none' and selected_userbot_id is null and selected_userbot_ids = '[]'::jsonb)
      or (userbot_mode = 'single' and selected_userbot_id is not null and selected_userbot_ids = '[]'::jsonb)
      or (userbot_mode = 'pool' and selected_userbot_id is null and jsonb_array_length(selected_userbot_ids) > 0)
    )
);

create index if not exists sales_bot_contours_owner_idx
  on public.sales_bot_contours (owner_id);

create index if not exists sales_bot_contours_paid_channel_idx
  on public.sales_bot_contours (paid_channel_id);

create index if not exists sales_bot_contours_public_chat_idx
  on public.sales_bot_contours (public_chat_id);

create index if not exists sales_bot_contours_selected_userbot_idx
  on public.sales_bot_contours (selected_userbot_id);
