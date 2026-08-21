-- Тарифы Trial + Pro: переименование normal→pro и счётчик запросов API/MCP.
-- Применять строго перед деплоем бэкенда с переименованием.

-- 1. Колонки профиля: normal_* → pro_*
alter table public.profiles
  rename column normal_started_at to pro_started_at;
alter table public.profiles
  rename column normal_ends_at to pro_ends_at;

update public.profiles
  set product_tier = 'pro'
  where product_tier = 'normal';

-- 2. Счётчик запросов API/MCP для Trial
create table if not exists public.api_usage_monthly (
  owner_id uuid not null references auth.users(id) on delete cascade,
  month text not null,
  calls_count integer not null default 0,
  primary key (owner_id, month)
);

-- Атомарный consume: возвращает новый счётчик, или -N когда лимит исчерпан
-- (заблокированный вызов не расходует лимит).
create or replace function public.api_usage_try_consume(
  p_owner_id uuid,
  p_month text,
  p_limit integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select calls_count into v_count
  from public.api_usage_monthly
  where owner_id = p_owner_id and month = p_month
  for update;

  if v_count is null then
    insert into public.api_usage_monthly (owner_id, month, calls_count)
    values (p_owner_id, p_month, 1)
    on conflict (owner_id, month) do nothing;
    return 1;
  end if;

  if v_count >= p_limit then
    return -v_count;
  end if;

  update public.api_usage_monthly
  set calls_count = calls_count + 1
  where owner_id = p_owner_id and month = p_month;

  return v_count + 1;
end;
$$;
