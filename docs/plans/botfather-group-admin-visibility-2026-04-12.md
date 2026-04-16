# BotFather Group Admin Visibility

## Finding

- `/app/botfather` shows group ownership from `channels.bot_id`.
- `admin-v2/src/pages/bots/useBotsAccountsData.js` loads `channels(id, title, tg_chat_id, bot_id)`.
- `admin-v2/src/pages/bots/useBotsAccountsDerivedState.js` groups rows by `bot_id` into `channelsByBotId`.
- `admin-v2/src/pages/bots/OfficialBotsSection.jsx` renders those rows in the connected bots list.
- Current database state for the newly added `@bulrun_ru_bot`: `linked_channel_count = 0`.
- Current database state for the bot owner: `channels = 0`, `userbots = 0`.

## Existing Backend Paths

- `official-bot.service.js` listens to `my_chat_member`.
- When Telegram reports the official bot became `administrator`, the service upserts `channels` with `{ owner_id, bot_id, tg_chat_id, title }`.
- `userbot.routes.js` has `POST /api/userbot/sync-channels`.
- `sync-channels` uses a live userbot to scan dialogs, detect official bots among chat admins, and upsert `channels.bot_id`.
- `AdminGroupsPage` already has a `Синкануть каналы` action around that endpoint.

## Product Implication

- A button on `/app/botfather` can reuse the existing sync endpoint only when the owner has a live operational userbot.
- For the current owner state, that button would fail because there is no userbot.
- Official bots cannot reliably list all groups they are in by themselves; they mostly learn groups from Telegram events like being added/promoted, or from a known `chat_id`.
- Bot admin identity should keep `admin_tg_id` as source of truth. `admin_tg_username` is only a best-effort display cache resolved by the official bot during admin assignment; Telegram may not return it if the user has not started the bot or is otherwise not visible to it.

## Proposed Plan

- Improve the empty state in `Подключенные боты`: explain that groups appear after the bot is added as admin to a group, or after a channel sync through a live userbot.
- Add a `Проверить группы` action on `/app/botfather` that calls `POST /api/userbot/sync-channels` only when at least one live userbot exists.
- If there is no userbot, show a direct message: `Проверить группы нечем: подключи юзербота или добавь official bot админом в группу заново, чтобы Telegram прислал событие.`
- After a successful sync, call `reloadAccounts()` so the connected bots list refreshes immediately.
