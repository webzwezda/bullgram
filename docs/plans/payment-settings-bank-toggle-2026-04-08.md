# Payment Settings Bank Toggle

## Plan
- [done] Review the current requisites layout and identify the smallest safe UI change.
- [done] Move bank selection to the first position in the buyer requisites block.
- [done] Replace the free-text bank field with an iPhone-like segmented selector for `Сбербанк` and `Т-Банк`.
- [done] Verify the admin build and record the result.

## Review
- `admin-v2` build passed after the UI change.
- The buyer requisites block now focuses on bank selection plus phone/FIO, without QR/deeplink UI.
- The bank selector still uses the existing `sbp_bank` payload field, but now stores one or both enabled banks as a comma-separated value.
- Bank selection now uses independent iPhone-style toggles, with `Т-Банк` treated as the default active bank.
- The QR/deeplink UI block was removed from the requisites screen, and the page no longer keeps local QR upload/preview state.
- Lesson: this screen does not use the legacy `.payment-card` wrapper, so the global `.field { min-width: 280px; }` must be explicitly neutralized under `.page.payment-page` or the inputs stop behaving responsively on narrow widths.
