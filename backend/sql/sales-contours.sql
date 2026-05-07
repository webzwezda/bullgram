alter table public.tg_accounts
  add column if not exists bot_kind text;

alter table public.channels
  add column if not exists username text null;

alter table public.channels
  add column if not exists visibility text not null default 'unknown';

alter table public.channels
  add column if not exists last_visibility_check_at timestamptz null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'channels_visibility_check'
  ) then
    alter table public.channels
      add constraint channels_visibility_check
      check (visibility in ('public', 'private', 'unknown'));
  end if;
end $$;

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
  public_channel_id uuid null references public.channels(id) on delete set null,
  paid_channel_id uuid null references public.channels(id) on delete restrict,
  public_chat_id uuid null references public.channels(id) on delete set null,
  paid_chat_id uuid null references public.channels(id) on delete set null,
  userbot_mode text not null default 'none'
    check (userbot_mode in ('none', 'single', 'pool')),
  selected_userbot_id uuid null references public.tg_accounts(id) on delete set null,
  selected_userbot_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(selected_userbot_ids) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_bot_contours_distinct_targets_check
    check (
      (public_channel_id is null or public_channel_id <> paid_channel_id)
      and (public_chat_id is null or public_chat_id <> paid_channel_id)
      and (paid_chat_id is null or paid_chat_id <> paid_channel_id)
      and (public_channel_id is null or public_chat_id is null or public_channel_id <> public_chat_id)
      and (public_channel_id is null or paid_chat_id is null or public_channel_id <> paid_chat_id)
      and (public_chat_id is null or paid_chat_id is null or public_chat_id <> paid_chat_id)
    ),
  constraint sales_bot_contours_userbot_mode_payload_check
    check (
      (userbot_mode = 'none' and selected_userbot_id is null and selected_userbot_ids = '[]'::jsonb)
      or (userbot_mode = 'single' and selected_userbot_id is not null and selected_userbot_ids = '[]'::jsonb)
      or (userbot_mode = 'pool' and selected_userbot_id is null and jsonb_array_length(selected_userbot_ids) > 0)
    )
);

alter table public.sales_bot_contours
  add column if not exists public_channel_id uuid null references public.channels(id) on delete set null;

alter table public.sales_bot_contours
  add column if not exists paid_chat_id uuid null references public.channels(id) on delete set null;

alter table public.sales_bot_contours
  alter column paid_channel_id drop not null;

create index if not exists sales_bot_contours_owner_idx
  on public.sales_bot_contours (owner_id);

create index if not exists sales_bot_contours_paid_channel_idx
  on public.sales_bot_contours (paid_channel_id);

create index if not exists sales_bot_contours_public_channel_idx
  on public.sales_bot_contours (public_channel_id);

create index if not exists sales_bot_contours_public_chat_idx
  on public.sales_bot_contours (public_chat_id);

create index if not exists sales_bot_contours_paid_chat_idx
  on public.sales_bot_contours (paid_chat_id);

create index if not exists sales_bot_contours_selected_userbot_idx
  on public.sales_bot_contours (selected_userbot_id);

create table if not exists public.sales_bot_contour_rights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  bot_id uuid not null references public.tg_accounts(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  target text not null
    check (target in ('public_channel', 'public_chat', 'paid_channel', 'paid_chat')),
  status text not null default 'unknown',
  admin_status text not null default 'unknown',
  is_admin boolean not null default false,
  can_invite_users boolean not null default false,
  can_restrict_members boolean not null default false,
  can_promote_members boolean not null default false,
  can_manage_chat boolean not null default false,
  warnings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(warnings) = 'array'),
  message text not null default '',
  raw_rights jsonb not null default '{}'::jsonb
    check (jsonb_typeof(raw_rights) = 'object'),
  checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bot_id, target)
);

create index if not exists sales_bot_contour_rights_owner_idx
  on public.sales_bot_contour_rights (owner_id);

create index if not exists sales_bot_contour_rights_channel_idx
  on public.sales_bot_contour_rights (channel_id);
