# BotsAccountsPage Decomposition Plan

## Scope

- Target file: `/admin-v2/src/pages/BotsAccountsPage.jsx`
- Current size: `3286` lines
- Active routes:
  - `/app/userbots`
  - `/app/botfather`
- Already extracted:
  - `admin-v2/src/pages/bots/OfficialBotsSection.jsx`
  - `admin-v2/src/pages/bots/UserbotStorefrontSection.jsx`

## Current Map

- Pure helpers at file top:
  - account status / proxy / checkout formatting
  - storefront grouping and labels
- Data effects in page:
  - base accounts/proxies/payment/channels load
  - storefront load
  - fingerprint profiles load
  - QR polling cleanup and fingerprint preset sync
- Heavy local state domains:
  - `state`
  - `onboarding`
  - `checkoutState`
  - `saleComposer`
  - `bindings`
  - account-level feedback buckets
- Main UI branches:
  - official bots
  - storefront for non-admin profile
  - userbot onboarding
  - live userbot operations
  - shop reserve / seller surface

## Safety Rules

- Keep one page-level orchestrator until the last phase. Do not split routing and cross-domain state ownership too early.
- Extract pure code before extracting mutating code.
- Extract derived selectors before extracting async actions.
- Extract one domain at a time. Do not move onboarding, checkout, and account-ops in one step.
- After each phase, keep public behavior identical. No copy changes, no layout rewrites, no endpoint changes.
- Prefer temporary container props over premature context. Over-propping is acceptable for one phase; broken ownership is not.
- Do not move `reloadAccounts` callers into several hooks until the reload contract is explicit.

## Main Risks

- `reloadAccounts` is shared by official bots, onboarding, proxy binding, checks, restore, deletion, and seller actions. Splitting this carelessly will create stale data and inconsistent refresh timing.
- `checkoutState`, `receiptNote`, and `receiptFile` form one mutation cluster. Moving only part of it will break checkout resume/cancel/mark-paid flows.
- QR login uses refs, polling, cleanup, and fingerprint-derived defaults. This is the highest regression-risk area.
- `bindings` are rehydrated from accounts in an effect. If extracted without a clear source-of-truth rule, edits can be overwritten unexpectedly.
- `mode`, `canSellUserbotAssets`, and selected IDs control large render branches. Extracting JSX without stabilizing these selectors first will cause prop sprawl and hidden branch coupling.

## Phased Plan

### Phase 0: Stabilize The Current Partial Split

- Goal:
  - make the current extraction a clean baseline before further moves
- Tasks:
  - verify `OfficialBotsSection` and `UserbotStorefrontSection` contain only presentational logic plus local render helpers
  - fix any indentation / fragment mismatches left by the interrupted split
  - add a short file comment near the page container describing ownership boundaries
- Gate:
  - `cd admin-v2 && npm run build`
  - manual open of `/app/botfather`
  - manual open of `/app/userbots`

### Phase 1: Extract Pure Utilities

- Goal:
  - shrink the top of the page without touching runtime behavior
- Extract first:
  - account status helpers: `summarizeCheckStatus`, `checkLine`, `buildCheckLines`, `defaultCheckLines`, `restrictedMarker`
  - proxy helpers: `proxySourceBadge`, `proxyTelegramMode`, `proxyTelegramModeLabel`, `proxyLabel`
  - storefront helpers: payment labels, amount formatters, grouping, lot labels, purchase status helpers
  - onboarding formatting helpers: `normalizeOnboardingErrorMessage`, `resolveBackendAssetUrl`
- Suggested targets:
  - `admin-v2/src/pages/bots/bots-page.utils.js`
  - or two files if cleaner: `bots-page.utils.js` and `bots-storefront.utils.js`
- Dependency:
  - none
- Gate:
  - zero JSX diff except imports
  - `cd admin-v2 && npm run build`

### Phase 2: Extract Derived Selectors Into Hooks

- Goal:
  - remove the dense `useMemo` cluster from the page
- Extract second:
  - account partitions: `userbots`, `officialBots`, `listedShopUserbots`, `liveUserbots`
  - proxy-derived groups: `usedUserbotProxyIds`, `availableOnboardingProxies`, `selfUseProxies`, `brokenSelfUseProxies`, `deadProxyUserbots`
  - storefront-derived groups: `openUserbotPurchases`, `selectedOpenPurchase`, visible lots, bundled/account-only lots
  - bot/channel selectors: `channelsByBotId`, `selectedOfficialBot`
- Suggested target:
  - `admin-v2/src/pages/bots/useBotsAccountsDerivedState.js`
- Keep inputs explicit:
  - pass raw `state`, `storefrontState`, selected IDs, `profilePlan`
- Do not extract yet:
  - any async action
  - any setter sync effect
- Gate:
  - selected bot/userbot/purchase defaults still behave the same
  - `cd admin-v2 && npm run build`

### Phase 3: Extract Data Loading Hooks

- Goal:
  - isolate read-side effects from write-side actions
- Split into separate hooks:
  - `useBotsAccountsData`
    - owns initial accounts/proxies/payment/channels/recovery load
    - exposes `state`, `setState`, `reloadAccounts`
  - `useUserbotStorefrontData`
    - owns storefront items/purchases load
  - `useFingerprintProfiles`
    - owns profile fetch and preset fallback
- Requirement:
  - keep `reloadAccounts` page-owned or returned from a single hook as the only canonical refresher
- Do not extract yet:
  - QR polling
  - checkout mutations
- Gate:
  - refresh still updates both `/app/userbots` and `/app/botfather`
  - `cd admin-v2 && npm run build`

### Phase 4: Extract Action Hooks By Domain

- Goal:
  - isolate mutations into bounded domains
- Recommended split:
  - `useOfficialBotsActions`
    - `addOfficialBot`
    - `saveBotAdmin`
    - official-bot delete path if still shared safely
  - `useUserbotCheckoutActions`
    - `openUserbotCheckout`
    - `createUserbotBatchCheckout`
    - `checkUserbotCheckout`
    - `showUserbotPurchaseInline`
    - `markUserbotCheckoutPaid`
    - `cancelUserbotCheckout`
  - `useUserbotAccountActions`
    - `checkAccount`
    - `toggleSafeMode`
    - `saveBinding`
    - `restoreAccount`
    - `deleteAccount`
    - `deleteShopItem`
    - `saveUserbotSaleLot`
- Important:
  - keep `uiMessage` ownership in page container until the end
  - pass `reloadAccounts` into hooks instead of duplicating fetch logic
- Gate:
  - every button path still resolves to same success/error notes
  - `cd admin-v2 && npm run build`

### Phase 5: Extract Onboarding As A Dedicated Hook + Section

- Goal:
  - isolate the highest-risk cluster last among the major behavior blocks
- Extract together in one bounded move:
  - `useUserbotOnboarding`
    - onboarding state
    - file handlers
    - fingerprint mode/profile sync
    - QR polling refs and cleanup
    - `startQrLogin`
    - `importSession`
  - `UserbotOnboardingSection.jsx`
    - all onboarding JSX
  - optional:
    - `QrFingerprintConfigurator.jsx`
- Reason to do this after action hooks:
  - onboarding depends on plan rules, proxies, fingerprint profiles, reload, and message conventions
- Gate:
  - QR generate flow still starts and stops cleanly
  - files mode still validates `.session + .json + proxy`
  - `cd admin-v2 && npm run build`

### Phase 6: Extract Remaining Userbot Surface Components

- Goal:
  - finish the visual split while keeping orchestration centralized
- Extract next:
  - `LiveUserbotsSection.jsx`
  - `ListedShopUserbotsSection.jsx`
  - optional child cards:
    - `UserbotAccountCard.jsx`
    - `UserbotSaleComposer.jsx`
    - `UserbotBindingPanel.jsx`
    - `UserbotHealthPanel.jsx`
- Boundary:
  - components receive already-prepared view models and handlers
  - components should not own fetch logic
- Gate:
  - only prop wiring changes in page container
  - `cd admin-v2 && npm run build`

### Phase 7: Final Container Cleanup

- Goal:
  - turn `BotsAccountsPageContent` into a thin orchestration layer
- Final shape:
  - imports hooks/selectors/components
  - computes branch flags
  - assembles props
  - renders route-specific sections
- Exit criteria:
  - page file is mostly composition and no longer stores domain details inline

## Suggested Delegation Slices

- Slice A:
  - pure utils extraction
- Slice B:
  - derived selectors hook
- Slice C:
  - read-side data hooks
- Slice D:
  - official bot actions
- Slice E:
  - checkout/storefront actions
- Slice F:
  - onboarding hook + section
- Slice G:
  - live userbots / listed-shop UI components
- Slice H:
  - review pass for stale closures, duplicated refreshes, and prop contract drift

## Verification Checklist Per Phase

- `cd admin-v2 && npm run build`
- Open `/app/botfather` and verify:
  - connected bots list renders
  - select bot works
  - save admin TG ID still uses the same flow
- Open `/app/userbots` and verify:
  - storefront branch renders for non-admin profile
  - onboarding branch renders
  - live userbot list still selects first item correctly
  - listed shop reserve still selects first reserved userbot correctly
  - checkout open / resume / cancel panel still behaves the same
- Watch for these regressions:
  - selected IDs resetting unexpectedly
  - purchase panel losing file/note state
  - QR polling surviving unmount
  - bindings being overwritten after save or refresh

## Review

- Planning only so far.
- Next implementation should start with `Phase 0` and `Phase 1`, not with another JSX-only split.
