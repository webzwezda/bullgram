# BotFather Consolidated Sales Contour Plan - 2026-05-06

## Problem

The current `/app/botfather` UI splits one operator flow into several similar cards:

- connect official bot
- configure bot admin
- list connected official bots
- sales contour
- check Telegram rights
- prepare selected userbot

This makes the page feel like several blocks do the same thing. It also exposes the current model weakness: the top bot card shows discovered Telegram places while `SalesContourSection` tries to assign business roles to the same places.

## Product Model

Keep two levels separate:

- Official bot technical status:
  - token connected
  - bot type: `sales` or `template`
  - runtime status
  - admin contact `admin_tg_id`
  - discovered linked Telegram places
- Sales contour business configuration:
  - which Telegram places belong to this sales flow
  - which userbot mode is used
  - whether official bot has enough rights
  - whether selected userbot is prepared

The UI can combine these levels in one screen, but the data model must not blur them.

## Source Of Truth

- `tg_accounts`
  - official bot identity
  - `bot_kind`
  - `bot_role`
  - `admin_tg_id`
  - token/session data
- `channels`
  - discovered Telegram places
  - `chat_type`
  - `bot_id` linkage
- `sales_bot_contours`
  - selected business contour for one sales bot
  - currently `paid_channel_id`, `public_chat_id`, `userbot_mode`, selected userbot
  - future extension should add explicit roles instead of inferring from names

Do not make the connected-bot card the source of truth for public/paid target selection. It should only summarize what the bot sees.

## Target UI

### 1. Connect Bot

Keep this as a small first-run block:

- Bot token
- Bot type: `Бот продаж` / `Заготовка`
- Connect button

When at least one bot exists, visually reduce this block. It should not dominate the page.

### 2. Selected Bot Workspace

Create one main block: `Настройка выбранного бота`.

Header:

- bot selector: `@bulrun_ru_bot`
- type selector: `Бот продаж` / `Заготовка`
- compact status chips:
  - token connected
  - runtime active / template inactive
  - admin assigned / missing
  - linked Telegram places count

This replaces the separate "Админ бота" block and the large connected-bot cards as the main working surface.

### 3. Admin Contact Inside Workspace

Move admin settings into the selected bot workspace:

- `Telegram ID админа`
- resolved username if available
- `Сохранить админа`
- link to `@userinfobot`

Reason: admin contact is not an independent product feature. It belongs to the selected official bot.

### 4. Sales Contour Inside Workspace

For `bot_kind = sales`, render contour settings inside the same workspace.

Current immediate fields:

- `Платный канал`
- `Публичный чат`
- `Режим юзербота`
- selected userbot
- save contour
- check rights
- prepare userbot

Near-term target fields:

- `Публичный канал`
- `Публичный чат`
- `Закрытый платный канал`
- `Закрытый платный чат`

This matches the real operator world:

- public channel = media / updates / funnel
- public chat = community / trust / questions
- paid channel = paid content
- paid chat = paid discussion / support

### 5. Linked Places Summary

Move the current "Группа / Канал" and "Чат" card content into a compact "Бот видит" summary inside the workspace:

- `Каналы: N`
- `Чаты: N`
- optional small list or disclosure

Do not present discovered places as chosen contour roles. They are candidates, not settings.

### 6. Other Bots

If multiple official bots exist, show a compact list/table below:

- username
- type
- admin status
- linked places count
- select button
- delete in a danger menu/zone

Do not repeat full contour/status cards for every bot.

## Filtering Fix

Before or during consolidation, fix the current selector bug:

- Paid channel selector should not include `group` / `supergroup` if the field means channel.
- Public chat selector should include only `group` / `supergroup`.

Current bug:

```js
paidChannelOptions = linkedChannels.filter(chat_type !== 'private')
```

This includes groups in the paid field. Replace with explicit role filters.

Short-term:

- `paid_channel_options`: `chat_type === 'channel'`
- `public_chat_options`: `chat_type === 'group' || chat_type === 'supergroup'`

Future:

- add `paid_chat_id` and `public_channel_id`
- then show four role-specific selectors

## Implementation Stages

### Stage 1 - Low-Risk UI Consolidation

- Keep backend API unchanged.
- Keep `useOfficialBotsController` and `useSalesContourController` separate on the first pass.
- Keep `botAdminDrafts`, `draftsByBotId`, and `dirtyBotIds` separate to avoid draft loss during layout work.
- Refactor `OfficialBotsSection.jsx` into:
  - `ConnectOfficialBotCard`
  - `SelectedOfficialBotWorkspace`
  - `OtherOfficialBotsList`
- Move admin controls into `SelectedOfficialBotWorkspace`.
- Move `SalesContourSection` rendering into the workspace body.
- Replace large connected-bot cards with compact other-bots list.
- Fix selector filtering for `channel` vs `group/supergroup`.
- Do not unmount/remount the selected-bot detail flow in a way that loses unsaved drafts.

Validation:

- `cd admin-v2 && npm run build`
- Manual check `/app/botfather`
- Ensure no Telegram calls on page load.

### Stage 2 - Contour Role Clarity

- Rename current labels:
  - `Платный канал / группа` -> `Платный канал`
  - `Публичный чат` stays `Публичный чат`
- Add UI copy that discovered places are candidates, saved contour is source of truth.
- Keep prepare-userbot locked to saved paid contour.

Validation:

- selecting unsaved values still blocks rights/prepare until contour is saved
- `pool` remains disabled

### Stage 3 - Four Telegram Places

Requires DB/API extension.

- Add fields to `sales_bot_contours`:
  - `public_channel_id`
  - `paid_chat_id`
- Keep existing `paid_channel_id` and `public_chat_id`.
- Backend validates:
  - channel fields must be `chat_type = channel`
  - chat fields must be `group/supergroup`
  - every selected place belongs to owner and is linked to selected official bot
- UI shows four selectors.

Validation:

- Supabase migration applied
- backend `node --check`
- admin build
- existing contours keep working with null new fields

### Stage 4 - Membership Tracking Foundation

Separate from UI consolidation.

- Add membership cache table later:
  - `owner_id`
  - `tg_user_id`
  - `channel_id`
  - `target_kind`
  - `status`
  - `last_seen_at`
  - `source`
- Update only by explicit button or controlled scheduled job.
- UI reads from DB cache, never live Telegram on page load.

## Non-Goals For This Refactor

- Do not implement aggressive Telegram scanning.
- Do not make userbots join anything automatically without explicit operator action.
- Do not merge `subscriptions` with actual Telegram membership state.
- Do not move all userbot inventory logic from `/app/userbots` into `/app/botfather`.

## Main Risk

The main risk is accidentally making unsaved form state look like live Telegram truth. Avoid this by keeping a hard rule:

- Save contour first.
- Then check rights.
- Then prepare userbot.

The UI should visually reinforce that sequence.

## Implementation Pass 1 - 2026-05-06

- Done: consolidated `/app/botfather` around one selected official-bot workspace.
- Done: moved bot type and `admin_tg_id` controls into the selected-bot workspace.
- Done: moved `SalesContourSection` inside the selected-bot workspace for `bot_kind = sales`.
- Done: replaced repeated large connected-bot cards with a compact official-bots list.
- Done: kept `useOfficialBotsController` and `useSalesContourController` separate.
- Done: kept `botAdminDrafts`, `draftsByBotId`, and `dirtyBotIds` separate.
- Done: fixed paid/public target filtering:
  - paid channel selector now uses only `chat_type = channel`
  - public chat selector uses only `group/supergroup`
- Done: backend contour validation now rejects group/supergroup for `paid_channel_id`.
- Verified:
  - `node --check backend/services/sales-contour.service.js`
  - `node --check backend/routes/official-bot.routes.js`
  - `cd admin-v2 && npm run build`

## Implementation Pass 2 - 2026-05-06

- Done: renamed the operator model in `/app/botfather` from "paid/public" wording to four Telegram-place roles:
  - `Открытый канал`
  - `Открытый чат`
  - `Закрытый канал`
  - `Закрытый чат`
- Done: added nullable `sales_bot_contours.public_channel_id` and `sales_bot_contours.paid_chat_id`.
- Done: kept existing `paid_channel_id` and `public_chat_id` for backward compatibility.
- Done: updated backend contour overview, save payload, row mapping, and Telegram rights target resolution for all four roles.
- Done: added DB distinct-role validation so one Telegram place cannot occupy two contour roles.
- Done: kept `paid_channel_id` required for current compatibility with existing access flow.
- Done: frontend now saves all four roles, but still keeps userbot preparation scoped to `Закрытый канал`.
- Done: rights check can target any selected role after the contour is saved.
- Applied Supabase migration:
  - `extend_sales_contours_four_telegram_places`
- Verified:
  - `node --check backend/services/sales-contour.service.js`
  - `node --check backend/routes/official-bot.routes.js`
  - `cd admin-v2 && npm run build`

Remaining next layer:

- Add a single "Проверить весь контур" action that checks all selected roles in one backend call.
- Add mass userbot preparation for multiple selected roles instead of only `Закрытый канал`.
- Connect `Plans` later to the ready closed roles, not directly to raw Telegram places.

## Implementation Pass 3 - 2026-05-06

- Done: changed `/app/botfather` UX from separate `Открытый контур / Закрытый контур` blocks to interactive cards:
  - `Каналы`
  - `Чаты`
  - `Админ`
- Done: channel card now assigns channel roles:
  - `Витрина` -> `public_channel_id`
  - `Доступ` -> `paid_channel_id`
  - `Не используется` -> clears the role
- Done: chat card now assigns chat roles:
  - `Комьюнити` -> `public_chat_id`
  - `Доступ` -> `paid_chat_id`
  - `Не используется` -> clears the role
- Done: admin card now expands into `Telegram ID админа` settings instead of keeping it as an always-visible duplicate block.
- Done: removed frontend auto-selection of the only channel as `Доступ`; roles are now explicit operator choices.
- Done: added channel public/private metadata:
  - `channels.username`
  - `channels.visibility`
  - `channels.last_visibility_check_at`
- Done: official bot `my_chat_member` updates now persist `username` and `visibility` from Telegram.
- Done: userbot admin sync also persists `username` and `visibility` when it can see those fields.
- Applied Supabase migration:
  - `add_channel_visibility_metadata`
- Verified:
  - `node --check backend/services/official-bot.service.js`
  - `node --check backend/services/sales-contour.service.js`
  - `node --check backend/routes/userbot.routes.js`
  - `cd admin-v2 && npm run build`
  - `git diff --check`

## Implementation Pass 4 - 2026-05-06

- Done: changed `/app/botfather` from 3 interactive cards to 5 role tabs:
  - `Открытый`
  - `Публичный чат`
  - `Закрытый канал`
  - `Закрытый чат`
  - `Админ`
- Done: each role tab now shows only compatible Telegram places for that role.
- Done: role assignment is now direct:
  - choose a channel in `Открытый` -> `public_channel_id`
  - choose a chat in `Публичный чат` -> `public_chat_id`
  - choose a channel in `Закрытый канал` -> `paid_channel_id`
  - choose a chat in `Закрытый чат` -> `paid_chat_id`
- Done: removed the intermediate `Каналы / Чаты` role selector UX from the primary flow.
- Done: kept userbot preparation only in `Закрытый канал`.
- Verified:
  - `cd admin-v2 && npm run build`
  - `git diff --check`

## Implementation Pass 5 - 2026-05-06

- Done: replaced the bottom `Official-боты` list with `Telegram-площадки` for the selected official bot.
- Done: the bottom block now shows every linked Telegram place from `channelsByBotId[selectedBotId]`:
  - title / Telegram ID
  - current `chat_type`
  - public/private metadata when known
  - linked `bot_id`
- Done: added operator controls in that list:
  - change `chat_type` between `channel`, `group`, and `supergroup`
  - delete a Telegram place from BullRun
- Done: added backend endpoints:
  - `PATCH /api/official-bot/channels/:channelId`
  - `DELETE /api/official-bot/channels/:channelId`
- Done: delete is DB-only and does not delete anything in Telegram.
- Done: delete clears nullable sales-contour references first, but blocks deletion when the place is the required `Закрытый канал` (`paid_channel_id`).
- Verified:
  - `node --check backend/routes/official-bot.routes.js`
  - `cd admin-v2 && npm run build`
  - `git diff --check`

## Implementation Pass 6 - 2026-05-06

- Done: removed the accordion/dropdown behavior from the five BotFather contour cards.
- Done: removed `activePanel` state from `OfficialBotsSection`.
- Done: `SalesContourSection` now renders the contour as inline working cards:
  - `Открытый`
  - `Публичный чат`
  - `Закрытый канал`
  - `Закрытый чат`
  - `Админ`
- Done: each Telegram role card now contains the actual controls directly:
  - place selector
  - rights status
  - `Проверить права`
  - `Сохранить`
- Done: rights results are exposed per target so several cards can keep their last checked status without opening a panel.
- Done: changing a selected place clears stale rights for that role, so old checks are not shown for a new group/channel.
- Done: page load still reads cached DB data only; Telegram is touched only by explicit `Проверить права`.
- Product rule captured: no hidden submenu for these five cards; the card itself must be the working surface.
- Verified:
  - `cd admin-v2 && npm run build`
  - `git diff --check`

## Implementation Pass 7 - 2026-05-07

- Done: role selectors now auto-save on change, starting with `Открытый / Канал-витрина`.
- Done: removed the per-card `Сохранить` button from Telegram role cards.
- Done: selector changes clear stale rights for affected roles before saving.
- Done: backend now allows partial sales contours without a required `paid_channel_id`, so `Открытый` can be saved before `Закрытый канал`.
- Done: kept `Закрытый канал` required for actions that actually need paid access, such as rights/preparation on that target.
- Applied Supabase migration:
  - `allow_partial_sales_contours_without_paid_channel`
- Verified:
  - `node --check backend/services/sales-contour.service.js`
  - `cd admin-v2 && npm run build`
  - `git diff --check`

## Implementation Pass 8 - 2026-05-07

- Done: added persistent rights cache for BotFather contour roles.
- Done: created `sales_bot_contour_rights` for cached Telegram rights:
  - admin status
  - can invite users
  - can restrict/delete members
  - can promote admins
  - can manage chat
  - warnings, message, checked timestamp
- Done: `Обновить права` now calls Telegram and saves the result to BullRun.
- Done: `/api/official-bot/contours` now returns cached rights by role so cards show saved values after reload.
- Done: UI no longer shows English `invite/promote`; rights are shown as:
  - `Админ`
  - `Приглашать`
  - `Удалять`
  - `Назначать админов`
  - `Управлять`
- Done: button copy changed from `Проверить права` to `Обновить права`.
- Done: role readiness is less strict for open roles; closed roles care about invite/delete, while admin promotion remains relevant for userbot preparation.
- Applied Supabase migration:
  - `cache_sales_contour_rights`
- Verified:
  - `node --check backend/services/sales-contour.service.js`
  - `cd admin-v2 && npm run build`
  - `git diff --check`

## Implementation Pass 9 - 2026-05-07

- Done: added manual `Обновить` action to the `Telegram-площадки` table for the selected official bot.
- Done: added backend endpoint `POST /api/official-bot/channels/:channelId/refresh`.
- Done: refresh pulls the latest Telegram chat metadata through the linked official bot:
  - title
  - `chat_type`
  - username
  - public/private visibility
  - `last_visibility_check_at`
- Done: page load still reads cached BullRun DB data only; Telegram is touched only when the operator presses `Обновить`.
- Done: row-level loading state is scoped to one Telegram place, so the rest of the table remains usable.
- Verified:
  - `node --check backend/routes/official-bot.routes.js`
  - `cd admin-v2 && npm run build`
  - `git diff --check`

## Implementation Pass 10 - 2026-05-07

- Product rule captured: do not expose Telegram backend terms `group`, `supergroup`, and `channel` as the main operator model.
- Done: `Telegram-площадки` now presents places as:
  - `Открытый канал`
  - `Закрытый канал`
  - `Открытый чат`
  - `Закрытый чат`
- Done: the manual type selector now shows only `Канал` and `Чат`; `group/supergroup` stays an internal persistence detail.
- Done: public/private status comes from cached Telegram metadata and is refreshed only by the explicit `Обновить` button.
- Verified:
  - `cd admin-v2 && npm run build`
  - `git diff --check`

## Implementation Pass 11 - 2026-05-07

- Done: removed the manual `Канал / Чат` selector from `Telegram-площадки`.
- Done: the list is now read-only for Telegram facts:
  - title
  - open/closed category
  - channel/chat surface
  - username and Telegram ID
- Done: operators now update facts only through `Обновить`, which pulls Telegram metadata and writes the DB cache.
- Done: kept `Удалить` as a BullRun-only cleanup action.
- Product rule captured: operators should not manually assign the technical shape of a Telegram place in the normal flow.
- Verified:
  - `cd admin-v2 && npm run build`
  - `git diff --check`

## Implementation Pass 12 - 2026-05-07

- Done: cleaned visual noise from the active `Контур продаж` rows.
- Done: removed secondary role subtitles from the contour:
  - `Витрина`
  - `Доступ по тарифу`
  - `Открытое общение`
  - `Для участников`
- Done: removed the visible `Обязательно` marker from the active contour UI.
- Done: changed rights pills in this active block from English labels to Russian:
  - `Приглашать`
  - `Назначать`
  - `Управлять`
- Verified:
  - `cd admin-v2 && npm run build`
  - `git diff --check`

## Implementation Pass 13 - 2026-05-07

- Done: rights in `Контур продаж` are always visible for each selected role.
- Done: removed the hidden rights panel pattern; the button is now only `Обновить права`.
- Done: rights labels are operator-readable:
  - `Бот админ`
  - `Может приглашать`
  - `Может удалять участников`
  - `Может назначать админов`
  - `Может управлять чатом`
- Done: rights are color-coded plainly:
  - green = yes
  - red = no
  - gray = not checked
- Verified:
  - `cd admin-v2 && npm run build`
  - `git diff --check`

## Implementation Pass 14 - 2026-05-07

- Done: fixed deletion of Telegram places that are selected as `Закрытый канал`.
- Done: `DELETE /api/official-bot/channels/:channelId` now clears all sales-contour role references before deleting the place:
  - `public_channel_id`
  - `paid_channel_id`
  - `public_chat_id`
  - `paid_chat_id`
- Product rule captured: deleting a Telegram place from BullRun is DB cleanup only; it should not be blocked by a saved contour role now that partial contours are allowed.
- Verified:
  - `node --check backend/routes/official-bot.routes.js`
  - `cd admin-v2 && npm run build`
  - `git diff --check`
