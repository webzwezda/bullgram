# CRM, Orders, Abandoned Context - 2026-04-23

## Product Boundary

`/app/orders` is the invoice and payment operations screen.

It answers:

- which invoices exist;
- which invoices are paid, pending, waiting for receipt, waiting for admin, or rejected;
- whether the paid order produced an invite/access trace;
- whether the order came through referral attribution;
- what the operator should do next for this order.

`/app/crm` is the subscriber/customer relationship screen.

It answers:

- who is in the customer/subscriber base;
- which subscriptions are active or expired;
- which customers need retention, extension, kick, manual message, or access cleanup;
- what to do with a customer across time, not just one invoice.

`/app/abandoned` is currently an unpaid invoice radar, not a true tariff-view funnel.

It answers:

- who created an invoice and did not finish payment;
- who clicked "I paid" but is still in a manual confirmation state;
- which unpaid invoice segment can be moved to orders, broadcast, CRM, or manual follow-up.

It does not yet track:

- tariff list opened;
- tariff details viewed;
- payment method selected before invoice creation.

## Important Rule

Do not present `paid but not joined` as a proven user behavior unless there is reliable evidence.

Current implementation can only infer it from:

- paid invoice;
- active subscription;
- missing `last_join_approved_at`.

That can also mean Telegram did not send/record the join event, the tariff delivered a resource instead of a group invite, or the access flow did not create an invite trace. Use cautious wording:

- "access needs check"
- "join not confirmed"
- "no join confirmation"

Avoid stronger wording like:

- "the user did not enter the group"
- "paid but ignored the invite"

## Current DB Snapshot

On 2026-04-23, aggregate inspection found no paid invoices in production, so the `paid but not joined` scenario is not validated by real data yet.

## Near-Term UI Direction

- Keep `/app/orders` as the source of truth for invoice/payment/access handoff.
- Keep `/app/crm` as the subscriber/customer screen.
- Keep `/app/abandoned` only as unpaid invoice radar until we add true funnel events.
- Rename and rewrite risky "paid but not joined" labels to "access needs check" / "join not confirmed".

