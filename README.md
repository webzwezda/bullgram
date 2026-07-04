# Bullgram

**Bullgram** — платформа для управления платным доступом в Telegram: CRM, контроль подписок, shop, рефералки, биллинг, userbot-операционка, автопостинг, managed proxies и агентские интеграции.

**Status:** work in progress. Публичная разработка под AGPL-3.0.

---

## Архитектура

Три активных runtime + один vendored:

| Runtime | Путь | Стек | Что делает |
|---|---|---|---|
| **backend** | `backend/` | Node.js 22, Express 5, Supabase, Telegraf, GramJS | API, фоновые jobs, биллинг, userbot-сервисы, MCP endpoint |
| **admin-v2** | `admin-v2/` | React 19, Vite, Tailwind v4, shadcn/ui | Админка на `/app` |
| **site-v2** | `site-v2/` | React 18, Vite, Tailwind v4, shadcn/ui | Публичный сайт и checkout на `/` |
| **userbot-web** | `userbot-web/` | Ajaxy/telegram-tt (GPL-3.0) + патчи | Веб-клиент Telegram для admin userbot-center |

Legacy `/admin` отдёт `410 Gone`. Не реинтродьюсить.

---

## Quickstart

### Требования

- Node.js `22.22.0` (см. `.nvmrc`)
- npm `10.x`
- Supabase-инстанс (self-hosted или cloud) с service-role key

### Install

```bash
git clone https://github.com/webzwezda/bullrun.git
cd bullrun
npm run install:active   # backend + site-v2 + admin-v2 + userbot-web
```

### Environment

```bash
cp backend/.env.example backend/.env
# заполнить SUPABASE_URL, SUPABASE_SERVICE_KEY, ENCRYPTION_KEY, TG_API_ID, TG_API_HASH
```

### Run dev

```bash
cd backend && node server.js          # API на :3000
cd admin-v2 && npm run dev            # админка на :5173
cd site-v2 && npm run dev             # сайт на :5174
```

### Build

```bash
npm run build:v2      # site-v2 + admin-v2
npm run build:site    # только site-v2
npm run build:admin   # только admin-v2
```

---

## Deploy

Основной флоу — push в `main`:

```bash
git push origin main
```

GitHub Action SSH'ит на прод, делает `git pull`, `npm ci`, `npm run build:v2`, `pm2 reload`. Время деплоя — 30–60 секунд.

Emergency-деплой (если CI сломан):

```bash
DEPLOY_HOST=<your-server-ip> npm run deploy
```

Rollback — через `git revert` + push, либо вручную на проде:

```bash
cd /srv/bullrun && git checkout <tag> && ./scripts/deploy-pull.sh
```

---

## Что важно про продукт

- **Upgrade path:** `Trial → Normal → Pro`. Не ломать.
- **Shop** — основной checkout. P2P проходит через shop.
- **Billing** — crypto-only (TON). Самозанятость/ИНН/Robokassa не используем.
- **Userbot automation:** `manual-by-default`. Каждое risky-действие за фича-флагом.
- **1 proxy record = 1 userbot** — сохраняется везде.
- **MCP:** Bullgram MCP (`POST /api/mcp`) — agent path для продукта; Supabase MCP — для базы.

---

## Frontend

Оба фронта (admin-v2 и site-v2) на React + Vite + Tailwind v4. shadcn/ui доступен, но существующий UI не переписывать «ради библиотеки».

Конфиг берётся из `window.location.origin` в рантайме — никаких build-time env injection для домена.

---

## Userbot safety

Это рабочие ограничения, не пожелания:

- onboarding через proxies всегда
- новые userbots стартуют в `safe-mode` (`runtime_status=pending_activation`) и не трогаются фоновыми jobs до ручной активации
- если `@SpamBot` подтверждает блокировку — это source of truth
- restricted userbot снимается с продажи, dedicated proxy чистится
- manual DM не включает автоматически retention, auto-kick fallback, inbox watch или broadcast — каждый сценарий за своим флагом

Подробнее в `CLAUDE.md`.

---

## Scripts

| Команда | Что делает |
|---|---|
| `npm run install:active` | Установить deps для всех runtime |
| `npm run build:v2` | Собрать site-v2 + admin-v2 |
| `npm run deploy` | Emergency rsync-deploy (нужен `DEPLOY_HOST`) |
| `npm run rollback -- all <ts>` | Откат по server-side snapshot |
| `npm run mcp:supabase:tunnel` | SSH-туннель до Supabase MCP на проде |

---

## Структура репозитория

```
bullrun/
├── backend/         # API, jobs, services, scripts
├── admin-v2/        # админка (React/Vite)
├── site-v2/         # публичный сайт (React/Vite)
├── userbot-web/     # vendored Ajaxy/telegram-tt + патчи
├── ops/             # deploy/rollback/infra скрипты
├── docs/            # design specs и references
├── CLAUDE.md        # инструкции для AI-агентов
├── AGENTS.md        # контракт для subagents
└── LICENSE          # AGPL-3.0
```

---

## Contributing

См. `CONTRIBUTING.md`. PR'ы принимаются под AGPL-3.0 — в PR нужно подтвердить согласие.

По стилю: backend — ESM, kebab-case файлы; frontend — React hooks, функциональные компоненты. Подробности в `CLAUDE.md`.

## Security

Баги безопасности — на `webzwezda@gmail.com` с темой `[SEC] Bullgram`. SLA ответа — 72 часа. См. `SECURITY.md`.

## License

Copyright (c) 2026 Ilya webzwezda. Distributed under [AGPL-3.0](./LICENSE).

## Acknowledgements

См. `NOTICE.md`. Ключевое: Ajaxy/telegram-tt (GPL-3.0), Supabase (Apache-2.0), Telegraf (MIT), GramJS (MIT), shadcn/ui (MIT), Lucide (ISC).
