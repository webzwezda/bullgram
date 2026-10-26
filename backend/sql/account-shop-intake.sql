-- Приёмка пачек аккаунтов (account shop intake, Wave 1).
-- Платформенный админ грузит zip/папки с комплектами (<phone>.session + <phone>.json
-- + опционально <phone>/tdata/ + заметка с паролем 2FA). Сервис группирует файлы в
-- пачки, валидирует без Telegram, под каждый аккаунт поднимает managed-прокси и
-- вставляет tg_accounts в safe-mode (runtime_status='pending_activation') с
-- обязательными зашифрованными blob'ами восстановления.
--
-- Что добавляет:
--   userbot_restore_sources: tdata_blob_encrypted / tdata_filename /
--     two_fa_secret_encrypted / intake_batch_id — полные комплекты восстановления;
--   tg_accounts.health_summary — результат последней проверки (статус, spambot,
--     restriction, checked_at) для карточки аккаунта и «отстойника»;
--   account_import_batches — журнал пакетов приёмки (статус, прогресс, items).
--
-- RLS включён без политик: backend ходит service-role, клиентам таблица не видна.
-- Файл идемпотентный (if not exists везде), применяется через Supabase MCP.
--
-- lock_timeout не даёт ALTER на горячих таблицах (tg_accounts) застрять за
-- длинной транзакцией и собрать за собой очередь из всех запросов: лучше упасть
-- быстро и повторить, чем подвесить запись.
set lock_timeout = '10s';

alter table public.userbot_restore_sources
    add column if not exists tdata_blob_encrypted text;
alter table public.userbot_restore_sources
    add column if not exists tdata_filename text;
alter table public.userbot_restore_sources
    add column if not exists two_fa_secret_encrypted text;
alter table public.userbot_restore_sources
    add column if not exists intake_batch_id uuid;

-- Приёмка вставляет restore source до первого getMe: tg_account_id ещё
-- неизвестен и заполняется джобой отлёжки (миграция 20261026204500).
alter table public.userbot_restore_sources
    alter column tg_account_id drop not null;

alter table public.tg_accounts
    add column if not exists health_summary jsonb;

create table if not exists public.account_import_batches (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null,
    status text not null default 'processing'
        check (status in ('processing', 'completed', 'failed')),
    total int not null default 0,
    processed int not null default 0,
    failed int not null default 0,
    items jsonb not null default '[]'::jsonb,
    error text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.account_import_batches enable row level security;

create index if not exists account_import_batches_owner_created_idx
    on public.account_import_batches (owner_id, created_at desc);

-- ROLLBACK (только если Wave 1 сворачивается целиком; теряется журнал пачек
-- и tdata/2FA-блобы, залитые через intake — их пере-залить нечем):
-- drop index if exists account_import_batches_owner_created_idx;
-- drop table if exists public.account_import_batches;
-- alter table public.tg_accounts drop column if exists health_summary;
-- alter table public.userbot_restore_sources
--     drop column if exists tdata_blob_encrypted,
--     drop column if exists tdata_filename,
--     drop column if exists two_fa_secret_encrypted,
--     drop column if exists intake_batch_id;
