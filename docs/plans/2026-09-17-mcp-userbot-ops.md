# Юзербот-операции: полный базовый набор действий через MCP/REST

**Контекст.** Поверхность юзербота урезана до чтения: 10 операций (диалоги, чтение/поиск/отправка текста, join/leave, участники, health) — и ни одного «банального» действия: создать группу, пригласить, повысить, закрепить, отредактировать, удалить, переслать, прочитать, резолвнуть юзера. E2E чек-листов упёрся ровно в это. Закрываем двумя волнами + roadmap. Все имена GramJS-методов проверены по `node_modules/telegram/tl/api.d.ts` (частые ловушки: описание = `messages.EditChatAbout`, не `channels.EditAbout`; инвайт = `messages.ExportChatInvite`; `channels.EditAbout` НЕ существует).

**Миграция:** нет (только код + пин `"telegram": "2.26.22"` без `^` — сейчас это и есть последняя в npm; апгрейд GramJS — отдельная задача, канарка после него — новые операции).

## Волна 1 — жизненный цикл группы/бота (e2e-critical, 6 операций + фикс)

| Операция | GramJS | Примечания |
|---|---|---|
| `bullgram_userbot_group_create` — `POST /userbots/{id}/groups`, args: `title` (1–128), `kind` (`group`\|`channel`, default group), `about?` (≤255) | `channels.CreateChannel({megagroup\|broadcast, title, about})` | → `{chat_id, access_hash, title, invite_link}` (`messages.ExportChatInvite`); группа-создатель — юзербот |
| `bullgram_userbot_member_invite` — `POST /userbots/{id}/groups/{chat_id}/invite`, args: `members` (1–10, @username) | `channels.InviteToChannel` | канал через `getInputEntity`/dialogs; per-member результат (ок/уже/отказ) |
| `bullgram_userbot_member_promote` — `POST /userbots/{id}/groups/{chat_id}/promote`, args: `member`, `rights` (`all`\|`post_only`\|`revoke`) | `channels.EditAdmin` (паттерн chat-admin-rights.service.js: `GetParticipant(InputPeerSelf)` для своих прав, `InputUser`+accessHash) | `revoke` = разжать (пустые права); юзербот обязан иметь canPromoteMembers |
| `bullgram_userbot_group_invite_link` — `POST /userbots/{id}/groups/{chat_id}/invite-link`, args: `revoke?` | `messages.ExportChatInvite` / `messages.EditExportedChatInvite(revoked)` (паттерн contour-admin-rights) | новая ссылка / отзыв старой |
| `bullgram_userbot_botfather_create_bot` — `POST /userbots/{id}/botfather/create-bot`, args: `bot_name` (1–64), `bot_username` (`^[a-z][a-z0-9_]{4,31}bot$`) | DM-диалог с @BotFather (93372553): ОДИН клиент на операцию, baseline `getMessages(minId)` → `/newbot` → имя → username → парс токена `^\d{6,10}:[A-Za-z0-9_-]{30,}` (новый хелпер; «taken» → INVALID_PARAMS с текстом BotFather); шаги withTimeout ~20с + поллинг | → `{bot_username, bot_token}` — свежая credentials владельца, вызов в audit-log |
| `bullgram_autopost_bot_init` — `POST /autopost/bots`, args: `bot_token` (req), `admin_tg_id?` | перенос `/bots/init` в реестр: `enforceAutopostBotQuota` (profile из БД — в MCP `req.profile` пуст) → `service.validateAndCreateBot` (getMe+insert+startBot) → ответ как sanitizeBot (без токена/invite_secret); неверный токен → INVALID_PARAMS, квота → QUOTA_EXCEEDED | |

**+ Фикс существующей дыры:** `leave-chat` покрывает только `channels.LeaveChannel` — добавить ветку basic-групп `messages.DeleteChatUser(InputUserSelf)` (паттерн cleanup.job).

**Флаги-kill-switch** (дефолт false, доктрина userbot-флагов): `USERBOT_GROUP_ADMIN_ENABLED` — create/invite/promote/invite-link; `USERBOT_BOTFATHER_ENABLED` — BotFather. Без флага → TOOL_DISABLED с подсказкой. `bot_init` без флага.

## Волна 2 — банальные операции с сообщениями/чатами (6 операций, все S)

| Операция | GramJS | Примечания |
|---|---|---|
| `bullgram_userbot_message_edit` — args: chat_id, message_id, text | `messages.EditMessage` | только свои сообщения |
| `bullgram_userbot_message_delete` — args: chat_id, message_ids[], `confirm: true` (обязателен) | `messages.DeleteMessages(revoke)` | необратимо — явный confirm |
| `bullgram_userbot_message_forward` — args: from_chat_id, message_ids[], to_chat_id | `messages.ForwardMessages` | |
| `bullgram_userbot_message_pin` — args: chat_id, message_id, `unpin?` | `messages.UpdatePinnedMessage` | |
| `bullgram_userbot_chat_read` — args: chat_id | `messages.ReadHistory` / `channels.ReadMessageContents` (внутренний `markDialogAsRead` уже есть) | |
| `bullgram_userbot_user_resolve` — args: `username` \| `tg_user_id` | `users.GetUsers`/`users.GetFullUser` (+peer-cache) | фундамент access_hash для invite/promote; → id, username, имена, verified |

Без флагов (операции безопасны/необратимость закрыта confirm-ом). Всё — только megagroup/каналы/ЛС-диалоги; basic-группы для admin-веток — осознанно не поддерживаем (в BACKLOG, паттерн `messages.EditChat*`).

## Реализация

- **Фаза 1 — сервисные методы (userbot.service.js):** `createGroupChat`, `inviteGroupMembers`, `promoteGroupMember`, `exportGroupInviteLink`, `botFatherCreateBot` (один клиент, шаги с поллингом, `parseBotFatherToken` рядом с `parseTelegramInviteLink`), `editMessage`/`deleteMessages`/`forwardMessages`/`pinMessage`/`markChatRead`/`resolveTelegramUser`; фикс leave-basic. Всё: `createAuthorizedClient` → try → finally `safeDisconnect`, `wrapTelegramError`, logger, `assertUserbotOperatable`, флаг-гейты. + пин `"telegram": "2.26.22"` без `^`.
- **Фаза 2 — 12 операций в реестре** (файлы в `mcp/tools/messages|dialogs|account/`, автопроводка REST), барель, `openapi.js` описание, README-секция, offline-тесты (mock userbotService/supabase, стиль test-autopost-checklist-ops): валидации, флаг-гейты, парсер BotFather («taken»), per-member результаты, confirm на delete, init (невалидный токен/квота/sanitize).
- **Фаза 3 — e2e на проде:** владелец включает 2 флага в backend/.env → pm2 reload. brapi_-токен через Supabase MCP → сценарий по REST: `group_create` (Erik) → `botfather_create_bot` → `bot_init` → `member_invite` (бот) → `member_promote` (админ) → `checklist_create` → тогглы в Telegram → `state` → `cancel`. Тестовая группа; после — список закрыт, бота удалить у BotFather.
- **BACKLOG §16:** волна 3 (media send/download, реакции, опросы, slow mode/banned-rights, контакты/блок, профиль/аватар, basic-группы для admin-веток, kick как MCP-обёртка, авторизации) + «апгрейд GramJS» (канарка — новые операции).

## Верификация

- Офлайн: `test:autopost` + новые тесты операций + `test:mcp` + `node --check`.
- Прод: e2e-сценарий фазы 3; открытый openapi.json показывает новые пути.

## Правила

- Никаких новых скоупов (`mcp/api:userbot:write`, `mcp/api:autopost:write`); `assertAccountAllowed` (allowed_userbot_ids) + `assertUserbotOperatable` (safe-mode) на каждой userbot-операции.
- BotFather-диалог — один клиент на операцию; никаких персистентных клиентов.
- `bot_init` не возвращает bot_token/invite_secret; токен BotFather — только в своей операции создания.
- Все `Api.*` — только в service-методах; версия `telegram` пинится.
- Имена GramJS — только после сверки с `tl/api.d.ts`.

## Ревью (клоуз-ап 2026-09-17)

**Код-ревью: APPROVE-WITH-NITS.** P2: `revoke` у invite-link без link молча выпускал новую ссылку вместо отзыва (исправлено: резолв текущей primary-ссылки через `channels.GetFullChannel` → `fullChat.exportedInvite.link` → EditExportedChatInvite; нет ссылки → INVALID_PARAMS); скан участников в `resolveMemberInputUser` не матчил @username и отрицательные id (исправлено). P3: комментарий forward, `USER_ALREADY_PARTICIPANT` → отдельный статус `already` (по плану было «ок/уже/отказ»), ветка `User` в `resolveChatPeer` (wave-2 работает и с DM-пирами), валидация username, проза README `{id}` → `{userbot_id}`. Похвала ревьюера: каждый GramJS-вызов сверен с типами — фикс `addAdmins` это подтвердил (старый код тратил продовый флоу на несуществующее поле).

**Security: SAFE-WITH-FIXES → закрыто.** P1: фикс `addAdmins` оживил мёртвую ветку в `chat-admin-rights.service.js`, которая слала `ChatAdminRights({canManageChat:true})` — флага в TL нет, сериализовалось в пустые права = **демоут с фальшивым успехом** (включать `USERBOT_AUTO_ADMIN_ENABLED` было нельзя). Исправлено на валидный набор `{changeInfo, deleteMessages, pinMessages, inviteUsers}` + тест, что в правах есть хотя бы один true. P2: токен BotFather дублировался в `raw_reply` (теперь redacted) + гонка baseline при параллельных созданиях (фильтр `out === false` + in-flight guard на юзербота → RATE_LIMITED). P3: пауза 1с между приглашениями, `already`-статус, атомарность квоты `bot_init` (select-потом-insert) — осознанно отложена в BACKLOG §16 (владелец-only операция + rate limit).

**Подтверждено security:** `mcp_tool_log` не хранит ни аргументы (только hash), ни тела ответов — токен BotFather в БД не оседает; все 11 userbot-операций за `loadOwnedUserbot` + `assertAccountAllowed` + `assertUserbotOperatable`; `bot_init` создаёт бота строго под владельцем токена; `delete` закрыт серверным confirm; регрессий leave/delete-split нет.

**Компромиссы (осознанные):** botFather in-flight guard per-process (одиночный pm2-инстанс); basic-группы не поддержаны в admin-ветках (волна 3); пауза 1с между инвайтами замедляет массовые приглашения (защита аккаунта важнее).

**Гейты:** `test:autopost` — 10 файлов зелёные (test-userbot-ops ~130+ ассертов); `test:mcp` — 56/56; `node --check` — OK.

**Прод-e2e (2026-09-17): пройден полностью.** Юзербот Erik: `group_create` → `botfather_create_bot` (реальный диалог, токен получен) → `autopost_bot_init` → `member_invite` → `member_promote` → `checklist_create` `publish_now` → живой тап владельца в Telegram → `checklist_state` с атрибуцией → `cancel`. Попутно пойман и исправлен баг формата chat_id (созданные группы: Bot API требует `-100…`, не голый MTProto-id — иначе «chat not found») и добавлен явный `my_chat_member` в `allowed_updates` (детерминированная привязка). Тестовые артефакты (бот, чек-листы, e2e-токен) удалены; сирота-бот `@bullgram_chk_e2e_bot` — удалить у BotFather вручную.
