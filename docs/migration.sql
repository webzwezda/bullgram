-- Добавление новых колонок для поддержки мульти-админов, мультиканальности, кнопок и альбомов

-- 1. Таблица autopost_bots (боты)
ALTER TABLE autopost_bots ADD COLUMN IF NOT EXISTS admin_tg_ids bigint[] DEFAULT '{}';
ALTER TABLE autopost_bots ADD COLUMN IF NOT EXISTS active_modes jsonb DEFAULT '{}';

-- Переносим существующего админа (если он есть) в массив
UPDATE autopost_bots 
SET admin_tg_ids = ARRAY[admin_tg_id] 
WHERE admin_tg_id IS NOT NULL 
  AND (admin_tg_ids IS NULL OR cardinality(admin_tg_ids) = 0);

-- 2. Таблица channels (каналы)
ALTER TABLE channels ADD COLUMN IF NOT EXISTS auto_accept_suggestions boolean DEFAULT false;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS buttons_config jsonb DEFAULT '[]';

-- 3. Таблица autopost_items (очередь постов)
ALTER TABLE autopost_items ADD COLUMN IF NOT EXISTS file_ids text[] DEFAULT '{}';
ALTER TABLE autopost_items ADD COLUMN IF NOT EXISTS target_channel_id bigint;
