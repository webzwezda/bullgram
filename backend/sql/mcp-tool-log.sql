-- MCP & REST audit log shared between transports.
-- Plan 01 Migration 1 / Plan 02 uses the same table.
-- token_id is nullable: legacy tools (bullgram_proxy_*) still accept JWT,
-- and audit rows must persist even when auth kind = 'user_token'.
-- auth_kind is NOT NULL so we always know how the caller authenticated.

create table if not exists public.mcp_tool_log (
  id              bigserial primary key,
  token_id        uuid references public.integration_tokens(id) on delete set null,
  auth_kind       text not null check (auth_kind in ('integration_token','user_token','agent_token')),
  owner_id        uuid not null,
  operation_name  text not null,
  source          text not null check (source in ('mcp','rest')),
  userbot_id      uuid,
  chat_id         text,
  arguments_hash  text,
  latency_ms      integer,
  status          text not null check (status in (
    'success','error','rate_limited','insufficient_scope',
    'forbidden_account','safe_mode_blocked','account_restricted',
    'integration_token_required','telegram_error'
  )),
  error_code      text,
  error_message   text,
  telegram_error_event_id bigint,
  request_ip      text,
  user_agent      text,
  request_id      text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index if not exists mcp_tool_log_token_idx
  on public.mcp_tool_log (token_id, started_at desc);

create index if not exists mcp_tool_log_owner_idx
  on public.mcp_tool_log (owner_id, started_at desc);

create index if not exists mcp_tool_log_userbot_idx
  on public.mcp_tool_log (userbot_id, started_at desc);

create index if not exists mcp_tool_log_status_started_idx
  on public.mcp_tool_log (status, started_at desc);

create index if not exists mcp_tool_log_request_id_idx
  on public.mcp_tool_log (request_id);
