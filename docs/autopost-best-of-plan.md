# 🏆 Лучшее — план реализации

Модуль автопостера для подсчёта Telegram-реакций и автоматической компиляции топ-контента.

## Суть

Подписчики ставят **нативные реакции** (👍❤️🔥). Бот слушает `message_reaction` апдейты, кэширует `reaction_total` на каждом посте. Админ жмёт кнопку → бот компонует top-10 за месяц и публикует в активный канал.

**Цели:**
- Бесплатный контент на "медленные дни" (перепаковка старого)
- Retention платящих (monthly best-of в приват)
- Marketing magnet (monthly best-of в публичный)
- Сигнал админу что заходит

---

## Что в v1 (Фазы 1+2) — committed

### Фаза 1 — MVP (1-2 дня)

**Возможности:**
- Под постами ничего визуально не меняется — нативные реакции Telegram
- Бот считает `reaction_total` (уникальные юзеры, отреагировавшие) на каждый пост
- Админ-кнопка `🏆 Лучшее` в главном меню
- Подменю: "Опубликовать топ-10 за текущий месяц" / "Предпросмотр"
- Best-of = фото-альбом из топ-10 (видео/гифки пока исключаются)

**Реализация:**

1. **Миграция БД** (через Supabase MCP):
   ```sql
   ALTER TABLE autopost_items 
     ADD COLUMN posted_message_ids BIGINT[] DEFAULT '{}',
     ADD COLUMN reaction_total INTEGER NOT NULL DEFAULT 0;

   CREATE INDEX autopost_items_bestof_idx
     ON autopost_items(bot_id, target_channel_id, created_at DESC, reaction_total DESC)
     WHERE reaction_total > 0;

   CREATE INDEX autopost_items_by_message_idx
     ON autopost_items USING GIN (posted_message_ids);
   ```

2. **`bot-lifecycle.js`** — `allowed_updates: [..., 'message_reaction', 'chat_member']`

3. **`autopost.service.js`** — новый метод `publishItem(bot, item, channel, botUsername)`:
   - Вызывает `sendItemToChannel`, получает message_ids
   - UPDATE autopost_items SET status='posted', posted_at=NOW(), posted_message_ids=$ids
   - Вызывается из scheduler / post_now / sug_post_now (устраняет дубликацию)

4. **`handlers/reactions.js`** (новый) — `bot.on('message_reaction', ...)`:
   - Дельта-логика: +1 если new_reaction non-empty и old empty; -1 если наоборот; 0 при замене
   - `UPDATE autopost_items SET reaction_total = GREATEST(0, reaction_total + delta) WHERE posted_message_ids @> ARRAY[messageId]::bigint[]`

5. **`services/autopost/best-of.js`** (новый):
   - `composeBestOfMonth(supabase, botId, channelId, year, month)` → топ-10 постов
   - `publishBestOf(bot, targetChatId, items, { year, month })` → заголовок + фото-альбом + футер

6. **`handlers/best-of-callbacks.js`** (новый) — `bot.action(/bestof:(pub|prev):(\d{4})-(\d{2})/, ...)`:
   - Берёт активный канал из `active_modes`
   - composeBestOfMonth → publishBestOf (в канал для pub, в чат админа для prev)

7. **`handlers/admin-commands.js`** — `bot.hears('🏆 Лучшее', ...)`:
   - Inline-кнопки "📊 Опубликовать топ-10 за {месяц}" / "👁 Предпросмотр"

8. **`keyboard.js`** — добавить `🏆 Лучшее` в `getAdminKeyboard`:
   ```
   [🔄 Направление: ...]
   [➕ Добавить пост]  [📋 Очередь]
   [📥 Предложки]      [🏆 Лучшее]
   ```

9. **`handlers/index.js`** — зарегистрировать reactions + best-of-callbacks

10. **Рефакторинг 3 callers** на `service.publishItem()`:
    - `autopost-scheduler.job.js`
    - `handlers/queue-callbacks.js` (post_now)
    - `handlers/suggestion-callbacks.js` (sug_post_now)

**Тесты:**
- `test-autopost-reactions.js` — unit на delta-логику
- `test-autopost-bestof.js` — unit на composeBestOfMonth (фильтр по месяцу, сортировка, limit)

**Ограничения Фазы 1:**
- ❌ Существующие посты (опубликованные ДО запуска) — `reaction_total = 0`, в best-of не попадают. Backfill невозможен (Bot API 7.2 убрал getMessageReactions)
- ❌ Видео/гифки в best-of исключаются
- ❌ Только текущий месяц (нет календаря)
- ❌ Границы месяца по UTC, не по таймзоне канала
- ❌ Только ручная публикация админом

### Фаза 2 — Календарь и медиа-типы (1 неделя)

- **Календарь:** inline-кнопки с месяцами где есть данные. Клик → top-10 за выбранный месяц в чат админа
- **Видео/гифки в best-of:** группировка по `media_type`, множественные альбомы в одной подборке
- **Таймзона канала:** границы месяца по `channels.timezone` (Asia/Vladivostok)
- **Предпросмотр перед публикацией:** приходит альбом + inline-кнопки "Опубликовать / Отмена" (сейчас preview просто дублирует альбом в чат админа)

---

## Что в v2 (Фаза 3) — confirmed, после эксплуатации v1

### Фаза 3 — Юзерский просмотр архива

Подписчик (или сам админ как читатель) может листать best-of через бота.

**Подход:**
- Deep-link `?start=best_CHANNELID` из закрепа канала
- После `/start` если юзер не админ → юзерская клавиатура:
  - `🏆 Лучшее за текущий месяц`
  - `📅 Архив по месяцам`
  - `ℹ️ О канале`
- Архив → inline-кнопки месяцев с count'ами → top-10 выбранного месяца в чат
- Источник канала запоминается через guest_session (аналогично suggest_ch флоу)

**Per-channel scope** — юзер видит best-of именно того канала, из которого пришёл, не микс со всей сетки.

---

## Что после (Фазы 4-5) — re-evaluate

Решение принимаем после 3-4 недель эксплуатации v1+v2 с реальными данными.

### Фаза 4 — Showcase + auto-publish (только если есть сетка)

- Флаг `is_showcase` на channels
- Cron еженедельно: top-3 из всех каналов сетки → пост в showcase
- Cron 1-го числа: авто-публикация best-of во все каналы (если админ не выключил)

**Условие для фазы:** 3+ активных канала у админа, и реальный кейс для aggregator-канала.

### Фаза 5 — Аналитический дашборд

Раздел в `/app/autopost/analytics`:
- Графики вовлечённости (реакции по дням/часам/типам)
- Топ-3 поста недели дайджестом админу в личку
- Конверсия "пост попал в best-of" → "дополнительные подписки"

**Условие для фазы:** достаточно данных (50k+ реакций в месяц), и реальная потребность в аналитике для решений.

---

## Архитектурные принципы

1. **Per-channel scope** — все запросы best-of фильтруют по `target_channel_id`. Сетка из N каналов работает без изменений.
2. **Native reactions, no inline buttons** — UX привычный, вовлечённость 5-10x выше
3. **Delta-update, no full recount** — на каждый `message_reaction` event делаем `+= delta` в БД. No batch jobs, no cron для подсчёта
4. **No backfill for existing posts** — Bot API не даёт запрашивать реакции ретроспективно. Считаем свежие посты с момента деплоя
5. **No detail reactions table** — Telegram уже хранит данные, мы кэшируем только total. GDPR-чисто
6. **`posted_message_ids BIGINT[]`** — массив (для альбомов несколько сообщений). GIN-индекс для lookup'а по message_id
7. **Multi-tenant готов** — `bot_id` в индексе, изоляция данных бесплатная

## Edge cases

| Кейс | Решение |
|---|---|
| Пост отредактировали | `reaction_total` сохраняется (Telegram не сбрасывает реакции при edit) |
| Пост удалили из канала | events перестают приходить, total остаётся как есть |
| Пост без реакций | `WHERE reaction_total > 0` исключает |
| Меньше 10 постов с реакциями | Публикуем что есть, заголовок "Топ-N за месяц" |
| Текущий месяц ещё идёт | Label "...(по состоянию на {date})" |
| Альбом (media_group_id) | Все message_ids сохраняются в массив, реакции суммируются по совокупности |
| Текст-пост (без медиа) | Исключаем из best-of в Фазе 1 |
| Бот пропустил event (рестарт) | `reaction_total` может слегка дрейфить. Приемлемо для best-of |
| Админ в активной_modes не выбран | fallback на `channels[0]` (как везде) |

## Масштабирование

| Уровень | Админы | Постов/день | Reaction events/день | Нагрузка |
|---|---|---|---|---|
| Старт | 1-10 | 4-40 | ~100-1000 | тривиально |
| Средний | 100 | 400 | ~10k | тривиально |
| Зрелый | 1000 | 4000 | ~100k | норм для Postgres |

Партиционировать `autopost_items` по месяцам — только при достижении зрелого уровня (1000 админов). До этого стандартных индексов достаточно.

## Метрики успеха (после v1)

- % постов с `reaction_total > 0` (target: >70% после раскачки)
- Среднее `reaction_total` на пост (baseline → рост после фичи)
- Число предпросмотров best-of админом в месяц (target: >2)
- Число публикаций best-of в месяц (target: 1-2 на канал)

## Порядок реализации Фазы 1

1. Миграция БД через Supabase MCP
2. `bot-lifecycle.js` — allowed_updates
3. `autopost.service.js` — `publishItem()` helper + reaction helpers
4. Рефакторинг 3 callers на `publishItem()`
5. `handlers/reactions.js` — приём message_reaction + delta-update
6. `services/autopost/best-of.js` — composer
7. `handlers/best-of-callbacks.js` — pub/preview
8. `handlers/admin-commands.js` — кнопка 🏆 Лучшее + handler
9. `keyboard.js` — добавить кнопку в главное меню
10. `handlers/index.js` — регистрация новых handlers
11. Тесты на delta-логику и best-of запрос
12. Деплой + smoke test в реальном боте

**Оценка:** 1-2 рабочих дня. 4 новых файла, 7 модифицированных, 1 миграция.
