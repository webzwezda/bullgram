-- Связки official-бот ↔ юзербот (sales contour, режимы single/pool).
-- Внимание: таблица уже существует в прод-БД (шейп сверен 2026-09-16, миграция применена
-- вне репозитория) — файл добавлен для воспроизводимости окружения с нуля.
-- Код: SalesContourService.loadUserbotBindings / syncUserbotBindings / toggleUserbotBinding,
--      ContourAdminRightsService.ensureAll (ensure-admin), jobs/bot-rights-monitor.job.js.
-- Файл идемпотентный: повторный прогон ничего не меняет.

create table if not exists public.official_bot_userbot_bindings (
  bot_id uuid not null references public.tg_accounts(id) on delete cascade,
  userbot_id uuid not null references public.tg_accounts(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint official_bot_userbot_bindings_pk primary key (bot_id, userbot_id)
);
