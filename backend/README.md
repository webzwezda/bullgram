# Bullgram Backend

Модульный Node.js бэкенд для Telegram paid-access, shop и userbot-операционки.

## Архитектура

Бэкенд построен по принципу разделения ответственности на модули:

```
backend/
├── server.js              # Точка входа (~64 строки)
├── middlewares/           # Express middleware
│   └── auth.middleware.js # Аутентификация через Supabase JWT
├── routes/                # API эндпоинты
│   ├── userbot.routes.js      # Юзербот операции, health-check, ops center, manual actions
│   └── official-bot.routes.js # Управление официальными ботами
├── services/              # Бизнес-логика
│   ├── userbot.service.js      # GramJS клиент, SpamBot-check, peer resolution, DM safety
│   └── official-bot.service.js # Telegraf бот для оплат и подписок
├── jobs/                  # Фоновые задачи (Cron)
│   ├── auto-kick.job.js        # Авто-кик истекших подписок
│   ├── retention.job.js        # Напоминания об оплате
│   ├── abandoned-cart.job.js   # Напоминания по брошенным checkout
│   └── userbot-inbox.job.js    # Inbox watcher, выключен по умолчанию
└── utils/                 # Утилиты
    ├── crypto.js          # Шифрование сессий
    ├── shop-reservations.js
    └── telegram-error-events.js
```

## Технологии

- **Node.js** + **Express.js** - Web сервер
- **Supabase** - База данных PostgreSQL и аутентификация
- **Telegraf** - Официальные Telegram боты
- **GramJS (telegram)** - Юзербот для scraping и direct messaging
- **setInterval** - Фоновые задачи (автопостер: планировщик каждые 5 минут, recovery каждую минуту)

## API Эндпоинты

### External surfaces

- `POST /api/mcp` — MCP server (JSON-RPC 2.0) — see [docs/integrations/transports/mcp.md](../docs/integrations/transports/mcp.md)
- `/api/external/v1/*` — REST API — see [docs/integrations/transports/rest.md](../docs/integrations/transports/rest.md)
- `/api/docs` — Scalar interactive explorer for REST API

Internal `/api/*` routes below are for the web app only and are not documented externally.

### Юзербот (`/api/userbot`)

- `POST /api/userbot/qr-start` - Генерация QR кода для авторизации через выбранный fingerprint-профиль
- `GET /api/userbot/qr-status` - Проверка статуса QR-входа (`pending`, `success`, `not_found`)
- `GET /api/userbot/check/:id` - Проверка статуса аккаунта, включая SpamBot-check
- `DELETE /api/userbot/:id` - Удаление аккаунта
- `POST /api/userbot/fetch-members` - Сканер аудитории группы
- `POST /api/userbot/sync-channels` - Синхронизация каналов
- `GET /api/userbot/crm/subscribers` - База клиентов
- `POST /api/userbot/crm/subscribers/:id/add-days` - Добавить дни подписки
- `POST /api/userbot/send-message` - Ручное сообщение в личку, требует `manual_confirmed=true`
- `POST /api/userbot/crm/import` - Массовый импорт пользователей
- `GET /api/userbot/crm/presence` - Проверка присутствия в группах
- `GET /api/userbot/ops-center` - Центр ручной triage по личкам и группам
- `GET /api/userbot/error-events` - Журнал Telegram-ошибок и ограничений

### Официальные боты (`/api/official-bot`)

- `POST /api/official-bot/add` - Добавить бота по токену

### Рассылки (`/api/broadcast`)

- `POST /api/broadcast/campaigns/:id/cancel` - Стоп активной рассылки (queued/sending → `cancelled`); чужая или не активная → 404
- `POST /api/broadcast/send` - `leave_groups_on_complete: true` ставит в meta кампании флаг: после терминального успеха (`sent`/`completed_with_errors`) джоба `broadcast-membership-cleanup.job.js` выводит юзерботов из групп, куда они вступали ради подготовки (свои чаты и контурные слоты не трогает)

### Сообщения (`/api/messaging`)

Единая точка исходящих ЛС через юзерботов: квоты на юзербота, паузы, ротация пула (`backend/services/messaging-router.service.js`, план: `docs/plans/2026-09-16-messaging-router.md`).

- `GET /api/messaging/capacity?audience_size=N` - Оценка ёмкости: сколько юзерботов нужно на базу N и на сколько дней растянется отправка
- `POST /api/messaging/send` - Точечная ЛС через юзербота с `idempotency_key`; под тем же гейтом `USERBOT_DM_ENABLED`, что и `/api/userbot/send-message`

### Автопостер (`/api/autopost`)

Планировщик автопостера — не node-cron, а `setInterval`-джобы: `jobs/autopost-scheduler.job.js` (тик каждые 5 минут — публикует очередь `autopost_items` по слотам каналов) и `jobs/autopost-stuck-editing.job.js` (тик каждую минуту — возвращает в очередь посты, зависшие в `editing`/`sending`).

Чек-листы — интерактивные списки дел с inline-кнопками: состояние в БД, домочадцы отмечают пункты прямо в Telegram, «кто и когда» пишется в атрибуцию. Пять MCP-операций (`mcp/tools/autopost/checklist-*.js`), они же внешний REST (`/api/external/v1`, `brapi_`-токен):

- `bullgram_autopost_checklist_create` — `POST /autopost/bots/{bot_id}/checklists` — создать и опубликовать (`publish_now` / `scheduled_at` / очередь); `dedup_key` обязателен в крон-путях (повтор → `already_exists=true` без дубля), `pin`, `expires_at`
- `bullgram_autopost_checklist_state` — `GET /autopost/bots/{bot_id}/checklists/{checklist_id}` — пункты + кто отметил + summary (+ `include_events` — лента событий)
- `bullgram_autopost_checklist_list` — `GET /autopost/bots/{bot_id}/checklists` — список с фильтром `status` (active/expired/cancelled) и курсором
- `bullgram_autopost_checklist_update` — `PATCH /autopost/bots/{bot_id}/checklists/{checklist_id}` — add/rename/remove/reset без потери отметок
- `bullgram_autopost_checklist_cancel` — `POST /autopost/bots/{bot_id}/checklists/{checklist_id}/cancel` — закрыть: снять клавиатуры, убрать строки очереди

Админские JWT-ручки для той же жизни: `GET/POST /api/autopost/bots/:botId/checklists`, `GET/PATCH /api/autopost/bots/:botId/checklists/:checklistId`, `POST /api/autopost/bots/:botId/checklists/:checklistId/cancel`.

Ретеншен ленты событий: `CHECKLIST_EVENTS_RETENTION_DAYS` — дни жизни `autopost_checklist_events` (по умолчанию 90, минимум 7 — ниже порога откат к дефолту); чистит `jobs/autopost-checklist-events-cleanup.job.js` раз в 6ч.

Сценарий агента: вечером `checklist_create` с `scheduled_at` на утро → семья отмечает пункты в Telegram → утром `checklist_state` с `include_events=true` питает память агента.

### Юзербот-операции (MCP/REST)

Полный базовый набор действий юзерботом (`mcp/tools/messages|dialogs|account/`, они же внешний REST `/api/external/v1`); волна 2 — план `docs/plans/2026-09-17-mcp-userbot-ops.md`:

- `bullgram_userbot_message_edit` — `POST /userbots/{userbot_id}/messages/{chat_id}/edit` — правка своего сообщения (чужие → `MESSAGE_EDIT_FORBIDDEN`)
- `bullgram_userbot_message_delete` — `POST /userbots/{userbot_id}/messages/{chat_id}/delete` — удалить до 100 сообщений, необратимо: обязателен `confirm: true`
- `bullgram_userbot_message_forward` — `POST /userbots/{userbot_id}/messages/{chat_id}/forward` — переслать сообщения в `to_chat_id`
- `bullgram_userbot_message_pin` — `POST /userbots/{userbot_id}/messages/{chat_id}/pin` — закрепить/открепить (`unpin`)
- `bullgram_userbot_chat_read` — `POST /userbots/{userbot_id}/chats/{chat_id}/read` — отметить чат прочитанным
- `bullgram_userbot_user_resolve` — `POST /userbots/{userbot_id}/resolve` — живой резолв по `username` | `tg_user_id` (ровно один), отдаёт `access_hash` для invite/promote

Волна 1 там же: `group_create`, `member_invite`, `member_promote`, `group_invite_link` (гейт `USERBOT_GROUP_ADMIN_ENABLED`), `botfather_create_bot` (гейт `USERBOT_BOTFATHER_ENABLED`) и `bot_init` в autopost.

## Установка

```bash
cd backend
npm install
```

## Конфигурация

Создайте файл `.env` в корне проекта:

```env
# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_role_key

# Telegram API (для юзербота)
TG_API_ID=your_api_id
TG_API_HASH=your_api_hash

# Бот авторизации: шлёт админам уведомления о заявках на доступ
# (публичный эндпоинт access-requests). Пусто — уведомления выключены.
TG_BOT_TOKEN=your_bot_token
TG_ADMIN_CHAT_ID=your_admin_chat_id

# Сервер
PORT=3000
```

Быстрый старт без копирования секретов из production:

```bash
cp backend/.env.example backend/.env
```

### Userbot automation flags

Все risky userbot-сценарии должны считаться выключенными, если флаг не задан.

```env
# manual DM from admin UI
USERBOT_DM_ENABLED=false

# background watcher of userbot inbox
USERBOT_INBOX_WATCH_ENABLED=false

# retention reminder fallback via userbot
USERBOT_RETENTION_DM_ENABLED=false

# auto-kick fallback via userbot when official bot cannot kick
USERBOT_AUTO_KICK_FALLBACK_ENABLED=false

# DM after auto-kick via userbot
USERBOT_AUTO_KICK_DM_ENABLED=false

# abandoned-cart follow-up via userbot when the official bot is blocked
USERBOT_ABANDONED_DM_ENABLED=false

# userbot-based broadcasts
USERBOT_BROADCAST_ENABLED=false

# messaging router: per-userbot DM quotas (hourly/daily) and send jitter, percent
USERBOT_DM_HOURLY_CAP=20
USERBOT_DM_DAILY_CAP=50
USERBOT_DM_JITTER_PERCENT=20

# broadcast preparation: auto-join userbots into groups for DM touchpoints
USERBOT_AUTO_JOIN_ENABLED=false
USERBOT_JOIN_PER_HOUR=4
USERBOT_JOIN_SLEEP_MS=45000

# userbot group-admin ops via MCP/REST: group_create, member_invite, member_promote, group_invite_link
USERBOT_GROUP_ADMIN_ENABLED=false

# bot creation through the BotFather DM flow via MCP/REST (botfather_create_bot)
USERBOT_BOTFATHER_ENABLED=false

# auto-delete restricted userbots after quarantine window
RESTRICTED_USERBOT_AUTO_DELETE_ENABLED=true
RESTRICTED_USERBOT_DELETE_AFTER_HOURS=72
```

`USERBOT_DM_ENABLED` включает только ручные действия из интерфейса.  
Он не должен автоматически включать retention, auto-kick fallback, inbox watch или broadcast.

### Bullgram platform billing

Normal продается отдельным контуром `/api/billing`, а не через Shop/P2P клиентов.  
Robokassa-секреты хранятся только в `.env` backend и не редактируются через `payment_settings`.

```env
ROBOKASSA_ENABLED=false
ROBOKASSA_TEST_MODE=true
ROBOKASSA_MERCHANT_LOGIN=
ROBOKASSA_PASSWORD_1=
ROBOKASSA_PASSWORD_2=
BILLING_NORMAL_PRICE_RUB=900
BILLING_NORMAL_DURATION_DAYS=365
BILLING_PENDING_ORDER_TTL_MINUTES=30
```

Callback URL для Robokassa:

- Result URL: `https://bullgram.xyz/api/billing/robokassa/result`
- Success URL: `https://bullgram.xyz/api/billing/robokassa/success`
- Fail URL: `https://bullgram.xyz/api/billing/robokassa/fail`

### Webhook кассы (`/api/payment/webhook/:provider`)

Вебхук платёжного провайдера админа (касса из «Кассы» /billing). Контракт:

- **Fail-closed**: если у админа не задан `billing_webhook_secret` в `payment_settings`, любой запрос получает `403` — проверять нечего, активация без секрета невозможна. Настрой секрет в Кассе до включения провайдера.
- Секрет передаётся в header `x-webhook-secret` **или** в query (`?secret=...`) — query-вариант оставлен для провайдеров, умеющих только GET-URL; он попадает в access-логи прокси (осознанный компромисс).
- Повторная обработка оплаченного счёта идемпотентна (`already_paid`), активация подписки выполняется один раз — claim через условный UPDATE.
- Если оплата принята, но активация подписки упала — в `payment_events` пишется `activation_failed` (status `wait_admin`), а вебхук отвечает 500: выдачу придётся доделать вручную из админки.

### Pro fulfillment: выдача бандла из Shop при оплате Pro

Когда заказ `Bullgram Pro` становится `paid`, рядом с активацией тарифа (`activateProForOrder`) запускается
`fulfillProOrderBundle` (`backend/services/pro-fulfillment.service.js`):

- из витрины Shop берется первый подходящий лот `item_type='bundle'` (один юзербот + один прокси, `status='published'`),
  юзербот не должен быть `runtime_status='restricted'`;
- лот забирается CAS-ом (`published → sold`, `visibility='private'`), создается `shop_purchases` с `source: 'pro_billing'`
  и через `transferShopAssets` (`backend/services/shop-transfer.service.js`) права на юзербота и прокси переходят покупателю;
- состояние пишется в `billing_orders.payload.fulfillment_status` (`processing → completed | failed`),
  при успехе в `payload.fulfillment` лежат `shop_item_id`, `userbot_id`, `proxy_id`, `shop_purchase_id`;
- идемпотентность — атомарный claim по паре `payload->fulfillment_status` + `payload->fulfillment_claimed_at`
  (CAS), `completed` финален, `failed` и зависший `processing` (старше 10 минут) переигрываются;
- если свободных бандлов нет или transfer упал, ставится `failed` (лот при этом остается проданным — как в Shop-сценарии
  «нужен возврат»), а job `billing-activation-recovery.job.js` ретраит выдачу другим бандлом;
  у свипа есть нижняя граница `PRO_FULFILLMENT_SINCE` (по умолчанию дата запуска фичи) — старые оплаты задним числом
  бандлы не получают;
- `GET /api/dashboard` отдает счетчик `proFulfillmentPending` (paid-заказы без fulfillment или с `failed`) —
  счетчик намеренно платформенный (бандлы на витрине — общий сток платформы), публичный billing-view показывает
  только `fulfillment_status`, без id и деталей актива.

### QR onboarding и импорт сессий

- `QR login` теперь не использует один глобальный fingerprint для всех аккаунтов.
- `POST /api/userbot/qr-start` принимает `fingerprint_profile_id` и поднимает QR через выбранный whitelist-профиль.
- После успешного QR-входа выбранный fingerprint сохраняется в `session_data` и используется дальше как fingerprint этой сессии.
- Новый аккаунт после QR или file import всегда встаёт в `safe-mode` (`runtime_status=pending_activation`).
- Пока аккаунт в `safe-mode`, фоновые jobs, `ops-center` и другие живые Telegram-paths не должны его трогать до ручной активации.
- `GET /api/userbot/qr-status` не должен ронять `500` на transient QR/auth гонках. Для незавершённого или уже очищенного QR он должен возвращать `pending` или `not_found`.
- Для боевых аккаунтов безопаснее путь `.session + .json`, потому что там берётся родной fingerprint из `.json`.
- `tdata`, `Password2FA.txt`, `Accounts.txt` и прочие соседние файлы через сайт не поддержаны.

## Запуск

**Development:**
```bash
node server.js
```

**Production (с PM2):**
```bash
pm2 start server.js --name bullgram-tg-backend
pm2 restart bullgram-tg-backend
pm2 logs bullgram-tg-backend
```

## Деплой

```bash
npm run deploy
```

Синхронизирует файлы на сервер `${DEPLOY_USER:-root}@${DEPLOY_HOST}:/var/www/backend/` и исключает `node_modules`, `.git`, `logs`, `.env`. Требует `DEPLOY_HOST` env: `DEPLOY_HOST=1.2.3.4 npm run deploy`.

**После деплоя обязательно перезапустите PM2:**
```bash
pm2 restart bullgram-tg-backend
pm2 flush bullgram-tg-backend
```

## Userbot Safety Rules

- `manual-by-default` для userbot действий
- если Telegram через `@SpamBot` подтверждает блокировку, аккаунт получает `restricted`
- restricted userbot автоматически снимается с продажи
- если у restricted userbot был выделенный managed proxy, proxy удаляется из БД и снимается с сервера
- restricted userbot может быть автоматически удален после quarantine window, если статус не был восстановлен
- `1 proxy record = 1 userbot`
- manual DM должен предупреждать, что Telegram чаще пускает сообщение, если у userbot уже был диалог или есть общий чат

## Фоновые задачи

Бэкенд поднимает фоновые jobs при старте, но risky userbot-ветки в них выключены по умолчанию:

1. **Auto-Kick** - кикает истекшие подписки; fallback через userbot отключен по умолчанию
2. **Retention** - напоминает об оплате; fallback ЛС через userbot отключен по умолчанию
3. **Abandoned Cart** - работает через checkout-контур
4. **Userbot Inbox Watch** - полностью выключен по умолчанию

## Мульти-тенантность

Все запросы проверяют `owner_id` для изоляции данных. Каждый админ видит только свои:
- Каналы
- Ботов
- Подписчиков

## Безопасность

- Frontend использует Supabase Anon Key с RLS политиками
- Backend использует Service Role Key для полного доступа
- Все API эндпоинты требуют JWT токен в заголовке `Authorization: Bearer <token>`
- Сессии Telegram зашифрованы перед сохранением в БД

## Telegram Client Lifecycle

Для юзербота (GramJS) строго соблюдается жизненный цикл:

1. **Init** - Создание TelegramClient с расшифрованной сессией
2. **Disable Updates** - `client._updateLoop = async () => {}` (отключаем входящие обновления)
3. **Connect** - `await client.connect()`
4. **Execute** - Выполнение операций (getParticipants, sendMessage и т.д.)
5. **Cleanup** - `await client.disconnect()` в `finally` блоке

Это предотвращает memory leaks и висящие сессии.

## Обработка ошибок

- глобальный `unhandledRejection` пишет ошибку в лог, ничего не подавляет
- `telegram_error_events` хранит userbot ошибки, ограничения и Telegram restriction signals
- peer resolution для DM теперь пишет `resolution_source` и `resolution_trace`
- API всегда возвращает JSON ошибки с правильными HTTP статусами
- фронтенд должен обрабатывать ошибки и показывать user-friendly сообщения

## Мониторинг

**Проверка статуса PM2:**
```bash
pm2 status
pm2 logs bullgram-tg-backend --lines 100
```

**Проверка здоровья API:**
```bash
curl https://prsng.ru/api/userbot/check/:id
```
