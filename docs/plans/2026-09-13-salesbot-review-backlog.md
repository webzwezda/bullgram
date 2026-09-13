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
