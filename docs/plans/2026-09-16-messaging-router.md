# Универсальный роутер исходящих сообщений (messaging router)

Дата: 2026-09-16. Статус: **в реализации** (владелец: «построй план, выступай оркестратором, закрывай бэклог»). Миграция `20260916210000` применена (`userbot_send_log` + `tg_accounts.dm_paused_until/dm_pause_reason`, эталон: `backend/sql/messaging-router.sql`).

## План реализации (чеклист)

Контракт ядра (фиксирую для срезов, чтобы волны шли параллельно без дрейфа):

```js
// backend/services/messaging-router.service.js
export function resolveMessagingCaps(env) → { hourlyCap, dailyCap, jitterPercent } // env: USERBOT_DM_HOURLY_CAP=20, USERBOT_DM_DAILY_CAP=50, USERBOT_DM_JITTER_PERCENT=20
export function estimateCapacity({ audienceSize, poolSize, dailyCap }) → { audienceSize, poolSize, dailyCap, botsNeeded, days }
export function isActorEligible(account, { now }) → bool // не pending_activation/restricted/expired, dm_paused_until в прошлом; прокси-живость фильтрует вызывающий
export class MessagingRouter { // deps: { supabase, sleep, now, random }
  async countSends(actorId, { since }) → int            // status='sent' из userbot_send_log
  async isUnderQuota(actorId, { now }) → { ok, reason }  // час+день по caps
  async getActorPause(accountId) / pauseActor(id, until, reason) / clearPause(id) // tg_accounts.dm_paused_until
  async recordSend({ ownerId, actorType='userbot', actorId, campaignId=null, tgUserId, status, errorKind=null, idempotencyKey=null })
  async deliver({ ownerId, tgUserId, text, pool, baseDelayMs=5000, touchpointActorId=null, commonChatId=null, eventSource }) → { status:'sent'|'failed', actorType, actorId, errorKind, errorText }
  // ротация: touchpoint-актёр первым → далее по минимуму sent (квота); пропуск неэлигибельных/на паузе/исчерпавших квоту;
  // flood_wait → pauseActor(retry_after+30s,'flood_wait'); account_flagged/session_revoked/spam → pauseActor(now+24h, reason);
  // каждая попытка → recordSend; джиттер ±jitterPercent между попытками (не перед первой)
}
```

- [x] Миграция 20260916210000 применена; эталонный SQL в backend/sql/ (+ 20260916220000: индекс идемпотентности скоуплен на владельца)
- [x] **A. Ядро:** `messaging-router.service.js` + `routes/messaging.routes.js` (`GET /api/messaging/capacity`, `POST /api/messaging/send` с idempotency_key, гейт USERBOT_DM_ENABLED) + монтаж в server.js + .env.example + backend/README.md + `backend/test/test-messaging-router.js` + npm script `test:messaging`
- [x] **E. Join-метод «инвайт от юзербота-админа»:** в `joinUserbotToChannel` (contour-admin-rights.service.js) после провала официального бота — найти юзербота владельца-админа цели (sales_contour_actor_rights state ok / диалоги), экспортнуть инвайт им, ImportChatInvite; тесты в test-contour-admin-rights.js
- [x] **B. Broadcast на роутер:** jobs/broadcast-delivery.job.js + services/broadcast-delivery.service.js → router.deliver (квоты, паузы, джиттер, автопауза актёров); POST /api/broadcast/campaigns/:id/cancel; если актор-пул пуст целиком → кампания failed с понятной meta.queue_error; чисто-юзерботные кампании при исчерпании квот тянутся по тикам (pending переигрывается — существующая семантика)
- [x] **C. Остальные отправители через роутер:** retention (контурный пул вместо loadLatestUserbot + common_chat_id из канала подписки), auto-kick DM, abandoned-фолбэк за новым флагом USERBOT_ABANDONED_DM_ENABLED=false
- [x] **D. UI:** шаг «Юзерботы» рассылки — предупреждение ёмкости (GET /api/messaging/capacity); кнопка «Стоп» кампании; на /app/bases — чипы «права актёров» на карточках каналов из /api/official-bot/contours (+ actor_rights_by_target в эндпоинте)
- [x] Гейты: `test:*` зелёные, admin build, check:design, код-ревью, пуш, CI
- [x] Ревью-секция здесь + закрытие BACKLOG §12

## Задача владельца

Пользователь собрал платящую аудиторию в TG. На странице рассылки презентует новый товар,
добавляет своих юзерботов (разрешено, они админы в разных группах). Нужно:

1. юзерботы умеют вступать в группы друг друга **разными способами, пока не добьются успеха**;
2. система **понимает, до кого они могут дотянуться**, и строит базу;
3. **ротация** отправителей, чтобы TG их не заблокировал;
4. на странице — **предупреждение о ёмкости**: «база слишком большая, для неё нужно 10 юзерботов, а не один» — иначе кто-то будет писать всем одним ботом и словит бан.

Плюс запрос владельца: «отдельный роутер на отправку сообщений» — единая точка исходящих.

## Что показало исследование (4 Explore-агента, 2026-09-16)

### /app/bases
- Две панели: AudiencePanel (`channel_audiences*`, синк по каналу продаж) и ClientBasesPanel (`client_bases*`, ручные базы) — `admin-v2/src/pages/bases/`.
- Синк: `getParticipants(limit:5000)` одним вызовом в HTTP-запросе (`channel-audiences.routes.js:486`); дневной job 03:00 пагинированный по 100/чанк с 300ms (`audience-sync.job.js:16-33`).
- `userbot_peer_cache` уже копит access_hash на пару (юзербот, tg_user_id) — `utils/peer-cache.js`.
- Питает рассылку (`buildAudience` в `broadcast.routes.js:119-199`), CRM, shop.

### /app/broadcast
- Мастер из 4 шагов: База → Юзерботы → Подготовка → Отправка (`BroadcastPage.jsx`).
- **Карта достижимости уже существует** — подготовка: скан диалогов →.join в чужие группы с квотами (4/час, 45s jitter, flood-паузы, `userbot_join_log`) → `broadcast_preparation_items.reachable_by` (touchpoints confirmed/probable/unreachable на юзербота) — `broadcast-preparation.service.js`.
- Отправка: очередь `broadcast_deliveries`, тик 30s, **фиксированные 5s на получателя**, round-robin по пулу с приоритетом confirmed-touchpoint (`broadcast-delivery.service.js:64-176`), Spambot-пре-чек перед каждым юзербот-отправлением.
- Чего нет: jitter на отправке, FLOOD_WAIT-бэкпрешшер в цикле доставки, персональные дневные/часовые квоты на юзербота, стоп работающей кампании, автопрекращение при сигналах бана.

### /app/retention и /app/abandoned
- Оба — крон-jobs прямо в коде, без REST: `retention.job.js` (5 мин, бот → юзербот-фолбэк под `USERBOT_RETENTION_DM_ENABLED`), `abandoned-cart.job.js` (15 мин, **только бот**, фолбэка нет).
- Баг рассинхрона: retention UI показывает контурного хелпера, а job шлёт через `loadLatestUserbot` (новейший юзербот) — **может уйти не тот аккаунт**.
- Ретеншн-фолбэк вызывает `sendMessage` без `common_chat_id` — скан общей группы не выполняется, копия в UI обещает больше, чем делает код.
- Пейсинга нет нигде: сообщение за сообщением, новое GramJS-соединение на каждое.

### Инвентарь примитивов (backend)
- Фабрика клиентов: `createAuthorizedClient` (`userbot.service.js:1700-1732`) — расшифровка сессии, SOCKS-прокси, IPv6-DC, `_updateLoop` выключен, disconnect в finally. Используется всеми, но eligibility-фильтр юзерботов скопирован в ~6 местах.
- Join-методы: username → `JoinChannel`; invite-hash → `ImportChatInvite` (`joinChatByInvite`, `userbot.service.js:2144`). **Мульти-методный** уже есть в контуре: username → ссылка от официального бота → `ImportChatInvite` → revoke (`contour-admin-rights.service.js:796-850`). Чего нет: инвайт от **юзербота-админа** (когда официального бота в группе нет).
- Квоты: только на join (`USERBOT_JOIN_PER_HOUR` через `userbot_join_log`). На отправку ЛС квот нет.
- Классификация ошибок: `utils/telegram-error-events.js` (flood_wait, account_flagged, session_revoked, privacy_restricted…), карантин restricted-юзерботов 72ч — есть.
- `sales_contour_actor_rights` — готовый прецедент «гарантия прав по матрице актор×площадка» + монитор 12h в repair-режиме.

**Вывод: ~80% запрошенного уже построено, но россыпью. Новую параллельную систему не строим — консолидируем в один роутер.**

## Дизайн

### Ядро: `backend/services/messaging-router.service.js`

Одна точка, через которую идут все исходящие ЛС (broadcast-доставка, retention-фолбэк, auto-kick DM, abandoned-фолбэк, ручная отправка, будущий MCP):

1. **Единый eligibility-фильтр** актёров (владелец, не shop-reserved, не `pending_activation`, не restricted, прокси жив) — вместо 6 копий.
2. **Реестр пауз актёров** (`messaging_actor_pauses` или колонки в tg_accounts): flood_wait → пауза на `retry_after`+30s; Spambot подтвердил блок → актёр выведен из ротации до ручной проверки. Пауза персистентна (переживает рестарт).
3. **Леджер отправок** `userbot_send_log` (owner_id, actor_type, actor_id, tg_user_id, status, error_kind, created_at): источник квот + аудит + защита от дубля по ключу.
4. **Квоты**: `USERBOT_DM_HOURLY_CAP` (дефолт 20) и `USERBOT_DM_DAILY_CAP` (дефолт 50) на юзербота — считает из леджера; исчерпан → актёр пропускается, берётся следующий из пула.
5. **Ротация**: round-robin + приоритет confirmed-touchpoint (перенос из `broadcast-delivery.service.js` как есть) + пропуск актёров на паузе/квоте. Джиттер ±20% поверх базовой задержки.
6. **Реакция на бан**: Spambot-блок актёра → кампания не падает, пул сжимается; пул пуст → кампания в `paused_no_actors` + тост/баннер владельцу. Повторные account_flagged → актёр в restricted по существующему конвейеру.
7. **Оценка ёмкости**: `estimateCapacity({ audienceSize, poolSize })` → `{ botsNeeded, days }` по дневной квоте. Чистая функция, константы из env.

### Миграция

`userbot_send_log` (RLS owner-only, индекс `(actor_id, created_at)`), аналог по образцу `userbot_join_log`. Реестр пауз — колонки `dm_paused_until timestamptz, dm_pause_reason text` на `tg_accounts` (миграция + `.maybeSingle()` чтение в сервисе).

### Роут: `backend/routes/messaging.routes.js` → `/api/messaging`

- `GET /capacity?audience_size=N` — оценка для UI ( bases и broadcast).
- `POST /send` — точечная отправка с `idempotency_key` (бот | юзербот | авто-пул); существующие флаги (`USERBOT_DM_ENABLED` и др.) остаются единственными воротами, роутер их не ослабляет.
- Существующий `POST /api/broadcast/send` контракт не меняется — job доставки переходит на сервис роутера изнутри.

### UI (запрошенное предупреждение)

Шаг «Юзерботы» в `BroadcastPage.jsx` (и малый бейдж на шаге «База» при размере > порога):

> «База N контактов. Один юзербот безопасно пишет ~50 ЛС в день. Для рассылки за 1 день нужно ~X юзерботов — у тебя Y, растянется на D дней. Больше юзерботов → меньше риск бана.»

Данные: `GET /api/messaging/capacity` + размер базы из превью, которое уже грузится.

### Фазы

- **Фаза 1 (ядро + видимая ценность):** сервис-роутер, миграции (леджер + паузы), перевод `broadcast-delivery.job.js` на роутер (jitter, квоты, flood-пауза, Spambot-автовывод), `/api/messaging/capacity`, предупреждение ёмкости в broadcast UI, тесты `test:messaging`.
- **Фаза 2 (все отправители через роутер):** retention-фолбэк (заодно: слать контурным пулом, а не `loadLatestUserbot`; передавать `common_chat_id` контурных площадок), auto-kick DM, abandoned-фолбэк за новым флагом `USERBOT_ABANDONED_DM_ENABLED` (false), ручной DM из ops-center. Кнопка «Стоп» у активной кампании.
- **Фаза 3 (полный workflow владельца):** join-метод «инвайт от юзербота-админа» в `joinUserbotToChannel` (закрывает случай, когда официального бота в группе нет) и в preparation phaseJoin; живая карта покрытия актор×чат (пишется монитором 12h и preparation) → бейджи «до кого дотягивается» на /app/bases.

## Инварианты (не трогаем)

- manual-by-default: ни одна автоотправка не включается без существующих флагов; роутер не добавляет автоактивность.
- Spambot — источник истины; safe-mode/pending_activation исключён; 1 proxy = 1 userbot; userbot'ам не выдаётся can_promote_members.
- Trial-гейт на рассылку остаётся; owner_id скоуп везде.

## Открытые константы (дефолты можно менять без правок кода)

`USERBOT_DM_HOURLY_CAP=20`, `USERBOT_DM_DAILY_CAP=50`, jitter ±20%, порог предупреждения = poolSize×dailyCap. Owner может поднять/опустить env'ом; warmup-профили для новых юзерботов — за рамками (backlog).

## Ревью

Реализовано 2026-09-16, коммит a61f440 (деплой пушем в main, CI + deploy-pull.sh).

**Сделано сверх плана:** скоуплен на владельца индекс идемпотентности (миграция 20260916220000); flood-pause зеркалится на in-memory объект пула (иначе пауза невидима до перезагрузки пула и остаток тика долбит flood-аккаунт и помечает получателей failed навсегда); в /contours добавлен `actor_rights_by_target` из `sales_contour_actor_rights` — без него чипы на базах видели только официальный бот.

**Код-ревью (staff, adversarial):** REJECT → исправлены все 3 P1 (зеркало паузы; owner_id на пре-чеке идемпотентности; owner_id на кандидатах peer-invite) и 4 P2 (owner-скоуп пауз, ключ идемпотентности только на первой попытке, status-гард на прогресс-апдейте, показ ёмкости при пустом пуле). Повторный прогон всех гейтов зелёный.

**Проверено:** test:messaging 76, test:broadcast 75, test:lifecycle 36, test:contours 12, test:sales 80, test:autopost — все зелёные; admin build PASS; check:design PASS (ratchet не вырос).

**Хвосты (BACKLOG §13):** видимость пауз юзерботов для владельца в UI (сейчас пауза видна только косвенно через ёмкость); prod-проход по браузеру владельца (ёмкость, «Стоп», чипы) по browser doctrine; e2e-наблюдение первой реальной рассылки (flood → quotaWait → догонка на следующем тике).
