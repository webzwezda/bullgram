-- One-shot: перенос кастомных баз без каналов из customer_bases → client_bases.
-- Запускать ПОСЛЕ применения client-bases.sql.
--
-- Перед запуском проверить сколько orphans:
--   select count(*) from public.customer_bases b
--   where not exists (select 1 from public.customer_base_channels bc where bc.base_id = b.id);
--
-- После запуска:
--   orphans появляются в client_bases и доступны через новый UI (после Phase 2 frontend rewrite).
--   В customer_bases остаются (закомментированный DELETE не запускаем автоматически).

begin;

insert into public.client_bases (id, owner_id, name, description, created_at, updated_at)
select
    b.id,
    b.owner_id,
    b.name,
    b.description,
    coalesce(b.created_at, now()),
    coalesce(b.updated_at, now())
from public.customer_bases b
where not exists (
    select 1 from public.customer_base_channels bc where bc.base_id = b.id
)
on conflict (id) do nothing;

-- В customer_base_members нет колонки source (только created_at, не added_at).
-- Все члены orphan-баз — добавлены руками (orphan = нет канала → не было синка).
insert into public.client_base_members (base_id, owner_id, tg_user_id, username, display_name, source, added_at)
select
    m.base_id,
    m.owner_id,
    m.tg_user_id::text,
    m.username,
    m.display_name,
    'manual',
    coalesce(m.created_at, m.updated_at, now())
from public.customer_base_members m
where not exists (
    select 1 from public.customer_base_channels bc where bc.base_id = m.base_id
)
on conflict (base_id, tg_user_id) do nothing;

-- Опционально (после визуальной проверки): удалить orphans из customer_bases.
-- Раскомментировать и запустить отдельно если хочется очистить старую таблицу.
--
-- delete from public.customer_base_members where base_id in (
--     select b.id from public.customer_bases b
--     where not exists (select 1 from public.customer_base_channels bc where bc.base_id = b.id)
-- );
-- delete from public.customer_bases where not exists (
--     select 1 from public.customer_base_channels bc where bc.base_id = customer_bases.id
-- );

commit;
