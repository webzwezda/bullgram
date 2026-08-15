create table broadcast_preparations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  audience_type text not null,
  channel_id uuid,
  base_id uuid,
  manual_tg_user_ids jsonb default '[]',
  base_filter text default 'all_members',
  userbot_ids jsonb not null default '[]',
  external_targets jsonb default '[]',
  status text not null default 'pending',
  phase_detail jsonb default '{}',
  stats jsonb default '{}',
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table broadcast_preparation_items (
  id uuid primary key default gen_random_uuid(),
  preparation_id uuid not null references broadcast_preparations(id) on delete cascade,
  tg_user_id text not null,
  username text,
  display_name text,
  reachable_by jsonb default '[]',
  status text default 'unknown',
  last_error text,
  unique(preparation_id, tg_user_id)
);

create table userbot_join_log (
  id uuid primary key default gen_random_uuid(),
  userbot_id uuid not null,
  target text not null,
  created_at timestamptz default now()
);

create index idx_broadcast_prep_owner on broadcast_preparations(owner_id, created_at desc);
create index idx_broadcast_prep_items_prep on broadcast_preparation_items(preparation_id);
create index idx_userbot_join_log_userbot on userbot_join_log(userbot_id, created_at desc);
