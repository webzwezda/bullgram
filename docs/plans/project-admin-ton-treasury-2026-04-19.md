# Project Admin TON Treasury

## Context

We need a project-level admin area for BullRun itself, not the current tenant/admin UI. This is for managing money that comes into BullRun-controlled TON wallets from product purchases, proxy/userbot sales, seller flows, referral fees, and later withdrawals.

Current important state:

- `shop` TON checkout currently uses the seller/admin wallet from `payment_settings.ton_wallet`.
- Referral protected reserve already uses a BullRun-controlled reserve wallet and a reserve ledger.
- Partner payout automation already exists and must not spend money that belongs to sellers or BullRun revenue.
- BullRun referral fee is `1%` of partner reward and is charged to the admin on top of partner reward.

New target direction:

- All TON purchases for BullRun-owned commerce should go to a BullRun-controlled wallet.
- This includes future purchases of proxies and userbots.
- We need a project-admin page where BullRun can see balances and withdraw available funds.
- Withdrawals must never touch partner obligations, admin reserves, pending seller payouts, network-fee buffers, or unsettled purchases.

## Product Rule

Do not treat the on-chain wallet balance as withdrawable money.

Withdrawable money must be calculated from an internal ledger:

```text
wallet balance
- partner reward liabilities
- admin reserve refundable balances
- pending partner payouts
- pending seller payouts
- pending purchase handoff risk
- reserved network fees
- failed/in-flight transaction buffers
= BullRun available treasury
```

If ledger and chain balance disagree, the UI must show a reconciliation warning and block automatic withdrawal until reviewed.

## Scope

### In Scope

- Project-level admin page, separate from normal customer admin pages.
- BullRun-controlled TON receiving wallet for platform commerce.
- Ledger that splits every incoming TON payment into buckets.
- Withdrawal request and automatic TON send from BullRun treasury wallet.
- Clear UI that shows what can be withdrawn and what is locked/reserved.
- Audit history for every money-affecting operation.

### Out Of Scope For First Pass

- Multi-currency treasury beyond TON.
- Legal/tax reporting.
- Fiat bank withdrawal.
- Multi-signature wallet.
- Complex accounting exports.
- Isolated wallets per tenant/seller, unless shared-wallet memo accounting becomes unsafe.

## Money Buckets

Every TON movement must be classified into one of these buckets.

### `platform_revenue`

BullRun-owned money.

Examples:

- BullRun package sales.
- Proxy sales owned by BullRun.
- Userbot sales owned by BullRun.
- BullRun `1%` referral fee.
- Other explicit BullRun commissions.

This bucket can become withdrawable after risk locks and reconciliation pass.

### `partner_liability`

Money owed to referral partners.

Examples:

- Partner reward amount.
- Partner payout that is requested, queued, sending, or sent but not confirmed.

This must never be available for project-admin withdrawal.

### `admin_reserve_liability`

Money that belongs to customer admins as protected referral reserve.

Examples:

- Admin reserve deposit.
- Refundable reserve balance.
- Locked reserve not yet withdrawable by admin.

This must never be available for BullRun withdrawal.

### `seller_liability`

Money owed to a seller if we move shop payments to our wallet.

Examples:

- Marketplace userbot sale where seller should receive proceeds.
- Marketplace proxy sale where seller is not BullRun.
- P2P seller product if BullRun acts as escrow.

This must not be available for BullRun withdrawal until seller settlement and commission split are complete.

### `network_fee_reserve`

Money kept for TON transfer fees.

Examples:

- Partner payout network fee.
- Admin reserve refund network fee.
- Seller payout network fee.
- Project treasury withdrawal network fee.

This must be deducted before showing withdrawable money.

### `pending_payment`

Incoming purchase that is not final yet.

Examples:

- Waiting for TON confirmation.
- Paid but ownership transfer/handoff not complete.
- Paid but purchase is under dispute/manual review.

This must stay locked until the purchase is final.

## Commission Rules

### Referral Commission

- BullRun fee is `1%` of the partner reward.
- The fee is charged to the admin on top of partner reward.
- The fee belongs to `platform_revenue`.
- It must be written as a ledger entry at the same time the partner reward obligation is created.
- The fee cannot be withdrawn until the related sale is settled and reserve reconciliation is clean.

### Shop / Proxy / Userbot Commission

Decision needed before implementation:

- If BullRun owns the inventory, sale proceeds are `platform_revenue`.
- If another seller owns the inventory, proceeds split into:
  - seller liability,
  - BullRun commission,
  - network fee reserve.

MVP assumption:

- BullRun-owned proxies/userbots: `100% platform_revenue`.
- Third-party seller flow: keep existing seller model until we explicitly add seller settlement ledger.

## Target Data Model

### `project_treasury_accounts`

Purpose: BullRun-controlled project-level wallets.

Fields:

- `id`
- `currency` (`TON`)
- `wallet_address`
- `wallet_role` (`platform_revenue`, `shop_escrow`, `reserve`, `mixed_mvp`)
- `status` (`active`, `paused`, `retired`)
- `last_chain_balance_ton`
- `last_reconciled_at`
- `created_at`
- `updated_at`
- `payload`

MVP can use one shared wallet, but ledger classification must be strict.

### `project_treasury_ledger`

Purpose: append-only source of truth for BullRun treasury accounting.

Fields:

- `id`
- `treasury_account_id`
- `owner_id`
- `entry_type`
- `bucket`
- `direction` (`credit`, `debit`)
- `amount_ton`
- `chain_tx_hash`
- `related_purchase_id`
- `related_invoice_id`
- `related_referral_event_id`
- `related_partner_payout_id`
- `related_reserve_account_id`
- `created_at`
- `payload`

Entry types:

- `shop_payment_confirmed`
- `proxy_sale_confirmed`
- `userbot_sale_confirmed`
- `platform_fee_created`
- `referral_fee_created`
- `partner_liability_created`
- `seller_liability_created`
- `network_fee_reserved`
- `partner_payout_sent`
- `seller_payout_sent`
- `admin_reserve_deposit`
- `admin_reserve_refund_sent`
- `project_withdrawal_requested`
- `project_withdrawal_sent`
- `manual_adjustment`
- `reconciliation_correction`

### `project_treasury_withdrawals`

Purpose: withdrawal requests from project-level admin page.

Fields:

- `id`
- `treasury_account_id`
- `requested_by`
- `to_wallet`
- `amount_ton`
- `network_fee_ton`
- `status` (`requested`, `queued`, `sending`, `sent`, `confirmed`, `failed`, `cancelled`)
- `chain_tx_hash`
- `failure_reason`
- `requested_at`
- `sent_at`
- `confirmed_at`
- `payload`

Rules:

- Withdrawal amount must be less than or equal to computed `available_treasury_ton`.
- Automatic send must use a max-per-withdrawal env cap.
- Any reconciliation warning blocks automatic send.

### `project_treasury_reconciliation_runs`

Purpose: compare ledger totals with chain wallet balance.

Fields:

- `id`
- `treasury_account_id`
- `chain_balance_ton`
- `ledger_balance_ton`
- `available_treasury_ton`
- `reserved_liabilities_ton`
- `difference_ton`
- `status` (`ok`, `warning`, `blocked`)
- `created_at`
- `payload`

## Backend Plan

### Phase 1: Treasury Read Model

- Add a service that calculates:
  - total chain balance,
  - total ledger balance,
  - platform revenue,
  - partner liabilities,
  - admin reserve liabilities,
  - seller liabilities,
  - network fee reserve,
  - pending payments,
  - available treasury.
- Reuse TON provider access already used by reserve watcher/confirmation.
- Add read-only API for project admin:
  - `GET /api/project-admin/treasury`
  - `GET /api/project-admin/treasury/ledger`
  - `GET /api/project-admin/treasury/withdrawals`

### Phase 2: Ledger Writes For New Money

- When TON shop payment is confirmed, write treasury ledger entries.
- For BullRun-owned products:
  - credit `platform_revenue`.
- For seller-owned products:
  - credit `seller_liability`,
  - credit BullRun commission if configured,
  - reserve network fee if payout will be automated.
- When referral reward is created:
  - keep existing reserve ledger,
  - mirror BullRun `1%` fee into project treasury ledger as `referral_fee_created`.
- When partner/admin/seller payouts happen:
  - debit the correct liability bucket,
  - debit network fee reserve.

### Phase 3: Move TON Checkout To BullRun Wallet

Do this only after Phase 1 and Phase 2 exist.

- Add env:
  - `PROJECT_TREASURY_TON_ADDRESS`
  - `PROJECT_TREASURY_WALLET_SECRET_FILE`
  - `PROJECT_TREASURY_SENDER_ENABLED`
  - `PROJECT_TREASURY_WITHDRAWAL_MAX_AMOUNT_TON`
- Change TON checkout for BullRun-owned shop/proxy/userbot products to use `PROJECT_TREASURY_TON_ADDRESS`.
- Store memo and wallet in purchase payload.
- Keep seller `payment_settings.ton_wallet` only for flows that still pay seller directly.
- UI copy must not say "seller wallet" if money goes to BullRun escrow.

### Phase 4: Project Admin Withdrawal

- Add `POST /api/project-admin/treasury/withdrawals`.
- Add `POST /api/project-admin/treasury/withdrawals/:id/send`.
- Add confirmation watcher for project treasury withdrawals.
- Block withdrawal if:
  - amount is above available treasury,
  - ledger/chain reconciliation is not `ok`,
  - wallet secret is missing,
  - sender env flag is disabled,
  - amount is above max auto withdrawal cap.

### Phase 5: Operational Safety

- Add idempotency keys for ledger writes by chain tx hash and related purchase id.
- Add admin notifications for:
  - large incoming payment,
  - reconciliation mismatch,
  - failed withdrawal,
  - withdrawal confirmed.
- Add manual adjustment route only for project admin role.
- Add export/download later if needed.

## Admin UI Plan

New surface: `/app/project-admin` or `/app/treasury`.

This page is for BullRun operator only. It must not appear for normal customer admins.

Sections:

### Overview

- Chain wallet balance.
- Ledger balance.
- Available to withdraw.
- Reserved liabilities.
- Reconciliation status.

### Buckets

- BullRun revenue.
- Partner liabilities.
- Admin reserve liabilities.
- Seller liabilities.
- Network fee reserve.
- Pending payments.

Each bucket should show:

- amount,
- last update,
- short explanation,
- link to ledger rows.

### Withdraw

- Destination TON wallet.
- Amount.
- Estimated network fee.
- Available balance after withdrawal.
- Warning if amount is close to available limit.
- Request button.
- Send button only when sender is enabled and reconciliation is clean.

### Ledger

- Filter by bucket.
- Filter by entry type.
- Filter by related entity.
- Tx hash.
- Amount.
- Direction.
- Created time.

### Reconciliation

- Last run status.
- Chain balance vs ledger balance.
- Difference.
- Blocking reason.
- Button to rerun reconciliation.

## Role And Access Rules

- Add project-level role separate from normal `admin`.
- Suggested role: `platform_admin`.
- Only `platform_admin` can open the page or call treasury APIs.
- Normal customer admins must never see project treasury.
- Seller admins must only see their own seller payouts, not total treasury.

## Implementation Order

1. Create plan and data model.
2. Add migrations for treasury accounts, ledger, withdrawals, reconciliation runs.
3. Add read-only treasury service and API.
4. Backfill/mirror current referral BullRun fee entries into project treasury ledger.
5. Add project admin UI read-only overview.
6. Add withdrawal request UI without automatic send.
7. Add automatic withdrawal sender with env flag and max cap.
8. Move BullRun-owned TON checkout to treasury wallet.
9. Add seller-liability flow if third-party seller funds should also pass through BullRun.
10. Run controlled TON purchase and withdrawal test.

## Open Decisions

- Should the project admin route be `/app/project-admin`, `/app/treasury`, or hidden under `/app/billing`?
- Is the first treasury wallet the same as the reserve wallet or a separate wallet?
  - Recommendation: separate wallet for project revenue/escrow.
- Do seller-owned assets still pay directly to seller for MVP, or do we move them into BullRun escrow now?
  - Recommendation: BullRun-owned proxy/userbot sales first; third-party seller escrow later.
- What is the max automatic project withdrawal amount?
- What commission applies to third-party seller sales?
- Who gets `platform_admin` role in the current Supabase profile model?

## Critical Lessons

- Never calculate withdrawable money from chain balance alone.
- Never mix partner reserve/refund money with BullRun available revenue.
- Never reuse memo values for money flows that need later chain confirmation.
- Every outgoing TON transaction needs status, tx hash, confirmation, retry/failure path, and manual recovery.
