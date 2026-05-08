# Official Bot Webhook Runtime Plan - 2026-05-07

## Problem

Current official-bot runtime starts one Telegraf polling instance per active bot:

- `initAllBots(supabase)` loads all bot accounts.
- `officialBotService.startBot(...)` creates `new Telegraf(token)`.
- `bot.launch()` starts runtime for that bot.

This is acceptable for a small number of bots, but it does not scale cleanly to hundreds or thousands of official bots.

## Goal

Move official bots from many polling runtimes to webhook-based ingestion:

- Telegram sends updates to BullRun.
- BullRun accepts updates quickly.
- Processing runs through controlled workers.
- DB remains the source of truth.
- `/app/botfather` reads cached state, not live Telegram scans.

## Non-Goals

- Do not make official bots scan all chats. Bot API cannot list all groups/channels for a bot.
- Do not move userbot logic into official-bot runtime.
- Do not rewrite all bot business logic in one pass.
- Do not break existing polling bots during migration.

## Target Architecture

### 1. Webhook Receiver

Add a backend route for Telegram updates:

- `POST /api/telegram/webhook/:botId/:secret`
- validates `botId` and secret
- resolves the bot account from `tg_accounts`
- accepts update quickly
- stores or enqueues update
- returns `200 OK` fast

### 2. Update Queue

Introduce an update buffer before business processing.

Initial practical option:

- DB-backed queue table if we want minimum infrastructure.

Future stronger option:

- Redis/BullMQ or another queue when volume grows.

Required fields:

- `id`
- `bot_id`
- `owner_id`
- `telegram_update_id`
- `update_type`
- `payload`
- `status`
- `attempts`
- `created_at`
- `processed_at`
- `last_error`

### 3. Worker Processing

Workers consume queued updates and call shared bot handlers.

Rules:

- idempotent by `bot_id + telegram_update_id`
- retry transient errors
- dead-letter repeated failures
- never block webhook response while doing long work

### 4. Shared Handler Layer

Refactor `OfficialBotService.startBot` so handlers can be reused by:

- current polling runtime during migration
- future webhook worker runtime

Target shape:

- register command/action/message handlers in reusable functions
- keep payment/access/referral logic in service methods
- keep Telegram update transport separate from business logic

### 5. Telegram Place Discovery

Keep current product model:

- `my_chat_member` and related updates discover places
- known places are stored in `channels`
- `/app/botfather` reads DB
- `Обновить` updates a known place only

Webhook runtime should preserve this behavior.

## Migration Stages

### Stage 1 - Handler Extraction

- Extract official-bot handlers from `startBot` into reusable registration functions.
- Keep current polling behavior working.
- No webhook behavior enabled yet.

Validation:

- backend syntax check
- current bot start still works
- payment/referral/access callbacks still registered

### Stage 2 - Webhook Account Fields

Add fields to `tg_accounts` or a related table:

- `webhook_mode`: `polling` / `webhook`
- `webhook_secret`
- `webhook_url`
- `webhook_set_at`
- `webhook_status`
- `last_update_at`

Default all existing bots to `polling`.

Validation:

- migration applied
- old bots unchanged

### Stage 3 - Webhook Receiver

- Add `POST /api/telegram/webhook/:botId/:secret`.
- Validate bot and secret.
- Insert update into queue.
- Return `200 OK`.

Validation:

- invalid secret rejected
- valid update inserted once
- duplicate update ignored or no-op

### Stage 4 - Queue Worker

- Add worker loop/job to process queued updates.
- Resolve bot token/account.
- Run shared handlers against update context.
- Track success/failure.

Validation:

- update processed from queue
- failed update retries
- repeated failure lands in dead-letter state

### Stage 5 - Webhook Registration

Add backend admin endpoint:

- set webhook for one bot
- unset webhook and return to polling
- check webhook info

Important:

- only switch one test bot first
- keep rollback path to polling

Validation:

- Telegram `setWebhook` succeeds
- `getWebhookInfo` shows expected URL
- test bot receives `/start`
- place discovery still records `channels`

### Stage 6 - Admin UI

In `/app/botfather`, show runtime mode:

- `Polling`
- `Webhook`
- `Webhook ошибка`

Actions:

- `Перевести на webhook`
- `Вернуть polling`
- `Проверить webhook`

Keep this hidden/guarded at first if needed.

### Stage 7 - Gradual Migration

- Start with one internal bot.
- Move 5-10 low-risk bots.
- Watch logs, queue depth, update latency.
- Then migrate batches.

Do not migrate all bots at once.

## Operational Requirements

- stable public HTTPS backend URL
- secret per bot
- monitoring for:
  - webhook request rate
  - queue depth
  - worker failures
  - dead-letter count
  - Telegram API errors
- rollback command or admin action per bot

## Risks

- Telegraf context assumptions may be tied to polling.
- Some handlers may expect immediate `ctx` behavior.
- Telegram webhook delivery requires fast `200 OK`; slow handlers must not run inline.
- Duplicates can happen; update handling must be idempotent.
- Existing active bots must not be interrupted during migration.

## Acceptance Criteria

- One official bot runs in webhook mode without polling.
- `/start` works.
- payment callbacks work.
- referral callbacks work.
- `my_chat_member` updates still create/update `channels`.
- `/app/botfather` shows known Telegram places from DB.
- Switching bot back to polling works.
- Backend can restart without losing queued updates.

## Recommended First Implementation Slice

Smallest useful first slice:

- add webhook-related fields/migration
- add `webhook_mode` config but keep default `polling`
- add safe webhook receiver that only stores updates
- do not process business actions yet

This proves secure ingestion before touching bot behavior.

## Implementation Pass 1 - Foundation

Status: completed locally, SQL applied through Supabase MCP.

Changes:

- Added reproducible SQL foundation in `backend/sql/official-bot-webhook-runtime.sql`.
- Added `tg_accounts.webhook_mode`, `webhook_secret`, `webhook_url`, `webhook_set_at`, `webhook_status`, and `last_update_at`.
- Added DB-backed queue table `official_bot_update_queue` with idempotency by `bot_id + telegram_update_id`.
- Added public receiver `POST /api/official-bot/webhook/:botId/:secret`.
- Receiver validates bot id, secret, `webhook_mode = webhook`, owner presence, and Telegram `update_id`.
- Receiver stores the raw Telegram update only; it does not run bot business handlers yet.
- Existing bots remain on polling because the default `webhook_mode` is `polling`.
- Server startup now skips polling runtime for accounts explicitly switched to `webhook`.

Validation:

- `node --check backend/routes/official-bot.routes.js`
- Supabase schema check confirmed the new `tg_accounts` columns and `official_bot_update_queue` table.
- Supabase advisors were checked after DDL. Existing unrelated warnings remain; new queue indexes appear as unused because no production traffic has used them yet.

Next slice:

- Add controlled admin endpoint to generate/store `webhook_secret`, calculate public webhook URL, call Telegram `setWebhook`, and switch one selected bot to `webhook`.
- Do not add worker processing until we verify Telegram delivery into the queue.

## Implementation Pass 2 - Controlled Runtime Switch

Status: completed locally.

Changes:

- Added `OFFICIAL_BOT_WEBHOOK_ORIGIN` to `backend/.env.example`.
- Added authenticated endpoint `POST /api/official-bot/webhook-runtime/:accountId/enable`.
- Enable endpoint:
  - loads an owned official bot,
  - decrypts the stored token,
  - generates or reuses `webhook_secret`,
  - builds `https://.../api/official-bot/webhook/:botId/:secret`,
  - stops local polling runtime for that bot,
  - calls Telegram `setWebhook`,
  - saves `webhook_mode = webhook`, `webhook_url`, `webhook_status`, and runtime metadata.
- Added authenticated endpoint `POST /api/official-bot/webhook-runtime/:accountId/disable`.
- Disable endpoint calls Telegram `deleteWebhook`, switches DB back to `polling`, and restarts polling runtime when the bot type allows it.
- Added authenticated endpoint `GET /api/official-bot/webhook-runtime/:accountId/status`.
- Status endpoint calls Telegram `getWebhookInfo` and saves a compact status snapshot back to `tg_accounts`.

Validation:

- `node --check backend/routes/official-bot.routes.js`

Next slice:

- Add a small guarded UI in `/app/botfather` for internal testing:
  - show runtime mode,
  - button `Включить прием событий`,
  - button `Проверить webhook`,
  - button `Вернуть polling`.
- Test only one internal bot first before moving business handlers to the queue worker.

## Implementation Pass 3 - BotFather Runtime UI

Status: completed locally.

Changes:

- Added official-bot controller actions in `admin-v2/src/pages/bots/useOfficialBotsController.js`:
  - enable webhook runtime,
  - disable webhook runtime,
  - refresh webhook status.
- Added a compact `Прием событий` block to `/app/botfather` in `OfficialBotsSection`.
- The block shows:
  - `Polling`,
  - `Webhook включен`,
  - `Webhook получает события`,
  - `Webhook ошибка`.
- The block exposes actions:
  - `Включить прием событий`,
  - `Проверить webhook`,
  - `Вернуть polling`.
- Existing Telegram places and sales contour UI remain unchanged.

Validation:

- `cd admin-v2 && npm run build`

Next slice:

- Deploy backend + admin together before testing the UI.
- On one internal bot:
  - enable webhook,
  - add bot as admin to a test chat/channel,
  - verify Telegram update lands in `official_bot_update_queue`,
  - only then start moving `my_chat_member` processing from polling handlers to queue worker.
