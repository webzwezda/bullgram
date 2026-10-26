-- Выдача аккаунт-лотов (account shop delivery, Wave 2).
-- Магазин аккаунтов: два режима выдачи после оплаты TON.
--   files  — анонимный покупатель: архив аккаунта (.session + .json + tdata +
--            пароль 2FA + README) качается с публичной страницы покупки по
--            квоте (SHOP_FILES_MAX_DOWNLOADS) в окне
--            (SHOP_FILES_DOWNLOAD_WINDOW_HOURS); наша копия аккаунта
--            (tg_account + restore source + прокси) после окна удаляется
--            джобой sold-files-purge;
--   hybrid — покупатель под JWT: аккаунт + прокси передаются покупателю
--            (смена owner_id, приходит в кабинет в safe-mode), архив остаётся
--            доступным бессрочно — это данные покупателя, пуржа нет;
--   transfer — легаси-поведение: только передача прав, без файловой выдачи.
--
-- Что добавляет:
--   shop_items.delivery_mode — режим выдачи аккаунт-лота ('files'|'hybrid'|
--     'transfer'); null = легаси-поведение (только передача прав);
--   shop_purchases.delivered_at — момент фактической выдачи (штампуется при
--     зачёте оплаты); от него считается окно скачивания для pуржа «в файлы»;
--   partial index по delivered_at — джоба пуржа и public-view ищут только
--     выданные покупки.
--
-- shop_purchases.buyer_owner_id уже nullable (Wave 1), FK на нём нет — не трогаем.
-- Файл идемпотентный (if not exists везде), применяется через Supabase MCP.
--
-- lock_timeout не даёт ALTER на горячих таблицах застрять за длинной
-- транзакцией и собрать за собой очередь из всех запросов: лучше упасть
-- быстро и повторить, чем подвесить запись.
set lock_timeout = '10s';

alter table public.shop_items
    add column if not exists delivery_mode text;

alter table public.shop_purchases
    add column if not exists delivered_at timestamptz;

create index if not exists shop_purchases_files_delivery_idx
    on public.shop_purchases (delivered_at)
    where delivered_at is not null;

notify pgrst, 'reload schema';

-- ROLLBACK (только если Wave 2 сворачивается целиком; история выдач
-- теряется вместе с колонкой):
-- drop index if exists shop_purchases_files_delivery_idx;
-- alter table public.shop_purchases drop column if exists delivered_at;
-- alter table public.shop_items drop column if exists delivery_mode;
