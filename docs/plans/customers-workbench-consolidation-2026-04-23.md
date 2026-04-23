# Customers Workbench Consolidation - 2026-04-23

## Why

Current admin pages split one operator workflow across too many screens:

- `/app/crm`
- `/app/orders`
- `/app/abandoned`
- `/app/access`
- `/app/dossier`
- `/app/bases`
- `/app/broadcast`
- `/app/userbot-center`

The useful work is repeated everywhere: find a person or segment, understand money/access status, then message, extend, kick, export, or open dossier.

The current UI also wastes the first screen with long explanations, hero panels, repeated signal cards, and duplicated stats. The interface should be self-evident: compact controls first, working queue immediately visible.

## Product Rule

Do not delete old functionality first.

Build one clean `Customers` workbench, route old pages into it or keep them as technical deep links, then remove sidebar clutter only after feature parity is verified.

## Target Navigation

Primary sidebar should have one main customer ops entry:

- `Клиенты`

Technical/supporting routes stay available but should not all be top-level daily menu items:

- `Orders` becomes `Клиенты -> Заказы` or a deep link.
- `CRM` becomes `Клиенты -> Подписки`.
- `Abandoned` becomes `Клиенты -> Неоплаты`.
- `Access` becomes `Клиенты -> Доступ`.
- `Dossier` becomes a drawer/detail route, not a top-level menu item.
- `Bases` becomes `Клиенты -> Базы / Sync`, or advanced.
- `Broadcast` stays separate as the full composer, but Customers can send selected segments into it.
- `Userbot Center` stays separate as manual outreach/inbox infrastructure.
- `Shop Receipts` stays in finance/shop, not customer workbench.

### Admin-Only Hidden Pages

Do not delete old pages immediately.

After Customers reaches parity, move legacy/technical customer pages into an admin-only menu group:

- Menu label: `Скрытые страницы`
- Visibility: only `profiles.role = admin`
- Purpose: emergency access, regression checks, and temporary rollback while Customers stabilizes.

Pages to hide from normal admins/operators:

- `/app/crm`
- `/app/orders`
- `/app/abandoned`
- `/app/access`
- `/app/dossier`
- `/app/bases`

Pages that should remain normal top-level or normal grouped tools:

- `/app/customers` - main daily customer workbench.
- `/app/broadcast` - full broadcast composer.
- `/app/userbot-center` - manual userbot inbox/DM tool.
- `/app/payments`, `/app/billing`, `/app/plans` - payments/tariffs setup.
- `/app/shop`, `/app/shop-receipts` - shop/P2P flow.
- `/app/referrals` - partner program.
- `/app/userbots`, `/app/proxies`, `/app/botfather`, `/app/admin-groups` - Telegram infrastructure.

Rule:

- Non-admin users should not see `Скрытые страницы`.
- Hidden pages must stay routable during transition unless explicitly replaced by redirects.
- Do not use the hidden menu as a permanent product surface; it is a transition/safety tool.

## Target Screen

Route: `/app/customers`.

Tabs:

- `Очередь` - combined actionable queue.
- `Смотрели тарифы` - new tracking, not implemented yet.
- `Бросили счет` - current abandoned invoices.
- `Клиенты` - current active/expired subscriptions.
- `Заказы` - current invoice/payment/access rows.
- `Доступ` - current invite/access issues.
- `Базы` - customer base sync and presence checks, advanced.

Top layout:

- One compact header: title, refresh state, last sync.
- One compact KPI strip, max 4-6 items.
- No hero panel.
- No long explanatory paragraph.
- No duplicated `prioritySignals` plus `StatCard` grids.
- Main table/queue must be visible on the first screen.

Common row actions:

- `Досье`
- `Написать`
- `В рассылку`
- `+5 дней`
- `+30 дней`
- `Кикнуть`
- `CSV`
- `Проверить присутствие`

## Preserve Existing Functionality

### Abandoned / Unpaid

Preserve:

- UI filters from `admin-v2/src/pages/AbandonedPage.jsx`.
- `pending` / `awaiting_receipt` invoices.
- CSV export.
- Reminder text and discount settings.
- Existing job `backend/jobs/abandoned-cart.job.js`.
- Broadcast segment `unpaid_leads`.

Risks:

- The job mutates `invoices.amount` when discount is applied.
- There is no event trail for discount/reminder.
- Do not remove `invoices.reminded`.

Target:

- Move visible queue into `Customers -> Бросили счет`.
- Move reminder text/discount into an advanced settings panel.

### Orders

Preserve:

- `GET /api/orders`.
- Payment status, access status, referral context.
- Filters: paid, access pending, referrals, trial, broken.
- Links/actions to dossier, access, userbot, CRM.

Risks:

- `backend/routes/orders.routes.js` currently reads last 150 invoices globally and filters owner in JS. This can drop owner rows when volume grows.

Target:

- Move operational table into `Customers -> Заказы`.
- Keep finance-level order details if needed as deep link.
- Fix owner-scoped pagination before relying on this for larger data.

### CRM / Subscriptions

Preserve:

- `GET /api/userbot/crm/subscribers`.
- Batch add days.
- Batch kick.
- Filters: active, expired, missing join, expired in group, active in group.
- Broadcast handoff and Userbot Center handoff.

Risks:

- CRM subscription rows alone do not prove the user is currently in group.
- `days` validation is weak.
- Batch kick returns aggregate result, not per-row errors.

Target:

- Make this the core of `Customers -> Клиенты`.
- Use `customer_base_members.present_now` or explicit userbot presence scan when available.

### Access

Preserve:

- `GET /api/access`.
- Invites, events, access issues.
- Pending access and stale expired logic.
- Extend/kick/handoff actions.

Risks:

- Current UI still has strong wording like `Оплатил, но не зашел`.
- Route limits only last 100 invites and 150 events.

Target:

- Move into `Customers -> Доступ`.
- Use wording `Вход не подтвержден`.
- Keep access as technical event log, not the primary customer screen.

### Dossier

Preserve:

- `GET /api/client-dossier/:tgUserId`.
- Summary, orders, subscriptions, invites, access events, payment events, base memberships, referral context.

Target:

- Convert to drawer/detail from Customers.
- Keep `/app/dossier?tg=...` as compatibility route.
- Remove from top-level sidebar later.

### Customer Bases / Presence

Preserve:

- `GET/POST /api/customer-bases`.
- Base channel binding.
- `POST /api/customer-bases/:id/sync`.
- `GET /api/customer-bases/:id/members`.
- Manual add.
- Import selected base members into CRM.
- Free rider / expired paid inside / active paid classification.

Risks:

- Sync first marks existing members `present_now=false`, then scans Telegram. Partial Telegram failures can create false missing statuses.
- Presence scans are expensive and depend on live userbot/proxy state.

Target:

- Use this as the strongest signal for `currently in group`.
- Keep sync explicit, with `last sync`, `partial failure`, and `scan required` states.
- Do not run heavy Telegram scans on every Customers page load.

### Broadcast

Preserve:

- `POST /api/broadcast/preview`.
- `POST /api/broadcast/send`.
- `GET /api/broadcast/campaigns`.
- Audience types:
  - `active_subscribers`
  - `expired_subscribers`
  - `unpaid_leads`
  - `paid_not_joined`
  - `customer_base_members`
  - `manual_list`
  - `trial_active`
  - `trial_expiring`
  - `trial_unpaid`
  - `channel_active`
- `broadcast_manual_selection` handoff.
- Userbot sender risk confirmation.

Target:

- Customers can send selected rows into Broadcast.
- Full Broadcast composer remains separate.

### Userbot Center

Preserve:

- `/api/userbot/ops-center`.
- `/api/userbot/ops-center/thread`.
- `mark-read`.
- `join-invite`.
- authorizations and reset-others.
- `POST /api/userbot/send-message`.
- `bullrun_userbot_center_handoff`.
- Manual confirmation and common-chat/known-dialog guardrails.
- `USERBOT_DM_ENABLED` behavior.
- Telegram error logging.

Target:

- Customers action `Написать` opens Userbot Center with handoff.
- Do not inline all userbot center complexity into Customers.

### Shop Receipts

Preserve separately:

- P2P/shop receipt approval flow.
- `awaiting_receipt` purchase queue.

Target:

- Keep in finance/shop area.
- Do not merge with customer subscription orders unless a direct customer TG link is needed later.

## Missing Functionality

### Tariff View Tracking

Currently missing.

Need a new table, for example `customer_funnel_events`:

- `id`
- `owner_id`
- `bot_id`
- `tg_user_id`
- `tariff_id`
- `event_type`
- `source`
- `referral_code`
- `session_key`
- `payload`
- `created_at`

Initial event types:

- `tariff_list_opened`
- `tariff_card_opened`
- `payment_method_selected`
- `invoice_created`

Write events from:

- `buy_tariff`
- `show_tariff_*`
- `buy_*`
- `pay_tariff_*`

Goal:

- Build real `Смотрели тарифы` segment.
- Separate `смотрел тариф` from `создал счет`.

### Ops Audit Trail

Needed later:

- manual add days
- batch kick
- import from base
- manual base add
- reminder sent

This can be a separate `customer_ops_events` table or reuse a broader event table.

## UI Cleanup Rules

Apply these rules to all customer/money/access ops pages:

- Delete `hero-panel` from daily work screens.
- Delete long explanatory paragraphs under page headers.
- Delete duplicate `prioritySignals` when the same numbers are already in `StatCard`.
- Keep at most one compact KPI strip.
- Keep `PlanBanner` / `UpgradeCallout` out of daily operator flow, or move them to Command Center/onboarding.
- Main table or queue must start near the top.
- Empty state should be short and actionable.
- Copy should be labels, statuses, and next actions, not page essays.
- Use cautious wording for inferred access state:
  - Good: `Вход не подтвержден`
  - Bad: `Оплатил, но не зашел`

## Compatibility Handoffs To Preserve

- `broadcast_manual_selection`
- `bullrun_userbot_center_handoff`
- `abandoned_filter_preset`

Need to review before removal:

- `orders_manual_selection`
- `orders_search_preset`
- `crm_focus_channel`
- `orders_focus_channel`
- `access_focus_channel`

Some of these appear set-only or partially broken. Do not rely on them until verified.

## Review Addendum - 2026-04-23

Independent reviewer pass found several plan gaps that must be handled before old pages are hidden.

### Owner-Scoped Query Rule

The owner-scoping issue is broader than `/api/orders`.

Before Customers becomes the source of truth, fix owner-scoped querying/pagination for all aggregated customer segments:

- `backend/routes/orders.routes.js` currently reads global recent invoices, then filters owner in JS.
- `backend/routes/broadcast.routes.js` loads paid and unpaid invoice audiences globally, then filters by owned channels.
- `backend/routes/customer-bases.routes.js` loads invoice stats globally, then hydrates base members.
- `backend/routes/client-dossier.routes.js` loads invoices by TG ID, then owner-filters after joins/limits.

Rule:

- Customers backend must query by owner-owned tariffs/channels first.
- Do not apply global `limit` before owner filtering.
- Acceptance for Phase 3 includes owner-scoped SQL/pagination for Orders, Broadcast audiences, Customer Bases enrichment, and Dossier.

### Compatibility Matrix Required

Before redirecting old routes, create and verify a source-to-target handoff matrix.

Known sources:

- `AdminGroupsPage` writes:
  - `crm_focus_channel`
  - `orders_focus_channel`
  - `access_focus_channel`
- `RetentionPage` writes:
  - `retention_filter_preset`
  - `crm_focus_channel`
  - `orders_focus_channel`
  - `broadcast_manual_selection`
- `PaymentEventsSection` writes:
  - `orders_search_preset`
- `AbandonedPage` writes:
  - `orders_manual_selection`
  - `orders_search_preset`
  - `broadcast_manual_selection`
- `AnalyticsPage` writes:
  - `abandoned_filter_preset`
  - `retention_filter_preset`
- `CommandCenterPage` links to:
  - `/app/orders`
  - `/app/access`
  - `/app/abandoned`

Each source must map to one Customers tab/action or stay on its old route until replaced.

### Dossier / Base Membership Contract

Current Dossier backend expects base membership fields that are computed dynamically in Customer Bases, not stored as columns:

- coverage/payment status
- present/missing channel titles
- free rider / expired inside classification

Before converting Dossier to a drawer:

- extract a shared backend hydrator for base membership enrichment; or
- add schema-backed computed/snapshot fields intentionally.

Acceptance:

- Dossier drawer shows the same base/payment/coverage signals as `/app/bases`.
- No loss of `free_rider`, `expired_paid_inside`, `active_paid`, `unpaid_lead`, coverage, and `present_now` context.

### Message Action Guardrail

`Написать` is not a simple inline DM action.

Backend manual DM requires:

- `USERBOT_DM_ENABLED`
- `manual_confirmed=true`
- known dialog or `common_chat_id`
- 4000 char limit
- Telegram privacy/flood/spambot error handling

Customers behavior:

- Open Userbot Center through `bullrun_userbot_center_handoff`.
- Pass `tg_user_id`, draft message, and common chat/channel context when known.
- If common chat is unknown, Userbot Center must require choosing one.
- Do not inline direct DM sending into Customers in MVP.

### Abandoned Settings Backend Parity

`AbandonedPage` currently reads/writes `payment_settings.abandoned_text` and `abandoned_discount_percent` directly through frontend Supabase.

If Customers moves abandoned management behind backend aggregator:

- add backend read/write for these settings; or
- keep the existing Supabase-backed settings panel until parity.

Do not remove the dожим text/discount settings during visual cleanup.

### Customer Bases Parity

Parity for Bases must be explicit.

Current UI covers:

- base CRUD
- channel binding
- sync via userbot
- manual add
- member filters

Backend also has latent/current endpoints not fully surfaced:

- `import-subscriptions`
- `manual_only`/`synced_only` assumptions, while manual-add may not reliably set `source`

Before hiding `/app/bases`:

- decide whether Customers covers only current UI parity or also exposes `import-subscriptions`;
- fix or document `source` behavior for manual/synced filters.

## Implementation Phases

### Phase 1 - Visual Declutter Without Data Changes

Status: implemented locally, build verified.

- Strip hero panels and duplicate stat grids from:
  - CRM
  - Orders
  - Access
  - Abandoned
  - Dossier
- Keep current routes.
- Keep current data calls.
- Verify build and live routes.

Acceptance:

- Main table appears on the first screen.
- No functional action removed.
- No deploy-time runtime errors.

Implemented:

- Removed hero/intro panels from `/app/crm`, `/app/orders`, `/app/access`, `/app/abandoned`, `/app/dossier`.
- Removed duplicated `prioritySignals` grids and trial upsell banners from those daily ops screens.
- Kept existing routes, data calls, filters, tables, CSV/settings, Broadcast handoffs, Userbot Center handoffs, and Dossier links.
- Reworded unsafe access wording from `Оплатил, но не зашел` to `Вход не подтвержден`.
- Removed self-links like `Открыть этот экран отдельно` from the same page.
- Verified with `cd admin-v2 && npm run build`.

### Phase 2 - Customers Workbench Shell

Status: implemented locally, build verified.

- Add `/app/customers`.
- Add sidebar item `Клиенты`.
- Reuse existing frontend calls:
  - `/api/userbot/crm/subscribers`
  - `/api/orders`
  - `/api/access`
  - current Supabase abandoned invoice query or new backend endpoint
  - `/api/customer-bases`
- Implement tabs with shared search/action bar.
- Keep old routes intact.

Acceptance:

- Customers shows the same rows as old pages.
- Bulk handoff to Broadcast works.
- Handoff to Userbot Center works.
- Dossier opens from rows.

Implemented:

- Added `/app/customers` frontend shell.
- Added sidebar item `Клиенты`.
- Added tabs: `Очередь`, `Смотрели тарифы`, `Бросили счет`, `Клиенты`, `Заказы`, `Доступ`, `Базы`.
- Reused existing data sources:
  - `/api/userbot/crm/subscribers`;
  - `/api/orders`;
  - `/api/access`;
  - `/api/customer-bases`;
  - current Supabase query for pending/awaiting receipt invoices.
- Added combined `Очередь` from abandoned invoices, paid orders without confirmed join, access issues, and CRM leaks.
- Kept old routes intact.
- Added Broadcast handoff, Userbot Center handoff, Dossier links, and source links.
- `Смотрели тарифы` is intentionally empty until Phase 4 creates `customer_funnel_events`.
- Verified with `cd admin-v2 && npm run build`.

### Phase 3 - Backend Aggregator

Status: implemented locally, syntax/build verified.

- Add `GET /api/customers/workbench`.
- Owner-scope all queries in SQL/backend, not JS after global limits.
- Fix owner-scoped pagination/querying across:
  - orders;
  - broadcast invoice audiences;
  - customer base member enrichment;
  - dossier invoice/base enrichment.
- Return normalized segments:
  - `viewedTariffs`
  - `abandonedInvoices`
  - `activeCustomers`
  - `expiredCustomers`
  - `inGroupLeaks`
  - `needsAccessCheck`
  - `recentOrders`
- Do not run live Telegram scans automatically.

Acceptance:

- No loss versus old pages.
- Pagination/limits are owner-scoped.
- Response is stable enough for one Customers UI.
- Dossier/base membership enrichment matches `/app/bases`.
- Abandoned settings are still editable.
- Userbot DM remains guarded by Userbot Center.

Implemented:

- Added `GET /api/customers/workbench`.
- Connected `/api/customers` in backend server.
- Switched `/app/customers` to the new backend aggregator.
- Aggregator returns normalized segments:
  - `viewedTariffs`;
  - `abandonedInvoices`;
  - `activeCustomers`;
  - `expiredCustomers`;
  - `inGroupLeaks`;
  - `needsAccessCheck`;
  - `recentOrders`;
  - `bases`.
- Endpoint queries invoices through owner-owned tariffs instead of taking global invoice limits and filtering in JS.
- Fixed the same owner-scoped invoice risk in old `/api/orders`.
- Fixed Broadcast paid/unpaid tariff audience lookups to query through owner channel tariffs.
- Fixed Customer Bases invoice enrichment to query through tariffs from linked owner channels.
- Fixed Dossier invoice lookup to query through owner-owned tariffs.
- Verified with:
  - `node --check backend/routes/customers.routes.js`;
  - `node --check backend/routes/orders.routes.js`;
  - `node --check backend/routes/broadcast.routes.js`;
  - `node --check backend/routes/customer-bases.routes.js`;
  - `node --check backend/routes/client-dossier.routes.js`;
  - `cd admin-v2 && npm run build`.

### Phase 4 - Tariff View Tracking

Status: implemented locally, database migration applied, syntax/build verified.

- Create `customer_funnel_events`.
- Log tariff list/card/payment-method events from official bot.
- Add Customers tab `Смотрели тарифы`.
- Add Broadcast audience for viewed-but-no-invoice.

Acceptance:

- Admin can see people who looked at tariffs but did not create invoice.
- Admin can follow up with selected segment.

Implemented:

- Created `public.customer_funnel_events` via Supabase migration.
- Added indexes for owner/date, owner/TG, owner/tariff, and event type.
- Added official bot funnel logging for:
  - `tariff_list_opened`;
  - `tariff_card_opened`;
  - `payment_method_selected`;
  - `invoice_created`.
- Funnel events capture owner, bot, Telegram user, tariff, referral code, session key, and payload.
- `/api/customers/workbench` now reads `customer_funnel_events`.
- `Смотрели тарифы` now receives real viewed-but-no-later-invoice rows from the backend aggregator.
- Added Broadcast audience `viewed_no_invoice` / `Смотрели тариф, но не создали счет`.
- Verified with:
  - `node --check backend/services/official-bot.service.js`;
  - `node --check backend/routes/customers.routes.js`;
  - `node --check backend/routes/broadcast.routes.js`;
  - `cd admin-v2 && npm run build`.

### Phase 4.5 - Demo Data For Visual QA

Status: implemented locally, seed not executed in production.

Purpose:

- Give the admin interface visible, realistic rows before real clients arrive.
- Let us record/check the UX of `Customers`, `Abandoned`, `Orders`, `CRM`, `Access`, and `Dossier` without waiting for live purchases.
- Make the demo data removable in one operation after review.

Rules:

- Demo data must be clearly marked with `demo_seed_id` or an equivalent marker in every inserted row.
- Demo data must be scoped to one selected owner/admin account, not global.
- Do not mix demo rows with real production rows without a marker.
- Do not create fake blockchain payouts, real TON transfers, real Telegram kicks, or real userbot DMs.
- Use impossible/safe Telegram IDs for demo rows, or a reserved test range, so no real person receives messages.
- Add a cleanup script or SQL migration note that deletes only rows with the demo marker.
- After visual QA, remove demo data and verify the pages return to their real empty/live state.

Seed scenarios:

- `Смотрел тарифы`: user opened tariff list/card but did not create an invoice.
- `Бросил счет`: pending invoice for a normal tariff.
- `Ждет чек`: invoice in `awaiting_receipt`.
- `Оплатил и вошел`: paid invoice, active subscription, confirmed access event.
- `Вход не подтвержден`: paid invoice and active subscription, but no confirmed join event.
- `Сгорел, но сидит`: expired subscription with presence still true in a customer base.
- `Реферальный заказ`: invoice with referral discount/reward context.
- `Досье клиента`: one demo TG ID with orders, subscription, access events, base membership, and referral context.

Implementation options:

- Preferred: backend-only dev/admin endpoint or script gated by env/admin role, for example `POST /api/dev/seed-customers-demo` and `DELETE /api/dev/seed-customers-demo/:seedId`.
- Alternative: one Supabase SQL seed file under `docs/plans/` for manual execution during QA.
- Do not ship a public UI button for demo seeding in MVP.

Acceptance:

- Demo rows appear in all relevant tabs and old compatibility pages.
- Broadcast handoff can preview demo TG IDs without sending.
- Userbot Center handoff opens with demo TG ID and draft, but no automatic DM is sent.
- Cleanup removes every demo row and leaves real rows untouched.
- Cleanup can be repeated safely.

Implemented:

- Added backend-only admin endpoints:
  - `POST /api/customers/demo-seed`
  - `DELETE /api/customers/demo-seed/:seedId`
- Endpoints require authenticated project admin role.
- Seed creates one marked demo channel, demo base, tariffs, invoices, subscriptions, access invites/events, base members, funnel events, payment events, and referral event.
- Every inserted demo row is marked by `demo_seed_id` through `payload`, `meta`, `memo`, title, description, or `access_note`.
- Cleanup is idempotent and deletes only rows matching the selected owner plus demo marker.
- No public UI button was added.
- Demo seed was executed for `webzwezda@gmail.com` with marker `customers_visual_qa_20260423`.
- Cleanup marker: `customers_visual_qa_20260423`.
- Verified with `node --check backend/routes/customers.routes.js`.

### Phase 5 - Menu Cleanup And Redirects

Status: partially implemented locally, build verified.

- Remove top-level menu items after parity:
  - `CRM`
  - `Заказы`
  - `Досье`
  - `Брошенные корзины`
  - maybe `Доступ`
  - maybe `Базы`
- Add admin-only sidebar group `Скрытые страницы` with legacy customer routes during transition.
- Keep routes as redirects/deep links:
  - `/app/crm -> /app/customers?tab=customers`
  - `/app/orders -> /app/customers?tab=orders`
  - `/app/abandoned -> /app/customers?tab=abandoned`
  - `/app/access -> /app/customers?tab=access`
  - `/app/dossier?tg=...` stays or maps to drawer route
- Update all incoming links/handoffs from:
  - Command Center
  - Analytics
  - Retention
  - Admin Groups
  - Payment Events
  - Abandoned
  - Broadcast
  - Userbot Center

Acceptance:

- Existing links do not 404.
- Command Center and Analytics links point to Customers tabs.
- All localStorage handoffs either work in Customers or remain on compatible old routes.

Implemented:

- Left `/app/customers` as the normal daily customer ops entry.
- Moved legacy customer pages into admin-only sidebar group `Скрытые страницы`:
  - `/app/crm`
  - `/app/orders`
  - `/app/abandoned`
  - `/app/access`
  - `/app/bases`
  - `/app/dossier`
- Kept all legacy routes routable during transition.
- Updated daily entry links from Command Center, Analytics, Retention, Userbot Center, Admin Groups, and Billing payment events to open Customers tabs.
- Added `channel` query support in Customers so Admin Groups/Retention can open channel-focused customer/order/access tabs.
- Customers now consumes `orders_search_preset` for payment-event handoff.
- Customers now consumes `abandoned_filter_preset` and filters the abandoned tab by the requested status.
- Customers now consumes `orders_manual_selection` and filters the orders tab by selected TG IDs.
- Removed remaining direct links from daily/legacy customer screens to `/app/orders`, `/app/crm`, `/app/access`, and `/app/bases`; they now point to the matching Customers tab.
- Verified with `cd admin-v2 && npm run build`.

Still pending:

- Decide whether hidden routes should become redirects after real usage proves Customers parity.
- Run live visual QA with real/demo data, then either keep hidden routes as emergency pages or redirect them.

## Verification Checklist

- `npm run build` in `admin-v2`.
- Backend syntax checks for touched route/service files.
- Live check after deploy:
  - `/app/customers`
  - old compatibility routes
  - `/app/broadcast`
  - `/app/userbot-center`
- Manually verify:
  - abandoned invoice appears in Customers and Broadcast preview
  - active subscription appears
  - expired subscription appears
  - userbot handoff opens with TG ID
  - broadcast handoff carries selected TG IDs
  - dossier still opens by TG ID

## Current Status

- [x] Frontend audit completed by subagent.
- [x] Backend/data audit completed by subagent.
- [x] Consolidation plan written.
- [x] Phase 1 implementation.
- [x] Phase 2 implementation.
- [x] Phase 3 implementation.
- [x] Phase 4 implementation.
- [x] Phase 4.5 demo data for visual QA.
- [ ] Phase 5 implementation.
