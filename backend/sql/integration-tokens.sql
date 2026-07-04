create table if not exists public.integration_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  purpose text not null,
  scopes text[] not null default '{}',
  token_prefix text not null,
  token_hint text not null,
  token_hash text not null unique,
  token_encrypted text not null,
  metadata jsonb not null default '{}',
  last_used_at timestamptz null,
  last_used_ip text null,
  revoked_at timestamptz null,
  revoked_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_tokens_purpose_check
    check (purpose in ('mcp', 'api', 'custom'))
);

create index if not exists integration_tokens_owner_idx
  on public.integration_tokens (owner_id, created_at desc);

create index if not exists integration_tokens_active_purpose_idx
  on public.integration_tokens (owner_id, purpose)
  where revoked_at is null;

create index if not exists integration_tokens_scopes_idx
  on public.integration_tokens using gin (scopes);
