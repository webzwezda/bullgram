# Customers Page AI Navigation - 2026-04-25

## Page

- Route: `/app/customers`
- Runtime: `admin-v2`
- Main file: [CustomersPage.jsx](/Users/webzwezda/Desktop/bullrun/admin-v2/src/pages/CustomersPage.jsx)
- Backend source: [customers.routes.js](/Users/webzwezda/Desktop/bullrun/backend/routes/customers.routes.js)

## Purpose

`/app/customers` is the main operator workbench for people, not for raw entities.

The page exists to answer one daily operational question:

`Who needs action right now, what exactly happened to them, and what should the admin do next?`

This screen replaces the old zoo of fragmented customer pages where operators had to jump between:

- CRM
- Orders
- Abandoned
- Access
- Dossier
- Bases

The goal is to keep the first line of customer operations in one place:

- see the person
- understand their state
- understand why they are here
- act immediately

## Product Goal

The strategic goal of `Customers` is to become the single navigation hub for client operations.

It should let an admin or AI:

- find hot leads
- find unpaid users
- find active or expired customers
- find people with access problems
- find users removed manually by admin
- launch outreach
- open dossier
- extend or revoke access

without forcing the operator to think in backend tables.

## What The Page Is Not

`/app/customers` is not:

- a pure invoice ledger
- a pure access-event log
- a raw CRM dump
- a bases sync console
- a full broadcast editor

Those deeper tools still exist, but `Customers` should be the first operational entry point.

## Data Model Behind The Screen

The page is a consolidated workbench built from multiple backend surfaces:

- `customer_funnel_events`
  - first touches
  - tariff views
  - payment method selection
  - invoice creation intent
- `invoices`
  - unpaid / paid / awaiting receipt
- `subscriptions`
  - active / expired / restored / kicked context
- `access_events`
  - join approved
  - kicked
  - restored
  - manual admin removal
- `access_invites`
  - issued access links
- `customer_base_members`
  - group presence / in-group confirmation
- `channels`
  - ties the person to the real Telegram channel/group

The screen translates these sources into human segments.

## Main Segments

Current main tabs:

- `Нажал старт`
  - people who reached the bot for the first time
- `Смотрели тарифы`
  - people who opened tariffs but did not create an invoice
- `Не смогли оплатить`
  - people with invoice/payment friction
- `Активный доступ`
  - users with active access
- `Доступ закончился`
  - users whose access ended naturally
- `Удален админом`
  - users manually removed by admin from the group
- `Не смог войти`
  - users with paid/issued access but unresolved Telegram entry

These tabs are states of a person, not states of a table.

## Why These Segments Exist

Each segment answers a different operator workflow:

- `Нажал старт`
  - early contact
  - can be warmed up manually
- `Смотрели тарифы`
  - strong interest, invoice not yet created
  - candidate for nudge or broadcast
- `Не смогли оплатить`
  - invoice exists, payment stalled
  - candidate for manual help
- `Активный доступ`
  - customer is healthy
  - can be extended or reviewed
- `Доступ закончился`
  - natural retention / winback segment
- `Удален админом`
  - deliberate admin action
  - should not be mixed with natural expiration
- `Не смог войти`
  - payment/access exists, Telegram entry is broken or unconfirmed

## Why `Removed By Admin` Is Separate

Manual admin removal is a different business state from:

- expired access
- auto-kick after expiration
- access not confirmed

It must stay separate because:

- operator intent is different
- recovery logic is different
- broadcast logic is different
- dossier interpretation is different

## Bot Scope

The page is bot-scoped.

If an owner has multiple official bots, `Customers` must not mix their funnels by default.

The bot selector exists because:

- one owner can run multiple sales bots
- channels may belong to different bot flows
- deleted bots can still have historical data

So `Customers` is not only user-state navigation, but also bot-scoped navigation.

## Main Column Meaning

### Client

This column identifies the person:

- first name / last name
- Telegram ID
- `@username`

It should never be overloaded with technical labels.

### Tariff / Channel

This column explains where the state happened:

- tariff
- channel

This is the business context of the row.

### Status

This is the short operational state:

- `Нажал /start`
- `Открыл тариф`
- `Счет без оплаты`
- `Доступ активен`
- `Доступ закончился`
- `Удален админом`
- `Вход не подтвержден`

### Reason

This is the explanation of why the person is here.

The reason should stay human-readable and operator-facing, not backend raw values.

### Actions

This is the execution point.

The page is not only for reading.
It is for doing.

## Main Row Actions

Current actions from `Customers`:

- `Написать`
  - opens manual outreach / userbot center flow
- `Досье`
  - opens full person history
- `Открыть источник`
  - opens compatibility/deep link
- dropdown `Действия`
  - `Продлить на 5 дней`
  - `Продлить на 30 дней`
  - `Выдать навсегда`
  - `Удалить из группы`

These actions make `Customers` an operational hub, not a report.

## Quick Broadcast Role

The quick broadcast block under the table is the fast mass-action layer.

It exists because the operator often needs to message:

- everyone in current filter
- everyone in current segment
- everyone in a broken state

This is not meant to replace full `/app/broadcast`.

Role split:

- `/app/customers`
  - fast segment selection and quick action
- `/app/broadcast`
  - full campaign editor and advanced sending flow

## Navigation Role

For AI, `/app/customers` should be treated as the primary navigation page for people-related work.

When the task is about a person or customer segment, start here first.

Examples:

- “who looked at tariffs but didn’t pay”
- “who paid but didn’t join”
- “who expired”
- “who was removed manually”
- “who should receive a return message”
- “who needs access extension”

## Where To Go From Customers

`Customers` should route deeper only when the current task needs specialized detail.

### Go to Dossier when:

- you need full history of one person
- you need referrals, payments, subscriptions, access events in one timeline
- you need evidence before making a decision

Route:

- `/app/dossier?tg=...`

### Go to Broadcast when:

- quick broadcast is not enough
- you need advanced sender logic
- you need full audience composition or campaign behavior

Route:

- `/app/broadcast`

### Go to Userbot Center when:

- you need manual DM
- you need direct person-level outreach handling
- you need inbox/manual follow-up infrastructure

Route:

- `/app/userbot-center`

### Go to Hidden Pages only when:

- you are debugging parity
- you are checking legacy behavior
- you need emergency fallback

Examples:

- `/app/crm`
- `/app/access`
- `/app/orders`
- `/app/abandoned`

These are compatibility/transition surfaces, not the preferred daily path.

## AI Navigation Rule

If an AI is trying to help an operator with customer operations, use this order:

1. Start in `/app/customers`
2. Identify the right segment/tab
3. Use row actions if the task is simple
4. Open `Dossier` if the case needs deep context
5. Open `Broadcast` only if mass outreach needs advanced control

## AI Interpretation Rule

When reading `Customers`, AI should interpret rows as:

- person-first
- state-first
- action-first

not as:

- invoice-first
- raw subscription-first
- raw access-event-first

The page is meant to reduce operator cognitive load.

## Success Criterion

`/app/customers` is successful when an admin can answer these without leaving the screen for most cases:

- Who needs attention?
- Why are they here?
- What happened?
- What should I do next?
- Can I message them?
- Can I restore access?
- Can I remove access?

If a future change makes the page more technical and less operational, that change goes against the purpose of this screen.
