create table if not exists public.project_treasury_withdrawals (
    id uuid primary key default gen_random_uuid(),
    requested_by uuid not null references auth.users(id) on delete cascade,
    to_wallet text not null,
    amount_ton numeric(18,6) not null check (amount_ton > 0),
    network_fee_ton numeric(18,6) not null default 0,
    status text not null default 'requested' check (status in ('requested', 'queued', 'sending', 'sent', 'confirmed', 'failed', 'cancelled')),
    chain_tx_hash text,
    failure_reason text,
    requested_at timestamptz not null default now(),
    sent_at timestamptz,
    confirmed_at timestamptz,
    payload jsonb not null default '{}'::jsonb
);

create index if not exists project_treasury_withdrawals_requested_at_idx
    on public.project_treasury_withdrawals (requested_at desc);

create index if not exists project_treasury_withdrawals_status_idx
    on public.project_treasury_withdrawals (status);

alter table public.project_treasury_withdrawals enable row level security;

drop policy if exists "project_treasury_withdrawals_service_role_all" on public.project_treasury_withdrawals;
create policy "project_treasury_withdrawals_service_role_all"
    on public.project_treasury_withdrawals
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
