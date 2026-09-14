-- Миграция 20260915003000: RLS на broadcast-таблицы.
-- Применена через Supabase MCP (см. supabase_migrations.schema_migrations).
--
-- Зачем: до миграции RLS был выключен при полных грантах anon/authenticated,
-- а фронт читает broadcast_deliveries напрямую из браузера по campaign_id
-- без owner-фильтра — любой залогиненный юзер мог читать чужие доставки
-- (TG ID подписчиков, тексты сообщений и ошибок). Класс утечки тот же,
-- что закрыт миграцией 20260914191000 для кассовых таблиц.
--
-- Кто не затронут:
-- - бэкенд ходит с SUPABASE_SERVICE_KEY (service role, RLS bypass);
-- - фронтовые запросы дополнительно несут .eq('owner_id', user.id) (belt-and-braces).

alter table public.broadcast_campaigns enable row level security;
alter table public.broadcast_deliveries enable row level security;
alter table public.broadcast_preparations enable row level security;
alter table public.broadcast_preparation_items enable row level security;

create policy "broadcast_campaigns_owner"
  on public.broadcast_campaigns
  for all
  using (owner_id = uid())
  with check (owner_id = uid());

create policy "broadcast_deliveries_owner"
  on public.broadcast_deliveries
  for all
  using (owner_id = uid())
  with check (owner_id = uid());

create policy "broadcast_preparations_owner"
  on public.broadcast_preparations
  for all
  using (owner_id = uid())
  with check (owner_id = uid());

create policy "broadcast_preparation_items_owner"
  on public.broadcast_preparation_items
  for all
  using (
    exists (
      select 1 from public.broadcast_preparations p
      where p.id = broadcast_preparation_items.preparation_id
        and p.owner_id = uid()
    )
  )
  with check (
    exists (
      select 1 from public.broadcast_preparations p
      where p.id = broadcast_preparation_items.preparation_id
        and p.owner_id = uid()
    )
  );
