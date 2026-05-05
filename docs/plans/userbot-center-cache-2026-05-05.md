# Userbot Center Cache Plan

## Goal

Persist the manually collected `userbot-center` groups and conversations so the page can render the last saved state without touching Telegram on every reload.

## Checklist

- [x] Add Supabase-backed cache tables for groups and conversations.
- [x] Read cached groups/conversations when `/api/userbot/ops-center` is called without `scan=true`.
- [x] On explicit scan, collect Telegram data conservatively and replace the cache for the selected userbot.
- [x] Surface cache metadata in the API response so the UI can show when data was last refreshed.
- [x] Update the `Проверить сейчас` button to show a spinner and elapsed wait time while scan is running.
- [x] Validate syntax/build and deploy only after checks pass.

## Review

- Backend syntax check passed with `node --check backend/routes/userbot.routes.js`.
- `admin-v2` production build passed.
- `site-v2` production build passed.
- Supabase migration was applied through Supabase MCP.
- Supabase advisors were checked; new unindexed foreign-key warnings were addressed with extra indexes. Remaining advisor warnings are pre-existing project-wide items or fresh unused-index notices for the new empty tables.

## Safety Rules

- No background Telegram polling from page reload.
- Only scan on explicit admin action.
- Keep the scan bounded to the existing dialog limit.
- Do not scan group participants except the existing admin check for groups already linked to BullRun channels.
- Preserve user edits in `admin-v2/src/pages/UserbotCenterPage.jsx`; it is currently dirty from user changes.
