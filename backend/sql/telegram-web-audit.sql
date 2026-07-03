-- telegram_web_audit: audit trail for the MTProto bridge used by /app/telegram-web
-- Records every bridge token issuance + every WS connection open/close + errors.
-- Used by the ops dashboard (Phase 6) and as forensic evidence in case of account issues.

create table if not exists public.telegram_web_audit (
    id bigserial primary key,
    admin_id uuid not null references auth.users(id) on delete cascade,
    userbot_id uuid not null references public.tg_accounts(id) on delete cascade,
    action text not null check (
        action in ('session_issued', 'bridge_opened', 'bridge_closed', 'token_expired', 'bridge_error')
    ),
    dc_id smallint,
    bytes_in bigint not null default 0,
    bytes_out bigint not null default 0,
    duration_ms bigint,
    error_code smallint,
    error_message text,
    admin_ip text,
    user_agent text,
    proxy_used text,
    created_at timestamptz not null default now()
);

-- Idempotent column add for existing installs created before proxy_used.
do $$
begin
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'telegram_web_audit'
          and column_name = 'proxy_used'
    ) then
        alter table public.telegram_web_audit
            add column proxy_used text;
    end if;
end $$;

create index if not exists idx_telegram_web_audit_admin
    on public.telegram_web_audit(admin_id, created_at desc);

create index if not exists idx_telegram_web_audit_userbot
    on public.telegram_web_audit(userbot_id, created_at desc);

create index if not exists idx_telegram_web_audit_action
    on public.telegram_web_audit(action, created_at desc);
