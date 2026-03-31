# BullRun

`BullRun` — это `v2-only` продукт для управления платным доступом в Telegram: CRM, доступы, заказы, shop, referrals, userbot-операционка, managed proxies и agent-интеграции.

Проект состоит из трёх активных runtime:

- `backend/` — API, фоновые jobs, Telegram-сервисы, shop- и billing-логика
- `admin-v2/` — основная админка на React/Vite, обслуживает `/app`
- `site-v2/` — публичный сайт на React/Vite, обслуживает `/`

Legacy `/admin` больше не является активной частью продукта. Любые старые ссылки или assumptions про `/admin` считаются устаревшими.

## Что важно про продукт

- `Trial -> Normal -> Seller` — основной upgrade path, который нельзя ломать
- `Shop` — основной checkout и package funnel
- `P2P` — отдельный flow, но в текущем runtime он проходит через `shop`
- `BullRun MCP` — основной agent path для продуктовых данных
- `Supabase MCP` — основной путь для работы с базой данных
- userbot-автоматизация должна оставаться `manual-by-default`
- правило `1 proxy = 1 userbot` сохраняется везде

## Активные поверхности

### `admin-v2`

- `command center` — `/app`
- `crm` — `/app/crm`
- `orders` — `/app/orders`
- `access` — `/app/access`
- `broadcast` — `/app/broadcast`
- `abandoned` — `/app/abandoned`
- `retention` — `/app/retention`
- `analytics` — `/app/analytics`
- `proxies` — `/app/proxies`
- `userbots` — `/app/userbots`
- `botfather / official bot` — `/app/botfather`
- `admin-groups` — `/app/admin-groups`
- `bases` — `/app/bases`
- `dossier` — `/app/dossier`
- `observer` — `/app/observer`
- `shop` — `/app/shop`
- `shop receipts` — `/app/shop-receipts`
- `referrals` — `/app/referrals`
- `payments` — `/app/payments`
- `billing` — `/app/billing`
- `plans` — `/app/plans`
- `claw / MCP` — `/app/claw`

### `backend`

- API runtime
- BullRun MCP endpoint: `POST /api/mcp`
- фоновые jobs
- managed proxy runtime restore

### `site-v2`

- публичный маркетинговый и checkout-контур на `/`

## Структура репозитория

```text
bullrun/
├── backend/        # API, jobs, services, scripts
├── admin-v2/       # админка
├── site-v2/        # публичный сайт
├── ops/            # deploy, rollback, systemd, infra-скрипты
├── docs/           # планы, onboarding, internal docs
└── AGENTS.md       # рабочий контракт для Codex/агентов
```

## Требования к окружению

- `Node.js 22.22.0`
- `npm 10.x`
- `rsync` для deploy-скриптов
- доступ на production server для deploy/rollback

В корне уже зафиксированы:

- [.nvmrc](/Users/webzwezda/Desktop/bullrun/.nvmrc)
- [package.json](/Users/webzwezda/Desktop/bullrun/package.json)

## Быстрый старт

Установка зависимостей для активных runtime:

```bash
npm run install:active
```

Локальная разработка по runtime:

```bash
cd backend && node server.js
cd admin-v2 && npm run dev
cd site-v2 && npm run dev
```

Сборка фронтов:

```bash
npm run build:v2
```

Отдельно:

```bash
npm run build:site
npm run build:admin
```

## Deploy и rollback

Основные команды:

```bash
npm run deploy
npm run deploy:v2
npm run rollback -- all <timestamp>
npm run rollback:v2 -- <timestamp>
npm run rollback:backend -- <timestamp>
```

Что делают команды:

- `npm run deploy` — backend + `site-v2` + `admin-v2`
- `npm run deploy:v2` — только `site-v2` и `admin-v2`
- `npm run rollback` — откат по server-side snapshot timestamp

Deploy-скрипты живут в `ops/scripts/` и используют `rsync` на production server. Это production-only команды.

## MCP и агентский доступ

### BullRun MCP

Это основной agent path для продуктовых данных.

- endpoint: `POST /api/mcp`
- onboarding screen: `/app/claw`
- при добавлении новых agent-capabilities предпочтение у явных tools вроде `summary`, `preview`, `import`, `status`

### Supabase MCP

Это основной путь для работы с базой.

- self-hosted Supabase MCP на сервере доступен через локальный доступ к `/mcp`
- локально подключение идёт через `SSH tunnel`, а не через публичный интернет
- helper-команда:

```bash
npm run mcp:supabase:tunnel
```

- локальный endpoint для Codex: `http://localhost:8080/mcp`
- конфиг Codex хранится в `~/.codex/config.toml`

Если задача касается схемы БД, данных или их изменения, сначала нужно идти через `Supabase MCP`, а не через прямые ad-hoc SQL обходы.

## Frontend stack

### `admin-v2`

- React 19
- Vite
- Tailwind CSS v4
- `shadcn/ui` уже инициализирован

### `site-v2`

- React 18
- Vite
- `shadcn/ui` тоже подготовлен
- Tailwind/shadcn-инфраструктура добавлена без агрессивного внедрения в текущий живой CSS-слой

Это значит, что оба фронтенда готовы к использованию `shadcn/ui`, но существующий UI не должен переделываться “ради библиотеки”.

## Конфигурация и `.env`

Локально в репозитории нет рабочего боевого `.env`.

Сейчас есть только шаблон:

- [backend/.env.example](/Users/webzwezda/Desktop/bullrun/backend/.env.example)

Фактически это значит:

- `backend/.env` нужно поднимать отдельно, если нужен полноценный локальный запуск с интеграциями
- `admin-v2` и `site-v2` не содержат локальных `.env` файлов в репозитории
- production credentials и session files коммитить нельзя

## Userbot и proxy rules

Это не “опциональные пожелания”, а рабочие ограничения продукта:

- все userbot onboarding flows идут через proxies
- `1 proxy record = 1 userbot`
- userbot automation остаётся `manual-by-default`
- manual DM не должен автоматически включать inbox watcher, retention, auto-kick fallback или broadcast
- если `@SpamBot` подтверждает блокировку, это source of truth
- blocked/restricted userbot assets не должны оставаться публичными в `shop`
- если у restricted userbot был выделенный managed proxy, он должен быть очищен из BullRun

## Managed proxies

В backend есть отдельный runtime для managed proxies.

Что важно:

- состояние хранится на сервере в `/var/lib/bullrun/managed-proxies/`
- boot-time restore делается через systemd unit `bullrun-managed-proxies.service`
- этот unit нужен для восстановления IPv6-адресов, `3proxy` config и контейнера после reboot

## Проверка изменений

Автотестов уровня продукта пока нет, поэтому базовая проверка такая:

```bash
cd admin-v2 && npm run build
cd site-v2 && npm run build
cd backend && node server.js
```

Для backend-изменений дополнительно:

- проверить нужный endpoint через приложение или `curl`
- посмотреть логи, если менялись jobs, Telegram flows или managed proxies

## Документация внутри репозитория

Ключевые внутренние документы:

- [AGENTS.md](/Users/webzwezda/Desktop/bullrun/AGENTS.md) — рабочий контракт для Codex и subagents
- [backend/README.md](/Users/webzwezda/Desktop/bullrun/backend/README.md) — backend-детали
- `docs/plans/` — планы, onboarding и internal notes

Если README и код расходятся, источником истины считаются:

1. код и runtime paths
2. `AGENTS.md`
3. целевые docs в `docs/plans/`

## Коротко

Если заходишь в проект впервые:

1. поставь зависимости через `npm run install:active`
2. не возвращай legacy `/admin`
3. считай `BullRun MCP` основным agent path для продукта
4. считай `Supabase MCP` основным путём к базе
5. держи userbot-логику `manual-by-default`
6. перед deploy прогоняй сборку фронтов
