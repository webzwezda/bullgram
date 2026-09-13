# Retention: закрытие бэклага код-ревью (2026-09-14)

Ревью фичи `/app/retention` (code-reviewer сабагент + верификация прод-БД через Supabase MCP) дало вердикт REQUEST_CHANGES. Здесь — решения и статус.

## Решения

- **P0 «напоминание один раз на жизнь подписки»** → новая колонка `subscriptions.last_reminder_sent_at timestamptz`. Условие отправки: `expires_at` в окне [now, now+24h] И (`last_reminder_sent_at` IS NULL OR < now−24h). Продления (in-place) трогать не нужно — джоба самокорректируется. `expiry_reminder_sent` после депоя дропнуть (в коде больше не используется, во фронте не встречается — проверено grep).
- **P1 «флаг до отправки»** → `last_reminder_sent_at` ставится только по финальному исходу: доставлено (бот или юзербот) либо дефинитивный скип (бот заблокирован, фолбэк выключен). Транзиентные ошибки (сеть/таймаут) не маркируют — ретрай следующим тиком. Parse-ошибка Markdown → ретрай plain-text (счистить `*_`[]()~`>#+-=|{}.!`) вместо классификации «бот заблокирован».
- **P1 «кросс-овнер тарифов»** → в retention.job запросы инвойсов/upsell-тарифа скоупятся `tariffs.owner_id = ownerId` (паритет с browse-followup `tariffs!inner(owner_id)`); второй слой — проверка владельца тарифа в `buy_`-хендлере start.handler.js.
- **P2 RLS** → включить RLS + owner-политики на `subscriptions` (EXISTS через channels), `access_events`, `sales_bot_contours`, `payment_settings`. Бэкенд на service-ключе — не затронут; site-v2 эти таблицы напрямую не читает (проверено).
- **P2 re-entrancy** → guard `running` на тике крона.
- **P2 UI-предупреждение** → в блок «Помощник-юзербот» добавить текст про общий чат/знание таргета (эталон UserbotCenterSection.jsx:1421).
- **P3** → `channels!inner` в селекте подписок + ранний continue; `{renewal_link}` без botUsername → убрать строку ссылки; мёртвый тернарник; копи про inline-кнопку; статистика «7 дней» — окно `gte(created_at, now-7d)` + limit 500 вместо 50 последних.

## Секвенция

1. Миграция 1 (до депоя): колонка `last_reminder_sent_at` + партиальный индекс `(expires_at) where status='active'` (аддитивная, старый код не затронет).
2. Код: backend slice (retention.job.js, start.handler.js) + frontend slice (RetentionPage.jsx) — параллельно.
3. Верификация: `npm run build` admin-v2, `node --check`, ревью диффа.
4. Push → CI депой.
5. Миграция 2 (после депоя): дроп `expiry_reminder_sent` + RLS/политики.
6. Smoke прод-страницы + advisors.

## Чеклист

- [x] Миграция 1 применена (`20260914120000`): колонка + индекс; SQL-копия в backend/sql/subscriptions-last-reminder-sent-at.sql
- [x] Backend slice: retention.job.js (P0+P1×2+P2 guard+P3), start.handler.js (owner-чек `buy_`)
- [x] Frontend slice: RetentionPage.jsx (owner-фильтры, предупреждение, P3 косметика/стats)
- [x] Build + ревью диффа (code-reviewer: APPROVE, P2-P3 остатки внесены до коммита: SQL-файл по конвенции, чек ошибки markReminderSent, лог ошибки выборки, `**`→`*` в дефолт-шаблонах legacy Markdown, stripMarkdownDecor для raw-отправки юзерботом + честное превью на странице)
- [ ] Push + CI депой
- [ ] Миграция 2: дроп булева + RLS
- [ ] Smoke + advisors

## Ревью (после реализации)

- code-reviewer сабагент: **APPROVE**. P0/P1 нет. Остатки P2-P3: (1) in-process re-entrancy guard не защищает мульти-инстанс pm2 — ecosystem без `instances`, один инстанс, ок; (2) после депоя проверить `access_events.payload->>parse_fallback` — если кастомные тексты админов регулярно уходят фолбэком, добавить валидацию Markdown в редакторе страницы; (3) transient-исходы не пишут access_event (сознательно, против спама каждые 5 мин).
- Данные прода проверены: retention_reminder событий ещё нет (0), NULL-ов в sales_bot_contours.owner_id нет — owner-фильтр страницы безопасен.
- Пограничное: «нет бота в реестре + флаг юзербота off» маркируется как дефинитивный скип — паритет со старым поведением, принято.
