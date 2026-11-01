-- Скан «Найти аккаунты для продажи» (account sale scan).
-- Кнопка на карточке «Продажа аккаунтов» запускает фоновый обход всего
-- юзербот-стока платформенного админа, у которого есть restore source
-- (любой runtime_status, включая карантин): живая проверка сессии на месте
-- (тот же код, что у джобы отлёжки), вердикты пишутся в статусы аккаунтов,
-- прогресс и результаты — в строку скана. Результат персистентный: UI
-- показывает последний скан владельца; одновременный скан — один на владельца.
--
-- RLS включён без политик: backend ходит service-role, клиентам таблица не видна.
-- Файл идемпотентный (if not exists), применяется через Supabase MCP.
--
-- lock_timeout не даёт DDL застрять за длинной транзакцией и собрать за собой
-- очередь из всех запросов: лучше упасть быстро и повторить, чем подвесить запись.
set lock_timeout = '10s';

create table if not exists public.account_sale_scans (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null,
    status text not null default 'processing'
        check (status in ('processing', 'completed', 'failed')),
    total int not null default 0,
    processed int not null default 0,
    failed int not null default 0,
    orphans int not null default 0,
    items jsonb not null default '[]'::jsonb,
    error text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.account_sale_scans enable row level security;

create index if not exists account_sale_scans_owner_created_idx
    on public.account_sale_scans (owner_id, created_at desc);

notify pgrst, 'reload schema';

-- ROLLBACK (только если скан продажи сворачивается целиком; теряется журнал
-- сканов — сами аккаунты, restore sources и статусы не тронуты):
-- drop index if exists account_sale_scans_owner_created_idx;
-- drop table if exists public.account_sale_scans;

-- Один активный скан на владельца (ревью sale-scan, P1): частичный уникальный
-- индекс закрывает гонку двух одновременных POST на уровне базы; роут маппит
-- 23505 в 409 «Скан уже идёт». Применён отдельно миграцией 20261029120000.
create unique index if not exists account_sale_scans_owner_active_idx
    on public.account_sale_scans (owner_id)
    where status = 'processing';
