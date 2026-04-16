# Admin V2 Bundle Analysis 2026-04-10

## Plan

- [x] Inspect current `admin-v2` build setup and choose a bundle analyzer.
- [x] Add an analyzer mode that does not affect normal `vite build`.
- [x] Run the analyzer and capture which chunks and dependencies are inflating the build.

## Notes

- Use `rollup-plugin-visualizer` behind `ANALYZE=true` so ordinary builds stay unchanged.
- Keep outputs inside `admin-v2/dist/` for easy inspection and cleanup.

## Findings

- Reports are generated at `admin-v2/dist/bundle-stats.html` and `admin-v2/dist/bundle-stats.json`.
- Ordinary `npm run build` still works unchanged; analyzer mode is only `npm run analyze`.
- The largest chunks are still:
  - `assets/index-CYR1LgrD.js` `893.70 kB` minified, `264.15 kB` gzip
  - `assets/index-E3PRAA8Z.js` `462.02 kB` minified, `129.68 kB` gzip
  - `assets/BotsAccountsPage-C4oZnCOP.js` `112.86 kB` minified, `25.62 kB` gzip
- `BotsAccountsPage` is not the main bundle-size problem anymore.
- Main contributors inside `assets/index-CYR1LgrD.js`:
  - `react-dom` about `561 kB`
  - `@tonconnect/ui` about `509 kB`
  - `@supabase/auth-js` about `255 kB`
  - `@tonconnect/sdk` about `237 kB`
  - `react-router` about `80 kB`
- Main contributors inside `assets/index-E3PRAA8Z.js`:
  - `@ton/core` about `288 kB`
  - `@ton/ton` about `230 kB`
  - `@ton/crypto` about `179 kB`
  - `zod` about `169 kB`
  - `axios` about `113 kB`

## Review

- The initial guess that the warning was mostly `supabase` was incomplete.
- The biggest weight today is a combination of global `TonConnect` usage in `src/main.jsx`, the TON stack behind `@ton/ton`, React runtime, and only then Supabase.
- The next optimization pass should target chunk strategy and import boundaries, not `BotsAccountsPage`.

## Remediation

- Removed browser wallet-connect flow from `admin-v2`.
- Deleted global `TonConnectUIProvider` from `src/main.jsx`.
- Deleted the browser-payment hook `src/pages/bots/useUserbotTonCheckoutBrowser.js`.
- Deleted `src/utils/ton-checkout.js` because it only existed to build browser wallet transactions.
- Removed `@tonconnect/ui-react` and `@ton/ton` from `admin-v2/package.json`.
- TON checkout in admin now stays on the simpler product flow:
  - wallet address
  - memo
  - `ton://` or wallet deeplink
  - QR
  - backend payment check by memo and amount

## Post-Change Result

- `npm run build` now finishes without the large-chunk warning.
- Previous heavy chunks:
  - `assets/index-CYR1LgrD.js` `893.70 kB`
  - `assets/index-E3PRAA8Z.js` `462.02 kB`
- Current shared chunk:
  - `assets/index-BZyy0387.js` `466.45 kB`, `138.29 kB` gzip
- `BotsAccountsPage` stayed roughly the same size, which confirms the warning was mostly from the removed TON browser stack.
- Current top contributors inside the remaining shared chunk are mostly:
  - `react-dom` about `561 kB`
  - `@supabase/auth-js` about `255 kB`
  - `tailwind-merge` about `99 kB`
  - `@supabase/realtime-js` about `95 kB`
  - `@supabase/storage-js` about `89 kB`
