# Bots Accounts Decomposition

## Plan
- [done] Map the current responsibility clusters inside [BotsAccountsPage.jsx](/Users/webzwezda/Desktop/bullrun/admin-v2/src/pages/BotsAccountsPage.jsx): shared inventory data, official-bot flow, userbot storefront/checkout, userbot onboarding QR/files, live userbot operations, listed-in-shop state, and pure formatting/helper logic.
- [done] Confirm the first safe extraction already happened: [OfficialBotsSection.jsx](/Users/webzwezda/Desktop/bullrun/admin-v2/src/pages/bots/OfficialBotsSection.jsx) and [UserbotStorefrontSection.jsx](/Users/webzwezda/Desktop/bullrun/admin-v2/src/pages/bots/UserbotStorefrontSection.jsx) now hold large presentational chunks, but the container still owns too much state/effect logic.
- [done] Phase 1: extract pure helpers into `admin-v2/src/pages/bots/bots-accounts.utils.js`.
- [done] Move formatting and classification helpers first: `formatWhen`, `summarizeCheckStatus`, `buildCheckLines`, `restrictedMarker`, `proxySourceBadge`, `proxyTelegramMode`, `proxyTelegramModeLabel`, `recoveryStatusBadge`, `canRestoreFromFiles`, `normalizeOnboardingErrorMessage`, `resolveBackendAssetUrl`, price/payment helpers, purchase grouping helpers, `proxyLabel`, and sale-title helpers.
- [done] Extract derived list/select logic into `admin-v2/src/pages/bots/useBotsAccountsDerivedState.js`: `officialBots`, `channelsByBotId`, `liveUserbots`, `listedShopUserbots`, `deadProxyUserbots`, `availableOnboardingProxies`, `openUserbotPurchases`, storefront lot grouping, `planRules`, and current selected-item fallbacks.
- [done] Keep signatures stable in Phase 1. No behavior changes, no JSX movement except imports and derived-state wiring.
- [done] Phase 2: extract shared inventory/query state into `useBotsAccountsData`.
- [done] `useBotsAccountsData` now owns the current `state` object, initial loading gate, `reloadAccounts`, and the one-minute silent refresh. It returns raw data plus a stable `reloadAccounts` action.
- [done] Keep `useAuth`, `mode`, and top-level `uiMessage` ownership in the page for now. Route concerns were not moved into the data hook.
- [done] Phase 3: extract official-bot actions into `useOfficialBotsController`.
- [done] `useOfficialBotsController` now owns `botForm`, `botAdminDrafts`, `selectedOfficialBotId`, selection sync, `addOfficialBot`, and `saveBotAdmin`, while consuming `officialBots`, `paymentAdminTgId`, `reloadAccounts`, `setState`, and `showUiMessage`.
- [ ] Keep `deleteAccount` shared outside this hook until userbot slices are extracted, because the same delete path is used by more than one surface.
- [done] Phase 4: extract storefront and checkout logic into `useUserbotStorefront`.
- [done] `useUserbotStorefront` now owns `storefrontState`, `checkoutState`, `receiptNote`, `receiptFile`, `selectedOpenPurchaseId`, `userbotBuyQuantity`, and actions like `openUserbotCheckout`, `createUserbotBatchCheckout`, `checkUserbotCheckout`, `showUserbotPurchaseInline`, `markUserbotCheckoutPaid`, and `cancelUserbotCheckout`.
- [done] Keep the hook responsible for refreshing storefront purchases after mutations. A duplicate page-level storefront effect was removed so the hook is the single owner.
- [done] Phase 5: extract onboarding and fingerprint flow into `useUserbotOnboarding`.
- [done] `useUserbotOnboarding` now owns `onboarding`, `fingerprintProfilesState`, QR polling refs, file handlers, fingerprint helpers, `startQrLogin`, `importSession`, and cleanup of polling timers.
- [done] The hook currently accepts the narrow dependencies it needs: `accessToken`, `planRules`, `userbots.length`, `reloadAccounts`, and a UI-message callback.
- [ ] Phase 6: split remaining userbot UI into focused sections under `admin-v2/src/pages/bots/`.
- [done] Extract `UserbotOnboardingSection` for the "Подключить самому" block.
- [done] Extract `LiveUserbotsSection` for the main live userbot inventory, binding controls, account checks, safe-mode toggle, restore flow, and sale composer entry.
- [done] Extract `ListedShopUserbotsSection` for the "Выставлены в Shop" area.
- [done] If the sale-composer JSX still dominates `LiveUserbotsSection`, split a final `UserbotSaleComposer` child only after the controller state is already isolated. This is now done as optional cleanup.
- [done] Phase 7: reduce the page to a route shell that composes hooks plus sections. Current shape: auth/mode shell, one global error/loading gate, one global `uiMessage`, selection sync, and section wiring only.

## Risks
- The biggest regression risk is duplicating ownership of async refreshes. `reloadAccounts` must have one owner, and storefront purchase refresh must also have one owner.
- The second risk is stale closures inside extracted hooks for `accessToken`, `user.id`, `planRules`, and timer-driven QR polling.
- The third risk is over-propping. Once a section needs more than a handful of raw values plus callbacks, that usually means the controller hook should move first.
- `deleteAccount` is cross-cutting. Moving it into the official-bot slice too early will create an awkward boomerang when live-userbot sections still need it.
- The onboarding flow is stateful and timer-based. It should be extracted only after pure helpers and inventory reload ownership are stable.
- The sale composer is entangled with account state, proxies, and shop publishing. Do not extract it as an isolated component before its action/state contract is explicit.
- Avoid a single `useBotsAccountsPage` mega-hook. That would move the 3286-line problem without improving boundaries.

## Verification
- After every phase, run `cd admin-v2 && npm run build`.
- After Phase 1 and Phase 2, smoke-check both routes: `/app/userbots` and `/app/botfather`.
- After Phase 3, verify: connect official bot, edit bot admin TG ID, switch selected official bot, delete official bot.
- After Phase 4, verify: open single checkout, batch checkout, switch payment method when available, upload receipt, cancel purchase, reopen existing open purchase.
- After Phase 5, verify: QR start, QR polling stop/timeout cleanup, file import validation, custom fingerprint fields, preset fingerprint selection.
- After Phase 6, verify: live userbot selection, proxy rebinding, safe-mode toggle, Telegram check, recovery action, sale composer open/close, publish lot, listed-shop deletion flow.
- Do not move to the next phase if the previous phase increased prop churn, duplicated reload logic, or changed the route-level loading/error behavior.

## Review
- This note is intentionally phased to preserve behavior while shrinking the container a slice at a time.
- The correct decomposition axis here is domain ownership and async state, not "split JSX until the file is shorter".
- If a phase starts requiring broad prop drilling, stop and extract the controller hook for that domain before moving more UI.
- Implemented on April 10, 2026:
  - added `admin-v2/src/pages/bots/bots-accounts.utils.js`
  - added `admin-v2/src/pages/bots/useBotsAccountsDerivedState.js`
  - added `admin-v2/src/pages/bots/useBotsAccountsData.js`
  - added `admin-v2/src/pages/bots/useOfficialBotsController.js`
  - added `admin-v2/src/pages/bots/useUserbotStorefront.js`
  - rewired `admin-v2/src/pages/BotsAccountsPage.jsx` to import pure helpers and derived state instead of keeping them inline
  - rewired `admin-v2/src/pages/BotsAccountsPage.jsx` so shared inventory data, official-bot actions, and storefront/checkout mutations are owned by dedicated hooks
  - added `admin-v2/src/pages/bots/useUserbotOnboarding.js`
  - added `admin-v2/src/pages/bots/UserbotOnboardingSection.jsx`
  - added `admin-v2/src/pages/bots/LiveUserbotsSection.jsx`
  - added `admin-v2/src/pages/bots/ListedShopUserbotsSection.jsx`
  - added `admin-v2/src/pages/bots/UserbotSaleComposer.jsx`
  - added `admin-v2/src/pages/bots/useLiveUserbotsController.js`
  - added `admin-v2/src/pages/bots/useListedShopUserbotsController.js`
  - added `admin-v2/src/pages/bots/useUserbotTonCheckoutBrowser.js`
  - rewired `admin-v2/src/pages/BotsAccountsPage.jsx` so onboarding QR/files/fingerprint state lives in `useUserbotOnboarding`
  - replaced duplicated inline onboarding JSX in `admin-v2/src/pages/BotsAccountsPage.jsx` with `UserbotOnboardingSection`
  - replaced the remaining inline live/listed userbot blocks with `LiveUserbotsSection` and `ListedShopUserbotsSection`
  - moved bindings, account check/recovery/delete feedback, safe-mode actions, and sale-composer state into `useLiveUserbotsController`
  - moved listed-shop deletion into `useListedShopUserbotsController`
  - moved browser TON checkout handling into `useUserbotTonCheckoutBrowser`
  - shrank `admin-v2/src/pages/BotsAccountsPage.jsx` to a thin route shell with route-level `uiMessage`, selection sync, and section wiring
  - split the sale-composer JSX out of `LiveUserbotsSection` into `UserbotSaleComposer`
  - fixed hook ordering so `planRules` and `userbots` are derived before onboarding hook initialization
  - fixed a temporary duplicate storefront owner after extraction so purchases/items load from one place again
  - verified with `cd admin-v2 && npm run build`
