# Customers Reconciliation Contour - 2026-04-25

## Current Implementation Status

- Done: `Milestone A` contour setup in `/app/customers`
  - select reconciliation userbot
  - manual discovery of visible chats/groups
  - assign BullRun role
  - save contour to `customer_reconciliation_sources`
  - show active contour and safe-scan state
  - save now behaves as apply/replace for the active contour, so omitted sources are really disabled instead of hanging forever
- Done: frontend aligned to the normalized backend contract from `customer-reconciliation.service.js`
- Done: first lower-table slice `Неучтенные / кандидаты`
  - built only from saved `customer_base_members` + configured contour
  - no new live Telegram scan
  - supports manual access actions directly from candidate rows
- Done: explicit manual transfer from candidate table into accounted clients
  - for people already inside `private_paid_group`
  - action creates/updates subscription without forcing a new invite flow
  - default manual transfer now goes in as perpetual access, with later correction handled from the upper accounted-client table
  - source is marked as `customers_candidate_import`
  - server now revalidates that the candidate still exists in the current reconciliation view before importing
- Done: first matching/linking layer in candidate table
  - candidate row now shows how BullRun already knows this person
  - distinguishes cases like `/start`, viewed funnel, invoice history, paid history, removed by admin
  - candidate row can jump straight into the matching upper segment
- Done: candidate table now has working operator filters
  - by source role
  - by match presence
  - by payment/problem state
  - filters work on top of persisted candidates without triggering new Telegram scans
- Done: candidate rows now expose a lightweight suggested next step
  - no automation
  - just a clear operator hint like `связать`, `перенести`, `написать`, `проверить вручную`
- Done: manual candidate resolutions
  - explicit `Связать с учтенным сегментом`
  - link now also carries the concrete target context (channel/bot/segment target label) when available
  - operator can leave a note when manually confirming the match
  - `Не трогать`
  - resolved rows stop polluting the lower reconciliation table
  - server now revalidates that the candidate still exists and that `linked_accounted` is still allowed
- Done: reconciliation decision history is now visible
  - `/app/customers` shows a `Недавно решено` block for recent manual reconciliation decisions
  - `/app/dossier` shows a dedicated `Решения сверки` table for the current TG user
  - manual decisions no longer disappear without audit context
- Done: candidate row now marks ambiguous matches explicitly
  - if BullRun sees more than one plausible matching segment for the same candidate, row shows `Несколько совпадений`
  - suggested next step falls back to manual review instead of pretending there is one obvious target
- Done: ambiguous matches now have explicit operator choice
  - `Связать` no longer blindly uses the first match
  - when candidate has several plausible matches, operator chooses the exact target before saving the resolution
  - the same choice is used for `Открыть где уже учтен`
- Done: manual reconciliation decisions are reversible
  - recent decisions block can return a person back into the lower candidate table
  - this reduces operator fear around accidental `Связать` / `Не трогать`
- Done: first per-source safe scan action
  - manual `Обновить` per contour source
  - scans exactly one source, not the whole Telegram surface
  - updates `running/success/failed/cooldown` and source snapshots
- Done: manual member sync from contour source into linked customer bases
  - explicit operator action only
  - syncs one source at a time
  - writes members into already linked bases without scanning the whole contour
- Done: large-source guard for manual member sync
  - source with `member_count_snapshot >= 1000` is treated as a large source
  - this is a BullRun safety threshold, not a Telegram guarantee
  - large source sync now requires an extra explicit operator confirmation
  - UI marks such sources as `Большой источник`
  - backend also rejects unconfirmed large-source sync calls
- Done: safe pacing even for small manual sync
  - every participant sync now waits before the Telegram request
  - wait time is not fixed: base delay + jitter
  - after manual sync the source goes into cooldown, so operators cannot hammer the same account repeatedly
  - the page shows that the source is `На паузе`
- Done: contour source now shows base readiness for manual sync
  - operator can see which bases are linked to the source
  - sync button is disabled when the source has nowhere to write members
- Done: contour source card now exposes the full manual sync loop in UI
  - operator sees linked bases directly on the source card
  - last scan error is visible without leaving the page
  - `Синкнуть` is available right on the source card
  - candidates refresh immediately after `Сохранить контур` and after manual sync
- Not done yet:
  - fully explicit bind to a concrete accounted row/entity, if we later need stricter reconciliation history than segment + target context
  - final operator polish for ambiguous source/channel/base situations

## Why

`/app/customers` already became the main workbench for known people:

- started the bot
- viewed tariffs
- stalled at invoice/payment
- active subscription
- expired subscription
- removed by admin
- access not confirmed

But this only covers people BullRun already knows through the official-bot/payment/access path.

For real operators this is not enough.

They also have:

- a public group
- a public chat
- a private paid group
- one or more userbots that already see those places
- old members already sitting inside the paid group without passing through BullRun

The missing business problem is audience reconciliation:

- who is already properly accounted for in BullRun;
- who exists in Telegram sources but is not yet accounted for;
- who is already inside the private group but has no BullRun lifecycle;
- who can be reached with an offer;
- who should be manually transferred into the accounted client base.

This is not an MVP-only concern.
This screen needs a durable model because it becomes the operator’s long-term customer map.

## Product Goal

Turn `/app/customers` into a two-zone operating page:

1. `Учтенные клиенты`
   - current main workbench for known/managed people
2. `Контур сверки`
   - source setup + scan state
3. `Неучтенные / кандидаты`
   - people found in Telegram sources but not yet fully accounted inside BullRun

The page should answer:

- What sources are we using for reconciliation?
- Is the userbot still able to observe those sources?
- Which people are already accounted?
- Which people are inside the ecosystem but not yet accounted?
- What action should the admin take next?

## Main UX Principle

Do not ask the admin to “create a reconciliation source” abstractly.

The admin should work in Telegram terms:

1. choose the userbot for reconciliation
2. load the chats/groups that this userbot already sees
3. assign a BullRun role to each source
4. save the contour

So the operator mental model becomes:

- “this is my userbot”
- “these are the groups/chats it sees”
- “this is my public funnel”
- “this is my public chat”
- “this is my private paid group”

That is much clearer than raw source configuration.

## Hard Safety Rule

Do not introduce automatic member parsing for Telegram groups or chats.

This is a strict BullRun rule:

- participant parsing only from explicit operator action;
- no page-open parsing;
- no background member crawling;
- no scheduled participant enumeration across sources.

Allowed:

- manual contour discovery
- manual per-source status refresh
- manual base sync
- reading already saved BullRun snapshots/tables

Additional large-source rule:

- if a source is roughly `1000+` members, it stops being a "quick operational sync"
- treat it as a heavy source
- require extra confirmation from the operator before syncing participants

Additional pacing rule for all manual participant sync:

- even a small source must not sync immediately like a machine burst
- before `getParticipants(...)` BullRun waits with jitter
- after sync BullRun puts the source into cooldown
- slower operator UX is acceptable; burning the account is not

Not allowed:

- automatic participant sync jobs
- full background scans of group members
- aggressive Telegram audience refresh loops

Reason:

- Telegram is hostile to aggressive automation;
- userbot accounts can be burned by repeated parsing patterns;
- slightly stale local data is better than killing the operator account.

## Page Structure

`/app/customers` should have three large sections in this order:

### 1. Reconciliation Contour

Purpose:

- configure what Telegram sources participate in customer reconciliation
- show whether the contour is healthy
- show when the last scan happened

This is a setup and status block, not a customer table.

### 2. Accounted Clients

Purpose:

- current `Customers` table
- people that BullRun already tracks through bot/payment/subscription/access lifecycle

This remains the “truthy managed base”.

### 3. Unaccounted / Candidate People

Purpose:

- people discovered through public groups, public chats, private group membership, and customer-base sync
- not yet fully mapped into BullRun lifecycle

This becomes the operator’s reconciliation and growth surface.

## Reuse Existing Product Pieces

This plan should reuse existing product logic where possible.

### Already Exists

- `customer_bases`
  - stores synced members and manual members
- `customer_base_members.present_now`
  - current presence marker
- `customer_base_members.payment_status`
  - already classifies:
    - `active_paid`
    - `expired_paid`
    - `expired_paid_inside`
    - `unpaid_lead`
    - `free_rider`
- `customer_bases/:id/sync`
  - sync members from groups through userbot
- `customer_bases/:id/actions/import-subscriptions`
  - manual import into subscriptions
- `userbot/sync-channels`
  - already collects channel/group visibility
- `Customers`
  - already owns the “accounted clients” workbench

### Do Not Duplicate

Do not build a second unrelated sync universe.

Instead:

- reuse `customer_bases` concepts for discovered people
- reuse `Customers` for accounted people
- add a new contour layer that controls which sources feed the reconciliation view

## Core Concepts

The new system needs two distinct layers.

### A. Source Discovery

What the chosen userbot can currently see in Telegram:

- groups
- chats
- channels

This is technical discovery.

Not every discovered source is meaningful for `Customers`.

### B. Reconciliation Contour

The subset of discovered sources that the admin explicitly activates for BullRun.

Each source gets a semantic role:

- `public_funnel_group`
- `public_chat`
- `private_paid_group`
- `ignore`

This is the business layer.

## New Data Model

Add a durable table for configured reconciliation sources.

Suggested table:

- `customer_reconciliation_sources`

Columns:

- `id`
- `owner_id`
- `userbot_id`
- `bot_id`
- `chat_id`
- `chat_type`
- `title_snapshot`
- `username_snapshot`
- `role`
  - `public_funnel_group`
  - `public_chat`
  - `private_paid_group`
  - `ignored`
- `is_active`
- `scan_enabled`
- `admin_verified`
- `admin_verified_at`
- `last_scan_at`
- `last_scan_status`
- `last_scan_error`
- `member_count_snapshot`
- `admin_rights_snapshot`
- `visibility_snapshot`
- `created_at`
- `updated_at`

Why this table is needed:

- current Telegram discovery is not enough;
- current customer bases are too generic;
- we need explicit operator intent for `Customers`.

## Setup Flow

### Step 1. Select Reconciliation Userbot

In `Customers`, admin selects which userbot is used for reconciliation.

Rules:

- exactly one active reconciliation userbot per contour by default
- later can support multiple, but first durable version should keep this simple

Why:

- avoids ambiguity
- makes scans predictable
- keeps ownership clear

### Step 2. Load Visible Telegram Sources

System loads chats/groups visible to that userbot.

This should reuse or evolve current `userbot/sync-channels` and related Telegram discovery logic.

Displayed per row:

- title
- Telegram type
- username / internal id
- member count if available
- whether userbot is inside
- whether userbot seems to have admin rights
- whether the source is already bound to BullRun channels/groups

### Step 3. Assign BullRun Role

For each discovered source admin chooses:

- `Публичная группа`
- `Публичный чат`
- `Закрытая платная группа`
- `Не использовать`

This is the most important operator action in setup.

### Step 4. Save Contour

System saves selected sources into `customer_reconciliation_sources`.

### Step 5. Initial Scan

After saving:

- run first controlled sync
- cache people from selected sources
- build the candidate/unaccounted table

## Why We Must Not Scan On Every Page Open

The page must not perform full live scans when opened.

That would be:

- expensive
- slow
- Telegram-fragile
- hard to debug
- hard to reason about for operators

So the rule is:

- page reads cached scan state;
- scans run manually or in background jobs.

## Telegram Safety Constraints

This part is mandatory.

The reconciliation contour must respect the real Telegram safety limits and the product’s existing userbot rules.

The system must assume:

- aggressive parsing can get the account restricted or burned;
- large bursts of member reads are dangerous;
- Telegram does not like repetitive, machine-like access patterns;
- userbot safety is more important than freshness of the candidate table.

### Hard Rules

- `Customers` must never scan Telegram directly on page open.
- `Customers` must only read cached scan results and cached source state.
- A click on `Сканировать сейчас` must not run a raw immediate full scan in the page request.
  It should enqueue or trigger a controlled background job.
- One userbot must not run overlapping reconciliation scans in parallel.
- One source must not be rescanned continuously without cooldown.
- Full “scan everything from scratch” loops should be avoided after initial setup.
- Prefer incremental scans/checkpointed refresh over full rescans.

### Pacing Rules

Every scan worker must use:

- fixed minimum delay between Telegram actions;
- randomized jitter on top of delay;
- small batches/chunks instead of one huge pass;
- cooldown after chunk completion;
- longer cooldown after Telegram errors or suspicious responses.

This is required to mimic a calmer human-like pace and reduce account risk.

### State Needed Per Source

Each configured source should keep safe scan metadata:

- `last_scan_at`
- `last_scan_status`
- `last_scan_error`
- `next_scan_after`
- `scan_cursor`
- `last_scanned_member`
- `cooldown_until`

Why:

- scans must be resumable;
- scans must not restart from zero every time;
- the system must know when a source is temporarily unsafe to touch.

### State Needed Per Userbot

Each reconciliation userbot should have runtime scan guards:

- `scan_lock`
- `active_job_id`
- `active_source_id`
- `last_scan_started_at`
- `last_scan_finished_at`
- `cooldown_until`

Why:

- one userbot cannot safely do several reconciliation scans at once;
- we need clear ownership of the current sync workload;
- this prevents accidental parallel parsing bursts.

### Failure Handling Rules

If Telegram starts returning:

- rate limit signals,
- temporary auth/session warnings,
- suspicious access errors,
- member read failures in sequence,

the job must:

- stop the current scan;
- mark the source as degraded;
- push `cooldown_until` forward;
- avoid automatic immediate retry;
- surface the degraded status in `Customers`.

### Freshness Rule

The candidate table is allowed to be slightly stale.

That is acceptable.

It is better to show a safe cached snapshot than to burn the userbot by chasing real-time freshness.

### Reuse Existing Safety Philosophy

This contour must follow the same safety philosophy already learned from previous userbot work in BullRun:

- manual-by-default
- no aggressive Telegram automation
- slow paced operations
- explicit operator intent
- background work with bounded scope

### Practical Scan Strategy

The first durable version should prefer this order of evidence:

1. existing saved `customer_bases` data
2. already synced members from selected sources
3. manual source rescan on demand
4. delayed background incremental refresh

Not this order:

1. open page
2. hit Telegram live
3. parse everything again

That unsafe pattern is explicitly banned.

### Implementation Constraint

No implementation should be considered complete if it introduces:

- page-open live Telegram scans;
- uncontrolled loops over large audiences;
- parallel scans on one userbot;
- tight retry loops after Telegram errors;
- “always refresh now” behavior without cooldowns.

## Scan Policy

### Manual

Buttons:

- `Сканировать сейчас`
- `Перепроверить доступ`

### Background

Suggested schedule:

- private paid group: every 6 hours
- public funnel group: every 12 hours
- public chat: every 12 hours
- forced recheck after admin changes contour

### What Scan Must Produce

For each configured source:

- current member snapshot
- userbot visibility status
- admin-rights snapshot
- last scan status and time

For each discovered person:

- source membership
- source role
- current presence
- profile snapshot:
  - tg_user_id
  - username
  - display_name
  - first_name
  - last_name

## Reconciliation Tables

### Accounted Clients Table

Keep the current top table and evolve it as the accounted truth.

This table means:

- person is already known to BullRun
- person has at least one lifecycle signal:
  - bot touch
  - invoice
  - subscription
  - access
  - manual admin action

This is the “managed base”.

### Candidate / Unaccounted Table

New lower table.

Sources:

- selected public funnel group
- selected public chat
- selected private paid group
- customer base membership snapshots connected to those sources

This table means:

- person exists in Telegram sources we care about
- but is not fully accounted in BullRun

## Candidate Table Filters

Do not build many separate physical tables.

Use one candidate table with filters:

- `В публичной группе`
- `В публичном чате`
- `Уже в закрытой группе`
- `Не сопоставлены`
- `Похожи на действующих`
- `Сидят внутри без оплаты`
- `Платили раньше, но теперь внутри без доступа`

## Candidate Classification

Each candidate row should carry:

- `discovery_source_role`
- `discovery_source_title`
- `inside_private_group`
- `inside_public_group`
- `inside_public_chat`
- `matched_accounted_client_id` or null
- `accounting_status`
  - `accounted`
  - `partially_accounted`
  - `unaccounted`
- `suggested_next_step`
  - `offer`
  - `manual_verify`
  - `grant_access`
  - `link_to_existing`
  - `ignore`

## Manual Transfer / Operator Actions

This is one of the main reasons to build the contour.

The admin needs to move people from “found in Telegram” into “accounted”.

Actions on candidate rows:

- `Выдать 30 дней`
- `Выдать навсегда`
- `Перенести в учтенные`
- `Связать с существующим клиентом`
- `Написать`
- `Отправить оффер`
- `Исключить из разбора`

### Important Semantic Rule

`Перенести в учтенные` is not just a visual move.

It should create or normalize actual BullRun state:

- subscription if needed
- access note
- access event / source marker
- optionally invite issuance

This should reuse existing subscription/direct-access logic, not invent a shadow client state.

## Matching Strategy

Do not over-automate matching at first.

Need a durable semi-manual model.

### Safe Matching Signals

- same `tg_user_id`
- same username with strong confidence
- same historical presence in source + same BullRun person

### First Version

Show probable matches, but require operator confirmation.

Example action:

- `Похоже, это клиент TG 123456. Связать?`

Why:

- wrong automatic matches will poison the base
- operators need trust

## Source Health UX

Each configured source in the contour block should show:

- title
- role
- chosen userbot
- status
  - `готов`
  - `нужно переподтвердить`
  - `юзербот не видит источник`
  - `нет прав админа`
  - `scan failed`
- last scan time
- found members count

Actions:

- `Сканировать сейчас`
- `Изменить роль`
- `Отключить`
- `Перекинуть на другой юзербот`

## Long-Term Architecture Rule

`Customers` must not become a live Telegram inspector.

It must remain a workbench over cached, curated, operator-approved sources.

This keeps the page:

- stable
- fast
- predictable
- explainable

## Detailed Screen Layout

### Block A. Reconciliation Contour

Contains:

- current reconciliation userbot
- discovered source list
- source role assignment
- source health
- manual scan controls

### Block B. Accounted Clients

Current top `Customers` table.

Keep:

- tabs
- statuses
- reasons
- actions

### Block C. Candidate / Unaccounted People

Contains:

- filters by source role
- candidate table
- manual transfer actions
- link/match actions
- outreach actions

## API Plan

Likely new routes:

- `GET /api/customers/reconciliation-sources`
- `POST /api/customers/reconciliation-sources/discover`
- `POST /api/customers/reconciliation-sources`
- `PATCH /api/customers/reconciliation-sources/:id`
- `POST /api/customers/reconciliation-sources/:id/scan`
- `GET /api/customers/reconciliation-candidates`
- `POST /api/customers/reconciliation-candidates/:id/grant-access`
- `POST /api/customers/reconciliation-candidates/:id/link-accounted`
- `POST /api/customers/reconciliation-candidates/:id/mark-accounted`
- `POST /api/customers/reconciliation-candidates/:id/exclude`

Not every route must be first-pass production-ready in one shot, but the plan should keep this direction.

## Migration / Reuse Plan

### Reuse from Customer Bases

Reuse:

- sync patterns
- member presence logic
- `payment_status`
- `coverage_status`
- manual add patterns
- manual import-subscriptions idea

Do not force operators to keep working from `/app/bases`.

Instead:

- absorb the useful logic into `Customers`
- keep `Bases` as advanced/legacy support surface

### Reuse from Existing Customers

Reuse:

- bot selector
- known-client tabs
- quick broadcast
- dossier handoff
- direct access
- manual restore / manual remove

## Non-Goals

Do not build in the first pass:

- fully automatic identity matching without confirmation
- live page-open Telegram scans
- unlimited multi-userbot reconciliation mesh
- heavy AI inference over arbitrary Telegram audiences

## Delivery Phases

### Phase 1. Contour Foundations

- new reconciliation source table
- discovery flow from chosen userbot
- source role assignment
- contour block UI
- initial source health state

### Phase 2. Candidate Table

- aggregated candidate dataset
- filters
- source-aware rows
- manual actions:
  - write
  - grant access
  - move to accounted

### Phase 3. Matching And Linking

- probable matches
- confirm-link flow
- linked state in UI

### Phase 4. Background Reliability

- background jobs
- scan health
- retry logic
- stale source warnings

## Execution Order

This section turns the product plan into a build order that can be implemented without repainting the page twice.

### Stage 0. Freeze Current Surfaces

Before new implementation starts:

- keep current `/app/customers` intact as the accounted-clients block;
- keep `/app/bases` intact as fallback/reference;
- do not delete any old import/sync flow before parity is visible in `Customers`.

Why:

- current customer operations are already live;
- reconciliation is additive;
- we need a migration path, not a replacement jump.

### Stage 1. Backend Contour Schema

Deliverables:

- create `customer_reconciliation_sources`
- define allowed roles
- define allowed scan statuses
- add owner/userbot/source uniqueness constraints

This stage is purely structural.

Nothing user-facing should depend on background scanning yet.

### Stage 2. Source Discovery API

Deliverables:

- backend route to list visible chats/groups for a selected userbot
- normalized response shape with:
  - `chat_id`
  - `title`
  - `username`
  - `telegram_type`
  - `member_count`
  - `visibility_status`
  - `admin_rights_status`
  - `already_bound_channel_id`

Important:

- this route is discovery-only;
- it must not mutate reconciliation config;
- it must not start scans automatically.

### Stage 3. Contour Config API

Deliverables:

- create/update reconciliation sources
- toggle active/inactive
- change role
- change userbot binding if needed
- list current configured contour

At the end of this stage, backend can represent:

- what userbot is used;
- what sources are configured;
- what role each source has.

### Stage 4. Customers UI - Contour Block

Deliverables:

- top block in `/app/customers` called `Контур сверки`
- select reconciliation userbot
- button `Загрузить доступные группы и чаты`
- discovered-source list
- per-source role selector
- save action
- list of configured sources with health badges

At the end of this stage, admin can configure the contour from UI.

Still no candidate table yet.

### Stage 5. Source Scan API

Deliverables:

- manual scan endpoint for one configured source
- manual scan endpoint for the whole contour
- cached scan metadata updates:
  - `last_scan_at`
  - `last_scan_status`
  - `last_scan_error`
  - `member_count_snapshot`

This stage should reuse current `customer_bases` sync logic where possible, but not expose base terminology in `Customers`.

### Stage 6. Candidate Aggregation Backend

Deliverables:

- build a candidates dataset from:
  - configured reconciliation sources
  - synced source members
  - current accounted clients
  - current subscriptions/invoices/access
- return candidates in one normalized API shape

Each candidate row should already answer:

- who this person is
- where they were found
- whether they are already inside private group
- whether they are already accounted
- whether there is a probable match
- what the suggested next step is

This is the stage where the real reconciliation brain appears.

### Stage 7. Customers UI - Candidate Table

Deliverables:

- lower section `Неучтенные / кандидаты`
- source filters
- candidate status pills
- candidate reason/next-step fields
- actions:
  - write
  - grant 30 days
  - grant forever
  - move to accounted
  - link to existing client
  - exclude from review

At the end of this stage, `Customers` becomes a real reconciliation page.

### Stage 8. Matching / Linking Layer

Deliverables:

- probable match hints
- confirm-link action
- persisted relationship between candidate and accounted client
- candidate state transitions after linking

This stage should stay conservative.

No blind auto-merging.

### Stage 9. Background Reliability

Deliverables:

- background scan jobs
- stale contour warnings
- source health degradation statuses
- “needs recheck” states

Only after this stage should the contour be considered long-term stable.

## Build Slices By Runtime

### Backend Slice

Files likely involved:

- `backend/routes/customers.routes.js`
- `backend/routes/customer-bases.routes.js`
- `backend/routes/userbot.routes.js`
- new job or service for reconciliation scans

Responsibilities:

- schema-backed contour config
- source discovery
- source scans
- candidate aggregation
- candidate actions

### Frontend Slice

Files likely involved:

- `admin-v2/src/pages/CustomersPage.jsx`
- possibly extracted components for:
  - contour setup
  - source cards
  - candidate table
  - candidate actions

Responsibilities:

- keep current accounted-clients block stable
- add contour setup above
- add candidate table below
- make the page still readable on first screen

### Data / DB Slice

Primary persistence:

- `customer_reconciliation_sources`

Possible future support tables if needed:

- `customer_reconciliation_candidates`
- `customer_reconciliation_links`
- `customer_reconciliation_exclusions`

Rule:

- do not create extra tables until API shape proves they are needed;
- but do not overload `customer_bases` with business configuration that belongs to reconciliation.

## Concrete First Implementation Milestone

The first milestone that is worth shipping is:

### Milestone A

- contour block exists
- admin can choose userbot
- admin can discover chats/groups
- admin can mark source role
- admin can save contour
- configured sources appear with status badges

This milestone does **not** yet need candidate table.

Why this is the right first ship:

- it establishes the durable model;
- it proves the UX of “how admin connects sources”;
- it prevents the rest of the work from being built on a fuzzy source model.

Current implementation status:

- `done`:
  - durable config table for contour sources
  - backend routes to load/save configured contour
  - top `Контур сверки` block in `/app/customers`
  - userbot selector
  - manual discovery trigger using existing admin-audit flow
  - per-source role assignment
  - configured-source status cards
- `not done yet`:
  - dedicated customers-native discovery route
  - manual source scan endpoint for one configured source
  - candidate/unaccounted table
  - background scan jobs
  - linking/matching actions

### Milestone B

- candidate table appears
- private-group-inside-but-unaccounted rows appear
- admin can grant 30 days / forever
- admin can move a person into the accounted flow

### Milestone C

- public group/chat reconciliation
- match suggestions
- operator linking
- exclusion controls

## Operator Language Rules

For this feature, do not expose backend language in UI.

Avoid labels like:

- reconciliation source
- candidate entity
- sync member row
- coverage record

Prefer:

- `Контур сверки`
- `Источники`
- `Где искать людей`
- `Учтенные`
- `Кандидаты`
- `Уже в закрытой группе`
- `Не оформлен через BullRun`

## Long-Term Constraint

The contour block must stay comprehensible even if:

- one owner has multiple userbots;
- one owner has several public groups;
- one owner has several private groups;
- some sources become stale or inaccessible.

This means:

- source cards must be explicit;
- statuses must be cached and visible;
- no hidden assumptions about “the only group”.

## Decisions Fixed Before Build

These decisions are now considered fixed unless a better reason appears:

- `Customers` is the long-term home for reconciliation.
- The admin connects sources by choosing a userbot and marking visible chats/groups.
- The page must not live-scan Telegram every time it opens.
- Current `Customers` table becomes the accounted-clients block.
- Candidate people live in a separate lower table, not mixed into the current accounted rows.
- Manual transfer from candidate to accounted is required.
- Existing `customer_bases` logic should be reused, but not exposed as the main mental model.

## Immediate Next Planning Step

Before implementation starts, create a narrower implementation checklist for Milestone A:

- DB migration
- discovery route contract
- contour config route contract
- top block UI wireframe
- explicit acceptance criteria

That checklist will be the real build ticket for the first slice.

## Success Criteria

The screen is successful when an admin can:

- choose one userbot for reconciliation
- see which groups/chats it can use
- mark which sources matter
- scan them on demand
- understand which people are already accounted
- understand which people are found but not accounted
- manually move someone from “inside Telegram” to “managed in BullRun”
- launch outreach without leaving the page for most cases

## Implementation Notes

- keep `Customers` as the main navigation hub
- do not degrade current accounted-client workflow while adding reconciliation
- prefer one strong page with sections over many new side-menu pages
- absorb the value of `customer bases` without forcing operators to think in base terminology

## Review Questions Before Build

- How do we choose the default reconciliation userbot?
- Do we allow exactly one private paid group, or multiple?
- How should candidate exclusion be stored?
- How should linked/matched candidates be persisted?
- Do we need a dedicated “offer template” concept for reconciliation outreach?
- Which existing `customer_bases` fields can be reused directly versus migrated into a reconciliation-specific model?

## Milestone A Backend Slice - 2026-04-25

Scope locked for this slice:

- backend + DB only
- no frontend wiring
- no candidate table yet
- no manual scan endpoint yet
- no page-open Telegram scans

Delivered:

- durable `customer_reconciliation_sources` schema normalized for `owner + userbot + chat`
- cached contour listing endpoint
- explicit manual discovery endpoint for visible chats/groups of the selected userbot
- create/update contour config endpoints with role validation and one-active-userbot guard

Safety rules enforced in backend:

- discovery is manual-only and never runs on `GET /api/customers/reconciliation-sources`
- discovery refuses `shop`-reserved userbots
- discovery refuses fresh-import userbots in `pending_activation`
- discovery refuses dead-proxy userbots unless existing failover logic revives them first
- config save refuses multi-userbot active contour in one milestone-A contour

Validation done in this slice:

- Supabase migration applied successfully
- corrected pre-existing draft table to required types/constraints
- `node --check backend/routes/customers.routes.js`
- `node --check backend/services/customer-reconciliation.service.js`
