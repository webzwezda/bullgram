# Tariff Delivery Toggles - 2026-04-15

## Scope

- `/app/plans` tariff creation now exposes delivery toggles as part of the initial tariff setup.
- The toggles map to existing data structures:
  - closed group -> `tariffs.channel_id`
  - chat -> `tariff_bundle_items` with `item_type = channel`
  - link/text -> `tariff_bundle_items` with `item_type = resource`

## Checklist

- [x] Keep one logical tariff with multiple payment methods.
- [x] Create bundle items immediately for every physical payment variant.
- [x] Preserve the primary closed group when extra chat targets exist.
- [x] Allow resource-only tariffs without a Telegram invite.
- [x] Verify `admin-v2` build and backend syntax.

## Lesson

Do not treat bundle Telegram targets as a replacement for the primary tariff channel. For bundled access, the official bot must issue the primary group invite and every active bundle chat invite together.
