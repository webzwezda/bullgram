# Battle Bot Settings Page - 2026-04-25

## Why

Сейчас у BullRun уже есть куски вокруг ботов, но они размазаны по разным экранам:

- `/app/botfather`
  - подключение official bot по token
  - назначение `admin_tg_id`
- `/app/admin-groups`
  - проверка, где userbot и official bot являются админами
  - sync channels
- `/app/userbots`
  - inventory и операционка по userbot-аккаунтам

Для запуска реального боевого контура этого недостаточно.

Оператору нужен один явный экран:

- выбрать бота, которого делаем боевым;
- оформить его профиль;
- привязать его к нужным группам и чатам;
- увидеть, готов ли он реально к работе.

То есть не просто “бот подключен”, а именно:

`бот оформлен + бот стоит в нужных местах + бот готов к продажам`

## Product Goal

Создать отдельную страницу настройки боевого бота:

- рабочее название: `/app/bot-settings`
- цель: сделать один official bot полностью готовым к продажам и доступам

Страница должна решать четыре вопроса:

1. Какой бот сейчас считается боевым.
2. Как выглядит его Telegram-профиль.
3. В какие группы/чаты он должен быть поставлен.
4. Что еще мешает считать его реально готовым.

## Main Principle

Не смешивать все в один экран “про всех ботов вообще”.

Правильная модель:

- сначала выбрать одного official bot;
- дальше работать с его настройкой как с отдельной боевой единицей.

То есть это не inventory-страница, а `launch/setup page` для одного выбранного бота.

## Existing Reuse

Нужно переиспользовать уже существующие куски, а не дублировать их.

### Already exists

- подключение official bot по token:
  - `/api/official-bot/add`
  - UI в `/app/botfather`
- назначение admin TG ID:
  - `/api/official-bot/admin`
  - UI в `/app/botfather`
- аудит групп:
  - `/api/userbot/admin-audit`
  - UI в `/app/admin-groups`
- sync channels:
  - `/api/userbot/sync-channels`
  - UI в `/app/admin-groups`

### Does not exist yet

- profile setup для official bot:
  - имя
  - описание
  - short description
  - avatar
- явная модель `боевой бот`
- единый checklist launch readiness по конкретному боту
- удобный mapping:
  - этот bot должен быть вот в этой группе
  - этот bot должен быть вот в этом чате

## Proposed Page

### Route

- `/app/bot-settings`

### Nav label

- `Настройка бота`

Не `BotFather`, потому что оператору нужен не Telegram-термин, а продуктовая задача:

`довести бота до боевого состояния`

## Page Structure

### 1. Выбор боевого бота

Верхний блок:

- select official bot
- статус:
  - `боевой`
  - `черновик`
  - `не готов`

Показывать:

- username
- internal bot role
- admin tg id
- число привязанных targets

Действия:

- `Сделать боевым`
- `Оставить черновиком`

### 2. Профиль бота

Это отдельный блок `Как бот выглядит в Telegram`.

Поля:

- avatar
- first name / display name
- short description
- full description / about

Что важно:

- это должно управлять именно Telegram-профилем official bot, а не только локальной БД
- значит нужны backend calls, которые реально дергают Bot API

Ожидаемое поведение:

- загрузил новую аватарку
- сохранил имя
- сохранил описания
- видишь результат и статус синка

### 3. Целевые места бота

Отдельный блок `Куда бот должен быть поставлен`.

Не ручной ввод chat id.

Источник данных:

- уже существующие channels/groups из BullRun
- аудит из `/api/userbot/admin-audit`

Нужно дать оператору:

- список релевантных мест
- роль места:
  - `закрытая группа`
  - `чат`
  - `публичная воронка`
  - `не использовать`

Для каждого места:

- userbot admin: yes/no
- official bot admin: yes/no
- linked to channel: yes/no

Действия:

- `Пометить как закрытую группу`
- `Пометить как чат`
- `Убрать из боевой схемы`

### 4. Готовность к запуску

Нужен не просто список полей, а понятный launch checklist.

Пример:

- bot token подключен
- admin tg id задан
- имя заполнено
- описание заполнено
- аватар загружен
- bot есть в закрытой группе
- bot есть в чате
- userbot admin в этих местах тоже есть

Итоговый статус:

- `Готов к запуску`
- `Почти готов`
- `Не готов`

### 5. Быстрые действия

Отдельный блок с короткими ссылками:

- `Открыть BotFather`
- `Открыть Admin Groups`
- `Открыть Plans`
- `Открыть Payments`

Это не основная логика, а быстрые handoff.

## Data Model

Нужна новая durable сущность, а не только UI state.

### Proposed table: `official_bot_profiles`

Примерные поля:

- `id`
- `owner_id`
- `bot_account_id`
- `is_battle_ready_target`
- `display_name`
- `short_description`
- `about_text`
- `avatar_file_path`
- `avatar_media_id`
- `profile_sync_status`
- `profile_sync_error`
- `last_profile_sync_at`
- `created_at`
- `updated_at`

Назначение:

- хранить желаемое состояние профиля
- хранить результат последнего sync в Telegram

### Proposed table: `official_bot_targets`

Примерные поля:

- `id`
- `owner_id`
- `bot_account_id`
- `channel_id`
- `target_kind`
  - `paid_group`
  - `chat`
  - `public_funnel`
  - `ignore`
- `is_required`
- `created_at`
- `updated_at`

Назначение:

- хранить именно боевую схему конкретного official bot

## Backend Scope

### Read APIs

- `GET /api/official-bot/settings`
  - список official bots
  - selected bot profile
  - target assignments
  - readiness checklist

- `GET /api/official-bot/settings/:botId`
  - детальный state одного бота

### Write APIs

- `POST /api/official-bot/settings/profile`
  - сохранить желаемое имя/описание

- `POST /api/official-bot/settings/avatar`
  - загрузить avatar

- `POST /api/official-bot/settings/profile-sync`
  - применить профиль в Telegram

- `POST /api/official-bot/settings/targets`
  - сохранить целевые места бота

- `POST /api/official-bot/settings/battle-status`
  - сделать bot боевым / черновым

## Telegram Constraints

Это важно зафиксировать сразу:

- official bot может менять часть профиля через Bot API
- не все поля Telegram дает менять одинаково свободно
- загрузка avatar и descriptions должна идти только через backend, а не напрямую с клиента
- ошибки Telegram по profile update надо явно сохранять в `profile_sync_error`

Нельзя делать вид, что профиль “сохранен”, если он только записан локально, но не применился в Telegram.

Нужны два статуса:

- `saved locally`
- `applied in Telegram`

## UX Rules

### Rule 1

Оператор должен видеть один главный статус:

`Бот готов к запуску / не готов`

### Rule 2

Не заставлять оператора помнить, где:

- менять token
- ставить bot в группы
- проверять права

Все это должно быть либо на этой странице, либо иметь явный handoff.

### Rule 3

Не смешивать official bot и userbot.

Они связаны, но роли разные:

- official bot = продает, выдает доступ, напоминает
- userbot = видит чаты, помогает с аудитом и outreach

### Rule 4

Для каждого обязательного target нужно явно говорить:

- есть ли там official bot
- есть ли там userbot-admin
- можно ли уже запускать продажи

## Execution Order

### Phase A - data and contract

1. создать `official_bot_profiles`
2. создать `official_bot_targets`
3. сделать read API settings/readiness

### Phase B - page skeleton

1. route `/app/bot-settings`
2. выбор official bot
3. checklist readiness
4. handoff links

### Phase C - profile editor

1. name
2. short description
3. about
4. avatar upload
5. profile sync status

### Phase D - target assignment

1. подтянуть channels/admin-audit
2. разметка paid group / chat / public funnel
3. readiness evaluation per target

### Phase E - battle mode

1. один bot может быть `primary battle bot`
2. остальные остаются черновыми/запасными
3. все launch checklist ориентируется на primary battle bot

## Acceptance Criteria

Считаем экран готовым, когда:

- оператор выбирает official bot;
- видит его текущую готовность;
- меняет имя/описание/аватар;
- сохраняет и видит, применилось ли это в Telegram;
- назначает закрытую группу и чат;
- видит, есть ли в этих местах нужные права;
- может сделать одного бота боевым;
- не ходит по трем страницам, чтобы понять, готов ли бот к работе.

## Decision

Не пытаться в первой итерации делать “полную Telegram-студию управления”.

Нужна не universal bot admin console, а конкретная страница:

`как довести одного official bot до боевого состояния для BullRun`

Это и есть правильный scope.
