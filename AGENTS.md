# Bullgram — Agent Instructions

Last full factual audit: 2026-10-14. If this file contradicts the repository, the repository wins — and file a lesson in `docs/plans/LESSONS.md`.

## Operating Discipline

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy

- Use subagents liberally to keep the main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One tack per subagent for focused execution

### 3. Self-Improvement Loop

- After ANY correction from the owner: update `docs/plans/LESSONS.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until the mistake rate drops
- Review `docs/plans/LESSONS.md` at session start for relevant rules

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between baseline and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the owner
- Go fix failing CI without being told how

## Task Management

1. **Plan First**: write the plan to `docs/plans/PLAN.md` or another focused note under `docs/plans/` with checkable items
2. **Verify Plan**: check in before starting implementation when the task is large enough to justify it
3. **Track Progress**: mark plan items complete as work progresses
4. **Explain Changes**: high-level summary as the work moves forward
5. **Document Results**: add a short review section to the same `docs/plans/` note
6. **Capture Lessons**: update `docs/plans/LESSONS.md` after any owner correction
7. **One Backlog**: open items across all work live in `docs/plans/BACKLOG.md` — each item needs a solution, an owner, and a trigger; finished plan notes get a review section, stale ones get a SUPERSEDED header pointing at BACKLOG.md

## Core Principles

- **Simplicity First**: make every change as simple as possible. Touch minimal code.
- **No Laziness**: find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: changes should only touch what is necessary. Avoid introducing bugs.

---

## Project Structure & Module Organization

Active runtimes (all v2):

- `backend/`: Express API for Telegram subscription management. Entry point `backend/server.js`; HTTP routes in `backend/routes/`, business logic in `backend/services/`, cron jobs in `backend/jobs/`, middleware in `backend/middlewares/`, utilities in `backend/utils/`. PM2 config lives at `backend/ecosystem.config.cjs` (not in the repo root).
- `admin-v2/`: paywall/ops admin app on React/Vite (`/paywall`). Source `admin-v2/src/`, build `admin-v2/dist/`.
- `userbot-v2/`: приложение «Юзербот» (`/userbot`) — основная поверхность для билдеров ИИ-агентов: юзерботы («Telegram Web»), прокси, MCP/API-ключи, магазин лотов. Не путать с `userbot-web/` (вендорный форк telegram-tt, раздаётся nginx'ом как `/userbot/telegram-web/` и легаси-алиасом `/app/telegram-web/`).
- `bots-v2/`: приложение «Боты» (`/bots`) — хаб мелких BotFather-ботов; первый модуль — Автопостер.
- `treasury-v2/`: приложение «Казна» (`/treasury`) — внутренний инструмент платформы: учёт TON, резервы, выводы. Доступ только у платформенного админа, вне продуктового меню.
- `profile-v2/`: приложение «Профиль» (`/profile`) — идентичность, кошелёк, Telegram-биндинг, тариф, покупки. Вне продуктового меню.
- `site-v2/`: primary public product site (`/`). React/Vite.
- `docs-site/`: документация на Eleventy (11ty), деплой собирает её в `site-v2/dist/docs` (публичный путь `/docs/…`, вход — `/docs/quick-start/`). Контент в `docs-site/content/`.
- `blog-site/`: блог, деплой собирает его в `site-v2/dist/blog` (публичный путь `/blog/…`).
- `ops/`: платформенные скрипты (`ops/scripts/ci/run-all-gates.sh`, `deploy.sh`, `deploy-v2.sh`, `deploy-telegram-web.sh`, `rollback*.sh`, `ensure-mcp-tunnel.sh`, `supabase-mcp-tunnel.sh`), `ops/RESTORE.md` (инфраструктура и nginx-локации), `ops/systemd/`.
- `archive/`: archived notes, не часть активного рантайма.
- `design/`: дизайн-токены и гейты (см. Design System ниже).
- nginx-конфигов в репо НЕТ — они накладываются на сервере руками (см. `ops/RESTORE.md`): SPA-fallback для `/paywall/`, `/userbot/`, `/bots/`, `/treasury/`, `/profile/`, 301 `/app/*` → `/paywall/*`, files-first раздача `/docs/…` и `/blog/…` из `site-v2/dist/`.

Tech: backend — Node.js 22 (`.nvmrc`, npm 10.x), Express, Supabase (PostgreSQL + auth), Telegraf, GramJS (userbots), node-cron. Все фронтовые апп-и — React + Vite; React Router v7 (admin-v2, userbot-v2, bots-v2, treasury-v2, profile-v2) / v6 (site-v2); Tailwind CSS v4 + shadcn/ui.

Multi-tenancy: all backend requests enforce `owner_id` for data isolation; each admin sees only their channels, bots, subscribers, orders, and settings.

Product split rule (plans `docs/plans/2026-09-26-userbot-product-split.md`, `2026-09-27-bots-app-split.md`): управление юзерботами — в `/userbot`, мелкие боты — в `/bots`, paywall-продажи — в `/paywall`; все ходят в один backend API. Legacy-пути `/app/*` — 301 на `/paywall/*`; старые подпути (`/app/userbots`, `/app/proxies`, `/app/mcp`, `/app/api`, `/app/profile`, `/app/autopost`) — редиректы в свои v2-приложения.

Do not reintroduce legacy `/admin` assumptions into active UI or product copy. Treat any reserve/legacy context as archived history, not as an active path.

## Surfaces & Routing (current, verified 2026-10-14)

- **site-v2** (`/`): `HomePage`; `/get-account` (флоу «Получить аккаунт»: оплата Pro → выдача → авто-переход в кабинет); `/access-request` (соцпомощь: тариф Normal бесплатно для людей с инвалидностью); `/pay/:purchaseId`; `/create`, `/created/:id` (инвойсы); `/quick-start` → `/docs/quick-start/`; `/shop` → внешний редирект в витрину юзерботов; `/plan` и `/purchases` → редиректы в кабинет `/profile` (сквозь совместимые редиректы userbot-v2).
- **userbot-v2** (`/userbot`): корень `/` = список юзерботов — владелец называет эту поверхность «Telegram Web» (дашборд слит со списком аккаунтов); `/connect` (подключение нового юзербота); `/proxies`; `/mcp` (Bullgram MCP-онбординг агентов); `/api` (API-ключи). Совместимые редиректы: `/accounts` и `/userbots` → `/` (с query), `/purchases` и `/profile` → `/profile/`. Витрина лотов магазина и TON-checkout живут внутри userbot-v2 (`src/features/shop-storefront/`, `src/features/ton-checkout/`, `src/components/shop/`).
- **bots-v2** (`/bots`): хаб `/`; `/bots/autopost` — управление автопостером (онбординг бота, каналы, журнал публикаций, админы). Следующие мелкие боты добавляются сюда.
- **admin-v2** (`/paywall`): корень `/` = «Бот продаж» (`OfficialBotsPage`, включая контурную ротацию юзерботов, сканирование групп, авто-кик) — command center как отдельная страница УДАЛЁН, `/sales-bot` → `/`; `/customers` (клиенты; туда же сведены `/crm`, `/orders`, `/access`, `/dossier`, `/analytics`); `/retention`; `/abandoned` (брошенные корзины); `/referrals`; `/bases`; `/broadcast` + `/broadcast/history`; `/billing` («Касса»; туда же сведены `/payments`, `/shop-receipts`). Казна в меню не выводится: `/treasury`, `/shop`, `/p2p/create`, `/p2p/orders` — внешние редиректы в `/treasury`. Прочие легаси-редиректы: `/autopost` → `/bots/autopost`, `/claw*` → `/userbot/mcp`, `/api`, `/integrations` → `/userbot/api`, `/mcp` → `/userbot/mcp`, `/proxies` → `/userbot/proxies`.
- **treasury-v2** (`/treasury`): TreasuryPage, гейт по роли платформенного админа. P2P как отдельный флоу больше не существует — денежные инструменты сведены в казну.
- **profile-v2** (`/profile`): ProfilePage на `/` и catch-all.

When adding admin features, wire the same scenario across the whole flow instead of creating isolated screens. The operational surfaces to check are: «Бот продаж» (`/paywall`), `/paywall/customers`, `/paywall/broadcast`, `/paywall/billing`, the shop storefront in `/userbot`, and `/treasury`.

## Backend API Areas

Key route zones (full list: `backend/server.js` mounts + `backend/README.md`): `/api/userbot` (operations, health checks, manual actions), `/api/official-bot`, `/api/mcp` (Bullgram MCP endpoint), `/api/autopost`, `/api/shop`, `/api/profile`, `/api/billing`, `/api/payment`, `/api/orders`, `/api/messaging` (DM-роутер), `/api/broadcast`, `/api/audience`, `/api/customers`, `/api/dashboard`, `/api/analytics`, `/api/access`, `/api/referral`, `/api/invoices`, `/api/public-invoices`, `/api/project-admin`, and **`/api/external/v1`** — внешний REST для агентов/интеграций с Scalar-документацией на `/api/external/v1/docs`. TonConnect manifest отдаётся с корня сайта (`/tonconnect-manifest.json`, монтируется без префикса `/api`). Full API docs: `backend/README.md`.

## Build, Deploy, and Development Commands

Install all active runtimes from the root:

```bash
npm run install:active   # backend + 6 v2-аппов + userbot-web
# при работе с доками/блогом: cd docs-site && npm install; cd blog-site && npm install
```

Key commands (root):

- `npm run build:v2`: build all six apps (site-v2, admin-v2, userbot-v2, bots-v2, treasury-v2, profile-v2)
- `npm run build:site` / `build:admin` / `build:userbot-v2` / `build:bots-v2` — build a single app
- `npm run ci` — all CI gates (`ops/scripts/ci/run-all-gates.sh`); `ci:source` / `ci:smoke` — subsets
- `npm run tokens:build` / `tokens:check` / `check:design` — design-token pipeline and design gates
- `npm run deploy` / `deploy:v2` / `deploy:telegram-web` — rsync-based emergency deploys (production-only)
- `npm run rollback` / `rollback:v2` / `rollback:backend` — emergency rollbacks
- Backend: `cd backend && node server.js`; backend tests — see Testing Guidelines; `cd backend && npm run deploy` (rsync fallback)

Primary deploy flow is push-to-main: GitHub Actions SSHes into prod and runs `scripts/deploy-pull.sh`: `git fetch` + `reset --hard origin/main` (PREV_HEAD сохраняется в `.git/deploy-prev-head`) → conditional `npm install` per changed `package.json` across **nine** runtimes (backend, six v2-аппов, docs-site, blog-site) → `npm run build:v2` → сборка docs-site → `site-v2/dist/docs` и blog-site → `site-v2/dist/blog` → `cd backend && pm2 reload ecosystem.config.cjs --env production` (fallback: `pm2 restart` + `pm2 save`) → smoke HTTP check на localhost:3000. `set -euo pipefail` aborts before the pm2 reload if the build fails.

Rollback: `git revert` + push (CI redeploys the previous state), or on prod `cd /srv/bullgram && git checkout HEAD~1 && ./scripts/deploy-pull.sh`.

**Dependency rule (owner decision after the 2026-09-30 sonner deploy failure): an npm dependency is added in the same commit as the code that uses it.** Never rely on conditional `npm install` on the server.

## Environment & Userbot Feature Flags

Backend config lives in `backend/.env` (template: `backend/.env.example`); `admin-v2` and `site-v2` have no `.env` files. Required: Node.js 22.22.0 (`.nvmrc`), npm 10.x.

Userbot feature flags (all default `false` unless explicitly enabled; полный список с квотами и тюнингом — `backend/.env.example`, документация — `backend/README.md`):

```env
USERBOT_DM_ENABLED=false                    # Manual DM from admin UI
USERBOT_INBOX_WATCH_ENABLED=false           # Background inbox watcher
USERBOT_RETENTION_DM_ENABLED=false          # Retention DM fallback
USERBOT_ABANDONED_DM_ENABLED=false          # DM по брошенным корзинам
USERBOT_AUTO_KICK_FALLBACK_ENABLED=false    # Userbot fallback for kicks
USERBOT_AUTO_KICK_DM_ENABLED=false          # DM after auto-kick
USERBOT_BROADCAST_ENABLED=false             # Userbot-based broadcasts
USERBOT_AUTO_JOIN_ENABLED=false             # Broadcast-джойны в группы
USERBOT_AUTO_ADMIN_ENABLED=false            # Автоназначение админов
USERBOT_GROUP_ADMIN_ENABLED=false           # group_create/invite/promote MCP-операции
USERBOT_BOTFATHER_ENABLED=false             # Создание ботов через BotFather из MCP
RESTRICTED_USERBOT_AUTO_DELETE_ENABLED=true # Auto-delete restricted accounts
RESTRICTED_USERBOT_DELETE_AFTER_HOURS=72    # Quarantine window
# тюнинг messaging-роутера: USERBOT_DM_HOURLY_CAP=20, USERBOT_DM_DAILY_CAP=50,
# USERBOT_DM_JITTER_PERCENT=20, USERBOT_JOIN_PER_HOUR=4, USERBOT_JOIN_SLEEP_MS=45000
```

## Design System (`design/`)

Built 2026-09-15/16 (plan: `docs/plans/2026-09-15-unified-design-system.md`). All apps render colors/typography from one DTCG token source; UI guidelines live in root `DESIGN.md`; the single live backlog is `docs/plans/BACKLOG.md`.

- **Iron rule**: values in `design/tokens/color.primitives.json` are byte-equal to Tailwind v4 defaults (`admin-v2/node_modules/tailwindcss/theme.css`). Never edit a primitive to "fix" one screen — changing a primitive changes the whole product (SemVer MAJOR, record in `design/CHANGELOG.md`). New colors enter as semantic aliases on existing ramp steps.
- **Semantic-first for new UI code**: `text-ink-*`, `bg-surface-*`, `border-border-*`, `bg-action-*`, `bg-feedback-*-bg/text` (mapping table in `design/README.md`; color semantics emit as `--color-*`, never `--text-*`). Legacy raw palette classes (`text-slate-500`…) still work — palette aliasing makes them token-driven — and the ratchet gate blocks growth; migrate a page's classes when you touch it.
- **Six apps, not four**: `npm run tokens:build` regenerates byte-identical tokens.css in **admin-v2, site-v2, userbot-v2, bots-v2, treasury-v2, profile-v2**; the ui-sync gate and the hardcodes ratchet scan the same six `src` trees.
- **Gates**: `npm run check:design` (tokens / contrast / hardcodes-ratchet / axe / ui-sync) must pass before push. `--update-baseline` is a conscious operation — justify it in the commit message.
- **Component canonical**: `admin-v2/src/components/ui/` is the source of truth for shared primitives (button/input/badge/card); other apps keep byte-identical copies and the `ui-sync` gate fails on drift. Cross-app shared files beyond the component kit: `src/ui/OpsRail.jsx` (пять аппов: промо-карты, карточка профиля, блок «Казна» по гейту платформенного админа) and `src/app/productTier.js` (admin-v2 + userbot-v2). Promote a component into the canonical kit only with ≥2 real usages.
- **Fonts**: Manrope + JetBrains Mono self-hosted woff2 from each app's `public/fonts/`; vite `base` prefixes: `/paywall/`, `/userbot/`, `/bots/`, `/profile/`, `/treasury/`; site — `/`. Do not reintroduce font npm-packages — prod builds must not depend on conditional `npm install`.
- **Critic ordering (standing owner rule)**: design-critic runs only after code-review AND deploy, on prod screenshots; visible waves also hand the critic a mobile (390px) frame and hover frames of key controls.

## Testing Guidelines

Backend has real test suites now — run the matching one when you touch that area (`cd backend && npm run <script>`):

- `test:autopost` — таймзоны/очередь/tier/reactions/bestof/checklists автопостера + userbot ops
- `test:sales` — права админа в контуре продаж
- `test:messaging` — DM-роутер (квоты, джиттер)
- `test:broadcast` / `test:broadcast-cleanup` — broadcast-роутер и зачистка
- `test:lifecycle` — lifecycle DM
- `test:mcp` — Bullgram MCP shared/dispatch + внешний REST `/api/external/v1`
- `test:contours` — контурный overview

For UI: `npm run build` in the touched app, then verify on production per the Browser Doctrine below. If you add tests, place them next to the feature (`backend/test/test-*.js`) and wire them into `package.json`. After push: watch the GitHub Actions tab — `pm2 reload` happens automatically inside `scripts/deploy-pull.sh`; restart PM2 by hand only if you used the emergency rsync fallback.

## Browser Doctrine (runtime checks)

- All runtime tests of site/admin changes run against the deployed production build (`https://bullgram.xyz`, apps at their v2 paths) in the owner's real Chrome — never against a local dev server or headless Chrome. This includes subagents: explicitly forbid dev servers and headless rendering in their prompts.
- The browser path is the Playwright MCP server in extension mode plus the owner's «Playwright Extension» from the Chrome Web Store: the owner clicks Connect, the agent drives the owner's real Chrome tab with logged-in sessions. See `docs/plans/04-site-verification.md`.
- Only use headless rendering when the owner explicitly asks for it; state the reason before doing so.
- Not verifiable in the browser: real TON transactions, TonConnect confirmations, email delivery — verify those side effects in the database through Supabase MCP.
- **cmux больше не используется** (owner decision 2026-10-14): no cmux panes, surfaces, or `cmux` CLI commands in any workflow. Do not reintroduce them.

## ZCode Workflow (orchestration)

- The main ZCode session is the orchestrator: task decomposition, prompt boundaries, worker selection, merge strategy, final diff review, verification, deployment decisions, user-facing summary.
- Delegate scoped work through the Agent tool: `Explore` for read-only discovery; `general-purpose` for scoped implementation slices, focused verification, and review passes.
- File-based subagents live at `~/.zcode/agents/*.md` (user scope; current set: `code-reviewer`, `design-critic`, `security-auditor`, `debugger`, `postgres-pro`, `deployment-engineer`, `test-engineer`, `mcp-developer`); there is no workspace-scope agent directory in the repo, so for anything not covered by a file-based agent use role-framed prompts on `general-purpose`/`Explore`.
- Role framing for delegation prompts: `context-manager` (repo context packaging, handoff packets), `backend-developer` (`backend/routes|services|jobs`, backend bugs), `frontend-developer` (`admin-v2/src`, `site-v2/src`, and the other v2 apps), `mcp-developer` (Bullgram MCP, `/userbot/mcp`, agent-facing integration), `reviewer` (default close-out review), `code-reviewer` (single-pass review of risky diffs), `architect-reviewer` (cross-runtime boundaries), `api-designer` (contracts), `documentation-engineer` (operator docs).
- Delegation bias: isolated task → delegate; multiple independent tasks → parallel agents; read-only discovery → `Explore`; bounded implementation → `general-purpose`; risky change → review subagent before close-out. The main session coordinates and merges rather than doing all detailed work. Keep architecture decisions, cross-runtime integration, and final verification in the main session; do not split tightly coupled changes across subagents without a clear merge plan.
- Keep delegated workers narrow: exact scope, allowed files, validation expected, return format. Workers never deploy, rollback, run destructive commands, or broaden architecture unless explicitly assigned.
- Required subagent return format:

```
Scope:
Changed:
Validated:
Risks:
Needs:
```

- For close-out, pre-push, and on-demand reviews use the `code-reviewer` subagent for single-pass review, or the `code-review` skill (`.agents/skills/code-review/`) for full parallel multi-lens review.

Workspace skills (`.agents/skills/`): `code-review`, `modern-web-guidance` (mandatory first step for HTML/CSS/client-side JS work), `systematic-debugging`, `test-driven-development`, `security-and-hardening`, `shipping-and-launch`, `supabase-postgres-best-practices` (read relevant rules before writing migration SQL). Standing rule: before hand-rolling a procedure, check whether a skill already covers it.

## Security & Configuration Tips

Never commit `.env`, session files, or production credentials. Document new Supabase or Telegram variables in the relevant README when you introduce them. All API endpoints require a JWT token in the `Authorization: Bearer <token>` header. Telegram sessions are encrypted before database storage.

Money rules (never mix destinations):

- platform lots (proxies, bundles, platform userbots) sold in the `/userbot` storefront accept TON on the **platform site wallet** — наш админский кошелёк; учёт и выводы — в `/treasury`
- a seller admin's own paid-access flows (их официальный бот продаёт доступ в их приватные каналы/чаты) accept TON on **that admin's `payment_settings.ton_wallet`** (owner decision 2026-09-15)
- listed `userbot` assets are reserved from active operations until sold or delisted
- post-purchase delivery is ownership transfer inside Bullgram, not a raw file drop

Userbot operation rules:

- all userbot onboarding goes through proxies; `1 proxy record = 1 userbot`
- new userbots start in `safe-mode` (`runtime_status=pending_activation`) after QR/file import; background jobs must not touch them until manual activation
- userbot automation stays `manual-by-default`
- the manual DM flag stays separate from retention, auto-kick fallback, inbox watcher, and broadcast flags
- if Telegram `SpamBot` confirms a block, that is the source of truth even if a naive session check still passes
- blocked/restricted userbot assets must not remain public in the shop storefront; their dedicated managed proxy is cleaned up when it is no longer shared
- any manual DM UI must warn that Telegram may only allow delivery when the userbot already knows the target or shares a group/chat with them, and that userbot admin rights in that shared group improve the odds
- GramJS lifecycle: init client with the decrypted session → disable the update loop (`client._updateLoop = async () => {}`) → `await client.connect()` → perform operations → `await client.disconnect()` in a `finally` block

## Bullgram MCP, Supabase MCP, And External REST

- `Bullgram MCP` (`POST /api/mcp`) is the primary agent integration path; onboarding screen: `/userbot/mcp`. Do not reintroduce temporary local bridge patterns or DOM/browser-only agent hacks; prefer adding user-scoped MCP tools with explicit names (`summary`, `preview`, `import`, `status`).
- `/api/external/v1` is the external REST surface for agents/integrations (Scalar docs at `/api/external/v1/docs`) — keep its contract documented when you change it.
- `Supabase MCP` is the default path for database inspection and operations: go through it before ad-hoc SQL shells or direct database workarounds.
- Ship read-only and guided-confirm flows first; onboarding copy assumes ordinary admins, not engineers. First `read-only` and guided confirm flows, then free-form automation.

Supabase tunnel: the self-hosted Supabase MCP server runs via bun from `~/.local/share/selfhosted-supabase-mcp/` (config in user `~/.zcode/cli/config.json` under `mcp.servers`; desktop ZCode ignores workspace `.mcp.json` files). The SSH tunnel is managed by the macOS LaunchAgent `com.webzwezda.supabase-mcp-tunnel`: `127.0.0.1:8080` → Kong REST, `127.0.0.1:5432` → direct PostgreSQL (bypasses PgBouncer). Не запускай туннельные скрипты (`ops/scripts/supabase-mcp-tunnel.sh`, `ops/scripts/ensure-mcp-tunnel.sh`) вручную, пока загружен LaunchAgent — они конфликтуют за порты (сам LaunchAgent запускает raw `ssh -L`). Database access is service-role level: full read/write.

## Coding Style & Naming Conventions

Backend: ESM (`import`/`export`), plain JavaScript. Frontend: React/Vite. Match the surrounding file's indentation (files mix 2-space and 4-space). Prefer small route/service modules, descriptive function names, early returns for request validation. Keep new files inside the existing feature area; kebab-case filenames (`official-bot.routes.js`, `auto-kick.job.js`).

Admin-facing UI copy may use blunt, colloquial Russian when it improves clarity for non-technical operators — intentional product style, not a change in system purpose. Prefer short explanations in plain terms that tell the admin why a block matters and what to do next.

If a feature depends on Telegram-specific constraints, explain that directly in the UI.

Payment/plan UX: `Payments / Requisites` stays clean and first-run friendly; tariff/package/referral/webhook complexity lives where the operation happens; do not leak internal trial/debug wording into user-facing forms when backend limits already enforce the rules.

## Current Product Focus & Owner Decisions

- `site-v2` hero sells ONE outcome: infrastructure for AI-agent and n8n builders («Дай своему ИИ-агенту Telegram-аккаунт», RU first, EN later). For THIS technical audience naming MCP/API/proxies in the hero subline is correct and expected (owner decision 2026-09-21, superseding the 2026-09-12 consumer framing). The «one outcome, no feature dump» principle still stands. Autopost/paywall/shop stay OFF the homepage.
- Секция доступа на главной — ровно три инструмента: REST API / Bullgram MCP / Telegram Web (Telegram Web первым; решение владельца 2026-09-30).
- Соцпомощь: `/access-request` — форма для людей с инвалидностью (тариф Normal бесплатно); ссылка первой строкой под тарифами, поддержка Telegram — второй (BACKLOG §17, закрыт 2026-09-30).
- Upgrade path `Trial -> Normal -> Seller` must be preserved and strengthened in UI and backend limits.
- ProductMenu (BACKLOG §23) — глобальная навигация поверхностей в сайдбарах — черновик, запуск по слову владельца. Do not implement without the owner's go.
- Known platform facts (BACKLOG §21-22): Supabase Realtime WS отвечает 403 на проде — живой пуш в журнале автопостера не работает, REST-поллинг ок; `autopost_bots.bot_token` хранится открытым текстом (осознанно); unlayered `a { color: inherit }` в index.css аппов ломает цветовые утилиты на анкорах (лечится `!`-суффиксом или переносом в `@layer base`).
