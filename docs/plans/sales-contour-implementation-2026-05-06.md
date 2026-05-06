# Sales Contour Implementation Plan - 2026-05-06

## Scope Analyzed

- Admin setup surface: `/app/botfather`
- Telegram target discovery/readiness: `/app/admin-groups`, `/app/plans`, ops checklist
- Backend ownership and runtime paths:
  - `backend/routes/official-bot.routes.js`
  - `backend/services/official-bot.service.js`
  - `backend/routes/userbot.routes.js`
  - `backend/services/customer-reconciliation.service.js`
- Current DB canon:
  - `channels` = canonical Telegram access targets
  - `tg_accounts` = bot/userbot inventory
  - `customer_reconciliation_sources` = low-level scan layer
  - `userbot_center_*_cache` = cached operator telemetry, not source of truth

## Key Findings

- `placeholder` cannot safely reuse `tg_accounts.bot_role`.
  - Current code treats almost every non-`ops` bot as sales runtime or sales readiness:
    - `admin-v2/src/pages/bots/useOfficialBotsController.js`
    - `backend/routes/dashboard.routes.js`
    - `backend/services/official-bot.service.js`
- `channels` should stay canonical for Telegram targets.
  - Official bot already upserts target chats into `channels` on `my_chat_member`.
  - Userbot sync already enriches `channels.bot_id` from live dialogs.
- `customer_reconciliation_sources` is not a good top-level contour source.
  - It is a scan/config layer for userbot discovery and currently enforces single active contour userbot in Milestone A.
- `userbot_center_group_cache` and `userbot_center_conversation_cache` are telemetry/cache only.
  - Good for hints and handoff, bad as configuration ownership.

## Recommended Backend Shape

- Keep `tg_accounts.bot_role` for runtime role only: `sales` / `ops`.
- Add a separate bot type field on `tg_accounts`, for example `bot_kind text not null default 'sales'`.
  - Allowed values for now: `sales`, `template`.
  - `template` hides sales contour and should not enter sales readiness.
- This is intentionally better than storing `placeholder` inside `bot_role`: existing runtime code already treats `bot_role` as executable bot behavior.
- Add a dedicated table `sales_bot_contours` keyed by official sales bot:
  - `bot_id uuid primary key references tg_accounts(id) on delete cascade`
  - `owner_id uuid not null`
  - `paid_channel_id uuid not null references channels(id)`
  - `public_chat_id uuid null references channels(id)`
  - `userbot_mode text not null` with `none | single | pool`
  - `selected_userbot_id uuid null references tg_accounts(id)`
  - `selected_userbot_ids jsonb not null default '[]'::jsonb`
  - `created_at`, `updated_at`
- Optional future table for true pool operations: `sales_bot_contour_userbots`.
  - MVP can store selected pool IDs in `selected_userbot_ids`.
  - If pool mode starts carrying per-userbot status, roles, pacing, or health, move it into a join table with `role`, `status`, and `scan_priority`.
- Validation rules in backend, not only UI:
  - bot must belong to owner and have `account_type = 'bot'`
  - `bot_kind = 'sales'` for contour save
  - `paid_channel_id` must belong to owner and be a `channels` row
  - `public_chat_id` is optional, must belong to owner, and should be `group` / `supergroup`
  - `paid_channel_id` and `public_chat_id` should already be attached to this bot via `channels.bot_id`, or return actionable warning/error
  - `selected_userbot_id` / `selected_userbot_ids` must reference owner userbots only
  - exclude reserved-in-shop, fresh-import, dead-proxy userbots from selectable contour options by reusing reconciliation availability logic

## API Plan

- Extend `backend/routes/official-bot.routes.js`:
  - `GET /api/official-bot/contours`
    - list sales/template bots with contour config, target readiness, eligible channels, eligible userbots, warnings
  - `POST /api/official-bot/contours`
    - upsert contour for one bot
  - `POST /api/official-bot/type`
    - switch `bot_kind` between `sales` and `template`
- Add contour loaders/validators in a small backend helper, preferably new file:
  - `backend/services/sales-contour.service.js`
- Reuse, do not duplicate:
  - `channels` ownership and bot linkage from existing `official-bot.service.js`
  - userbot eligibility rules from `customer-reconciliation.service.js`
  - optional admin-right hints from `userbot.routes.js` admin audit / userbot-center cache

## Frontend Surfaces

- Primary surface: `admin-v2/src/pages/bots/OfficialBotsSection.jsx`
  - keep current connect-bot card
  - keep connected bots list
  - add per-bot type switch: `Бот продаж` / `Заготовка`
  - show `SalesContourSection` only when selected bot has `bot_kind = 'sales'`
- Better split than bloating current component:
  - new `admin-v2/src/pages/bots/SalesContourSection.jsx`
  - new `admin-v2/src/pages/bots/useSalesContourController.js`
  - extend `admin-v2/src/pages/bots/useBotsAccountsData.js` or load contour payload from backend-only endpoint
- Contour form fields:
  - official bot: current selected bot
  - paid group/channel: required, from `channels` already linked to this bot
  - public chat: optional, from `channels` linked to this bot and `chat_type = group/supergroup`
  - userbot mode:
    - `Без юзербота`
    - `Один юзербот`
    - `Пул юзерботов`
  - if `single`: one selectable eligible userbot
  - if `pool`: checklist/multiselect of eligible userbots
  - short Telegram warnings inline
- Secondary surfaces to update after save:
  - `admin-v2/src/ui/OpsChecklistRail.jsx`
    - replace loose “Telegram бот” readiness with stricter contour readiness
  - `backend/routes/dashboard.routes.js`
    - expose contour summary/readiness counts
  - `admin-v2/src/pages/payment-settings/TariffsSection.jsx`
  - `admin-v2/src/pages/payment-settings/useTariffsController.js`
    - prefill new tariff from `paid_channel_id`
    - warn when active tariff target diverges from contour paid target
  - `admin-v2/src/pages/AdminGroupsPage.jsx`
    - highlight which linked places are the chosen paid target and chosen public chat

## Migration Strategy

- Phase 0 migration:
  - add `tg_accounts.bot_kind` with default `sales`
  - backfill all existing bots as `sales`
  - create `sales_bot_contours`
- Phase 1 backfill:
  - no forced contour backfill
  - optionally auto-suggest draft contour from:
    - first linked `channels` row on the selected sales bot
    - first active tariff channel for that bot
  - keep drafts only in API response until user confirms
- Runtime compatibility:
  - existing invoice/access flow continues to read `tariffs.channel_id`
  - contour does not silently override tariff delivery
  - contour is setup/readiness/default-selection layer first

## Telegram/Product Risks

- Official bots cannot reliably discover all chats on their own.
  - `my_chat_member` and existing `sync-channels` remain the source of target discovery.
- Public chat is not the same thing as paid chat bundle in tariffs.
  - Do not overload `tariff_bundle_items` or `/app/plans` “chat delivery” as contour public chat.
- Public chat membership is not permission to DM.
  - Keep the default policy as shared-chat/manual-confirmation only.
  - UI copy must not imply guaranteed DM reachability.
- Multi-userbot pool is structurally blocked in current reconciliation layer.
  - `customer-reconciliation.service.js` currently enforces a single active contour userbot.
  - MVP pool should not auto-wire multiple userbots into reconciliation sources.
- Userbot choices must respect existing safety rules:
  - manual-by-default
  - exclude blocked/restricted/reserved assets
  - do not imply guaranteed DM reachability; Telegram may require shared group/admin context
- No Telegram participant parsing on page load.
- No background crawling in the first contour MVP.
- Every scan/verify/sync action stays explicit and rate-limited.

## MVP Stages

- MVP A
  - add `bot_kind`
  - add `sales_bot_contours`
  - `/app/botfather` shows contour only for `sales`
  - support `paid_channel_id`, optional `public_chat_id`, `userbot_mode = none | single`
  - readiness API + checklist update
- MVP B
  - tariff prefill/warnings from contour
  - admin-groups highlighting for chosen targets
  - draft suggestion from linked channels / active tariffs
- MVP C
  - `pool` persistence + UI selection
  - pool used only as operator selection/handoff first
  - no automatic multi-userbot reconciliation activation yet
- MVP D
  - if needed, refactor reconciliation layer to support more than one active userbot per sales contour
  - only after contract and operational semantics are explicit

## Validation Status

- Verified in code and DB:
  - `channels`, `tg_accounts`, `customer_reconciliation_sources`, `userbot_center_*_cache` current columns
  - existing `/app/botfather` page shape
  - existing official-bot runtime and userbot sync/audit entry points
- Still needs runtime/product confirmation:
  - whether one sales bot should own exactly one paid target long-term
  - whether “public chat” must always have official bot admin rights
  - whether pool mode is intended for manual outreach only or future automation

## Implementation Review - 2026-05-06

- Done: added `tg_accounts.bot_kind` and `sales_bot_contours`.
- Done: added `/api/official-bot/type`, `/api/official-bot/contours` read/save endpoints.
- Done: template bots no longer start official-bot runtime; switching back to sales restarts runtime.
- Done: `/app/botfather` shows bot type and renders sales contour only for sales bots.
- Done: contour MVP supports paid target, optional public chat, and `none | single | pool` mode selection; pool is visible but not saved by the UI yet.
- Done: backend rejects contours for `ops` bots, rejects unavailable userbots, and rejects the same Telegram place as both paid and public target.
- Done: SQL now includes integrity checks for distinct targets and userbot-mode payload shape.
- Verified: `node --check backend/routes/official-bot.routes.js`.
- Verified: `node --check backend/services/sales-contour.service.js`.
- Verified: `cd admin-v2 && npm run build`.
- Applied: Supabase migrations `sales_contours_botfather_mvp`, `sales_contours_selected_userbot_index`, `sales_contours_selected_userbot_covering_index`, `sales_contours_integrity_checks`.
- Residual risk: if a template bot was made admin in Telegram while its runtime was disabled, Telegram may not replay old `my_chat_member` updates after switching it to sales. UI now warns the operator to re-sync/rebind Telegram places if linked targets do not appear.

## Userbot Admin Preparation - 2026-05-06

- Goal: official BotFather bot should act as the controlled admin handoff point for a selected contour userbot.
- Rule: no Telegram crawling or automatic checks on page load; Telegram is touched only by explicit operator button.
- Backend endpoints:
  - `POST /api/official-bot/contours/check-rights`
    - compatibility alias kept: `POST /api/official-bot/contours/rights`
    - body: `bot_id`, optional `target = paid | public`
    - uses the already saved `sales_bot_contours` row as source of truth
    - checks official bot membership/admin rights in the saved contour target
    - returns `rights.is_admin`, `rights.can_invite_users`, `rights.can_promote_members`, `rights.can_manage_chat`, `warnings`
  - `POST /api/official-bot/contours/prepare-userbot`
    - body: `bot_id`, optional `target = paid`
    - requires saved contour with `userbot_mode = single` and `selected_userbot_id`
    - UI intentionally blocks unsaved draft changes before calling this endpoint
    - UI uses paid target for userbot preparation
    - if userbot is not in the target chat, creates an invite link and returns `status = needs_join`
    - if userbot is already a `member`, promotes it with the minimal safe admin-right set
    - if userbot is already `administrator`, returns `status = already_admin`
- Safety rules:
  - official bot must already be admin with `can_invite_users` and `can_promote_members`
  - userbot must already be eligible for contour use
  - promote does not grant `can_promote_members`, `can_change_info`, `can_delete_messages`, or `can_restrict_members`
  - the system never promises guaranteed private-message delivery
- Verification:
  - `node --check backend/routes/official-bot.routes.js`
  - `node --check backend/services/sales-contour.service.js`
  - `cd admin-v2 && npm run build`
- Residual risk:
  - runtime validation against live Telegram was not possible in this task because deploy/server start were explicitly out of scope
