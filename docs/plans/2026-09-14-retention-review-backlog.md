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
- [x] Push + CI депой (079a01a, run 34766112392: build + pm2 reload + smoke ✓)
- [x] Миграция 2 (`20260914130000`): дроп `expiry_reminder_sent` + RLS/политики на subscriptions (через channels), access_events, sales_bot_contours, payment_settings
- [x] Smoke: /app/retention 200; advisors — 4 таблицы ушли из rls_disabled; expiring-подписок в окне сейчас нет (тик пустой, наблюдение за первым реальным тиком — по access_events)
- [ ] Рантайм-наблюдение (нужен живой подписчик в 24ч-окне): напоминание ровно раз в цикл; `payload->>parse_fallback` на кастомных текстах; визуальная проверка страницы в реальном Chrome (browser doctrine)

## Ревью (после реализации)

- code-reviewer сабагент: **APPROVE**. P0/P1 нет. Остатки P2-P3: (1) in-process re-entrancy guard не защищает мульти-инстанс pm2 — ecosystem без `instances`, один инстанс, ок; (2) после депоя проверить `access_events.payload->>parse_fallback` — если кастомные тексты админов регулярно уходят фолбэком, добавить валидацию Markdown в редакторе страницы; (3) transient-исходы не пишут access_event (сознательно, против спама каждые 5 мин).
- Данные прода проверены: retention_reminder событий ещё нет (0), NULL-ов в sales_bot_contours.owner_id нет — owner-фильтр страницы безопасен.
- Пограничное: «нет бота в реестре + флаг юзербота off» маркируется как дефинитивный скип — паритет со старым поведением, принято.

## Дизайн-бэклаг (волна 2, 2026-09-14)

code-reviewer → design-critic дал REJECT (9 находок: 1 blocker, 4 major, 3 minor, 1 nit). Закрыто коммитом 0c622c7.

Ключевое решение — корневое: легаси-правило `.grid` (auto-fit 260px + margin-top) в app.css было unlayered и перебивало Tailwind v4 утилиты на ВСЕХ страницах админки (сетка статов рендерилась 3+1 вместо 4-up). Удалено вместе с нейтрализатором-симптомом `[data-slot='card-header']`; `.grid` убран из мобильного media-правила. Урок закреплён комментарием-надгробием в app.css: не возвращать голый `.grid` — display:grid даёт сам Tailwind.

Остальное: AA-типографика инструкций (slate-500 + max-w-2xl), хинт про общий чат в привязанном состоянии юзербота, `expires_at` убран из копии, превью «Так увидит подписчик (бот)» с рендером легаси-markdown и чипом inline-кнопки, бейдж подписчиков со склонением, H1 «Удержание» + статусная строка, компактнее стат-карточки, рельс line-clamp-2 + контрастные done-состояния.

Верификация: build ✓, code-reviewer APPROVE (P2 каскадного сдвига разобран по 4 конкретным местам — все после фикса рендерятся по замыслу), прод-рендер в Chrome: сетка 4×237px, H1/превью/бейдж/хинт на месте, sales-bot и рельс без регрессий. Повторная дизайн-критика: **ACCEPT** (9/9 исправлены, новых проблем нет).

Backlog на будущее (не блокирует): стат-карточки с ненулевыми значениями, таблица истории с раскрытой строкой, max-h со скроллом для длинных превью, мобильная ширина и тёмная тема, мёртвый CSS (.grid--double и др.) — отдельная чистка.
