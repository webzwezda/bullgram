# Bots Accounts Safe Decomposition Plan

## Scope

- Target file: `/Users/webzwezda/Desktop/bullrun/admin-v2/src/pages/BotsAccountsPage.jsx`
- Current size: ~3286 lines
- Already extracted:
  - `/Users/webzwezda/Desktop/bullrun/admin-v2/src/pages/bots/OfficialBotsSection.jsx`
  - `/Users/webzwezda/Desktop/bullrun/admin-v2/src/pages/bots/UserbotStorefrontSection.jsx`

## Problem Shape

- The file is not only large JSX. It mixes:
  - raw data loading
  - derived selectors and grouping logic
  - write actions and mutation handlers
  - onboarding QR/files flow
  - storefront checkout state
  - live userbot management UI
  - shop-reserved userbot UI
- Safe decomposition should follow state and effect boundaries first, then UI boundaries.

## Invariants

- Do not rewrite behavior while decomposing. Each phase should be mostly move-only.
- Keep `BotsAccountsPageContent` as the orchestration shell until late phases.
- Keep `accessToken`, `user`, `profilePlan`, Ton wallet state, and top-level success/error banner ownership in the shell at first.
- Preserve mode split:
  - `official-bots`
  - userbot operator/admin flow
  - userbot buyer/storefront flow
- Preserve existing refresh path through `reloadAccounts` until replacement is fully proven.

## Anti-Patterns To Avoid

- Do not split JSX into many presentational components first if they still need dozens of props from parent state.
- Do not duplicate fetch logic between `useEffect` loaders and `reloadAccounts`; centralize fetchers before moving them.
- Do not introduce React context early just to avoid prop drilling. That will hide dependencies and make regressions harder to trace.
- Do not move mutation handlers into child components if they still coordinate multiple top-level states.
- Do not mix safe refactor with logic cleanup, renaming, copy edits, or UX redesign in the same phase.
- Do not convert the page to a global store rewrite unless the smaller phases still leave an unmaintainable shell.

## Recommended Phases

### Phase 1: Extract Pure Utilities

- Move pure helpers into `admin-v2/src/pages/bots/bots-accounts.utils.js`
- Candidate helpers:
  - formatters
  - status badge builders
  - purchase grouping helpers
  - proxy label helpers
  - sale title helpers
- Keep zero React state inside this file.

Gate:

- `cd admin-v2 && npm run build`
- No JSX or runtime behavior should change.

### Phase 2: Extract Derived Selectors

- Create a pure selector module or a hook such as `useBotsAccountsDerivedState`.
- Inputs should stay narrow:
  - `state`
  - `storefrontState`
  - `profilePlan`
  - selected ids
- Outputs should include:
  - `officialBots`
  - `channelsByBotId`
  - `liveUserbots`
  - `listedShopUserbots`
  - `selected*` entities
  - proxy availability lists
  - grouped storefront purchases
  - visible lots
- Keep mutation handlers in the page for now.

Gate:

- Build passes.
- Switching selected official bot, live userbot, shop userbot, and open purchase still behaves the same.

### Phase 3: Extract Read Models / Loaders

- Create focused hooks:
  - `useBotsAccountsData`
  - `useUserbotStorefrontData`
  - `useFingerprintProfiles`
- The first pass should only move read-side loading and refresh logic.
- Return explicit `refresh` functions instead of hiding reloads in child components.
- Keep write actions in the page, but make them call shared refresh functions from hooks.

Gate:

- Initial page load still fetches the same data.
- Silent refresh still works.
- Error and loading states still render correctly.

### Phase 4: Extract Onboarding Flow As One Unit

- Move QR/files onboarding into:
  - `UserbotOnboardingSection.jsx`
  - optional hook `useUserbotOnboarding`
- Treat onboarding as a single cohesive slice:
  - proxy selection
  - fingerprint mode and custom fingerprint inputs
  - QR generation and polling
  - file import
- Keep `reloadAccounts` and top-level UI message callback injected from parent.

Gate:

- Manual checks:
  - switch QR/files
  - choose proxy
  - generate QR
  - cancel/unmount without leaked polling
  - import form still validates the same way

### Phase 5: Extract Live Userbot Operations

- Split the operator/admin userbot surface into bounded sections:
  - `UserbotInventorySection`
  - `UserbotCard` or `UserbotOperationsCard`
  - `UserbotSaleComposer`
- Keep account-level action handlers in parent first:
  - `checkAccount`
  - `toggleSafeMode`
  - `saveBinding`
  - `restoreAccount`
  - `deleteAccount`
  - `saveUserbotSaleLot`
- Only after components settle, consider a dedicated hook for userbot actions.

Gate:

- Manual checks on one live userbot:
  - check/activate
  - safe-mode toggle
  - proxy binding save
  - sale composer open/save/cancel

### Phase 6: Extract Shop-Reserved Userbot Surface

- Move “Выставлены в Shop” block into `ReservedUserbotsSection.jsx`.
- Keep it read-heavy and isolated from the live inventory slice.
- Pass only:
  - selected reserved userbot id
  - selected reserved userbot entity
  - reservation/item lookup data
  - delete shop item action

Gate:

- Manual checks:
  - reserved userbot select switch
  - reservation details visible
  - delete lot button still targets correct item

### Phase 7: Review Shell Size And Decide On Reducer

- After the above, inspect what remains in `BotsAccountsPageContent`.
- If remaining complexity is mostly scattered local UI state transitions, introduce `useReducer` only then.
- If the shell is already readable, stop. Do not add abstraction for its own sake.

Gate:

- Shell should read as orchestration only:
  - auth/runtime wiring
  - hook composition
  - action composition
  - top-level mode switch

## Suggested Temporary Ownership

- Shell owns:
  - auth and access primitives
  - global banner message
  - refresh orchestration
  - cross-slice mutation handlers
- Hooks own:
  - fetching
  - derived data
  - lifecycle and polling where isolated
- Sections/components own:
  - rendering
  - local form input state only if it is not shared elsewhere

## Verification Checklist Per Phase

- `cd admin-v2 && npm run build`
- Open `/app/userbots`
- Open `/app/botfather`
- Verify official bot selection still works
- Verify open purchase selection still works
- Verify onboarding mode switch still works
- Verify one userbot card still supports check/bind/sell flows
- Verify reserved shop block still shows correct lot/reservation data

## Stop Rule

- If a phase starts requiring more than one new shared abstraction at once, stop and split that phase again.
- If a child component needs more than roughly 15-20 props, stop and extract a narrower hook or section boundary before continuing.

## Review

- Planning only in this pass.
- No code changes to runtime behavior were made here.
