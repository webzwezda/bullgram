# Site V2 Digital Markets Homepage

## Goal

Reposition the public homepage from a narrow Telegram paywall offer to a broader BullRun entry point for digital markets, while preserving the existing Telegram monetization page as a separate public route.

## Decisions

- `/` is now a broad digital-markets homepage with the headline `Исследуем цифровые рынки`.
- The previous homepage was preserved as `/telegram`.
- Left navigation now includes `Telegram`.
- `/telegram` is public, like `/` and `/pricing`, and is not wrapped in `SiteAuthGate`.
- Blog category links from the homepage point to existing static 11ty routes:
  - `/blog/crypto/`
  - `/blog/steam/`
  - `/telegram`

## Implementation Notes

- Copied the old `site-v2/src/pages/TestPage.jsx` into `site-v2/src/pages/TelegramPaywallPage.jsx`.
- Replaced `site-v2/src/pages/TestPage.jsx` with the digital-markets homepage.
- Updated `site-v2/src/App.jsx`:
  - imported `TelegramPaywallPage`;
  - added `MessageCircle` icon;
  - added nav item `Telegram`;
  - added route `/telegram`;
  - included `/telegram` in the public marketing route set.

## Verification

- `npm --prefix site-v2 run build` passed.
- `npm run deploy:v2` completed.
- Rollback timestamp: `20260501-122646`.
- Live `https://bullrun.ru/` returns 200.
- Live `https://bullrun.ru/telegram` returns 200.
- Production JS bundle contains both:
  - `Исследуем цифровые рынки`
  - `Монетизируйте Telegram`
- cmux browser snapshot for `/` shows the new headline and nav item `Telegram`.
- cmux browser on `/telegram` confirmed the old page text `Монетизируйте Telegram`.
