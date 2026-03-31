# Bullrun Backend

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
- **node-cron** - Фоновые задачи

## API Эндпоинты

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

# userbot-based broadcasts
USERBOT_BROADCAST_ENABLED=false

# auto-delete restricted userbots after quarantine window
RESTRICTED_USERBOT_AUTO_DELETE_ENABLED=true
RESTRICTED_USERBOT_DELETE_AFTER_HOURS=72
```

`USERBOT_DM_ENABLED` включает только ручные действия из интерфейса.  
Он не должен автоматически включать retention, auto-kick fallback, inbox watch или broadcast.

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
pm2 start server.js --name bullrun-tg-backend
pm2 restart bullrun-tg-backend
pm2 logs bullrun-tg-backend
```

## Деплой

```bash
npm run deploy
```

Синхронизирует файлы на сервер `root@64.188.70.180:/var/www/backend/` и исключает `node_modules`, `.git`, `logs`, `.env`.

**После деплоя обязательно перезапустите PM2:**
```bash
pm2 restart bullrun-tg-backend
pm2 flush bullrun-tg-backend
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
pm2 logs bullrun-tg-backend --lines 100
```

**Проверка здоровья API:**
```bash
curl https://bullrun.ru/api/userbot/check/:id
```
