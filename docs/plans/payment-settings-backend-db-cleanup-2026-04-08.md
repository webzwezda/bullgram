# Payment Settings Backend / DB Cleanup

## What We Verified
- `public.payment_settings` still has legacy columns `sbp_qr_url` and `sbp_payment_url`.
- In `payment_settings` there are live rows with legacy data: currently `2` rows total, `1` row with `sbp_qr_url`, `1` row with `sbp_payment_url`.
- `public.shop_purchases.payload` still carries legacy checkout keys broadly: `12` rows total, `11` rows with `sbp_qr_url`, `11` rows with `sbp_payment_url`, `12` rows with `sbp_bank`.
- Backend still writes and serves legacy QR/deeplink logic:
  - `backend/server.js` persists `sbp_qr_url` / `sbp_payment_url` in `/api/payment-settings`
  - `backend/server.js` exposes `POST /api/payment-settings/sbp-qr`
  - `backend/routes/shop.routes.js` selects, copies, and returns `sbp_qr_url` / `sbp_payment_url`
- Frontend/runtime consumers still expect legacy fields in purchase payloads:
  - `admin-v2/src/pages/ProxyManagerPage.jsx`
  - `admin-v2/src/pages/BotsAccountsPage.jsx`
  - `site-v2/src/pages/ShopPage.jsx`

## Decisions To Implement
- Canonical bank selection stays in `sbp_bank`, but as a normalized comma-separated string such as `Сбербанк, Т-Банк`.
- Remove QR/deeplink storage and upload flow from active runtime.
- Keep P2P checkout readable by continuing to return/display `sbp_bank` as plain text.

## Plan
- [done] Normalize existing bank data in Supabase.
  - Keep `sbp_bank` as the canonical field
  - Normalize spelling/casing like `Т-банк` -> `Т-Банк`
  - Normalize multi-bank values into deterministic text order: `Сбербанк, Т-Банк`
- [done] Remove legacy DB fields no longer needed by product.
  - Drop `payment_settings.sbp_qr_url`
  - Drop `payment_settings.sbp_payment_url`
- [done] Clean historical purchase payloads.
  - Remove `sbp_qr_url` and `sbp_payment_url` from `shop_purchases.payload`
  - Keep `sbp_bank` in payload for checkout/history rendering
- [done] Refactor backend payment settings save/load.
  - `backend/server.js`: normalize and save `sbp_bank`
  - remove `POST /api/payment-settings/sbp-qr`
  - remove legacy fallback branches tied to missing QR/payment-url columns
- [done] Refactor backend shop payload generation.
  - `backend/routes/shop.routes.js`: stop selecting/copying/returning QR/deeplink fields
  - keep returning normalized `sbp_bank`
- [done] Refactor downstream UI consumers outside `PaymentSettingsPage`.
  - `site-v2/src/pages/ShopPage.jsx`: render one or multiple selected banks from `sbp_bank`
  - `admin-v2/src/pages/ProxyManagerPage.jsx`: remove QR/deeplink expectations from P2P checkout UI
  - `admin-v2/src/pages/BotsAccountsPage.jsx`: remove QR/deeplink expectations from P2P checkout UI
- [done] Clean server-side file-storage tail.
  - remove unused QR upload handling from backend runtime
  - separately decide whether to delete old files from `/uploads/payment-assets/` on the server after rollout
- [done] Verify changed code paths and DB state.
  - `admin-v2` build passed
  - `site-v2` build passed
  - `node --check` passed for `backend/server.js`, `backend/routes/shop.routes.js`, `backend/utils/payment-settings.js`
  - Supabase verification confirmed dropped columns and removed legacy payload keys

## Risks
- Dropping columns before updating all readers will break `shop.routes` and any checkout surfaces still expecting legacy payload shape.
- Historical `shop_purchases.payload` already contains legacy QR/deeplink keys, so runtime readers can still surface removed UI unless payload cleanup or compatibility handling is done.
- The normalized `sbp_bank` text must stay consistent across admin save, backend serialization, and buyer-facing checkout rendering.

## Review
- Migration `drop_sbp_qr_fields_and_cleanup_payloads` was applied successfully through Supabase MCP.
- `payment_settings` no longer has `sbp_qr_url` or `sbp_payment_url`.
- `shop_purchases.payload` no longer contains `sbp_qr_url` or `sbp_payment_url`.
- Backend and active frontend payment surfaces no longer reference the removed QR/deeplink fields.
- `hasSbp` readiness was tightened to depend on `sbp_phone`, so a default/normalized bank label alone does not falsely mark manual payment as ready.
