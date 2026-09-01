-- Заявки на доступ к сайту (режим Normal, без юзерботов и прокси).
-- Публичная форма на сайте /access-request/ создаёт запись,
-- уведомление уходит админу в Telegram.

create table if not exists public.access_requests (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    contact text not null,
    note text,
    status text not null default 'new' check (status in ('new', 'contacted', 'granted', 'rejected')),
    created_at timestamptz not null default now()
);

create index if not exists access_requests_created_idx
    on public.access_requests (created_at desc);

alter table public.access_requests enable row level security;

drop policy if exists "access_requests_service_role_all" on public.access_requests;
create policy "access_requests_service_role_all"
    on public.access_requests
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
