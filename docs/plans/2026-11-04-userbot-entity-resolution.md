# 2026-11-04 — Entity resolution для свежих юзербот-сессий (fetch/search/botfather)

## Symptom (владелец + агент через Bullgram MCP)

Свежес залогиненный юзербот (новая GramJS-сессия, пустой кэш сущностей):

- `fetch_messages` / `search_messages` → `Could not find the input entity for PeerUser …`
- `send_message` в личку / `botfather_create_bot` → `Cannot cast [object Object] to any kind of peer`
- `botfather_create_bot` на свежем диалоге читает приветствие-меню BotFather вместо ответа на `/newbot`
  («BotFather ответил без токена: I can help you create and manage Telegram bots…»)

Старые сессии (Erik) работают — entity давно в кэше сессии. У `dialogs`/`chat_read`/`user_resolve` своего резолва хватает.

## Root causes (userbot.service.js)

1. `fetchMessages`/`searchMessages` зовут `client.getMessages(id, …)` на голом id — резолв только из кэша
   сессии, никакого fallback. ДИАГНОЗ из кода: comment на line ~2797 («внутри хелпера getInputEntity
   без fallback на диалоги») — проблема известна, но read-методы не покрыты.
2. `resolveDirectMessageTarget` (DM-send/mark-read): dialogs-fallback = `getDialogs({ limit: 80 })` —
   одна страница; на аккаунтах с сотнями диалогов чат за пределами первых 80 не находится.
3. `waitForBotFatherReply` берёт ПЕРВОЕ входящее сообщение с `id > afterId`: в свежем диалоге BotFather
   лениво досылает приветствие-меню уже ПОСЛЕ нашего `/newbot` — оно и возвращается как «ответ».

## Fix

1. **`findPeerByDialogPages(client, normalizedId, { maxTotal, normalize })`** (module-level, export):
   пагинация `getDialogs({ limit: 100, offsetId })` до 10 страниц (≤1000 диалогов), возвращает
   input-peer или null; заодно заселяет кэш сессии.
2. `resolveDirectMessageTarget`: мелкий dialogs-проход заменён на пагинированный хелпер.
3. **`resolveChatPeerForRead(client, userbot, chatId)`** (instance): для DM (positive id) —
   `resolveDirectMessageTarget`; иначе `getInputEntity` → catch → `findPeerByDialogPages`.
   Подключён в `fetchMessages` и `searchMessages` вместо голого id.
4. **`isBotFatherGreeting(text)`** (module-level, export): детектор приветствия-меню
   («I can help you create and manage Telegram bots» и/или список `/newbot`+`/mybots`).
   `waitForBotFatherReply` фильтрует такие сообщения — ждёт настоящий ответ шага.
   Эвристика сознательно консервативна: false-positive на реальном ответе невозможен,
   т.к. ответы шагов начинаются с «Alright, a new bot…», «Done! …», «Sorry, …».

## Tests

`backend/test/test-userbot-entity-resolution.js` (`npm run test:entity`):
- greeting-детектор: меню → true; «Alright/Done/Sorry/токен» → false
- `findPeerByDialogPages`: found on page 2 (пагинация), not found → null, empty page → null
- `waitForBotFatherReply` c fake client: greeting-сообщение пропускается, настоящий ответ возвращается
  (проверка фильтра в живом цикле опроса)

## Deploy

push-to-main → GitHub Actions → deploy-pull.sh → pm2 reload. Live-верификация через MCP
юзерботом владельца (webzwezda): fetch_messages по DM + botfather_create_bot.

## Review

(filled after deploy)
