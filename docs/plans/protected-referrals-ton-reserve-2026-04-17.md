# Protected Referrals TON Reserve

## Context

Current `/app/referrals` is a basic referral dashboard:

- Settings live in `payment_settings`: `referral_enabled`, `referral_reward_percent`, `referral_welcome_text`.
- Referral partners live in `referral_profiles`.
- Referral lead attribution lives in `referral_attributions`.
- Reward and payout history lives in `referral_events`.
- The official Telegram bot creates referral links, records `/start ref_...` leads, and grants rewards after a paid invoice.
- Admin payout marking is currently manual accounting, not protected payout infrastructure.

The target product is a protected partner program where BullRun holds a TON reserve from the admin before the admin can run referral sales. This is planning only; do not implement code from this document until explicitly assigned.

## MVP Scope

This is an internal-first MVP for the first partner users. Optimize for a working end-to-end flow and clear UI/UX, not for a banking-grade treasury system.

Default implementation choices:

- Use an external TON API provider. Do not run a TON full node, liteserver, or indexer on the current BullRun server.
- Start with testnet-capable code paths, but keep the runtime provider configurable by environment.
- Use a lightweight wallet worker / wallet service on the existing backend server.
- Keep admin refund request-based/manual in MVP.
- Automate partner payouts only after the partner balance reaches the `5 TON` minimum.
- Keep the client discount fixed at `10%`.
- Keep partner reward calculation from the original tariff price.
- Keep the main operator experience in `/app/referrals`.
- Do not add partner tiers, dynamic discount settings, complex approvals, or a treasury console in MVP.
- Preserve a simple audit trail for every money-affecting action: deposit, reward, BullRun fee, network fee, payout, refund request.

The MVP is considered useful when a non-technical admin can:

- see that a `100 TON` reserve is required
- see whether the reserve is ready, locked, low, or over limit
- enable referrals after deposit confirmation
- explain the economics of one referral sale
- see partners, leads, rewards, debt, and payouts
- understand why new partner onboarding is paused if reserve coverage is exhausted

The MVP is considered useful when a partner can:

- get a referral link
- understand that buyers get a discount
- see leads and converted sales
- set a TON payout wallet
- request payout when the TON balance is at least `5 TON`

## Product Rules

- Minimum partner reserve deposit: `100 TON`.
- BullRun owns/controls the reserve wallet infrastructure so partner payouts can be automated.
- The admin can enable referrals as soon as the reserve deposit is confirmed and locked.
- The reserve deposit is locked for `30 days` before any admin refund can be requested.
- Referral lead attribution lasts `30 days` from first valid referral entry.
- Referral terms are fixed at attribution time:
  - referrer Telegram ID
  - referred Telegram ID
  - referral code
  - client discount percent
  - partner reward percent
  - attribution start and expiry
- MVP client discount: fixed `10%`.
- Partner reward is calculated from the original tariff price, not the discounted paid amount.
- BullRun fee: `1%` of the partner reward.
- BullRun fee is charged to the admin on top of the partner reward, so the partner receives the full promised reward.
- TON network fee is charged to the admin on top of the partner reward.
- Minimum partner auto-withdrawal: `5 TON`.
- Partner rewards are paid in TON.
- If a sale is paid in RUB or USDT, calculate and store the original reward amount plus the TON equivalent using the stored exchange rate at sale time.
- Exchange rates should be refreshed hourly and stored in the database.
- Reserve limits are based only on already occurred referral sales, not potential active leads.
- If reserve obligations exceed available reserve:
  - notify the admin
  - notify partners
  - close the program for new partners
  - prevent new referral attributions from receiving discounts
  - keep discounts and terms for already attributed leads until their 30-day windows expire
  - continue recording admin referral debt for old attributed leads that convert
- If no referral sale happened, the admin can refund the full deposit after the 30-day lock.
- If referral sales happened, only free reserve can be refunded after obligations, fees, network fees, and pending payouts are deducted.

## Economics

Example in TON:

- Original tariff price: `100 TON`
- Client discount: `10%`
- Client pays: `90 TON`
- Partner reward percent: `20%`
- Partner reward base: original `100 TON`
- Partner reward: `20 TON`
- BullRun fee: `1% * 20 TON = 0.2 TON`
- Reserve obligation: `20 TON partner reward + 0.2 TON BullRun fee + network fee`

Example in RUB:

- Original tariff price: `100 RUB`
- Client discount: `10%`
- Client pays: `90 RUB`
- Partner reward percent: `20%`
- Partner earns: `20 RUB`
- System reads latest RUB -> TON rate from the rates table at sale time.
- Reward event stores:
  - original sale currency: `RUB`
  - original tariff price: `100 RUB`
  - discount amount: `10 RUB`
  - partner reward original amount: `20 RUB`
  - conversion rate
  - partner reward TON amount
  - BullRun fee TON amount

## Target Data Model

Add new tables rather than overloading the existing simple referral tables too far.

### `crypto_exchange_rates`

Purpose: hourly exchange rates used for referral settlement.

Fields:

- `id`
- `base_currency` (`TON`)
- `quote_currency` (`RUB`, `USDT`, maybe `USD`)
- `rate`
- `provider`
- `fetched_at`
- `created_at`
- `payload`

Constraints:

- Index on `(base_currency, quote_currency, fetched_at desc)`.
- Store enough raw payload to audit weird rates later.

### `referral_reserve_accounts`

Purpose: one protected partner reserve account per admin/owner.

Fields:

- `id`
- `owner_id`
- `deposit_address`
- `deposit_memo` or chain-specific correlation value if needed
- `status`
- `total_deposited_ton`
- `locked_until`
- `available_reserve_ton`
- `reserved_obligations_ton`
- `admin_debt_ton`
- `bullrun_fee_accrued_ton`
- `network_fee_accrued_ton`
- `last_deposit_at`
- `created_at`
- `updated_at`

Suggested statuses:

- `deposit_required`
- `locked_active`
- `active`
- `reserve_low`
- `over_limit`
- `closed_for_new_partners`
- `refund_requested`
- `refund_available`
- `refund_completed`
- `paused`

### `referral_reserve_ledger`

Purpose: append-only money ledger for reserve changes and obligations.

Fields:

- `id`
- `owner_id`
- `reserve_account_id`
- `entry_type`
- `amount_ton`
- `direction` (`credit` or `debit`)
- `related_referral_event_id`
- `related_payout_id`
- `chain_tx_hash`
- `payload`
- `created_at`

Entry types:

- `deposit_confirmed`
- `reward_obligation_created`
- `bullrun_fee_created`
- `network_fee_reserved`
- `partner_payout_sent`
- `partner_payout_failed`
- `admin_refund_requested`
- `admin_refund_sent`
- `manual_adjustment`

### `referral_partner_payout_methods`

Purpose: partner TON withdrawal wallet.

Fields:

- `id`
- `owner_id`
- `tg_user_id`
- `ton_wallet`
- `status`
- `verified_at`
- `last_changed_at`
- `created_at`
- `updated_at`

MVP can use a simple bot confirmation flow. Later we can add address-change cooldown and signed verification.

### `referral_partner_payouts`

Purpose: automated or requested partner withdrawals.

Fields:

- `id`
- `owner_id`
- `tg_user_id`
- `amount_ton`
- `network_fee_ton`
- `status`
- `ton_wallet`
- `chain_tx_hash`
- `requested_at`
- `sent_at`
- `failed_at`
- `failure_reason`
- `payload`

Statuses:

- `requested`
- `queued`
- `sent`
- `failed`
- `cancelled`

### Changes To Existing Tables

`payment_settings`:

- Keep `referral_enabled`.
- Keep `referral_reward_percent`.
- Add or derive `referral_client_discount_percent`, default `10`.
- Add protected referral state fields only if the UI needs cheap reads; otherwise read from `referral_reserve_accounts`.

`referral_attributions`:

- Add `expires_at`.
- Add `reward_percent_snapshot`.
- Add `client_discount_percent_snapshot`.
- Add `terms_status`.
- Add `discount_eligible`.
- Add `reserve_status_snapshot`.
- Keep unique `(owner_id, referred_tg_user_id)` first-touch behavior.

`referral_events`:

- Add fields for original sale economics and TON settlement:
  - `sale_original_amount`
  - `sale_original_currency`
  - `client_discount_percent`
  - `client_discount_original_amount`
  - `reward_original_amount`
  - `reward_original_currency`
  - `reward_ton_amount`
  - `bullrun_fee_ton_amount`
  - `network_fee_ton_amount`
  - `exchange_rate_id`
  - `reserve_account_id`
  - `reserve_coverage_status`
- Make sure payout events do not violate `referred_tg_user_id` nullability. Current manual payout code likely inserts `null` there and can fail.

## Backend Phase Plan

- [ ] Phase 1: schema and compatibility migration.
  - Add protected reserve tables.
  - Add attribution expiry and snapshots.
  - Add settlement fields to referral events.
  - Keep existing referral dashboard working with old rows.
  - Fix current payout event nullability issue before adding payout automation.

- [ ] Phase 2: reserve account service.
  - Add service for loading reserve state by `owner_id`.
  - Compute `available_reserve_ton`, `reserved_obligations_ton`, `admin_debt_ton`, and status from ledger/events.
  - Add idempotent ledger entry helpers.
  - Add reserve status transition rules.

- [ ] Phase 3: TON deposit tracking.
  - [x] Assign one shared reserve deposit address from server env for MVP.
  - [x] Use per-admin `deposit_memo` to correlate incoming TON payments.
  - [x] Poll incoming TON transactions through TON Center API with bounded pagination.
  - [x] Confirm deposits idempotently by chain transaction hash.
  - [x] Enforce unique case-insensitive deposit memo values.
  - [x] When confirmed deposit total reaches `100 TON`, set `locked_until = now + 30 days`.
  - [x] Allow referral enablement immediately after confirmed deposit and lock creation.
  - [ ] Generate isolated admin wallets/subwallets later if shared-wallet memo flow becomes too risky.

- [ ] Phase 4: exchange rates.
  - [x] Add hourly job to fetch rates.
  - [x] Store TON/RUB and TON/USDT rates.
  - [x] Add conversion helper that returns the latest acceptable rate.
  - [x] If no acceptable rate exists during sale settlement, refresh the rate immediately before failing.
  - [x] Add a pending conversion retry queue if the provider is down during a paid invoice.

- [ ] Phase 5: referral attribution rules.
  - On `/start ref_...`, reject self-referrals.
  - Preserve first-touch attribution.
  - If reserve is healthy, create attribution with `expires_at = now + 30 days`, fixed reward and discount snapshots.
  - If reserve is over limit or closed for new partners, do not grant new discount eligibility.
  - For already attributed leads, preserve existing terms until `expires_at`.

- [ ] Phase 6: discounted tariff purchase flow.
  - When a user with active eligible attribution views/buys tariffs, show discounted price.
  - Invoice amount should use discounted price.
  - Store discount metadata on the invoice or payment event so settlement can be audited.
  - Preserve existing Trial -> Normal -> Seller flow.

- [ ] Phase 7: reward settlement.
  - After a paid invoice, find active attribution.
  - Use attribution snapshots, not current admin settings.
  - Calculate reward from original tariff price.
  - Convert to TON if the sale was RUB or USDT.
  - Add BullRun fee as `1%` of partner reward.
  - Reserve network fee estimate against the admin reserve.
  - Write reward event and reserve ledger entries idempotently.
  - If reserve is insufficient, record admin debt and transition reserve status to `over_limit` or `closed_for_new_partners`.

- [ ] Phase 8: partner payout flow.
  - [x] Add bot flow for partner TON wallet entry.
  - [x] Add withdrawal request when partner balance is at least `5 TON`.
  - [x] Queue payout request in `referral_partner_payouts`.
  - [x] Let admin close an active TON request through manual payout marking.
  - [x] Add manual payout lifecycle statuses before automatic sender.
  - [x] Store manual TON tx hash and network fee on the payout request.
  - [ ] Send payout automatically from BullRun-controlled wallet.
  - [x] Charge manually entered network fee to admin reserve.
  - [ ] Update payout status by chain result.
  - [ ] Notify admin outside the dashboard when a payout request is created.

- [ ] Phase 9: admin refund flow.
  - Allow refund request only after `locked_until`.
  - Calculate refundable amount from free reserve.
  - If no referral sale happened, allow full free deposit refund.
  - If sales happened, deduct obligations, BullRun fee, network fee, and pending payouts.
  - Turning on refund flow should pause new partner onboarding.

## Admin UI Plan

### `/app/referrals`

- [ ] Add top-level protected reserve card.
  - Deposit address.
  - Minimum required: `100 TON`.
  - Total deposited.
  - Locked until.
  - Available reserve.
  - Reserved obligations.
  - Admin debt.
  - BullRun fees.
  - Network fees.
  - Program status.

- [ ] Gate referral enablement.
  - If reserve deposit is below `100 TON`, disable `referral_enabled`.
  - If deposit is confirmed and locked, allow enablement.
  - If status is `closed_for_new_partners`, explain that old leads remain honored but new partners cannot join.

- [ ] Add economics settings/readout.
  - Partner reward percent.
  - Fixed client discount: `10%`.
  - BullRun fee: `1%` of partner reward.
  - Show an example calculation using current settings.

- [ ] Add partner table columns.
  - TON payout wallet status.
  - Current TON balance.
  - Pending payout amount.
  - Withdrawable amount.
  - Last payout.

- [x] Add payout queue block.
  - Active requested/queued TON payout requests.
  - Partner, wallet, amount, requested time.
  - Manual status actions for queued, failed, cancelled, and sent-through-manual-payout.

- [x] Add lead table or lead drawer.
  - Partner.
  - Referred user.
  - First seen.
  - Expires at.
  - Discount eligibility.
  - Snapshot reward percent.
  - Snapshot discount percent.
  - Converted invoice.

- [ ] Add reserve notifications and action banners.
  - Deposit required.
  - Reserve low.
  - Reserve over limit.
  - Closed for new partners.
  - Refund available.
  - Pending payout failures.

### `/app/orders` and `/app/dossier`

- [x] Show referral discount metadata on orders.
- [x] Show partner attribution and expiry in dossier.
- [x] Show partner reward settlement status after purchase.
- [ ] Keep legacy dossier labels compatible with existing referral profile/attribution data.

### `/app/plans` and Payment Settings

- [ ] Remove duplicated referral configuration from plans if `/app/referrals` becomes the single referral control surface.
- [ ] If kept temporarily, make it link to `/app/referrals` and avoid conflicting saves.

## Telegram Bot Plan

- [ ] Partner onboarding.
  - If program is active, create partner profile and show referral link.
  - If reserve is closed for new partners, explain that partner onboarding is paused.
  - If partner already has a profile, keep showing their link if old links still have active leads.

- [ ] Lead entry by referral link.
  - If new attribution is allowed, record the lead and mention the discount.
  - If new attribution is not allowed, tell the user the partner discount is temporarily unavailable.
  - If the user already has active attribution, preserve old terms.

- [ ] Tariff display.
  - Show original price and discounted referral price for eligible leads.
  - Do not leak internal reserve/debt language to buyers.

- [ ] Partner account.
  - Show leads, converted sales, TON balance, and withdrawable amount.
  - Add TON wallet setup.
  - Add withdraw button if balance is at least `5 TON`.

- [ ] Notifications.
  - Admin: deposit confirmed, reserve low, reserve over limit, payout sent/failed, refund requested.
  - Partner: lead came in, sale converted, payout available, payout sent/failed, program paused for new partners.
  - Buyer: discount applied, or discount unavailable for new referral entries.

## API Surface

New or changed endpoints should stay explicit:

- `GET /api/referrals` returns dashboard plus reserve state.
- `POST /api/referrals/settings` validates reserve before enabling.
- `GET /api/referrals/reserve` returns reserve account and ledger summary.
- `POST /api/referrals/reserve/refund-request` starts admin refund flow.
- `GET /api/referrals/leads` returns attributions with expiry and discount state.
- `POST /api/referrals/partner-wallet` can be bot-only or admin-assisted.
- `POST /api/referrals/payout-request` requests partner withdrawal.

Avoid generic "agent action" style endpoints. If BullRun MCP later exposes this area, add read-only tools first:

- `referrals_summary`
- `referrals_reserve_status`
- `referrals_partner_preview`
- `referrals_payout_status`

## Reserve State Rules

Use deterministic reserve state calculation from ledger and referral events where possible.

Suggested formulas:

```text
total_deposited_ton =
  sum(ledger credits where entry_type = deposit_confirmed)

obligations_ton =
  unpaid partner rewards
  + unpaid BullRun fees
  + reserved or actual network fees
  + queued payouts

available_reserve_ton =
  total_deposited_ton
  - paid partner payouts
  - paid admin refunds
  - obligations_ton

admin_debt_ton =
  max(0, obligations_ton - remaining reserve coverage)
```

If `available_reserve_ton < 0`, transition to `over_limit` and `closed_for_new_partners`.

If `available_reserve_ton` is positive but below a future threshold, transition to `reserve_low`. The exact threshold can be `20 TON` or one estimated max reward; decide during implementation.

## Open Decisions

- Exact TON infrastructure provider or self-hosted indexer for automated payouts. Deposit watcher MVP uses TON Center API.
- Whether every admin gets a unique TON wallet/subwallet later. MVP uses one shared BullRun reserve wallet plus unique memo/comment per admin.
- Exact exchange rate provider and acceptable staleness window.
- Whether partner reward is always paid only in TON for MVP. Current plan says yes.
- Whether partner wallet changes require a cooldown before payouts.
- Whether admin refund pauses all active lead windows immediately or only prevents new attributions. Current product direction: active old lead terms remain honored unless explicitly cancelled before any sales.
- Reserve-low threshold.
- Whether payout requests are immediate or batched on a schedule.

## Risks

- Custodial wallet ownership increases security and operational risk.
- Automated payouts require strict idempotency around chain transactions.
- Exchange rate failures can create disputed calculations if not stored with each reward event.
- Existing referral reward code grants rewards directly into profile balances; protected settlement needs a clearer ledger or it will be hard to audit.
- The current manual payout endpoint may fail because payout events use `referred_tg_user_id: null` while the live DB column is non-nullable.
- Referral discounts affect invoice amount, so order/payment screens must show original price and discount clearly.
- Admin refund behavior can conflict with active lead expectations unless UI and bot copy are explicit.

## Verification Plan

Manual verification until tests exist:

- Backend build/start:
  - `cd backend && node server.js`
- Admin build:
  - `cd admin-v2 && npm run build`
- Public site build if checkout surfaces are touched:
  - `cd site-v2 && npm run build`

Scenario checks:

- Admin cannot enable referrals with reserve below `100 TON`.
- Confirmed deposit of `100 TON` creates a 30-day lock and allows referral enablement.
- Partner can get a referral link only while program accepts new partners.
- New buyer through active referral link gets `10%` discount.
- Attribution stores 30-day expiry and snapshot terms.
- Paid invoice creates reward from original tariff price.
- RUB sale stores original RUB calculation and TON converted reward.
- BullRun fee is `1%` of partner reward and charged to admin.
- Reserve over-limit closes new partner onboarding but preserves old attributed lead discounts.
- Partner withdrawal is blocked below `5 TON`.
- Partner withdrawal at or above `5 TON` creates payout and charges network fee to admin.
- Admin refund is blocked before `locked_until`.
- Admin refund after lock returns only free reserve.

## Implementation Review Placeholder

- Initial MVP foundation started on April 17, 2026.
- Applied Supabase migrations:
  - `protected_referrals_ton_reserve`
  - `protected_referrals_reward_idempotency`
  - `protected_referrals_reserve_ledger_account_idx`
- Added backend SQL file: `backend/sql/protected-referrals-ton-reserve.sql`.
- Added backend reserve state service: `backend/services/referral-reserve.service.js`.
- Expanded `GET /api/referrals` to return `reserve` and `economics`.
- Gated `POST /api/referrals/settings` so referrals cannot be enabled until the protected reserve is ready.
- Updated official bot referral entry/onboarding so new leads and new partners respect reserve availability, while existing partners can still see their link/statistics.
- Updated official bot invoice creation so active attributed leads receive the fixed referral discount in the payable invoice amount.
- Updated reward calculation to prefer attribution snapshots and original tariff price, with TON reserve ledger entries for TON rewards.
- Added `/app/referrals` reserve-first UI card and economics readout.
- Verified:
  - `node --check backend/services/referral-reserve.service.js`
  - `node --check backend/routes/referral.routes.js`
  - `node --check backend/services/official-bot.service.js`
  - `node --check backend/server.js`
  - `cd admin-v2 && npm run build`
- Supabase advisors after migration:
  - Security: existing `public.handle_new_user` mutable search_path warning remains unrelated.
  - Performance: added the missing `referral_reserve_ledger.reserve_account_id` index after advisor flagged it.
- Before continuing, split remaining work into backend schema/service, TON wallet/rates, official bot, admin UI, and reviewer passes.
- Use Supabase MCP for schema inspection and migrations.
- Use `backend-developer`, `frontend-developer`, `payment-integration`, `blockchain-developer`, and `reviewer` subagents or Claude workers for bounded implementation slices when implementation starts.
- Added TON reserve deposit watcher:
  - `backend/jobs/ton-reserve-watch.job.js`
  - `startTonReserveWatch(supabase)` in `backend/server.js`
  - `recordReferralReserveDeposit(...)` in `backend/services/referral-reserve.service.js`
  - `referral_reserve_accounts_deposit_memo_unique` migration for memo lookup and collision protection
- Runtime env for MVP deposit watcher:
  - `TON_RESERVE_WATCH_ENABLED=true`
  - `TON_RESERVE_DEPOSIT_ADDRESS=<BullRun controlled TON wallet>`
  - `TON_RESERVE_API_BASE=https://toncenter.com/api/v2`
  - `TON_RESERVE_API_KEY=<optional TON Center key>`
  - `TON_RESERVE_POLL_INTERVAL_MS=120000`
  - `TON_RESERVE_TX_LIMIT=50`
  - `TON_RESERVE_MAX_PAGES=20`
- Deposit watcher is off by default unless `TON_RESERVE_WATCH_ENABLED=true` and `TON_RESERVE_DEPOSIT_ADDRESS` are set.
- TON deposits must include the admin memo like `br_...`; without memo the shared-wallet MVP cannot attribute the deposit to an admin.
- A focused review found three blocker risks before commit: missed deposits without pagination, stale account totals after a partial ledger/account failure, and non-unique/case-sensitive memos. The implementation now paginates TON Center reads, reconciles known deposit accounts from ledger, normalizes memos, and adds a unique case-insensitive memo index.
- Verified TON watcher changes:
  - `node --check backend/jobs/ton-reserve-watch.job.js`
  - `node --check backend/services/referral-reserve.service.js`
  - `node --check backend/server.js`
  - `git diff --check`
- Production TON reserve wallet setup completed on April 17, 2026:
  - public deposit address: `UQBvr3KLWw6xt0DBrDSsDku5w9gxJiVh4J2AuvV57wJyr-40`
  - server secret file: `/root/bullrun-ton-reserve/reserve-wallet.json`
  - secret file permissions: `600`
  - backend env backup before enabling: `/var/www/backend/.env.backup-20260417-ton-reserve`
  - watcher env enabled in `/var/www/backend/.env`
  - PM2 restarted with `--update-env`
  - verified production log line: `[TonReserveWatch] started { interval_ms: 120000, provider: 'toncenter' }`
- Do not commit or print the reserve wallet mnemonic. For future automated payouts, read the mnemonic only from the protected server file or move it to a proper secret manager before real customer money.
- Added exchange rate refresh and TON settlement conversion:
  - `backend/services/crypto-rates.service.js`
  - `backend/jobs/crypto-rates.job.js`
  - `startCryptoRatesRefresh(supabase)` in `backend/server.js`
  - referral reward settlement now stores original sale/reward currency, but credits partner balance and reserve obligation in TON
  - `USDT` is priced through CoinGecko `usd` as a stablecoin MVP approximation
- Runtime env for exchange rates:
  - `CRYPTO_RATES_ENABLED=true` by default
  - `CRYPTO_RATES_INTERVAL_MS=3600000`
  - `COINGECKO_API_BASE=https://api.coingecko.com/api/v3`
  - `COINGECKO_API_KEY=<optional>`
  - `COINGECKO_API_KEY_HEADER=x-cg-demo-api-key` by default
- Verified CoinGecko fetch locally on April 17, 2026:
  - TON/RUB returned a positive rate
  - TON/USDT returned a positive rate
- Added referral settlement retry job:
  - `backend/jobs/referral-settlement-retry.job.js`
  - `startReferralSettlementRetry(supabase, getBotById)` in `backend/server.js`
  - scans unconverted referral attributions every 10 minutes
  - finds paid invoices completed inside the attribution window
  - reruns reward settlement after rates recover
  - settlement expiry check now uses invoice `paid_at`, not retry time, so paid-in-window leads are still honored
  - existing attributed leads no longer depend on current `referral_enabled`; reward snapshot and payment date decide settlement
- Runtime env for retry:
  - `REFERRAL_SETTLEMENT_RETRY_ENABLED=true` by default
  - `REFERRAL_SETTLEMENT_RETRY_INTERVAL_MS=600000`
  - `REFERRAL_SETTLEMENT_RETRY_BATCH_LIMIT=100`
- Added partner payout request MVP:
  - partners can save a TON wallet from the official bot partner screen
  - wallet changes are blocked while a payout request is pending
  - partners can create a payout request once `balance_ton >= 5`
  - database allows only one active `requested`/`queued` payout per partner
  - admin can manually close the active TON request from `/app/referrals`; this marks the request `sent` and decrements partner balance
  - payout requests are not sent automatically yet
  - `/app/referrals` shows partner payout wallet and pending requested TON amount
  - admin/manual payout remains separate from automated payout sending
  - TON payout accounting uses 6 decimal places
- Added read-only referral metadata outside `/app/referrals`:
  - `/app/orders` shows referral discount, original price, partner reward TON, and reward status
  - `/app/orders` has a `По рефке` filter for invoice triage
  - `/app/dossier` shows whether the client is a partner/referred user, who referred them, attribution expiry, discount snapshot, partner balance, and reward status per order
  - no referral settings, payout controls, or reserve controls were moved into orders/dossier
- Added `/app/referrals` payout queue and lead visibility:
  - backend `GET /api/referrals` returns normalized `leads` with partner, expiry, snapshot, discount eligibility, conversion, and reward context
  - `/app/referrals` shows a wide lead table with dossier links
  - `/app/referrals` has a separate active payout request queue with partner, wallet, amount, status, and requested time
  - admin can move a payout request to `queued`, mark it `failed`, or `cancelled`; marking `sent` still goes through the existing manual payout path so partner balance is decremented
- Added manual payout lifecycle groundwork:
  - active payout requests now include `requested`, `queued`, and `sending`
  - `/app/referrals` can move a request to `sending` before marking it sent
  - manual TON payout marking can store `chain_tx_hash` and `network_fee_ton`
  - manually entered network fee is written to the reserve ledger as `network_fee_reserved`
  - the partner bot treats `sending` as an active request, so partners cannot change wallet or create a duplicate request while money is in flight
  - automatic TON sending and blockchain confirmation remain intentionally unimplemented
