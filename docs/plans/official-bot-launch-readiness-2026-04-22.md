# Official Bot Launch Readiness - 2026-04-22

## Purpose

This note defines when an admin's sales official bot can be considered ready for the first real launch.

The goal is not "a bot token exists". The bot is launch-ready only when the full paid-access path works:

1. buyer sees a tariff;
2. buyer creates an invoice;
3. buyer pays through configured requisites;
4. admin can see the order;
5. bot can issue access to the configured Telegram target;
6. access state is visible in admin operations.

## Current Sources

- Live UI checklist: `admin-v2/src/ui/OpsChecklistRail.jsx`
- Dashboard readiness API: `backend/routes/dashboard.routes.js`
- Bot setup notes: `docs/plans/botfather-surface-2026-04-09.md`
- Group admin visibility notes: `docs/plans/botfather-group-admin-visibility-2026-04-12.md`
- Payment settings cleanup: `docs/plans/payment-settings-backend-db-cleanup-2026-04-08.md`
- Tariff delivery notes: `docs/plans/tariff-delivery-toggles-2026-04-15.md`

## Launch-Ready Checklist

- [ ] Payment requisites are configured.
  - Ready if `/app/payments` has at least one real payment method:
    - TON wallet, or
    - SBP phone.
  - Bank name alone is not enough for SBP readiness.

- [ ] Sales official bot is connected.
  - Ready if the owner has at least one `tg_accounts` row with `account_type = bot` and sales role.
  - The UI source is `/app/botfather`.
  - A connected bot should show username/TG ID and be removable from the connected bots list.

- [ ] Bot-level admin Telegram ID is configured.
  - Ready if the connected sales bot has `tg_accounts.admin_tg_id`.
  - `payment_settings.admin_tg_id` may exist as fallback, but bot-level `admin_tg_id` is the preferred source for launch.
  - This ID is needed for admin-side bot controls, receipts, and operational signals.

- [ ] Telegram target is known and bot is admin there.
  - Ready if the sale target channel/group is present in `channels` and linked to the official bot through `channels.bot_id`.
  - The bot usually learns this when it is added/promoted as administrator in the Telegram group/channel.
  - If the group is not visible, `/app/admin-groups` sync may help only when the owner has a live userbot.

- [ ] Active tariff exists.
  - Ready if the owner has at least one active tariff.
  - The UI source is `/app/plans`.

- [ ] Tariff has delivery configured.
  - Ready if the tariff can actually deliver something after payment:
    - primary closed group through `tariffs.channel_id`, or
    - bundle chat/resource through `tariff_bundle_items`.
  - For bundled Telegram access, the official bot must issue the primary group invite and every active bundle chat invite together.

- [ ] Buyer checkout works.
  - Ready if opening a tariff in the sales bot creates an invoice with the expected amount/currency and payment instructions.
  - For TON payments, the buyer-facing wallet must be the admin/seller wallet configured in requisites, not the referral reserve wallet.

- [ ] Paid order lands in operations.
  - Ready if the created invoice/order appears in `/app/orders`.
  - Manual confirmation paths must be visible when the payment method requires manual approval.

- [ ] Access issuance works.
  - Ready if a paid invoice leads to an invite/access grant for the configured Telegram target.
  - The result should be visible in `/app/access`.

- [ ] Failure paths are visible.
  - Ready if these states are not silent:
    - paid order without reliable join confirmation;
    - group without bot admin;
    - pending/manual payment;
    - failed invite or access delivery.
  - Current dashboard signals already cover several of these states.

## Optional For First Launch

These are useful but should not block the first friendly-client launch:

- Referrals reserve and partner flow.
- Userbot/proxy infrastructure.
- Broadcast/retention flows.
- Shop seller asset marketplace.
- BullRun MCP tools.

## Current Gap

The right rail checklist currently checks only broad readiness:

- payment method exists;
- sales bot or bot-linked group exists;
- active tariff exists;
- referral step is always incomplete.

It does not yet verify:

- bot-level `admin_tg_id`;
- tariff delivery target;
- bot admin rights in the target group;
- real checkout-to-access smoke result.

## Recommended UI Rule

Add a dedicated launch readiness block for the sales bot flow. It should be stricter than the current right rail:

- `Реквизиты`
- `Sales bot`
- `Admin TG ID`
- `Группа/канал с bot-админом`
- `Активный тариф`
- `Выдача доступа`
- `Тестовый заказ`

The block should avoid long explanations. It should show a clear state and one next action per failed item.

## Manual Smoke Test

Before saying a bot is ready for launch:

- [ ] Open `/app/payments` and confirm live requisites.
- [ ] Open `/app/botfather` and confirm the sales bot plus bot-level admin TG ID.
- [ ] Add/promote the bot as admin in the Telegram target.
- [ ] Open `/app/admin-groups` and confirm the target is linked to the bot.
- [ ] Open `/app/plans` and confirm an active tariff with delivery.
- [ ] In Telegram, open the sales bot as a buyer and create an invoice.
- [ ] Confirm the payment manually or through the configured payment flow.
- [ ] Confirm `/app/orders` shows the paid order.
- [ ] Confirm the buyer receives access/invite.
- [ ] Confirm `/app/access` shows the resulting access state.

## Notes On Existing Plans

Do not delete the related historical plans yet. They are still useful because they explain why current readiness is shaped this way:

- `botfather-surface-2026-04-09.md` explains connected bot inventory and admin TG ID ownership.
- `botfather-group-admin-visibility-2026-04-12.md` explains why official bots cannot always discover groups by themselves.
- `payment-settings-backend-db-cleanup-2026-04-08.md` explains the current payment readiness rule.
- `tariff-delivery-toggles-2026-04-15.md` explains tariff delivery and bundle behavior.
