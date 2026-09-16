-- Миграция 20260917120000: broadcast_preparation_joins
-- Факт join'а юзербота в целевую группу ради подготовки рассылки.
-- Источник истины для «выйти по окончанию рассылки»: cleanup трогает только строки,
-- записанные phaseJoin; свои чаты владельца и контурные слоты помечаются skipped_protected.
-- Подробнее: docs/plans/2026-09-17-broadcast-membership-cleanup.md

create table if not exists public.broadcast_preparation_joins (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null,
    preparation_id uuid not null,
    userbot_id uuid not null,
    tg_chat_id text not null,
    chat_title text,
    granted_admin boolean not null default false,
    joined_at timestamptz not null default now(),
    removed_at timestamptz,
    remove_status text check (remove_status in ('left', 'kicked', 'failed', 'skipped_protected', 'skipped_restricted')),
    remove_error text
);

create index if not exists broadcast_preparation_joins_preparation
    on public.broadcast_preparation_joins (preparation_id);

create index if not exists broadcast_preparation_joins_pending
    on public.broadcast_preparation_joins (owner_id, removed_at)
    where removed_at is null;

alter table public.broadcast_preparation_joins enable row level security;

drop policy if exists broadcast_preparation_joins_owner_all on public.broadcast_preparation_joins;
create policy broadcast_preparation_joins_owner_all on public.broadcast_preparation_joins
    for all to authenticated
    using (owner_id = auth.uid())
    with check (owner_id = auth.uid());
