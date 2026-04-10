# Userbots Page Performance Handoff

## Goal

Find and fix the remaining slowness on `https://prsng.ru/app/userbots`.

This is no longer primarily an infrastructure incident. The Docker/Supabase healthcheck storm was already mitigated on the server, zombie processes were cleared, and steady-state infra is now much healthier.

## Current status

- HTML delivery is fast:
  - `https://prsng.ru/` TTFB was about `0.12s`
  - `https://prsng.ru/app` TTFB was about `0.12s`
- Public API is also reasonably fast in steady state:
  - `https://prsng.ru/api/shop/public/items` was about `0.21-0.25s`
- The slow screen is specifically `https://prsng.ru/app/userbots`
- In a live logged-in browser session, `performance` showed the page issuing a large batch of API requests on load
- Historical entries in that browser session showed some earlier requests taking `6-7.7s`, but those overlapped with the period right after Supabase containers were recreated and warmed up
- Repeat measurements after stabilization were lower but still not great:
  - `/api/userbot/proxies` about `1.2s`
  - `/api/shop/seller/items` about `1.2s`
  - `/api/userbot/recovery-status` about `0.75s`

## Most likely root causes

### 1. Frontend startup fan-out on `BotsAccountsPage`

The page loads too many independent data sources immediately.

Relevant file:

- `admin-v2/src/pages/BotsAccountsPage.jsx`

On initial page load it does at least these calls:

- `loadData()` around `admin-v2/src/pages/BotsAccountsPage.jsx:544`
  - `supabase.from('tg_accounts')`
  - `GET /api/userbot/proxies`
  - `GET /api/shop/seller/reserved-assets`
  - `GET /api/shop/seller/items`
  - `supabase.from('payment_settings')`
  - `GET /api/userbot/recovery-status`
- `loadStorefront()` around `admin-v2/src/pages/BotsAccountsPage.jsx:635`
  - `GET /api/shop/app/items`
  - `GET /api/shop/public/my-purchases`
- `loadFingerprintProfiles()` around `admin-v2/src/pages/BotsAccountsPage.jsx:681`
  - `GET /api/userbot/fingerprint-profiles`

That means one page load can easily trigger `8-9` separate data fetches before the screen becomes useful.

Also note:

- `reloadAccounts()` around `admin-v2/src/pages/BotsAccountsPage.jsx:946` duplicates almost the same `loadData()` fan-out again
- `loadData()` also schedules a `60s` interval refresh around `admin-v2/src/pages/BotsAccountsPage.jsx:624`

### 2. Each protected backend request pays auth overhead first

Relevant files:

- `backend/middlewares/auth.middleware.js`
- `backend/utils/agent-mcp-auth.js`

For every protected request, the middleware currently does:

- `supabase.auth.getUser(token)`
- `loadProfileForUser(...)`

`loadProfileForUser()` then queries `profiles`.

That means every single API call from `userbots` pays an authentication/user lookup cost before route logic even begins.

### 3. `/api/userbot/proxies` is structurally expensive

Relevant file:

- `backend/routes/userbot.routes.js`

Main route:

- `router.get('/proxies', ...)` around `backend/routes/userbot.routes.js:1026`

Expensive helpers called from that route:

- `reconcileExpiredTrialProxyLease(...)` around `backend/routes/userbot.routes.js:656`
- `supportsProxyProvisionSource(...)` around `backend/routes/userbot.routes.js:531`
- `supportsProxyInventoryGroup(...)` around `backend/routes/userbot.routes.js:542`
- `countManualFreeProxies(...)` around `backend/routes/userbot.routes.js:553`
- `countOwnedManualProxies(...)` around `backend/routes/userbot.routes.js:568`
- `loadAvailableSiteFreeProxy(...)` around `backend/routes/userbot.routes.js:759`
- `loadAvailableShopSaleProxies(...)` around `backend/routes/userbot.routes.js:819`

Problems in this route:

- schema capability checks are done by querying the DB on request
- user metadata is loaded through `supabase.auth.admin.getUserById(...)`
- more quota and availability queries run after the main proxies query
- the route assembles one response by combining many independent reads

This route is a strong candidate for memoization/capability caching and response simplification.

### 4. `/api/shop/seller/items` and related shop routes are also heavy

Relevant file:

- `backend/routes/shop.routes.js`

Key routes:

- `GET /seller/reserved-assets` around `backend/routes/shop.routes.js:1144`
- `GET /seller/items` around `backend/routes/shop.routes.js:1166`
- `GET /app/items` around `backend/routes/shop.routes.js:2210`
- `GET /public/my-purchases` around `backend/routes/shop.routes.js:2214`

Why they are expensive:

- `reserved-assets` calls `loadReservedAssetMap(...)`, which loads published `shop_items` and then `shop_item_assets`
- `seller/items` loads:
  - seller items
  - item assets
  - purchases
  - buyer profiles
  - stale-purchase expiration logic
- `app/items` goes through `listVisibleShopItems(...)` around `backend/routes/shop.routes.js:2013`, which loads:
  - published items
  - item assets
  - purchases
  - seller profiles
  - payment settings
  - in-memory seller cards/stats aggregation
- `public/my-purchases` loads purchases plus assets and also generates QR codes for pending purchases

This means the frontend is not only fanning out many requests, but several of those requests are themselves multi-query aggregators.

## Important measurement notes

- A live browser session on `/app/userbots` had no console or browser errors at the time of inspection
- Browser `performance.getEntriesByType('resource')` showed the page issuing these API calls during startup:
  - `/api/userbot/proxies`
  - `/api/shop/seller/items`
  - `/api/shop/app/items`
  - `/api/userbot/fingerprint-profiles`
  - `/api/shop/public/my-purchases`
  - `/api/shop/seller/reserved-assets`
  - `/api/userbot/recovery-status`
- Some older entries in the same browser session were much slower, but they likely overlapped with container warm-up right after the server remediation
- Steady-state measurements after stabilization are still slower than ideal, but much better than the warm-up spike

## What to investigate next

### Frontend

1. Check whether all startup fetches are actually necessary for first paint on `/app/userbots`
2. Split the screen into critical-above-the-fold vs deferred data
3. Avoid loading storefront data immediately for roles that do not need it
4. Look for duplicate initial loads or mount/reload behavior on this page
5. Add cheap instrumentation around each load block in `BotsAccountsPage.jsx`

### Backend

1. Add timing logs around these routes:
   - `/api/userbot/proxies`
   - `/api/shop/seller/items`
   - `/api/shop/app/items`
   - `/api/shop/public/my-purchases`
   - `/api/userbot/fingerprint-profiles`
   - `/api/userbot/recovery-status`
2. Cache schema capability checks such as `supportsProxyProvisionSource()` and `supportsProxyInventoryGroup()`
3. Reduce repeated `supabase.auth.admin.getUserById(...)` / metadata lookups in hot paths
4. Consider aggregating userbots-page data behind one tailored backend endpoint instead of `8-9` separate frontend calls
5. Review whether QR generation in `public/my-purchases` should be deferred or cached

## Constraints and guardrails

- Do not start by blaming Docker. The major Docker-related load issue was already mitigated.
- Do not assume current slowness is caused by the earlier healthcheck changes.
- Focus on `userbots` page request fan-out and route cost first.
- Be careful with changes to shop and userbot flows: this page touches both Telegram infra and shop data.

## Suggested first concrete change

If you want one narrow first implementation target:

1. Instrument and optimize `GET /api/userbot/proxies`
2. Make `BotsAccountsPage` defer non-critical requests until after the first usable render
3. Re-measure `/app/userbots` in a real logged-in browser session
