create table userbot_peer_cache (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  userbot_id uuid not null,
  tg_user_id text not null,
  access_hash text,
  username text,
  source text,
  seen_at timestamptz default now(),
  unique(userbot_id, tg_user_id)
);

create index idx_userbot_peer_cache_owner on userbot_peer_cache(owner_id);
