-- Миграция 20260917150000 (применена через Supabase MCP 2026-09-17).
-- SQL-копия по конвенции backend/sql/ — схема не должна жить только в проде.
-- Чек-листы автопостера: интерактивные списки в чатах с состоянием в БД.
-- План: docs/plans/2026-09-17-autopost-checklists.md

create table if not exists public.autopost_checklists (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null,
    bot_id uuid not null references public.autopost_bots(id) on delete cascade,
    title text not null default '',
    created_by text not null default 'agent',
    expires_at timestamptz,
    cancelled_at timestamptz,
    dedup_key text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.autopost_checklist_items (
    id uuid primary key default gen_random_uuid(),
    checklist_id uuid not null references public.autopost_checklists(id) on delete cascade,
    bot_id uuid not null,
    text text not null,
    position integer not null default 0,
    is_checked boolean not null default false,
    checked_by_tg_id bigint,
    checked_by_name text,
    checked_at timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists public.autopost_checklist_events (
    id bigserial primary key,
    checklist_id uuid not null references public.autopost_checklists(id) on delete cascade,
    item_id uuid,
    action text not null,
    actor_source text not null,
    actor_tg_id bigint,
    actor_name text,
    chat_id bigint,
    created_at timestamptz not null default now()
);

create unique index if not exists autopost_checklists_bot_dedup_uidx
    on public.autopost_checklists (bot_id, dedup_key) where dedup_key is not null;
create index if not exists autopost_checklists_owner_created_idx
    on public.autopost_checklists (owner_id, created_at desc);
create index if not exists autopost_checklist_items_checklist_pos_idx
    on public.autopost_checklist_items (checklist_id, position);
create index if not exists autopost_checklist_events_checklist_idx
    on public.autopost_checklist_events (checklist_id, created_at desc);

alter table public.autopost_items
    add column if not exists checklist_id uuid references public.autopost_checklists(id) on delete cascade;
create index if not exists autopost_items_checklist_idx on public.autopost_items (checklist_id);

-- updated_at: функция set_updated_at() уже существует в проде (см. autopost_items)
create trigger set_updated_at_autopost_checklists
    before update on public.autopost_checklists
    for each row execute function set_updated_at();

-- RLS: админка и realtime ходят юзерским токеном
alter table public.autopost_checklists enable row level security;
alter table public.autopost_checklist_items enable row level security;
alter table public.autopost_checklist_events enable row level security;

create policy autopost_checklists_owner on public.autopost_checklists
    for all to public using (owner_id = uid());

create policy autopost_checklist_items_owner on public.autopost_checklist_items
    for all to public using (bot_id in (select id from public.autopost_bots where owner_id = uid()));

create policy autopost_checklist_events_owner on public.autopost_checklist_events
    for all to public using (checklist_id in (select id from public.autopost_checklists where owner_id = uid()));

-- RPC атомарного тоггла: advisory-лок по чек-листу + событие + свежие items одним вызовом.
-- Серверные проверки отмены/истечения — внутри RPC (хендлер-проверки только для тостов).
create or replace function public.autopost_toggle_checklist_item(
    p_item_id uuid,
    p_actor_tg_id bigint,
    p_actor_name text,
    p_chat_id bigint
)
returns jsonb
language plpgsql
as $$
declare
    v_checklist_id uuid;
    v_item public.autopost_checklist_items;
    v_checklist public.autopost_checklists;
    v_checked boolean;
begin
    select checklist_id into v_checklist_id
      from public.autopost_checklist_items
     where id = p_item_id;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('cli:' || v_checklist_id::text));

    select * into v_item from public.autopost_checklist_items where id = p_item_id;

    select * into v_checklist from public.autopost_checklists where id = v_checklist_id;
    if v_checklist.cancelled_at is not null then
        return jsonb_build_object('ok', false, 'reason', 'cancelled');
    end if;
    if v_checklist.expires_at is not null and v_checklist.expires_at < now() then
        return jsonb_build_object('ok', false, 'reason', 'expired');
    end if;

    v_checked := not v_item.is_checked;

    update public.autopost_checklist_items
       set is_checked = v_checked,
           checked_by_tg_id = case when v_item.is_checked then null else p_actor_tg_id end,
           checked_by_name = case when v_item.is_checked then null else left(p_actor_name, 100) end,
           checked_at = case when v_item.is_checked then null else now() end
     where id = p_item_id;

    insert into public.autopost_checklist_events
        (checklist_id, item_id, action, actor_source, actor_tg_id, actor_name, chat_id)
    values
        (v_checklist_id, p_item_id,
         case when v_checked then 'checked' else 'unchecked' end,
         'telegram', p_actor_tg_id, left(p_actor_name, 100), p_chat_id);

    return jsonb_build_object(
        'ok', true,
        'action', case when v_checked then 'checked' else 'unchecked' end,
        'items', (
            select coalesce(jsonb_agg(jsonb_build_object(
                       'id', t.id,
                       'text', t.text,
                       'position', t.position,
                       'is_checked', t.is_checked,
                       'checked_by_tg_id', t.checked_by_tg_id,
                       'checked_by_name', t.checked_by_name,
                       'checked_at', t.checked_at
                   ) order by t.position), '[]'::jsonb)
            from public.autopost_checklist_items t
            where t.checklist_id = v_checklist_id
        )
    );
end;
$$;

-- Бэкенд зовёт RPC сервисным ключом; публичный вызов под любым JWT запрещён
revoke execute on function public.autopost_toggle_checklist_item(uuid, bigint, text, bigint) from public;
revoke execute on function public.autopost_toggle_checklist_item(uuid, bigint, text, bigint) from anon;
revoke execute on function public.autopost_toggle_checklist_item(uuid, bigint, text, bigint) from authenticated;
grant execute on function public.autopost_toggle_checklist_item(uuid, bigint, text, bigint) to service_role;

-- Realtime для админки
alter publication supabase_realtime add table public.autopost_checklists;
alter publication supabase_realtime add table public.autopost_checklist_items;
alter publication supabase_realtime add table public.autopost_checklist_events;
