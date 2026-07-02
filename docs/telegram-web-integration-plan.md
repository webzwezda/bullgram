# Telegram Web Integration into Userbot Center

## Context

`/app/userbot-center` (`admin-v2/src/pages/UserbotCenterPage.jsx`) даёт админам интерфейс для ручной работы с юзерботами: чат-список, профиль, группы, сессии. Текущий UI — самописный, ограниченный по функционалу: нет стикеров, реакций, тредов, полноценного медиа, поиска по сообщениям, тем.

Цель — заменить самописный чат-интерфейс на полноценный Telegram Web UI, форкнув официальный [Ajaxy/telegram-tt](https://github.com/Ajaxy/telegram-tt) (GPL-3.0; проект некоммерческий, лицензия ок). Главное нефункциональное требование: **аккаунты не должны отлетать**. То есть весь трафик должен идти через существующие серверные SOCKS5-прокси (правило `1 proxy = 1 userbot`), а не напрямую из браузера админа.

**Подход:** транспортный мост на бэкенде. Браузерный GramJS (из форка telegram-tt) шифрует MTProto-пакеты локально, но транспорт идёт через WebSocket на BullRun-бэкенд → бэкенд проксирует сырые байты через SOCKS5 → Telegram DC. IP аккаунта остаётся стабильным (как у текущего серверного клиента). Сессия выдаётся браузеру on-demand, короткоживущая, только в памяти (никогда не персистится в IndexedDB).

---

## Architecture Overview

```
Admin browser
  ├─ admin-v2 (/app)                    ← существующий UI
  └─ userbot-web (/app/telegram-web)    ← НОВЫЙ отдельный Vite-билд, форк telegram-tt
       │
       │ 1) POST /api/userbot/web-session/:id  → { bridgeToken, sessionToken, wsUrl, fingerprint, expiresAt }
       │ 2) WSS /api/mtproto-bridge?bridge_token=<token>
       │    WS binary frames ↔ (payload = raw MTProto bytes)
       ▼
nginx (уже настроен для /api/ WS — строки 18-28 bullgram.xyz.conf)
       ▼
BullRun backend (single PM2 process, port 3000)
  ├─ http.createServer(app)             ← refactor server.js
  ├─ WebSocketServer on /api/mtproto-bridge
  ├─ mtproto-bridge.service.js          ← per-connection state machine
  └─ socks-proxy-agent → userbot's proxy → Telegram DC IP:443 (raw TCP)
```

**Протокол моста (уточнённый после Phase 0 spike):**
- Первый text frame от браузера: `JSON.stringify({ip, port, dcId, version})`. Backend парсит JSON, открывает raw TCP к `ip:port` через SOCKS5-прокси юзербота. `dcId` факультативный — для логирования и audit, не для resolution.
- Bridge НЕ держит DC IP таблицу. GramJS резолвит DC IP из StringSession и передаёт его в `socket.connect(port, ip)` — bridge просто форвардит то, что пришло. Подтверждено Phase 0: GramJS коннектится к `2001:b28:f23d:f001::a:80` (IPv6), `socks` library корректно форвардит IPv6 destination через IPv4-прокси.
- Все последующие binary frames в обе стороны — payload = сырые MTProto bytes (codec уже отработал в браузерном GramJS). Backend пишет их verbatim в TCP-сокет.
- TCP-ответы от Telegram → verbatim как WS binary frames обратно в браузер.
- Bridge отправляет ACK в виде text frame `"ok"` после успешного TCP-connect, либо `"error:<msg>"` + close.
- Bridge token — **multi-use с TTL 5 минут**. Одна сессия GramJS открывает несколько WS (main DC + file DCs DC2/DC4) под одним токеном. После 5 мин — GramJS рефетчит токен через REST.

> **Phase 0 spike (2026-07-02):** end-to-end доказано на реальном userbot Erik (`43cd7bf3...`). `getMe` + `getDialogs` через мост возвращают реальные данные. Source IP аккаунта — тот же SOCKS5 (`193.23.197.169:21130`), что и `createAuthorizedClient`. См. `backend/test/spike-mtproto-bridge/README.md`.

**Почему это безопасно для аккаунтов:** даже если мост полностью сломается, source IP аккаунта не меняется — тот же SOCKS5-прокси, что и `createAuthorizedClient`. Худший исход = неработающий UI, не забаненный аккаунт.

---

## Critical Files (verified)

**Existing files to modify or reuse:**

- `backend/server.js:101` — `const app = express()`. Refactor to `http.createServer(app)` + attach WS server before line 236 `app.listen`.
- `backend/server.js:236` — `app.listen(PORT, ...)`. Change to `httpServer.listen(PORT, ...)`.
- `backend/middlewares/auth.middleware.js:11` — `authenticateUser`. Reuse on REST endpoint.
- `backend/middlewares/rate-limit.middleware.js:7` — `rateLimit({ windowMs, max, message })`. Reuse for token issuance rate-limit.
- `backend/services/userbot.service.js:421` — `parseSessionData(decryptedData)` → `{ token, fingerprint }`. Reuse.
- `backend/services/userbot.service.js:648` — `_buildProxy(proxyData)` → `{ ip, port, socksType: 5, username?, password? }`. Reuse to build proxy config for bridge TCP connection.
- `backend/services/userbot.service.js:1648` — `createAuthorizedClient(userbot)` — reference for decrypt+proxy flow (we won't use this directly; bridge holds raw byte pipe, no GramJS client on backend).
- `backend/utils/crypto.js:59` — `decrypt(text)` returns UTF-8 string (JSON with `{ token, fingerprint }`).
- `backend/routes/userbot.routes.js:3401` — `/admin-audit` route (live scan, NOT a table). Reference for the pattern of live userbot operations.
- `admin-v2/src/pages/UserbotCenterPage.jsx:1586-1640` — main render area; add "Открыть в Telegram Web" button next to "Проверить сейчас" that opens `/app/telegram-web/:userbotId` in new tab.
- `admin-v2/src/api/client.js:3` — `apiRequest(path, { accessToken, method, body, signal })`. Reuse for new endpoint.
- `ops/nginx/bullgram.xyz.conf:18-28` — `/api/` already has WS Upgrade/Connection headers. WS endpoint works out of the box.
- `ops/nginx/bullgram.xyz.conf:77-80` — `location /app/` alias. Need to add `location ^~ /app/telegram-web/` BEFORE this (similar to `^~ /app/assets/` at line 66) so the new sub-app is served from its own dir.
- `ops/scripts/deploy-v2.sh` — extend pattern with separate rsync target for `/var/www/bullrun-telegram-web`.

**New files:**
- `backend/services/mtproto-bridge.service.js` (~300 LOC) — bridge state machine, multi-use tokens, TCP pipe. DC IP table НЕ нужна (см. Phase 0 spike findings).
- `backend/routes/userbot-web.routes.js` (~100 LOC) — token issuance endpoint.
- `backend/migrations/NNN_telegram_web_audit.sql` — new table for audit (see §6).
- `backend/test/test-mtproto-bridge.js` (~250 LOC) — mock browser integration test.
- `userbot-web/` (git submodule of fork) — entire telegram-tt fork with patches.
- `ops/scripts/deploy-telegram-web.sh` — separate deploy for new sub-app.

**GramJS internals (reference, not modified in BullRun):**
- `backend/node_modules/telegram/extensions/PromisedWebSockets.js:54` — `getWebSocketLink(ip, port, testServers)` returns `wss://${ip}:${port}/apiws`. This is the upstream patch point.
- `backend/node_modules/telegram/network/connection/Connection.js` — codec layer (TCPAbridged, etc.). Bytes from PromisedWebSockets are codec-encoded already.

---

## Phased Implementation

### Phase 1 — Repo scaffolding (no runtime changes)
- Stub-директория `userbot-web/` с заглушкой `index.html` ("BullRun Telegram Web — coming soon"). Submodule форка `Ajaxy/telegram-tt` добавляется в Phase 3, когда есть что патчить — сейчас это пустая трата 100+ MB в репо.
- Stub `vite.config.ts`, `package.json`, чтобы собиралось в `userbot-web/dist/`.
- nginx: добавить **перед `location /app/`** (строка 77) блок:
  ```nginx
  location ^~ /app/telegram-web/ {
      alias /var/www/bullrun-telegram-web/;
      try_files $uri /app/telegram-web/index.html;
      add_header Cache-Control "no-cache";
  }
  ```
- `ops/scripts/deploy-telegram-web.sh`: rsync `userbot-web/dist/` → `/var/www/bullrun-telegram-web/`.
- Никаких бэкенд-изменений, никаких изменений admin-v2.
- **Verify:** `/app/telegram-web/test123` показывает stub-страницу. `/app/` продолжает работать. Бэкенд не тронут.

### Phase 2 — Backend MTProto bridge + session endpoint + audit table
- **`backend/server.js` refactor (строки 101, 236):**
  ```js
  import { createServer } from 'http';
  import { WebSocketServer } from 'ws';
  // ... existing app setup ...
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/api/mtproto-bridge', maxPayload: 4 * 1024 * 1024 });
  wss.on('connection', (ws, req) => mtprotoBridgeService.handleConnection(ws, req));
  // заменить app.listen на httpServer.listen
  ```
- **New `backend/services/mtproto-bridge.service.js`:**
  - In-memory `Map<bridgeToken, { userbotId, ownerId, proxyConfig, fingerprint, sessionToken, expiresAt, createdAt }>` (TTL 5 мин, multi-use).
  - DC IP таблица НЕ нужна. GramJS резолвит DC IP из StringSession и передает его в `socket.connect(port, ip)` — bridge просто форвардит. Подтверждено Phase 0 spike.
  - `issueBridgeToken(userbotId, adminId, adminIp, userAgent)` → валидация ownership (`tg_accounts.owner_id`), decrypt session via `decrypt()`, parseSessionData, build proxy config via `_buildProxy(userbot)`, сгенерировать `crypto.randomBytes(32).toString('hex')`, сохранить в Map, записать в `telegram_web_audit`, вернуть `{ bridgeToken, wsUrl, sessionToken, fingerprint, expiresAt }`.
  - `handleConnection(ws, req)` → распарсить `bridge_token` из query, найти в Map (401 + close если нет/expired), повесить обработчики.
  - На первый text frame: распарсить `JSON.parse(data.toString())` → `{ip, port, dcId}`. Открыть raw TCP через `SocksClient.createConnection({ proxy: proxyConfig, destination: { host: ip, port } })` (использовать тот же `_buildProxy` output) → дождаться TCP connect → отправить обратно text frame `"ok"`. При ошибке — text frame `"error:<msg>"` + close. JSON-frame fallback: text `"ip:port"` парсится через `lastIndexOf(':')` для IPv6-совместимости.
  - **Использовать `socks` (SocksClient), не `socks-proxy-agent`** — последний плохо работает с IPv6 destination. Phase 0 spike использует `SocksClient.createConnection` напрямую, работает с IPv6 DC out-of-the-box.
  - Все последующие binary frames: `ws.on('message', (data) => tcpSocket.write(data))` и `tcpSocket.on('data', (chunk) => ws.send(chunk))`. Verbatim byte pipe.
  - Cleanup: на close любой стороны — `tcpSocket.destroy()`, log duration+bytes в audit, **НЕ** удалять токен из Map (multi-use). Token evictит TTL cleaner.
  - TTL cleaner: `setInterval` раз в минуту, удаляет expired tokens из Map.
- **New `backend/routes/userbot-web.routes.js`:** `POST /api/userbot/web-session/:userbotId` через `authenticateUser` + `rateLimit({ windowMs: 60_000, max: 5 })`. Заголовки `Cache-Control: no-store, private, max-age=0`. Возвращает JSON. Audit в `telegram_web_audit`.
- **New migration `NNN_telegram_web_audit.sql`:**
  ```sql
  CREATE TABLE telegram_web_audit (
      id BIGSERIAL PRIMARY KEY,
      admin_id UUID NOT NULL,
      userbot_id UUID NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('session_issued','bridge_opened','bridge_closed','token_expired','bridge_error')),
      dc_id SMALLINT,
      bytes_in BIGINT DEFAULT 0,
      bytes_out BIGINT DEFAULT 0,
      duration_ms BIGINT,
      error_code SMALLINT,
      admin_ip TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX idx_telegram_web_audit_admin ON telegram_web_audit(admin_id, created_at DESC);
  CREATE INDEX idx_telegram_web_audit_userbot ON telegram_web_audit(userbot_id, created_at DESC);
  ```
- **New `backend/test/test-mtproto-bridge.js`:** Node.js mock-клиент. Шаги: получить токен для реального test-userbot через REST → открыть WS → отправить 4-байт DC header → дождаться ACK → использовать GramJS Node-side client через patched transport → вызвать `messages.getDialogs` → ассерт: ненулевой список диалогов → close. Запуск: `node test-mtproto-bridge.js`.
- **Verify:** mock-тест проходит против локального бэкенда с реальным userbot. В `telegram_web_audit` появляются записи `session_issued` + `bridge_opened` + `bridge_closed`. PM2 restart сбрасывает Map (ожидаемо — браузер переподключится).

### Phase 3 — Vendored telegram-tt, minimal patches, read-only
- Подмодуль форка собран в `userbot-web/dist/`.
- **Минимальные патчи в `userbot-web/`** (пути файлов — upstream telegram-tt, **verify after `git submodule add`** в Phase 3 Step 1; до этого относиться как к approximate):
  1. **Transport injection** — заменить `PromisedWebSockets` (библиотека `telegram` внутри форка) на кастомный `BullrunBridgeSocket`, который:
     - В `connect(port, ip, testServers)` игнорирует ip/port, читает `BRIDGE_WS_URL` + `BRIDGE_TOKEN` из global scope.
     - Открывает WS на `${BRIDGE_WS_URL}?bridge_token=${BRIDGE_TOKEN}`.
     - На onopen отправляет 4-байт DC header (DC ID берётся из глобальной переменной, инициализированной из сессии).
     - Остальное (write/read/close) — как upstream. ~100 LOC (estimate).
  2. **In-memory session storage** — обёртка вокруг GramJS `MemorySession`, не использует IndexedDB для auth_key. ~60 LOC (estimate).
  3. **API_ID/HASH consistency** — при инициализации GramJS-клиента передавать `fingerprint.api_id` и `fingerprint.api_hash` из выданной сессии, НЕ использовать дефолтные от telegram-tt. Иначе Telegram увидит чужой api_id в `initConnection` и потенциально неконсистентный девайс-фингерпринт. ~20 LOC.
  4. **Auth flow bypass** — upstream `src/components/auth/Auth.tsx` (verify path) и весь связанный codepath удалены/заблокированы. Заменены на loading screen пока сессия применяется. ~-200 / +30 LOC (estimate).
  5. **App entry** (upstream `src/index.tsx` или эквивалент — verify): на старте — `indexedDB.deleteDatabase('gramjs')`, `localStorage.clear()` для неймспейса. Извлечь `userbotId` из URL `/app/telegram-web/:userbotId`. `POST /api/userbot/web-session/:userbotId` через fetch с Supabase-токеном из sessionStorage. Сохранить `bridgeToken`, `sessionToken`, `fingerprint` в window-scope. Инициализировать GramJS. ~100 LOC.
  6. **Branding** — upstream `index.html`, title, favicon, лого. ~10 LOC.
- **Mount в admin-v2:** на `UserbotCenterPage.jsx` рядом с `refreshCenterNow` (строка 1605-1616, проверено) добавить кнопку "Открыть в Telegram Web". При клике: `window.open('/app/telegram-web/' + selectedUserbotId, '_blank')`. ~10 LOC.
- **Read-only gate:** в форке временно скрываем send/edit UI через env flag `READ_ONLY=true`. Админ не может случайно отправить.
- **Verify:** админ выбирает userbot → жмёт "Открыть в Web" → в новой вкладке открывается Telegram Web с реальным списком чатов. Может листать, открывать диалоги, смотреть медиа. Не может отправить (read-only). DevTools → Application → IndexedDB: пусто (кроме служебных SW, которые отключим в Phase 5). Закрывает вкладку — bridge закрывается, audit пишет `bridge_closed`.

### Phase 4 — Full feature surface
- Включить send/edit/media/profile editing (env flag `READ_ONLY=false`).
- Вырезать лишнее из форка (upstream paths — verify после submodule add):
  - `src/components/left/main/LeftMain.tsx` — убрать "Add Account", Stories, Premium CTAs.
  - `src/components/middle/PremiumPreview*` — удалить полностью.
  - Contacts import hooks — stub.
  - QR/phone код — удалить полностью (уже частично сделано в Phase 3).
- IDB nuke on boot обязателен.
- **Verify:** end-to-end — админ отправляет тестовое сообщение в собственный аккаунт, сообщение приходит в реальный Telegram (проверить с другого устройства), ответ виден в UI. Редактирование профиля сохраняется. Загрузка картинки улетает, видна с другого устройства.

### Phase 5 — Edge cases hardening
- **WebRTC calls disabled** — UDP-трафик не через TCP-мост. Патч `Call*` компонентов (upstream paths — verify): no-op + тост "Звонки отключены в BullRun Web". ~30 LOC.
- **Web Push disabled** — upstream `src/util/notifications.ts` (verify path) early-return без запроса permission.
- **Service Worker disabled** — upstream `src/util/ServiceWorkerManager.ts` (verify path) skip registration. Без SW нет кэш-конфликтов с admin-v2.
- **Second-tab blocker** — `BroadcastChannel('bullrun-telegram-web')` heartbeat с userbot_id в имени канала. Если вкладка уже открыта для этого userbot — второй показывает блокер "Уже открыто в другой вкладке". ~25 LOC.
- **Reconnect UX** — на WS-close code 4001 (TCP died) или 1006 (network) — показывать кнопку "Переподключиться" + autorpo-retry с экспоненциальным backoff до 3 попыток, потом — запрос нового bridge_token через REST.
- **Multi-DC behavior check** — убедиться что patched socket корректно открывает несколько параллельных WS под одним bridge_token для main DC + file DCs (DC2/DC4 типично).
- **Verify:** все 6 сценариев прогнаны вручную.

### Phase 6 — Observability + audit UI
- **Bridge metrics** в существующем ops-логе или новая панель: active bridge count, bytes/sec, error rate, DC distribution. Структурированные логи: `[{bridgeId, userbotId, dcId, event, bytes}]`.
- **Audit UI** — на существующей странице admin-audit (`/admin-audit`) или ops-странице добавить таб "Telegram Web" с событиями из `telegram_web_audit`: когда/какой админ открывал чей userbot, длительность, объём трафика.
- **Health-check** — periodic job проверяет активные мосты, алерт при >0 errors в 5-минутном окне.
- **Verify:** ops dashboard показывает live bridge count. Audit-страница показывает свежие issuance events. Алерт срабатывает при kill моста.

### Phase 7 — Production rollout
- Stage — 1 неделя с одним доверенным админом, ежедневная проверка audit + ops + @SpamBot.
- Feature flag `TELEGRAM_WEB_ENABLED=false` (env):
  - REST endpoint возвращает 503.
  - WS upgrade reject с code 1008.
  - Кнопка в admin-v2 скрыта.
  - nginx location остаётся, но sub-app видит 503 от API.
- Rollout: env flip + PM2 restart, наблюдение 24 часа.
- **Verify:** 7 дней стабильной работы, 0 забаненных аккаунтов (через @SpamBot + existing userbot health checks в `/app/userbots`), 0 bridge-крашей в логах.

---

## Security & Safety

- **Session in browser** — неотъемлемо для Path 3 (MTProto требует auth_key на шифрующей стороне). Митигировано: 5-мин TTL на bridge_token, multi-use но in-memory only на стороне браузера (MemorySession, не IndexedDB), вкладка одна (BroadcastChannel lock), tab-close = wipe.
- **IP stability** — главный guardrail. Мост использует тот же SOCKS5-прокси, что и `createAuthorizedClient`. Худший исход = UI не работает, не бан.
- **Auth on REST and WS** — `authenticateUser` на `POST /web-session`, Origin validation на WS upgrade (только `/app` и `/app/telegram-web`).
- **Audit trail** — каждое issue/open/close/error залогировано в `telegram_web_audit` с admin_id, userbot_id, IP, user-agent, длительностью, объёмом трафика.
- **Rate limiting** — `rateLimit({ windowMs: 60_000, max: 5 })` на issuance (5 токенов в минуту на админа — достаточно для реконнектов, мало для абуза).
- **No IndexedDB persistence** — форк использует MemorySession. На старте каждого boot — `indexedDB.deleteDatabase('gramjs')`. Никаких утечек между аккаунтами.
- **API_ID/HASH consistency** — браузерный GramJS использует fingerprint из сессии (api_id, api_hash, deviceModel, systemVersion, appVersion, systemLangCode, langCode). Это критично: Telegram видит тот же api_id, что и при регистрации auth_key. Без этого риск `AUTH_KEY_INVALID` или неконсистентного device fingerprint.

---

## Testing & Verification

No automated test suite в проекте. Стратегия:

1. **Bridge integration test** (`backend/test/test-mtproto-bridge.js`) — единственный автоматизированный тест. Запускается вручную перед каждым деплоем бэкенда. Мок-клиент получает токен для реального test-userbot, открывает WS, интегрирует GramJS Node-client через patched transport, вызывает `messages.getDialogs`, ассертит ненулевой ответ. Это критический тест — мост = единственное место, где баги могут аффектить аккаунты.

2. **Per-phase manual checklist** — каждая фаза имеет явные шаги верификации. Фаза не закрывается без прохождения чеклиста.

3. **Observability-driven** — после Phase 6 production-алерты ловят всё, что пропустили ручные тесты.

---

## Rollback

Три слоя:

1. **Separate deploy artifact.** `/var/www/bullrun-telegram-web/` независимо от `/var/www/bullrun-admin-v2/` и `/var/www/bullrun-backend/`. Откат фронтенда = `rsync` предыдущего dist (через `ops/scripts/rollback.sh --telegram-web <timestamp>`). Откат бэкенда = revert server.js + delete bridge service + PM2 restart.

2. **Feature flag.** `TELEGRAM_WEB_ENABLED=false` → REST 503 + WS reject + кнопка скрыта. Без редеплоя, env-flip + PM2 restart.

3. **nginx kill switch.** `location ^~ /app/telegram-web/ { return 404; }` — мгновенно, на уровне nginx, без приложения.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Backend bridge crash loops → UI freezes | Medium | Feature flag, separate deploy, reconnect UX |
| Session bytes leak to disk via IDB | High | MemorySession only + nuke IDB on boot |
| Second-tab cache corruption | Medium | BroadcastChannel tab-lock |
| Calls UI crashes when UDP unreachable | Low | Calls disabled in fork |
| Backend memory bloat (many bridges) | Low | ~200KB/bridge budget; admin scale never an issue |
| WS upgrade blocked by intermediary proxies | Low | Use port 443 wss; nginx TLS-terminates upstream |
| Auth-key exposure in browser memory | Medium (accepted) | Inherent to Path 3; mitigated by single-tab lock + 5-min TTL + admin-only access |
| Account IP change | Critical → mitigated | Bridge uses same SOCKS5 as backend — worst case UI broken, not ban |
| Upstream telegram-tt breaking changes | Low | Pin submodule to tag; quarterly merge review |
| API_ID/HASH mismatch → AUTH_KEY_INVALID | Medium → mitigated | Pass fingerprint from session to browser GramJS init |
| WS max payload exceeded on large file transfer | Low | `maxPayload: 4MB` on WebSocketServer; large files use multiple frames |
| nginx timeout on long-lived WS | Low | Add `proxy_read_timeout 86400;` to /api/ location if needed |

---

## Effort estimate

Все LOC-оценки — **грубые приближения** (estimates), не точные измерения. Время — субъективная оценка.

- **Backend (Phase 2):** ~750 LOC new (bridge service + route + migration + test) + 1 file refactor (server.js)
- **telegram-tt fork patches (Phases 3-5):** ~330 new LOC, ~600 deletions
- **admin-v2 integration (Phase 3):** ~15 LOC
- **Observability (Phase 6):** ~150 LOC + UI tab
- **Total:** ~1250 new LOC, ~600 deletions, 7 phases, **3-5 недель работы с тестированием** (subjective)

Каждая фаза independently deployable. На любом этапе можно остановиться без регрессий для существующего `/app/userbot-center`.

---

## Verification Status (что подтверждено против реальных файлов)

**Подтверждено прямыми чтениями (Read/Bash):**
- `backend/server.js:101` — `const app = express()` ✓
- `backend/server.js:236` — `app.listen(PORT, ...)` ✓
- `backend/middlewares/auth.middleware.js:11` — `authenticateUser` (export) ✓ (также есть inline-дубликат в server.js:109, canonical — из middleware)
- `backend/middlewares/rate-limit.middleware.js:7` — `rateLimit({ windowMs, max, message })` ✓
- `backend/services/userbot.service.js:421` — `parseSessionData(decryptedData)` → возвращает `{ token, fingerprint }` ✓
- `backend/services/userbot.service.js:648` — `_buildProxy(proxyData)` → `{ ip, port, socksType: 5, username?, password? }` ✓
- `backend/services/userbot.service.js:1648` — `createAuthorizedClient(userbot, retries = 1)` ✓
- `backend/utils/crypto.js:59` — `decrypt(text)` returns UTF-8 string ✓
- `backend/routes/userbot.routes.js:3401` — `/admin-audit` route (делает live scan через GramJS, **НЕ** таблица) ✓
- `admin-v2/src/api/client.js:3` — `apiRequest(path, { accessToken, method = 'GET', body, signal })` ✓
- `admin-v2/src/pages/UserbotCenterPage.jsx` — проверен полностью; кнопка "Проверить сейчас" на строках 1605-1616 ✓
- `ops/nginx/bullgram.xyz.conf` — проверен полностью:
  - строки 18-28: `location /api/` уже с WS Upgrade/Connection headers ✓
  - строка 66: `location ^~ /app/assets/` (прецедент для нового location) ✓
  - строки 77-80: `location /app/` (нужный нам target для precedence) ✓
  - домен продакшена = `bullgram.xyz` ✓
- `ops/scripts/deploy-v2.sh` — проверен полностью: rsync pattern, server `root@64.188.70.180`, `/var/www/bullrun-admin-v2/` ✓
- `backend/node_modules/telegram/extensions/PromisedWebSockets.js:54` — `getWebSocketLink(ip, port, testServers)` ✓ (полный класс прочитан, contract понятен: connect/write/read/close)
- `backend/node_modules/telegram/client/telegramBaseClient.js:26` — `DEFAULT_IPV4_IP = "149.154.167.91"` для Node ✓

**Public knowledge (НЕ из локальных файлов, помечено в плане):**
- Telegram DC IPs DC1-DC5 (из [core.telegram.org/dcs](https://core.telegram.org/dcs), не из GramJS source)
- Структура репозитория Ajaxy/telegram-tt (upstream paths типа `src/components/auth/Auth.tsx`) — будет верифицировано после `git submodule add` в Phase 3 Step 1
- GPL-3.0 лицензия Ajaxy/telegram-tt (подтверждено через WebSearch)

**Оценки (estimates, не факты):**
- LOC-цифры по фазам — грубые приближения
- "3-5 недель" — субъективная оценка, не фактическое измерение
- Memory budget "~200KB per bridge" — теоретическая оценка, не замер

**Что НЕ верифицировано (появится в ходе имплементации):**
- Точные пути файлов в форке telegram-tt до подключения submodule
- Реальная совместимость patched `PromisedWebSockets` с браузерным GramJS (потребует Phase 3 прототипа)
- Поведение GramJS при multi-DC concurrent WS-connections под одним bridge_token (verify в Phase 5)
- Реальный memory budget per active bridge (verify в Phase 6 observability)
