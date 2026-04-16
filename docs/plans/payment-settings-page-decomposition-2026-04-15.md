# Payment Settings Page Decomposition

## Context

- Current file: `admin-v2/src/pages/PaymentSettingsPage.jsx`
- Current size: about 1470 lines.
- Current routes using the same component:
  - `/app/payments` -> `PaymentSettingsPage mode="requisites"`
  - `/app/plans` -> `PaymentSettingsPage mode="plans"`
  - `/app/billing` -> `PaymentSettingsPage mode="billing"`

This should be decomposed like the previous bots work: first isolate helpers and UI sections, then controllers, and only then data loading. Do not start by splitting into three independent pages, because the current screen still shares `payment_settings`, `channels`, auth, refresh state, and save behavior.

## Current Responsibility Map

- `requisites`: SBP bank selection, recipient phone/FIO, TON wallet, payment field validation, and `saveSettings`.
- `plans`: tariffs, trial/upsell fields, bundle items, package composition, and referral settings.
- `billing`: service Telegram ID, provider/webhook config, billing health, webhook test, payment event filtering, CSV export, and event-to-orders/dossier navigation.

Shared state currently includes:

- runtime: `loading`, `refreshing`, `saving`, `error`, `updatedAt`
- settings: `payment_settings` payload, including requisites, billing settings, and referral settings
- product data: `channels`, `tariffs`, `bundleItems`, `bundleSupport`, `trialSupport`
- billing data: `billingHealth`, `paymentEvents`
- UI state: `selectedUserbotId`, `paymentEventFilter`, `newTariff`, `bundleDrafts`, `fieldErrors`

## Target Structure

```text
admin-v2/src/pages/payment-settings/
  payment-settings.constants.js
  payment-settings.utils.js
  usePaymentSettingsDerivedState.js
  usePaymentSettingsController.js
  useBillingSettingsController.js
  useTariffsController.js
  usePaymentSettingsData.js
  RequisitesSection.jsx
  BillingHeader.jsx
  PrioritySignalsGrid.jsx
  BillingStatsGrid.jsx
  BillingAdminIdSection.jsx
  BillingWebhookSection.jsx
  PaymentEventsSection.jsx
  TariffsSection.jsx
  TariffCreateForm.jsx
  TariffCard.jsx
  TariffBundleEditor.jsx
  ReferralSettingsSection.jsx
  FinalSettingsActions.jsx
```

Keep `admin-v2/src/pages/PaymentSettingsPage.jsx` as the route-level composer until the end. It should own mode routing, loading/error gates, and composition of the extracted hooks/sections.

## Phase Plan

- [done] Map the current file and confirm the three route modes.
- [done] Confirm that `/app/plans` header copy was separate from the decomposition task and has already been removed from plans mode.
- [done] Phase 1: extract constants and pure utilities.
  - Move `DEFAULT_SETTINGS`, `DEFAULT_NEW_TARIFF`, `SBP_BANK_OPTIONS`, `AUTOFILL_BLOCK_PROPS`, and payment event filter constants into `payment-settings.constants.js`.
  - Move `parseSbpBanks`, `serializeSbpBanks`, phone/TON normalizers, validators, `formatWhen`, `paymentEventBadge`, `downloadCsv`, and `requisitesStatusBadgeClass` into `payment-settings.utils.js`.
  - No JSX movement and no behavior changes in this phase.
- [done] Phase 2: extract derived state without changing ownership.
  - Add `usePaymentSettingsDerivedState.js`.
  - Move `billingStats`, `filteredPaymentEvents`, `billingStatsCards`, `prioritySignals`, `tariffStats`, `showBillingStats`, and `pageCopy`.
  - Keep raw data and mutations in `PaymentSettingsPage.jsx`.
  - Remove `isFirstRun` only if a fresh `rg "isFirstRun"` confirms it is unused.
- [done] Phase 3: extract low-risk UI sections.
  - `RequisitesSection.jsx` for `/app/payments`.
  - `BillingHeader.jsx` for `/app/billing` only.
  - `PrioritySignalsGrid.jsx`, `BillingStatsGrid.jsx`, and `FinalSettingsActions.jsx`.
  - Preserve root wrapper class: `page${isRequisitesMode ? ' payment-page' : ''}`. CSS depends on `.payment-page`.
  - Done: `BillingHeader.jsx`, `PrioritySignalsGrid.jsx`, `BillingStatsGrid.jsx`, `FinalSettingsActions.jsx`, and `RequisitesSection.jsx`.
- [done] Phase 4: extract billing controller and billing UI.
  - `useBillingSettingsController.js` owns `selectedUserbotId`, `fillAdminIdFromUserbot`, and `sendWebhookTest`.
  - `BillingAdminIdSection.jsx` owns the admin TG ID card UI.
  - `BillingWebhookSection.jsx` owns provider/webhook settings UI.
  - `PaymentEventsSection.jsx` owns event filters, CSV action, and payment events table.
- [done] Phase 5: extract settings controller.
  - `usePaymentSettingsController.js` owns `fieldErrors`, `patchSettings`, `toggleSbpBank`, `validatePaymentFields`, and `saveSettings`.
  - Preserve the current full payload save behavior. Do not switch to partial saves in this refactor.
  - Preserve `bullrun:payment-settings-updated` dispatch after successful save.
- [done] Phase 6: extract plans/tariff controller and UI.
  - `useTariffsController.js` owns `newTariff`, `bundleDrafts`, `ensureBundleDraft`, `getTariffBundleItems`, `getUpsellOptions`, `getBundleSummary`, `createTariff`, `deleteTariff`, `addBundleItem`, and `deleteBundleItem`.
  - `TariffsSection.jsx` is the first extracted plans UI.
  - After `TariffsSection` is stable, split it into `TariffCreateForm.jsx`, `TariffCard.jsx`, and `TariffBundleEditor.jsx`.
  - `ReferralSettingsSection.jsx` should be separate from tariffs because referral settings live in `payment_settings`, not `tariffs`.
- [ ] Phase 7: extract data loading last.
  - Add `usePaymentSettingsData.js` only after UI and controller boundaries are stable.
  - Preserve current fallback behavior for missing trial fields and missing `tariff_bundle_items`.
  - Preserve current one-minute refresh behavior.
  - Do not optimize route-specific loading in the same phase. Splitting data loads by `mode` is a later behavior change.

## Key Risks

- `/app/plans` still depends on `payment_settings` because referral settings live there.
- `saveSettings` currently saves the whole settings payload; extracted sections must not silently switch to partial saves.
- `trialSupport` and `bundleSupport` are schema compatibility fallbacks. Do not simplify them during UI extraction.
- `window.location.reload()` after tariff/bundle mutations is existing behavior. Preserve it during decomposition.
- `prioritySignals` mixes billing, requisites, and product readiness. Moving it is fine; changing where it appears is a separate product decision.
- The current data effect depends on `selectedUserbotId`; moving data loading too early can accidentally change refresh frequency.

## Verification

After every phase:

- Run `cd admin-v2 && npm run build`.
- Smoke `/app/payments`: bank toggle, phone validation, TON validation, save requisites.
- Smoke `/app/plans`: create tariff form renders, trial fields render when supported, existing tariff cards render, bundle editor renders, referral fields save through final action.
- Smoke `/app/billing`: admin TG ID selection, provider/webhook fields, webhook test button, payment event filters, CSV export.

## Review Rules

- Keep each phase behavior-preserving.
- If prop lists become too wide, extract the controller hook before moving more JSX.
- Do not create a single mega-hook that just hides the 1470-line component elsewhere.
- Do not split `/app/payments`, `/app/plans`, and `/app/billing` into separate route components until shared settings/data ownership is explicit.

## Implementation Review

- Implemented phases 1-6 on April 15, 2026.
- `PaymentSettingsPage.jsx` is now a route-level composer of about 352 lines.
- Data loading remains in `PaymentSettingsPage.jsx` by design; Phase 7 is still open because loading is coupled to `selectedUserbotId` and tariff bundle draft initialization.
- Reviewer found one inherited/follow-on save bug in `FinalSettingsActions`: passing `saveSettings` directly to `onClick` could pass the click event as `overrides`. Fixed by calling `onSave()` explicitly.
- Verification run: `cd admin-v2 && npm run build` passed after the final fix.
