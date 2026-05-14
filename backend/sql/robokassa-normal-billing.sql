alter table public.profiles
    add column if not exists normal_started_at timestamptz,
    add column if not exists normal_ends_at timestamptz;

create sequence if not exists public.billing_order_inv_id_seq
    start with 100000
    increment by 1;

create table if not exists public.billing_orders (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    plan_code text not null,
    status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'expired')),
    amount_rub numeric(12,2) not null check (amount_rub > 0),
    currency text not null default 'RUB',
    duration_days integer not null default 30 check (duration_days > 0),
    provider text not null default 'robokassa',
    provider_invoice_id text not null unique default nextval('public.billing_order_inv_id_seq'::regclass)::text,
    provider_payment_id text,
    payment_url text,
    paid_at timestamptz,
    expires_at timestamptz,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists billing_orders_owner_status_idx
    on public.billing_orders (owner_id, status);

create index if not exists billing_orders_provider_invoice_idx
    on public.billing_orders (provider, provider_invoice_id);

create index if not exists billing_orders_created_idx
    on public.billing_orders (created_at desc);

alter table public.billing_orders enable row level security;

drop policy if exists "billing_orders_service_role_all" on public.billing_orders;
create policy "billing_orders_service_role_all"
    on public.billing_orders
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');

create table if not exists public.billing_events (
    id uuid primary key default gen_random_uuid(),
    billing_order_id uuid references public.billing_orders(id) on delete set null,
    owner_id uuid references auth.users(id) on delete set null,
    event_type text not null,
    provider text not null default 'robokassa',
    provider_invoice_id text,
    amount_rub numeric(12,2),
    signature_valid boolean,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists billing_events_order_idx
    on public.billing_events (billing_order_id, created_at desc);

create index if not exists billing_events_owner_idx
    on public.billing_events (owner_id, created_at desc);

create index if not exists billing_events_provider_invoice_idx
    on public.billing_events (provider, provider_invoice_id);

alter table public.billing_events enable row level security;

drop policy if exists "billing_events_service_role_all" on public.billing_events;
create policy "billing_events_service_role_all"
    on public.billing_events
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
