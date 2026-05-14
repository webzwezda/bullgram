# Robokassa Normal Billing Foundation

## Цель

Подготовить отдельный Robokassa billing-контур для оплаты BullRun, чтобы после регистрации магазина осталось минимум ручной работы:

- внести `MerchantLogin`, пароль 1, пароль 2 и тестовый/боевой режим;
- прописать ResultURL, SuccessURL и FailURL в кабинете Robokassa;
- выполнить тестовую оплату `Normal`;
- переключить checkout из test mode в production.

Основной продаваемый продукт: `Normal` за `2 900 ₽ / 30 дней`. `Trial` остается бесплатным входом. `Под заказ` виден на `/pricing`, но не принимает оплату.

## Архитектурное решение

Robokassa не должна идти через `Shop`.

Разделяем два денежных контура:

- `BullRun Billing`: наша продажа доступа к BullRun (`Normal`), продавец — самозанятый Козель Илья Сергеевич, прием оплаты через Robokassa.
- `Client Shop / P2P`: внутренний инструмент клиентов BullRun, где клиенты создают свои лоты, P2P/TON-реквизиты, чеки и выдачу результата своим покупателям.

Причина: Robokassa модерирует наш публичный ресурс и нашу услугу. Клиентские P2P/TON-сценарии должны остаться отдельной продуктовой функцией и не смешиваться с оплатой BullRun.

## Текущий контекст

- `/pricing` уже опубликован и показывает:
  - `Trial`;
  - активный `Normal` за `2 900 ₽ / 30 дней`;
  - неактивный `Под заказ`;
  - реквизиты самозанятого без паспортных данных.
- `site-v2/src/app/providers/AuthProvider.jsx` сейчас возвращает пользователя после Google OAuth в `/shop`; для billing это нужно заменить на сохранение исходного intent.
- В backend уже есть `payment_settings` и старый `/api/payment/webhook/:provider`, но этот route работает с `invoices` для Telegram-ботов.
- `Shop` использует `shop_items` и `shop_purchases`; этот контур не трогаем для Robokassa billing.
- Runtime DB check on 2026-05-12 found no current `shop_items` rows with `offer_code = normal`, but the code still contains Normal-as-Shop assumptions that must be removed before billing launch.
- `profiles.product_tier` уже является источником тарифа пользователя (`trial`, `normal`, `pro`).
- Current profile shape has no Normal expiration field, so selling `30 дней доступа` requires explicit entitlement dates before production.
- Product decision: when paid Normal expires, downgrade the user back to Trial/limited mode and close Normal-only functionality until renewal.

## Robokassa Notes

При реализации сверяться с официальной документацией Robokassa:

- payment URL строится сервером и подписывается паролем 1;
- ResultURL проверяется сервером по подписи с паролем 2 и является source of truth;
- SuccessURL только возвращает пользователя на сайт и не должен сам активировать `Normal`;
- FailURL возвращает пользователя в recoverable checkout state;
- для самозанятого нужно подтвердить чековый/фискальный режим в кабинете Robokassa перед production.

## Desired Buyer Flow

1. Клиент приходит на `/pricing`.
2. Жмет `Оформить Normal`.
3. Если не залогинен, видит Google login.
4. После входа возвращается в billing checkout, а не в `/shop`.
5. Видит подтверждение заказа:
   - `Normal`;
   - `2 900 ₽`;
   - `30 дней доступа`;
   - продавец: самозанятый;
   - условия оказания и возврата.
6. Жмет `Перейти к оплате`.
7. Backend создает `billing_orders` row и возвращает Robokassa payment URL.
8. Browser redirects to Robokassa.
9. Robokassa вызывает `ResultURL`.
10. Backend проверяет подпись, сумму, заказ, статус и idempotency.
11. Backend отмечает `billing_orders.status = paid`.
12. Backend переводит `profiles.product_tier = normal`, sets Normal start/end dates, and clears trial dates.
13. Пользователь возвращается на SuccessURL и видит `Normal активен` с CTA в `/app`.

## Target Routes

Frontend:

- `/pricing` — публичная витрина тарифов.
- `/billing/normal` — защищенный checkout для оплаты BullRun Normal.
- `/billing/success` — возврат после Robokassa SuccessURL.
- `/billing/fail` — возврат после Robokassa FailURL.

Backend:

- `POST /api/billing/checkout/normal` — создать или переиспользовать pending billing order и вернуть `payment_url`.
- `GET|POST /api/billing/robokassa/result` — ResultURL от Robokassa, source of truth.
- `GET /api/billing/robokassa/success` — buyer redirect after payment.
- `GET /api/billing/robokassa/fail` — buyer redirect after failed/cancelled payment.
- `GET /api/billing/orders/current` — статус текущего billing order для frontend polling/recovery.

## Data Model

### `billing_plans`

Можно стартовать без таблицы, с константой в backend. Таблица нужна, если планируем менять тарифы из админки.

Минимальная будущая схема:

- `id uuid primary key`
- `code text unique not null` — `normal`
- `title text not null`
- `amount_rub numeric not null`
- `duration_days integer not null`
- `status text not null` — `active`, `archived`
- `payload jsonb not null default '{}'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Рекомендация для первого шага: не заводить `billing_plans`, держать `NORMAL_PLAN` в backend, чтобы после Robokassa-регистрации осталось меньше surface area.

### `billing_orders`

Новая таблица. Не использовать `shop_purchases`, `invoices` или `payment_events`.

- `id uuid primary key default gen_random_uuid()`
- `owner_id uuid not null references auth.users(id)`
- `plan_code text not null` — `normal`
- `status text not null` — `pending`, `paid`, `failed`, `cancelled`, `expired`
- `amount_rub numeric not null`
- `currency text not null default 'RUB'`
- `duration_days integer not null default 30`
- `provider text not null default 'robokassa'`
- `provider_invoice_id text unique` — numeric Robokassa `InvId`, generated from a sequence or another stable integer source
- `provider_payment_id text`
- `payment_url text`
- `paid_at timestamptz`
- `expires_at timestamptz`
- `payload jsonb not null default '{}'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexes:

- `(owner_id, status)`
- `(provider, provider_invoice_id)`
- `(created_at desc)`

Implementation note: do not send the UUID `billing_orders.id` as Robokassa `InvId`. Keep the UUID as internal order id, and generate a separate numeric `provider_invoice_id`.

### `profiles` entitlement fields

Required before production because `/pricing` sells `Normal` as `30 дней доступа`.

Add either:

- `normal_started_at timestamptz`
- `normal_ends_at timestamptz`

or an equivalent billing entitlement table. Current recommendation: add fields to `profiles` first because app tier checks already read from `profiles`.

Required behavior:

- paid Normal sets `normal_started_at = now()`;
- paid Normal sets `normal_ends_at = max(now(), current normal_ends_at) + interval '30 days'`, so renewal before expiry does not burn remaining paid days;
- paid Normal sets `product_tier = normal`;
- expired Normal downgrades `product_tier` to `trial` and closes Normal-only functionality;
- expired Normal keeps `normal_started_at` and `normal_ends_at` for history/support;
- UI shows a renewal wall with CTA back to `/billing/normal`;
- `pro` must not be downgraded by Normal expiry logic.

### `billing_events`

Новая таблица для audit trail. Не переиспользовать `payment_events`, потому что там `invoice_id` обязателен и смысл завязан на Telegram invoices.

- `id uuid primary key default gen_random_uuid()`
- `billing_order_id uuid references billing_orders(id)`
- `owner_id uuid references auth.users(id)`
- `provider text not null default 'robokassa'`
- `event_type text not null`
- `status text`
- `signature_valid boolean`
- `amount_rub numeric`
- `provider_invoice_id text`
- `provider_payment_id text`
- `payload jsonb not null default '{}'`
- `created_at timestamptz not null default now()`

Indexes:

- `(billing_order_id, created_at desc)`
- `(provider, provider_invoice_id)`

## Backend Plan

### Phase 1: Billing foundation

- [x] Add migration for `billing_orders` and `billing_events`.
- [x] Add Normal entitlement fields to `profiles`:
  - `normal_started_at`;
  - `normal_ends_at`.
- [x] Update product tier helpers to treat `normal` as active only while entitlement is valid, unless the user is `pro`.
- [x] Add backend billing service with `NORMAL_PLAN`:
  - code: `normal`;
  - title: `BullRun Normal`;
  - amount: `2900`;
  - currency: `RUB`;
  - duration: `30 days`.
- [x] Add backend billing service:
  - create or reuse pending Normal order for current user;
  - expire stale pending orders;
  - mark order paid idempotently;
  - activate `profiles.product_tier = normal`;
  - set `normal_started_at` and `normal_ends_at`;
  - extend from `max(now(), current normal_ends_at)` on renewal;
  - clear `trial_started_at` and `trial_ends_at`.
- [x] Add Normal expiry enforcement:
  - scheduled job or request-time guard downgrades expired Normal users to `trial`;
  - never downgrade `pro`;
  - keep Normal dates for audit/history.

### Phase 1.5: Decouple Normal from Shop

- [x] Change shared sales links:
  - `SALES_LINKS.ops` should become `/billing/normal`;
  - all public `Оформить Normal` CTAs should use `/billing/normal`.
- [x] Remove or block Normal unlock from `shop_purchases`:
  - `applyShopOfferUnlock()` must not grant `product_tier = normal` from client Shop purchases;
  - legacy `offer_code = normal` text offers should be archived or redirected to billing.
- [x] Define compatibility behavior:
  - `/shop?offer=normal` should redirect to `/billing/normal` or show a clear moved notice;
  - admin upgrade prompts should point to billing, not Shop.
- [x] Update package pulse / shell banners:
  - do not infer Normal checkout state only from `/api/shop/public/my-purchases`;
  - add billing order status to `AuthProvider` or a dedicated billing hook.
- [x] Update backend dashboard/command-center signals that currently assume Normal is a Shop offer.

### Phase 2: Robokassa service

- [x] Add `backend/services/robokassa.service.js`.
- [x] Functions:
  - `buildPaymentUrl(order)`;
  - `signPaymentRequest({ merchantLogin, outSum, invId, receipt })`;
  - `verifyResultSignature(params)`;
  - `verifySuccessSignature(params)`;
  - `normalizeOutSum(value)`;
  - `buildReceipt(order)` if fiscalization is enabled.
- [x] Env vars:
  - `ROBOKASSA_ENABLED=false|true`;
  - `ROBOKASSA_TEST_MODE=true|false`;
  - `ROBOKASSA_MERCHANT_LOGIN`;
  - `ROBOKASSA_PASSWORD_1`;
  - `ROBOKASSA_PASSWORD_2`;
  - `ROBOKASSA_CURRENCY=RUB`;
  - receipt/self-employed settings after cabinet registration.
- [x] Never expose Robokassa passwords to frontend, Supabase client, public JS, or logs.

### Phase 3: Billing routes

- [x] Add `backend/routes/billing.routes.js`.
- [x] Mount in `backend/server.js` as `app.use('/api/billing', billingRoutes(supabase))`.
- [x] Implement `POST /api/billing/checkout/normal`:
  - requires auth;
  - refuses if `ROBOKASSA_ENABLED` is false, unless returning a guided setup error;
  - creates/reuses `billing_orders` pending order;
  - assigns numeric `provider_invoice_id` before building Robokassa URL;
  - builds payment URL;
  - returns `{ order_id, payment_url, amount_rub, duration_days }`.
- [x] Implement `GET /api/billing/orders/current`:
  - requires auth;
  - returns latest Normal billing order plus current `product_tier`.
- [x] Implement `GET|POST /api/billing/robokassa/result`:
  - public endpoint;
  - accepts Robokassa callback params from query/body;
  - supports URL-encoded form posts as well as query params, not only JSON;
  - verifies signature with password 2;
  - verifies `OutSum = 2900.00`;
  - verifies `InvId` maps to `billing_orders.provider_invoice_id`;
  - writes `billing_events`;
  - marks paid idempotently;
  - activates Normal;
  - returns Robokassa expected success response.
- [x] Implement `GET /api/billing/robokassa/success`:
  - does not activate access;
  - logs event;
  - redirects to `/billing/success?order=<id>`.
- [x] Implement `GET /api/billing/robokassa/fail`:
  - logs event when possible;
  - redirects to `/billing/fail?order=<id>`.

## Frontend Plan

### Phase 1: Intent preservation

- [x] Update `AuthProvider.login()` to accept optional `redirectPath`.
- [x] Default redirect should preserve `window.location.pathname + window.location.search`.
- [x] Update login buttons/gates so `/pricing -> Оформить Normal -> login` returns to billing checkout, not `/shop`.

### Phase 2: Billing checkout screens

- [x] Add `site-v2/src/pages/BillingNormalPage.jsx`.
- [x] Add route `/billing/normal`.
- [x] `/pricing` Normal button should point to `/billing/normal`.
- [ ] Checkout content:
  - plan name: `Normal`;
  - price: `2 900 ₽`;
  - duration: `30 дней`;
  - seller: self-employed seller details already on pricing;
  - terms: remote access to BullRun service;
  - CTA: `Перейти к оплате`.
- [x] On CTA:
  - call `POST /api/billing/checkout/normal`;
  - redirect to returned `payment_url`.
- [x] Show recoverable states:
  - Robokassa not configured;
  - pending order exists;
  - paid/Normal already active;
  - failed payment;
  - expired Normal with renewal CTA.

### Phase 3: Return pages

- [x] Add `BillingSuccessPage.jsx`.
- [x] Add `BillingFailPage.jsx`.
- [ ] Success page:
  - poll `GET /api/billing/orders/current`;
  - if paid/product_tier normal: show CTA `/app`;
  - if pending: show `Платеж проверяется`.
- [ ] Fail page:
  - explain payment was cancelled/failed;
  - CTA back to `/billing/normal`.
- [ ] Add renewal wall state across app/admin surfaces:
  - `Normal закончился`;
  - explain that paid functionality is closed;
  - CTA `Продлить Normal на 30 дней`.

## Admin / Operator Plan

- [ ] Keep client P2P settings under existing `Payments / Requisites`.
- [ ] Add separate admin block for BullRun billing readiness, not mixed with client requisites:
  - Robokassa enabled;
  - test mode / production;
  - MerchantLogin present;
  - ResultURL, SuccessURL, FailURL;
  - last billing event.
- [ ] Admin UI must expose readiness/status only. Robokassa merchant secrets must not be editable through `payment_settings` or stored per user.
- [ ] Add simple billing orders view:
  - order id;
  - user;
  - status;
  - amount;
  - Robokassa InvId;
  - created/paid time;
  - last signature result.

## Robokassa Cabinet Checklist

After account registration:

- [ ] Site/resource URL: `https://bullrun.ru`.
- [ ] ResultURL: `https://bullrun.ru/api/billing/robokassa/result`.
- [ ] SuccessURL: `https://bullrun.ru/api/billing/robokassa/success`.
- [ ] FailURL: `https://bullrun.ru/api/billing/robokassa/fail`.
- [ ] Add `MerchantLogin`, password 1, password 2 to backend env.
- [ ] Start with test mode.
- [ ] Configure self-employed receipt/fiscalization settings if required by Robokassa.
- [ ] Run test payment for `Normal`.
- [ ] Confirm:
  - `billing_orders.status = paid`;
  - `billing_events` has ResultURL event with valid signature;
  - `profiles.product_tier = normal`;
  - success page leads to `/app`.

## Verification Plan

- [ ] Unit-level checks for Robokassa signature generation/verification.
- [ ] Backend smoke checks:
  - missing signature rejected;
  - bad signature rejected;
  - wrong amount rejected;
  - URL-encoded ResultURL body accepted and verified;
  - duplicate ResultURL is idempotent;
  - SuccessURL alone does not unlock Normal;
  - FailURL does not mutate paid orders.
- [ ] Expiry/renewal checks:
  - paid renewal before expiry extends from current `normal_ends_at`;
  - paid renewal after expiry extends from `now()`;
  - expired Normal downgrades to `trial`;
  - `pro` is never downgraded.
- [ ] Database checks through Supabase MCP:
  - migrations applied;
  - indexes exist;
  - no Robokassa secrets in public tables.
  - no active legacy `shop_items.offer_code = normal` rows remain.
- [ ] Deployed browser checks only on `https://bullrun.ru`:
  - `/pricing`;
  - `/billing/normal` unauthenticated;
  - login returns to `/billing/normal`;
  - payment URL generated;
  - success/fail pages render.

## Explicit Non-Goals

- Do not add Robokassa to `shop_items.payment_methods`.
- Do not write Robokassa billing orders into `shop_purchases`.
- Do not change client P2P/TON shop flow while adding BullRun billing.
- Do not activate Normal from SuccessURL alone.
- Do not implement recurring billing for the first Robokassa launch.
- Do not store Robokassa merchant secrets in `payment_settings` or any public/user-editable table.

## Open Decisions

- Price correction on 2026-05-14: final `Normal` is `900 ₽` for `365 дней доступа`; do not use the earlier `2 900 ₽ / 30 дней` assumption.
- Confirm whether first launch needs Robokassa receipt payload from our backend or Robokassa self-employed cabinet setup handles it.
- Decide whether `billing_plans` table is needed before launch; current recommendation is backend constant first.
- Expiry policy decided: when `normal_ends_at` passes, downgrade to `trial` / limited mode, close Normal-only functionality, keep dates as history, and show renewal wall.

## Deployment Rule

For this task, do not use localhost as the final verification path. Build, deploy, and verify on `https://bullrun.ru`.

## Implementation Review

- Added Supabase migration `robokassa_normal_billing` and local SQL file `backend/sql/robokassa-normal-billing.sql`.
- Applied follow-up migration `robokassa_billing_events_owner_index` after Supabase advisor flagged the new `billing_events.owner_id` foreign key.
- Added separate BullRun billing backend under `/api/billing`; Robokassa callbacks accept URL-encoded bodies and query params.
- Kept Robokassa secrets in backend env only; public frontend receives only readiness and order state.
- Blocked Shop from granting `product_tier = normal`; Normal is now granted only after valid Robokassa Result callback.
- Added request-time downgrade for expired Normal in profile loading, preserving `normal_started_at` and `normal_ends_at`.
- Added `/billing/normal`, `/billing/success`, and `/billing/fail` to `site-v2`.
- Changed Normal CTA paths from `/shop?offer=normal` to `/billing/normal`; old Shop normal URL redirects client-side.
- Local checks run before deploy: `node --check` for changed backend modules and `site-v2 npm run build`.

Remaining launch work after Robokassa registration:

- Set backend `.env`: `ROBOKASSA_ENABLED=true`, merchant login, password 1, password 2, and final test/prod mode.
- Configure Robokassa Result/Success/Fail URLs from the cabinet checklist.
- Confirm whether Robokassa self-employed fiscalization handles receipts without backend `Receipt` payload; if not, add receipt signing before production payments.
