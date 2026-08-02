-- Базы клиентов: пользовательские кураторские списки.
-- Не путать с customer_bases — те синкаются юзерботом из каналов (это audience snapshots).
-- client_bases: пользователь создаёт сам, отфильтровав аудиторию. Персистентный список.

create table if not exists public.client_bases (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    description text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.client_base_members (
    id uuid primary key default gen_random_uuid(),
    base_id uuid not null references public.client_bases(id) on delete cascade,
    owner_id uuid not null references auth.users(id) on delete cascade,
    tg_user_id text not null,
    username text,
    display_name text,
    source text not null default 'manual' check (source in ('manual', 'copied', 'imported')),
    added_at timestamptz not null default now(),
    unique (base_id, tg_user_id)
);

create index if not exists client_bases_owner_idx on public.client_bases(owner_id);
create index if not exists client_base_members_base_idx on public.client_base_members(base_id);
create index if not exists client_base_members_owner_idx on public.client_base_members(owner_id);
create index if not exists client_base_members_tg_user_idx on public.client_base_members(tg_user_id);

alter table public.client_bases enable row level security;
alter table public.client_base_members enable row level security;

drop policy if exists "client_bases_select_own" on public.client_bases;
create policy "client_bases_select_own"
    on public.client_bases for select to authenticated
    using (owner_id = auth.uid());

drop policy if exists "client_bases_insert_own" on public.client_bases;
create policy "client_bases_insert_own"
    on public.client_bases for insert to authenticated
    with check (owner_id = auth.uid());

drop policy if exists "client_bases_update_own" on public.client_bases;
create policy "client_bases_update_own"
    on public.client_bases for update to authenticated
    using (owner_id = auth.uid())
    with check (owner_id = auth.uid());

drop policy if exists "client_bases_delete_own" on public.client_bases;
create policy "client_bases_delete_own"
    on public.client_bases for delete to authenticated
    using (owner_id = auth.uid());

drop policy if exists "client_base_members_select_own" on public.client_base_members;
create policy "client_base_members_select_own"
    on public.client_base_members for select to authenticated
    using (owner_id = auth.uid());

drop policy if exists "client_base_members_insert_own" on public.client_base_members;
create policy "client_base_members_insert_own"
    on public.client_base_members for insert to authenticated
    with check (owner_id = auth.uid());

drop policy if exists "client_base_members_update_own" on public.client_base_members;
create policy "client_base_members_update_own"
    on public.client_base_members for update to authenticated
    using (owner_id = auth.uid())
    with check (owner_id = auth.uid());

drop policy if exists "client_base_members_delete_own" on public.client_base_members;
create policy "client_base_members_delete_own"
    on public.client_base_members for delete to authenticated
    using (owner_id = auth.uid());
