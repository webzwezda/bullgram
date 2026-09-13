# План: закрытие бэклога ревью /app/sales-bot

Дата: 2026-09-13. Источник: код-ревью `code-reviewer` (verdict fix-first) по
фиче sales-bot: `backend/routes/official-bot.routes.js`,
`backend/services/sales-contour.service.js`, `backend/services/official-bot/*`,
`admin-v2/src/pages/bots/*`.

## Ключевое решение по P0 (channels)

`channels` — общая таблица (official-bot, autopost, subscriptions, access,
audience, broadcast...). Глобальная уникальность `tg_chat_id` держит логику
всех lookup'ов по чату. Поэтому схему НЕ меняем (никаких
уникальных индексов по `bot_id,tg_chat_id`): фикс — guard в коде хендлеров.

- `official-bot/handlers/chat-events.handler.js` (my_chat_member → administrator):
  select строки по `tg_chat_id`; нет строки → insert со своим `owner_id/bot_id`;
  строка своя (`bot_id` совпадает) → update; строка чужая → skip + log, не красть.
- delete при left/kicked: `.eq('tg_chat_id', ...).eq('bot_id', botId)`.
- `getChannelByChatId`: опциональный `botId` → `.eq('bot_id', botId)` +
  `maybeSingle()` (join_request не должен обрабатывать чужой канал).
- `autopost/handlers/chat-member.js:22` — тот же класс бага: тот же guard
  (своя строка по `autopost_bot_id`, чужую не красть). Delete там уже scoped.

## Слайс бэкенд (backend-developer)

- [ ] P0: guard в chat-events.handler.js + autopost chat-member.js + getChannelByChatId(botId)
- [ ] 404 вместо 500: `assertOwnedSalesBot` (sales-contour.service.js:662) и
      PATCH /channels/:channelId (official-bot.routes.js:704) → `maybeSingle()` +
      явный 404 по паттерну `loadOwnedOfficialBotAccount`
- [ ] `loadFullUserbotAccount` (sales-contour.service.js:1127): `.eq('owner_id', ownerId)`
- [ ] `loadUserbotBindings` (sales-contour.service.js:524): `.in('bot_id', ownedBotIds)`
- [ ] `userbot_options` — один раз на верхнем уровне ответа getContoursOverview,
      не в каждом боте (фронт читает через extractFirstArray(payload,...), форма совместима)
- [ ] Мёртвые эндпоинты: DELETE `/contours/rights`, `/prepare-userbot`, `/admin`
- [ ] Debug console.log: routes:668,673
- [ ] Хардкод TG api_id/api_hash: official-bot.routes.js:671, userbot.routes.js:1374,
      customer-reconciliation.service.js:7-8 → env/fallback конструктора
- [ ] Webhook-секрет: `crypto.timingSafeEqual` (routes:202), с защитой от разной длины

## Слайс фронтенд (frontend-developer)

- [ ] join-all: confirm-диалог с объяснением (юзербот вступит в площадки контура
      и получит админ-права; доставка зависит от Telegram) на обоих триггерах
      (toggle ротации, добавление юзербота) + in-flight guard от двойного клика
- [ ] Удалить мёртвый код: `prepareUserbotAdmin` (с пустыми ветками),
      `saveBotAdmin`/`botAdminDrafts`, прокидывание в props
- [ ] console.log в toggleUserbotActive

## Не делаем (осознанно)

- Миграция схемы channels — опасно для остальных фич (см. выше).
- Async job для join-all — отдельная работа (нужен job-инфраструктурный цикл и
  статус-поллинг; сейчас busy-guard + confirm достаточны).
- `buildContourReadiness` (всегда 'ready') — продуктовая заглушка, не баг ревью;
  оставить до появления реальной проверки готовности.
- Заголовок X-Telegram-Bot-Api-Secret-Token вместо URL-секрета — URL-гейт
  работает, constant-time сравнение закрывает класс атаки.

## Ревью/проверка

- [x] npm run build в admin-v2, node --check по тронутым бэкенд-файлам
- [x] code-reviewer по диффу (раунд 1: fix-first, 2×P1 — см. «Правки по ревью»)
- [x] Правки по ревью
- [ ] коммит, пуш, CI, прод-проверка /app/sales-bot в браузере

## Правки по ревью (раунд 2)

code-reviewer по диффу нашёл две проблемы, обе закрыты:

1. **Guard сравнивал feature-bot-id, а не owner_id** — ломал легитимный
   same-owner сценарий «один чат в official-bot и autopost» (таблица общая,
   колонки bot_id и autopost_bot_id соседствуют в одной строке; в проде
   3 из 4 каналов — такие мерж-строки, проверено через Supabase MCP).
   Следствие было бы: join requests платного канала молча отклоняются.
   Фикс: guard тенантный — чужой owner_id → warn+skip, свой → update с
   merge-семантикой. Во всех трёх писателях channels.
2. **Третий безусловный писатель channels** — POST /api/userbot/sync-channels
   (userbot.routes.js) делал тот же cross-tenant upsert. Закрыт тем же guard'ом.

Решения оркестратора по остальным вердиктам ревью:

- **left/kicked у official-бота** — `delete` переведён на
  `update({ bot_id: null })` scoped по bot_id: мерж-строка того же владельца
  сохраняет autopost-привязку и историю подписок; симметрично autopost-ветке.
- **Гонка select→insert** — оставлена: unique_tg_chat_id существует (проверено
  MCP), проигравший insert получает 23505 и самозалечивается на следующем
  событии; дубликатов в проде нет.
- **PATCH userbot-active до confirm** — оставлено: «включён в ротацию, но не
  вступил» — валидное состояние, повторный тумблер дозапускает join-all.

## Этап 2: join-all в фоне (отложенное из ревью)

Задача: убрать 20–60 сек синхронного HTTP (риск 504 и параллельных прогонов).

Дизайн:
- Миграция `20260913121500` (применена): `sales_bot_contours` +
  `join_all_status` (idle|running|done|error, default idle),
  `join_all_result` (jsonb), `join_all_started_at` (timestamptz).
- Статус живёт на строке контура: join-all требует сохранённый контур
  (409 иначе), значит строка всегда существует на момент запуска.
- POST /contours/join-all: синхронные preconditions (как сейчас) →
  атомарный claim conditional update (running не перезапускается; протухший
  running старше 10 мин можно перезапустить) → 202 → фон без await.
- GET /contours/join-all/status: owner-scoped, отдаёт status/result;
  running старше 10 мин трактуется как прерванный рестартом → error.
- Фронт: confirm → POST 202 → поллинг раз в 3 сек (таймер в ref, cleanup
  при unmount, предохранитель 10 мин) → done: toast summary + reload;
  error: toast message; 409 already_running: перейти к поллингу.

- [x] Бэкенд-слайс (startJoinAll + статус-роут + фон-обёртка)
- [x] Фронтенд-слайс (поллинг)
- [x] Ревью диффа (fix-first: 2×P1 + 4×P2, все закрыты)
- [x] Валидация + пуш

Правки по ревью (все закрыты оркестратором):
1. P1: поллинг переживал unmount во время in-flight tick — добавлен
   `joinAllPollCancelledRef`, проверка после каждого await в tick.
2. P1: DDL миграции отсутствовал в репо — добавлен идемпотентный
   `backend/sql/sales-contour-join-all-status.sql` (конвенция backend/sql/).
3. P2: stale-flip возвращал error безусловно — теперь читает фактическую
   строку после условного update (прогон мог завершиться между select и update).
4. P2: терминальные записи фона guard'ятся по `join_all_started_at` —
   зависший прогон не перезапишет статус нового запуска.
5. P2: мёртвая ветка в 409-детекте фронта убрана (остался только `err?.code`).
6. P2: чекбоксы/итоги плана — этот раздел.

## Итог (заполнить после работы)

- Коммит: `0cba41f` — fix(sales-bot): tenant-guard на всех писателях channels,
  404 вместо 500, join-all под confirm
- Ревью: код-ревью `code-reviewer` (2 раунда). Раунд 1 — fix-first (2×P1:
  feature-guard вместо tenant-guard, третий писатель sync-channels), обе
  закрыты. Раунд 2 — дельта проверена оркестратором (guard по owner_id во
  всех трёх писателях, detach вместо delete).
- Проверка: node --check по всем тронутым файлам, npm run build admin-v2
  (зелёный), CI-деплой зелёный (run 34755577423, smoke-чек пройден),
  прод /app/sales-bot рендерится без ошибок консоли.
- Не проверялось живьём: фактический join-all и chat_member-события двух
  ботов в одном чате (требует реальных Telegram-состояний; поведение
  подтверждено кодом и ревью).
