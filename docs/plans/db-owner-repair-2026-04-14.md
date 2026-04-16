# DB owner repair 2026-04-14

## Problem

Admin account stopped seeing tariffs and related operational data after accidental DB changes.

## Findings

- Working admin owner appears to be `9fd78a21-33b6-4d68-b0f7-a8ddf2e0bce3` (`webzwezda@gmail.com`).
- Official bot `bulrun_ru_bot` and channel `bullrun.ru` are currently owned by `4514eca8-724b-45a5-aba7-802b341f0ea4`.
- `tariffs` is empty globally, so exact old tariff rows cannot be restored from current table contents.
- Current UI and backend filter bot, channel, payment, and tariff data by `owner_id = current user id`.
- The current channel has no dependent subscriptions, invites, access events, bundle items, or invoices by `channel_id`.

## Repair Plan

- [x] Move official bot `abf9aace-5b58-4010-849a-29a53395f143` to the working admin owner.
- [x] Move channel `9f8a77f6-a0f0-44d7-9c6d-a5e75e4cc1ed` to the working admin owner.
- [x] Re-check owner counts for both owners.
- [ ] Restore tariffs only with explicit known tariff details or a clearly accepted fallback.

## Current Status

- `webzwezda@gmail.com` now owns the official bot and channel again.
- Active tariff count is still `0`.
- Invoice aggregates suggest old/test amounts of `1 RUB`, `1 TON`, and `5 TON`, but they do not prove the correct active tariff titles or durations.

## Lesson

When account-specific data disappears in this app, first check owner alignment across `profiles`, `tg_accounts`, `channels`, `payment_settings`, and `tariffs`; most admin screens are intentionally scoped to the current Supabase user id.
