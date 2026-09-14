-- Миграция 20260914191000: RLS на tariffs / tariff_bundle_items / invoices.
-- Применена через Supabase MCP (см. supabase_migrations.schema_migrations).
--
-- Зачем: admin-v2 («Касса» /billing и переиспользуемый TariffsSection на
-- /userbots) читает и пишет эти таблицы напрямую anon-клиентом supabase-js.
-- До миграции RLS был выключен, а у anon/authenticated были полные гранты
-- (вплоть до DELETE/TRUNCATE): любой залогиненный юзер видел и мог менять
-- чужие тарифы и инвойсы (подтверждено на живом проде: аккаунт A видел
-- тарифы аккаунта B как свои).
--
-- Кто не затронут:
-- - бэкенд ходит с SUPABASE_SERVICE_KEY (service role, RLS bypass);
-- - site-v2 эти таблицы напрямую не читает (проверено grep по site-v2/src);
-- - публичный чекаут идёт через бэкенд-роуты (public_invoices, invoice-public).
--
-- Инвойсы с tariff_id is null (легаси-RUB 2026-06, сироты удалённого
-- тестового тарифа) становятся невидимы для owner-UI сознательно.

alter table public.tariffs enable row level security;
alter table public.tariff_bundle_items enable row level security;
alter table public.invoices enable row level security;

create policy "tariffs_owner"
  on public.tariffs
  for all
  using (owner_id = uid())
  with check (owner_id = uid());

create policy "tariff_bundle_items_owner"
  on public.tariff_bundle_items
  for all
  using (owner_id = uid())
  with check (owner_id = uid());

-- invoices не имеет owner_id: владелец определяется через тариф
-- (тот же путь, которым бэкенд-роуты скоупят инвойсы через .in('tariff_id', ...)).
create policy "invoices_owner"
  on public.invoices
  for all
  using (
    exists (
      select 1 from public.tariffs t
      where t.id = invoices.tariff_id and t.owner_id = uid()
    )
  )
  with check (
    exists (
      select 1 from public.tariffs t
      where t.id = invoices.tariff_id and t.owner_id = uid()
    )
  );
