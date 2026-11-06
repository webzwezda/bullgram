# План: привести репозиторий под pre-commit хук (волновая разрезка oversized-файлов)

Дата: 2026-11-06. Статус: план на утверждении владельцем.
Триггер: `.githooks/pre-commit` — лимит 5000 токенов (20 000 байт, размер файла
ЦЕЛИКОМ; семантику не менять — решение владельца в AGENTS.md).

Уже сделано (утверждено владельцем 2026-11-06): исключения в `IGNORE_RE` —
`docs/plans/`, `LICENSE`, `*/src/styles/app.css` (коммиты 7d60db1, 138c9cf);
`git config core.hooksPath .githooks` активен.

## 1. Аудит (снимок 2026-11-06)

| Категория | Файлов | Судьба |
|---|---|---|
| Всего >20 000 байт | 107 | — |
| Бинарные (картинки/шрифты) | 29 | хук пропускает сам, не трогаем |
| `docs/plans/*.md` | 10 | исключение (не режем) |
| `*/src/styles/app.css` | 5 | исключение (ui-sync, байт-в-байт) |
| `LICENSE` | 1 | исключение |
| `AGENTS.md` | 1 | вне очереди: не резать и не исключать (решение владельца); правки через `--no-verify` |
| Спорные (вопрос владельцу, §7) | 2 | `backend/README.md`, `design/tokens/color.primitives.json` |
| **Рабочая очередь (кодовые)** | **59** | разбиты на 12 волн ниже |

Очередь по областям: backend routes ×10, backend services ×10, backend jobs ×4,
`server.js` ×1, backend test ×11, admin-v2 ×10, userbot-v2 ×9, site-v2 ×3,
bots-v2 ×1.

## 2. Инфра-факты, влияющие на план (проверено 2026-11-06)

1. **hook активен**: `core.hooksPath = .githooks`.
2. **gate-07 console-ratchet — per-file**: рост total ИЛИ любого файла блокирует
   CI. Переезд `console.*` в новый файл при том же total = FAIL (новый файл
   начинает с allowed 0). → **каждая backend-волна завершается осознанным
   `node ops/scripts/ci/console-ratchet.mjs --update-baseline`** (total не
   растёт — рамка №5 соблюдается; обоснование в сообщении коммита гейта).
3. **design hardcodes-ratchet — тоже per-file** (`design/lint-baseline.json`):
   переезд JSX с захардкоженными классами в новый файл = FAIL. → фронт-волны
   при необходимости делают `node design/check-design.mjs --update-baseline`
   (только когда total не вырос).
4. **ui-sync файлы не в очереди**: `src/components/ui/*`, `OpsRail.jsx`,
   `productTier.js`, `log-capture.js` — все <20КБ, план их не трогает (рамка №3
   остаётся страховкой на будущее).
5. **Тест-цепочки**: `backend/package.json` ссылается на точные пути тестов
   (`test:autopost` — цепочка из 10, `test:mcp` — из 4, `test:sales` — из 2).
   Разрезка тестов (волна 12) обязана обновить цепочки в том же шаге.
6. **Реальный цикл**: `contour-admin-rights.service ⇄ sales-contour.service`
   (contour импортирует `SalesContourError, normalizeBotKind`; sales-contour —
   `classifyTelegramError`). Оба режутся в одной волне 4; цикл сохраняется как
   есть через фасады, общие чистые функции при надобности уезжают в leaf-модули
   (поведение не меняется).
7. **Кросс-импорт route→route**: `customers.routes.js → official-bot.routes.js`
   (`getBotById`). Фасад official-bot.routes.js сохраняет named-экспорт.
8. **Прецеденты доменных папок**: в `services/` есть (`official-bot/`,
   `autopost/`); в `routes/` папок нет — вводим `routes/<name>/` (паттерн
   одобрен владельцем: «userbot.routes.js → routes/userbot/<area>.js»).
9. `botFatherCreateBotInFlight` Map (userbot.service.js:3260) и
   `proxyCheckCooldown` Map (userbot.routes.js:495) — mutable module state,
   каждый переезжает ровно в один модуль вместе со своим потребителем.
10. Side-effect `fs.mkdirSync(SHOP_RECEIPTS_DIR)` при импорте (shop.routes.js
    ~:23) — остаётся в одном модуле-владельце.

## 3. Паттерны разрезки (все — behavior-preserving)

- **routes-фабрика** (`export default function(supabase)`): подмодуль
  `export function registerX(router, ctx)`; `routes/<name>/index.js` —
  агрегатор, регистрирующий модули **в исходном порядке файла**; старый файл —
  фасад `export { default } from './<name>/index.js'` (+ реэкспорт named).
  `server.js` и прочие импортёры не меняются.
- **service-класс**: mixin-композиция `export const XMixin = (Base) => class
  extends Base { /* методы verbatim */ }`, фасад собирает цепочку; named
  чистые функции — в leaf-модули с реэкспортом через фасад. Альтернатива
  (функции + делегаты) — там, где миксин не нужен.
- **jobs**: подмодуль-хелперы с сигнатурами `(supabase, …)` / `(deps, …)`;
  DI-сигнатуры `start*` не менять (тесты подменяют `messagingRouterOverride`).
- **React-страница**: sibling `sections/`, `hooks/`, `utils/` внутри той же
  папки; страница сохраняет default/named export (App.jsx не меняется);
  reqId-ref уезжает вместе со своей загрузкой.
- `console.*` переезжает вместе с кодом; миграция на `utils/logger.js` —
  только отдельными коммитами (правило «трогаешь файл — мигрируй логи»).
- **Порядок регистрации подроутеров = исходный порядок** (критично:
  `DELETE /proxies/:id` раньше дженерика `DELETE /:id`; в official-bot.routes
  `/contours*` раньше `/:accountId*`, `/add` раньше `/:accountId/token`).

## 4. Цикл одной волны (рамка №2, обязателен для каждой волны)

- [ ] сверить швы с актуальными строками файлов (карта ниже — от 2026-11-06);
- [ ] разрезка шагами: новый модуль — обычный коммит (проходит хук);
      уменьшение легаси-файла — `git commit --no-verify` с сообщением
      `refactor(split): <file> → <path> (волна N, k/total)`;
      каждый промежуточный коммит рабочий;
- [ ] проверки: `node --check` всех изменённых .js; `npm run build` затронутых
      аппов; профильные backend-тесты волны; `npm run check:design` при
      троганье общих файлов; гейты CI (`npm run ci:source`);
- [ ] осознанные обновления baseline (gate-07 и/или design), total не растёт;
- [ ] push в main (деплой GitHub Actions → `scripts/deploy-pull.sh`);
- [ ] проверка на проде: pm2 online, `app.err.jsonl` чист, смоук затронутых
      эндпоинтов / страницы в реальном Chrome владельца (не headless);
- [ ] отчёт владельцу: Scope / Changed / Validated / Risks / Needs + сводка
      «вышло из зоны / осталось»;
- [ ] **ОК владельца → следующая волна (новая сессия по этому доку).**

## 5. Волны

### Волна 1 — backend мелочь, 11 файлов (20.3–26.2 КБ) — СЕССИЯ ЭТОГО ПЛАНА

| Файл | КБ | Шов |
|---|---|---|
| services/autopost/handlers/queue-callbacks.js | 20.3 | text-input handler (L260–392) + `pluralizeChannels` → `handlers/queue-text-input.js`; вход `handlers/index.js` не меняется |
| services/autopost/handlers/admin-commands.js | 20.6 | seed-кластер (L239–315) → `handlers/seed-reactions.js`; `resolveActiveChannel` → `handlers/active-channel.js` (импортируют оба) |
| services/sale-scan.service.js | 21.0 | `isMissingShopTablesError`+`attachListedItemIds`+`sweepStaleScans` (L124–188) → `sale-scan/scan-maintenance.js`; реэкспорт (shop.routes и тест импортируют по имени) |
| services/official-bot/handlers/admin.handler.js | 22.4 | gift-code кластер (L205–313) → `handlers/admin-gift-codes.js`; вход `handler-registry.js` не меняется |
| jobs/broadcast-delivery.job.js | 22.5 | 5 чистых supabase-операций (claim/load/fail/isStillOurs/finalize, ~6.9КБ) → `broadcast-delivery/campaign-ops.js` |
| routes/client-bases.routes.js | 22.6 | GET /:id/members (L166–382) → `client-bases/members-list.js`; `loadOwnedBase` → `client-bases/ownership.js` |
| jobs/retention.job.js | 23.1 | pool-хелперы+маркировка (L27–112) → `retention/helpers.js`; при тесноте + сборка текста (L151–239) → `retention/reminder-text.js`; DI `startRetention` не менять |
| jobs/broadcast-membership-cleanup.job.js | 25.2 | telegram-слой (L40–255) → `broadcast-membership-cleanup/telegram-ops.js` (всё module-level, ноль замыканий) |
| jobs/abandoned-cart.job.js | 26.1 | хелперы (L19–99) → `abandoned-cart/helpers.js` + юзербот-фолбэк (L311–388) → `abandoned-cart/userbot-fallback.js`; DI не менять |
| routes/customers.routes.js | 26.2 | хелперы (L6–115) → `customers/access-source.js`; POST /direct-access (L121–221) → `customers/direct-access.js` (импорт `getBotById` уезжает туда) |
| server.js | 23.5 | inline payment-settings роуты (L252–362) → `routes/payment-settings.routes.js` (mount на том же месте); регистрация cron (L393–444) → при тесноте `jobs/register-cron.js` |

Проверки: `node --check` всех изменённых; `npm run test:autopost`,
`test:lifecycle`, `test:broadcast-cleanup`, `test:sale-scan`; gate-07
`--update-baseline` (осознанно). Прод: смоук `/api/userbot/*` ключевых,
`/api/customers/workbench`, автопостер-бот жив.

### Волна 2 — фронт мелочь, 11 файлов (20.6–29.1 КБ)

userbot-v2 (7): McpSettingsPage 20.6, SessionsQuarantineSection 20.7,
UserbotStorefrontSection 20.9, ProxyStorefrontSection 22.8,
UserbotOnboardingSection 24.5, AccountLotsSection 25.5, ProxyConnectPanel 28.9.
site-v2 (2): HomePage 24.6 (секции героя/доступа в `sections/`), CreateInvoicePage 24.8.
admin-v2 (2): ClientBasesPanel 27.1, AudiencePanel 29.1.
Швы: карта на старте волны (паттерн: крупнейшая секция/панель → sibling-файл,
страница сохраняет export). Проверки: build userbot-v2 + site-v2 + admin-v2,
`check:design`, прод-страницы в реальном Chrome. Design-baseline — при
необходимости.

### Волна 3 — backend средние роуты, 6 файлов (30–75 КБ)

| Файл | КБ | Шов |
|---|---|---|
| routes/channel-audiences.routes.js | 30.1 | members (L264–448) + sync (L449–617) → `channel-audiences/{members,sync}.js`, лоадеры в deps |
| routes/dashboard.routes.js | 36.3 | монолитный GET / (L100–577) декомпозировать по шву «загрузка → агрегация»: `dashboard/summary-loader.js` + `dashboard/metrics-builder.js`, handler остаётся один |
| routes/broadcast.routes.js | 40.1 | buildAudience (L93–435) → `broadcast/build-audience.js`; campaigns (L436–789) → `broadcast/campaign-routes.js` |
| routes/autopost.routes.js | 42.3 | checklists (L530–714) + items/channels (L715–867) → `autopost/{checklist-routes,item-routes}.js`; `findOwnedBot`/`sanitizeBot` в deps; тест `test:mcp` (mcp/tools зовут эти роуты) |
| routes/official-bot.routes.js | 62.5 | webhook (L212–455) + contours/channels (L760–1087) + bot-management (L456–759) → `official-bot/{webhook,contours,bot-management}.js`; синглтоны L16–17 не дублировать; named `getBotById`/`initAllBots`/`buildActorRightsByTarget` реэкспорт (customers.routes и server.js); порядок: contours раньше `/:accountId*`, add раньше `/:accountId/token`; проверка `test:contours` |
| routes/referral.routes.js | 75.5 | TON-payload билдеры (L63–314) + reserve-refunds (L315–740) + payout-ops (L741–1156) → `referral/{ton-payloads,reserve-refunds,payout-ops}.js`; overview (L1157–1477) при тесноте |

### Волна 4 — backend средние сервисы, 5 файлов (39–92 КБ)

| Файл | КБ | Шов |
|---|---|---|
| services/autopost.service.js | 39.2 | checklist-методы (L418–771) → `autopost/checklist-ops.js`; publish/reaction (L233–417) → `autopost/publish.js`; сигнатуры методов класса не менять (10 файлов mcp/tools зовут) |
| services/contour-admin-rights.service.js | 52.6 | ensureUserbotTarget (L467–726) → `contour-admin-rights/userbot-target.js`; join/invite-хелперы (L727–988) → `contour-admin-rights/join-invites.js`; persistence (L989–1149) при тесноте |
| services/broadcast-preparation.service.js | 58.0 | phaseScan (L549–827) + phaseJoin (L828–1037) → `broadcast-preparation/{phase-scan,phase-join}.js`; phase-recompute (L1038–1163) при тесноте; `test:broadcast-cleanup` импортирует файл — фасад обязателен |
| services/sales-contour.service.js | 64.6 | normalize (L1–460) → `sales-contour/normalize.js` (реэкспорт `SalesContourError/normalizeBotKind` — их зовёт contour); loaders (L479–696) → `sales-contour/loaders.js`; join-all движок (L920–1284) → `sales-contour/join-all.js` |
| services/official-bot.service.js | 92.4 | tariff-форматтеры (L166–356) + access/gift (L357–826) + notify (L827–1207) + referral-награды (L1322–1934) → `official-bot/{tariff-format,access-gifts,referral-notify,referral-rewards}.js`; `activeBots` Map — в одной зоне целиком; 12 импортёров через фасад |

Развязка цикла contour⇄sales-contour: сохранить как есть через фасады; новые
leaf-модули (`normalize.js`, `classify`) не импортируют друг друга. Проверки:
`test:sales`, `test:contours`, `test:autopost`, `test:broadcast-cleanup`,
`test:mcp`.

### Волна 5 — МОНСТР: routes/userbot.routes.js (229 КБ, 4913 строк)

Разрезка на ~20 подмодулей `routes/userbot/*.js` + `index.js`-агрегатор
(регистрация строго в исходном порядке; старый файл — фасад, server.js не
меняется; каждый шаг = отдельный коммит, «(волна 5, k/21)»).

| Модуль | Источник (строки) | ~КБ |
|---|---|---|
| helpers-core.js | 74–109, 474–477, 588–702, 1139–1177, 1303–1393 | 11.0 |
| helpers-proxy.js | 287–587 (вкл. Map `proxyCheckCooldown` L495), 703–785, 1090–1138 | 14.5 |
| helpers-lease.js | 786–1089 (trial-proxy lease) | 10.0 |
| helpers-center.js | 140–286, 1178–1359 | 12.3 |
| proxies-list.js | head + GET /proxies, /proxies/managed-health, /agent/infra-summary, /agent/proxy-intake (1404–1715) | 12.4 |
| proxies-crud.js | POST/DELETE /proxies, GET /proxies/check (1716–2065) | 17.2 |
| proxies-bind.js | /bind-proxy, /import-session-file (2066–2228) | 8.3 |
| sessions.js | import-session-file + multer `upload` (2229–2405) | 9.1 |
| intake.js | intake/batch + multer `intakeUpload` (2406–2602) | 9.9 |
| qr.js | qr-start/status/password (2603–2807) | 10.4 |
| profile.js | profile/:id sync+update (2808–3068) | 11.9 |
| lifecycle.js | DELETE /:id, restore, safe-mode, custom-label (3069–3351) | 13.1 |
| health-check.js | GET /check/:id (3352–3655) | 17.0 |
| sync-audit.js | sync-channels, admin-audit (3656–3871) | 12.0 |
| ops-center.js | GET /ops-center (3872–4157) | 15.2 |
| ops-center-feed.js | thread/mark-read/join-invite, authorizations (4158–4372) | 10.4 |
| errors-members.js | error-events, fetch-members (4373–4461) | 4.6 |
| crm.js | crm/subscribers* (4462–4780) | 15.3 |
| messaging.js | send-message, crm/import, crm/presence (4781–4913) | 7.5 |
| index.js | фабрика-голова, инстансы сервисов, порядок регистрации | 2.0 |

Риски: общий порядок роутов; `wait`/`sleep`/`loadOperationalUserbot`
(11 зон) — только через helpers-*; multer-инстансы по одному. Проверки:
`test:autopost` (вкл. test-userbot-ops), `test:intake`, `test:entity`,
`test:mcp`, `test:messaging`; прод: смоук прокси/сессий/ops-center.

### Волна 6 — МОНСТР: routes/shop.routes.js (162 КБ, 3592 строк)

Разрезка на ~15 модулей `routes/shop/*.js` (helpers, purchase-core,
purchase-check, lots-batch, catalog-admin, items-read, items-create(+helpers),
items-lots, items-lifecycle, catalog-public, purchase-api, purchase-checks,
delivery, index). Фасад сохраняет default + named
(`createOrRefreshBuyerPurchase`, `runShopPurchaseCheck`,
`createAccountLotsBatch` — их зовут server.js и test-shop-delivery через
динамический import). Side-effect `fs.mkdirSync` — в helpers.js, один раз.

⚠ **Единственный кусок >20КБ во всей очереди**: хендлер POST items
(L1790–2176, 20 688 Б) — чистая резка невозможна, требуется вынос части тела в
локальные функции-хелперы (`items-create-helpers.js`), без изменения логики.
Единственное место плана, где дифф — не 100% перемещение. Выделено владельцу
на подтверждение (§7, вопрос 3).

### Волна 7 — МОНСТР: services/userbot.service.js (147 КБ, 3447 строк)

Mixin-композиция `services/userbot/*.js`, фасад собирает
`export class UserbotService extends BotFather(Groups(Dialogs(MessagesOps(Health(Members(Dm(Qr(Fingerprint(Proxy(Session(Base)))))))))))`
+ реэкспорт named (`isBotFatherRefusal`, `isBotFatherGreeting`,
`findPeerByDialogPages`, `parseBotFatherToken` — их зовут тесты и 21 импортёр,
вкл. ленивые `await import`).

Модули: base (constructor), telegram-errors, session.mixin, proxy.mixin
(15.5КБ, FAILOVER_COOLDOWN_MS), fingerprint.mixin, qr.mixin, dm.mixin (16КБ),
health.mixin, members.mixin, dialogs.mixin (17.6КБ), groups.mixin, botfather.js
(метод + Map `botFatherCreateBotInFlight` + exported-хелперы ВМЕСТЕ),
messages-ops.mixin, helpers.js (assertFeatureEnabled, normalize*,
safeDisconnect, wrapTelegramError).

⚠ Mixin-композиция меняет цепочку прототипов при сохранении поведения — это
единственное место с «обвязкой» вокруг перемещённого кода. grep по backend не
нашёл ручных обходов prototype. Выделено владельцу на подтверждение (§7,
вопрос 3). Проверки: `test:autopost` (userbot-ops), `test:intake`,
`test:entity`, `test:qr-auth`, `test:messaging`, `test:mcp`.

### Волна 8 — фронт средние admin-v2/site-v2, 5 файлов (31.8–39.7 КБ)

PayPage.jsx (site-v2, 31.8), useSalesContourController.js (admin-v2, 35.4 —
разрезка хука на составные хуки), TariffsSection.jsx (39.7), AbandonedPage.jsx
(39.4), RetentionPage.jsx (39.1). Швы: карта на старте волны.

### Волна 9 — userbot-v2 крупные, 2 файла (78 КБ каждый)

ProxyManagerPage.jsx: ProxyTableSection (L110–507, уже props-driven) + формы
(L1114–1595) + хуки данных/продаж. UserbotCenterSection.jsx (самый связный,
30+ хуков): ProfileTab + GroupsTab + useThreadMessaging + ChatThread +
useCenterData. localStorage handoff-ключ (дублируется с CustomersPage) не
менять. Проверки: build userbot-v2, check:design, прод в реальном Chrome.

### Волна 10 — admin-v2 крупные, 3 файла (54–67 КБ)

CustomersPage.jsx (AudienceTable + CustomersTable + useCustomersData + rows-утилиты),
OfficialBotsSection.jsx (самый лёгкий — компоненты уже изолированы: 4 sections),
BroadcastPage.jsx (StepBase/StepUserbots/StepSend + useBroadcastPreparation;
`pollRef`-интервал — в один хук с poll).

### Волна 11 — фронт-монстры, 2 файла (109–111 КБ)

bots-v2 AutopostManagePage.jsx (111.4): JournalPanel + ChannelConfig +
BotConnect + BotAdminsPanel (гонки reqId-refs — с их загрузками).
admin-v2 ReferralsPage.jsx (109.3): TransferBoxes (чистые, ~19КБ) +
RefundPanel + PayoutPanel + DashboardTables + ReserveCard (единый `state` —
refresh-колбэк остаётся на странице). Проверки: build bots-v2 + admin-v2,
check:design, прод-страницы автопостера и рефералок в реальном Chrome.

### Волна 12 — тесты, 11 файлов + package.json

| Тест | КБ | Скрипт (цепочка) |
|---|---|---|
| test-userbot-ops.js | 49.4 | test:autopost (9-я позиция) |
| test-broadcast-cleanup.js | 48.6 | test:broadcast-cleanup |
| test-sale-scan.js | 44.8 | test:sale-scan |
| test-contour-admin-rights.js | 41.2 | test:sales (1-я) |
| test-autopost-checklist-ops.js | 40.3 | test:autopost (8-я) |
| test-account-intake.js | 40.1 | test:intake |
| test-shop-delivery.js | 35.2 | test:shop-delivery |
| test-messaging-router.js | 31.6 | test:messaging |
| test-broadcast-router.js | 25.9 | test:broadcast |
| test-mcp-shared.js | 21.1 | test:mcp (1-й) |
| test-external-rest.js | 21.1 | test:mcp (3-й) |

Швы: сценарные кластеры → `backend/test/<suite>/<scenario>.js`; файл-хост
остаётся входом сценария. **В том же шаге обновить цепочки в
`backend/package.json`** (точные пути — рамка №4). gate-07 тесты не считает
(skip `test/`) — baseline не трогается. Проверки: полный прогон затронутых
скриптов + `test:contours`, `test:logging`, `test:jobs`, `test:client-log`.

## 6. Итоговое состояние

Очередь 59 → 0 (плюс 3 файла вне очереди по решению/вопросу). Хук становится
ежедневным предохранителем; `--no-verify` остаётся только для AGENTS.md и
будущих разовых случаев. Ретрошпектива по итогам волн — апдейт LESSONS.md.

## 7. Спорные случаи — РЕШЕНО владельцем 2026-11-06

1. **backend/README.md (38 КБ)** — исключение в IGNORE_RE (операционная дока,
   формула токенов неприменима).
2. **design/tokens/color.primitives.json (41.9 КБ)** — исключение в IGNORE_RE
   (данные DTCG, резка ломает пайплайн tokens:build).
3. **Обвязка сверх чистого переноса — ОК на обе**: (а) волна 6, POST items
   shop.routes — вынос части тела хендлера в функции; (б) волна 7,
   mixin-композиция userbot.service (методы verbatim, цепочка классов).
4. **Волна 1 стартует в этой сессии** (после ответов владельца).

## 8. Учет

- [x] Волна 1 (backend мелочь, 11) — 2026-11-06, см. «Ревью волны 1»
- [x] Волна 2 (фронт мелочь, 11) — 2026-11-06, см. «Ревью волны 2»
- [x] Волна 3 (backend роуты, 6) — 2026-11-06, см. «Ревью волны 3»
- [x] Волна 4 (backend сервисы, 5) — 2026-11-06, см. «Ревью волны 4»
- [x] Волна 5 (userbot.routes, 1 → ~20) — 2026-11-06, см. «Ревью волны 5»
- [x] Волна 6 (shop.routes, 1 → ~15) — 2026-11-06, см. «Ревью волны 6»
- [x] Волна 7 (userbot.service, 1 → ~14) — 2026-11-06, см. «Ревью волны 7»
- [x] Волна 8 (фронт средние, 5) — 2026-11-06, слиты с 9–10, см. «Ревью волн 8–10»
- [x] Волна 9 (userbot-v2 крупные, 2) — 2026-11-06, слиты с 8–10, см. «Ревью волн 8–10»
- [x] Волна 10 (admin-v2 крупные, 3) — 2026-11-06, слиты с 8–10, см. «Ревью волн 8–10»
- [x] Волна 11 (фронт-монстры, 2) — 2026-11-06, см. «Ревью волны 11»
- [x] Волна 12 (тесты, 11 + package.json) — 2026-11-07, см. «Ревью волны 12»
- [x] Ретрошпектива + LESSONS.md — 2026-11-07, см. «Ретроспектива»

## Ревью волны 1 (2026-11-06, коммиты 538a15f…b5b00c5 + фикс e634c4b)

Сделано: 11 легаси-файлов разрезаны на 24 файла (11 исходников, все 11.1–18.7
КБ + 13 новых модулей 0.7–11.0 КБ). Хук прошёл все 12 коммитов ШТАТНО — ни
одного `--no-verify` (файлы уже в лимите). Порядок: 4 параллельных агента по
зонам (autopost handlers / services / jobs / routes+server) с точными швами из
§5, вербатим-перенос побайтово сверен с `git show HEAD`.

Проверки: `node --check` всех 24 файлов; тесты — test:autopost (19),
test:lifecycle (36), test:broadcast-cleanup (92), test:broadcast (75),
test:sale-scan, test:sales, test:contours (12), test:mcp, test:messaging (76)
— все зелёные; gate-07 baseline обновлён осознанно (total 596 → 596, только
переехавшие вызовы); `npm run ci:source` — 4/4 гейта PASS; деплой success ×2;
прод: pm2 online, `/health` 200, затронутые API 401 (смонтированы),
BroadcastDelivery started в JSONL, новых unhandledRejection нет.

**Баг, пойманный проверкой на проде** (фикс e634c4b): STALE_HEARTBEAT_MS уехал
в campaign-ops.js без импорта назад в главный файл — unhandledRejection при
старте джобы доставки рассылок, интервал не ставился. `node --check` это НЕ
ловит (синтаксис валиден). Причина пропуска: у broadcast-delivery нет
собственного тест-сьюта. Урок для следующих волн (добавить в цикл §4):
1. после каждой пары — статический скан «символ используется, но не
   импортирован/не объявлен» по обеим сторонам шва (re-export-строки,
   default-import и деструктуризацию deps эвристика не видит — ручной триаж);
2. рантайм-смоук стартовых функций джоб с dummy-зависимостями;
3. после деплоя — grep `unhandledRejection` по свежим строкам
   `logs/app.err.jsonl` (обязательный шаг прод-проверки backend-волн).

Отклонения от карты швов (все задокументированы агентами): isScanStale уехал
в scan-maintenance вместе с sweepStaleScans (без цикла); путь импорта из
broadcast-delivery/ — '../../services/...'; makeLoadOwnedBase-фабрика в
ownership.js; устаревшая шапка queue-callbacks.js (комментарий — сознательно
не правился).

Из зоны лимита вышло: 11. Осталось в очереди: 48.

## Ревью волны 2 (2026-11-06, коммиты d814584…70a8a73)

Сделано: 11 фронт-файлов разрезаны на 24 (12 исходников, все 14.4–17.9 КБ,
включая бустер bases/shared.js 4738→5949 + 13 новых 3.6–15.4 КБ). Хук прошёл
все 13 коммитов штатно. Картирование швов — 2 Explore-агента, разрезка — 3
параллельных агента (userbot-v2 ×2 / site-v2+admin-v2 ×1) с картой из волны.
Props именуются как заменяемые переменные — тела JSX без правок, вербатим
сверен нормализованными diff против `git show HEAD` (26/26 блоков).

Проверки: esbuild-парсинг всех файлов у агентов; `npm run build` ×3 аппа
(userbot-v2, site-v2, admin-v2) ✓; `check:design` — hardcodes-ratchet FAIL
per-file по 11 новым файлам → baseline обновлён осознанно, **total упал**
8958 → 8826 (роста нет — рамка соблюдена); `ci:source` 4/4 PASS; деплой
success; прод в реальном Chrome (Playwright-расширение): `/` (герой, тарифы
вкл. Trial, секция доступа, CTA), `/create` (форма счёта), `/userbot/mcp`
(токен/промпт/«Ручная настройка»), `/userbot/proxies` (AdminServerProxyForm),
`/userbot/` (витрина, Боевой режим), `/paywall/bases` (ChannelsGrid +
ChannelAudienceSection с реальными данными) — 0 ошибок консоли нашего кода
(единственный шум: analytics.ton.org от TON Connect SDK, сторонний вендор).

Отклонения от карты (задокументированы агентами): manualOpen уехал с карточкой
(использовался только ею); `formatCheckedAgo` импортируется из useAccountLots,
не useSaleScan; в AdminServerProxyForm добавлен prop isAdminCreate (в точке
рендера всегда true — поведение идентично); closeTrigger собран в обеих ветках
из onClose (10 строк JSX задублировано); состояние ветки `{X ? … : null}` →
`return (…)` в OpenPurchasesList.

Из зоны лимита вышло: 11 (итого 22). Осталось в очереди: 37.

## Ревью волны 3 (2026-11-06, коммиты ed10b3a…14b8d0e)

Сделано: 6 средних роутов разрезаны на 23 файла (6 исходников 5.2–17.8 КБ + 17
новых подмодулей 1.5–18.7 КБ). Хук прошёл все 8 коммитов штатно. 3
параллельных агента; паттерн register(router, ctx/deps), фасады с named
реэкспортами (getBotById/initAllBots/buildActorRightsByTarget по старому пути —
server.js и customers.routes не тронуты).

Уроки волны 1 сработали: скан швов в обе стороны поймал у агентов 4 реальные
ловушки ДО коммита (неэкспортированный getReserveAccountByOwner, отсутствующий
supabase в сигнатуре restoreReferralBalance, потерянные ключи деструктуризации
dashboard — упали бы ReferenceError на каждом GET, не тот файл для импорта
loadReservedUserbotIds). Порядок регистрации сверен сравнением стеков:
referral 10/10, official-bot 23/23 (contours раньше /:accountId*, add раньше
/:accountId/token), channel-audiences 5/5, autopost/broadcast — порядок
GET→preview→send→cancel сохранён.

Проверки: node --check 23/23; import-smoke всех фабрик и подмодулей; тесты —
test:mcp, test:contours (12), test:broadcast (75), test:autopost (19),
test:broadcast-cleanup (92), test:sale-scan, test:sales, test:messaging (76),
test:lifecycle (36) — все зелёные; gate-07 baseline обновлён осознанно
(596 → 596); ci:source 4/4 PASS; деплой success; прод: pm2 online, JSON-ошибок
level≥50 после рестарта ноль, смоук эндпоинтов /api/dashboard,
/api/channel-audiences, /api/autopost/bots, /api/broadcast/campaigns,
/api/referrals, /api/official-bot/contours — 401 (смонтированы, auth живой),
/health 200; прод в реальном Chrome: /paywall/ (Бот продаж: боты, юзерботы,
площадки) и /paywall/referrals (Резервный фонд с живыми данными через новый
overview.js) — 0 ошибок консоли.

Отклонения от карты §5 (все ради лимита/ацикличности, задокументированы
агентами): referral — buildReserveRefundSummary/enrichReserveRefundPayload/
getReserveAccountByOwner в ton-payloads (иначе циклы), overview вынесен в
отдельный файл; official-bot — bot-management.js создан (родитель с зоной C
был бы 34.7К); autopost — admin-routes.js вынесен (родитель после C+D был бы
24.4К); broadcast — cancel остался в родителе (C+D = 19.9К в один файл).
Тонкие запасы: referral/overview.js 1279 Б, bot-management.js 1895 Б,
build-audience.js/campaign-routes.js ~2.2К — при будущем росте этих зон
потребуется своя под-разрезка. proFulfillment-запрос в dashboard теперь
исполняется в лоадере до агрегации (независимый read-only — поведение то же).

Из зоны лимита вышло: 6 (итого 28). Осталось в очереди: 31.

## Ревью волны 4 (2026-11-06, коммиты 81b400e…8b402d2)

Сделано: 5 средних сервисов разрезаны на 18 файлов (5 фасадов 14.3–18.4 КБ +
13 новых модулей 2.8–18.4 КБ). Цикл contour⇄sales-contour сохранён как есть
через фасады (import classifyTelegramError дословно), все leaf-модули
ацикличны. 3 параллельных агента; вербатим-верификация механическая:
official-bot 59 тел (плюс дифтест 51 кейс идентичен), broadcast-preparation
76 блоков, прототипы AutopostService 39/39 и BroadcastPreparationService
28/28 методов с прежними сигнатурами.

Проверки: node --check + import-smoke всех файлов и 12 импортёров
official-bot; тесты: test:autopost (19), test:broadcast-cleanup (92),
test:sales (80 + quarantine), test:contours (12), test:mcp, test:messaging
(76), test:lifecycle (36); gate-07 596→596; ci:source 4/4; деплой success;
прод: pm2 online, level≥50 после рестарта — ноль, эндпоинты 401/200, /paywall/
в реальном Chrome — 0 ошибок консоли (боты/юзерботы/площадки с живыми
данными).

Отмечено: 23 internal-only метода official-bot сняты с класса в функции
(grep-доказано ноль внешних вызовов); стек-трейсы делегатов добавляют фрейм;
join-all.js импортирует classifyTelegramError из leaf
contour-admin-rights/shared.js (кросс-сервисная leaf-зависимость, легальна);
неиспользуемый импорт в теле sales-contour фасада — намеренный (держит цикл).
Тонкий запас: sales-contour.service.js 1584 Б.

Из зоны лимита вышло: 5 (итого 33). Осталось в очереди: 26.

## Ревью волны 5 (2026-11-06, коммиты 25281ff, eb58907, c51428f)

Сделано: МОНСТР backend/routes/userbot.routes.js (229114 Б, 4913 строк) →
**фасад 379 Б** (`export { default } from './userbot/index.js'`, server.js не
меняется) + агрегатор index.js (4113 Б, 16 register-вызовов) + **23 модуля**
(4 helpers + constants.js + 18 роут-модулей, 816–18240 Б). Три
последовательные стадии: helpers → первая половина фабрики → вторая половина
+ агрегатор; две промежуточные коммит-стадии через утверждённый `--no-verify`,
финал — штатно через хук.

Проверки: фабрика байт-идентична после стадии 1; тела всех модулей байт-в-байт
против git show HEAD; порядок регистрации 43→43 маршрутов — динамическая
сверка обходом router.stack в двух процессах, совпадение поэлементно
(DELETE /proxies/:id раньше DELETE /:id сохранена); multer-инстансы уехали со
своими зонами (по одному); proxyCheckCooldown Map — единственная в
helpers-proxy.js; цикл routes⇄helpers разорван через constants.js; сканы
«используется ↔ импортирован» чисты; тесты: test:autopost (19, вкл.
test-userbot-ops через роуты), test:contours (12), test:intake, test:qr-auth,
test:entity (23), test:messaging (76), test:mcp; gate-07 596→596; ci:source
4/4; деплой success; прод: 5 userbot-эндпоинтов 401, pm2 online, level≥50
ноль, /userbot/proxies в реальном Chrome — 0 ошибок консоли.

Отмечено: зона proxies-crud в реальности 21.9К — разрезана на proxies-crud +
proxies-check (порядок сохранён); мелкие GET /fingerprint-profiles и
/recovery-status встроены в qr.js/lifecycle.js первыми роутами; мёртвая
константа TRIAL_PROXY_LEASE_HOURS удалена (grep по backend — ноль
использований); 2 ловушки пойманы сканами до коммита (isMissingRecoveryTable в
main, FRESH_IMPORT_RUNTIME_REASON в health-check).

Из зоны лимита вышло: 1 (итого 34). Осталось в очереди: 25.

## Ревью волны 6 (2026-11-06, коммиты 7844e85, c88fece)

Сделано: МОНСТР backend/routes/shop.routes.js (162013 Б, 3592 строк) →
**фасад 664 Б** (default + 3 named по старым путям, server.js и
test-shop-delivery не меняются) + агрегатор index.js (3862 Б) + **15 модулей**
(4 stage-1: helpers/purchase-core/purchase-check/lots-batch; 9 register-зон +
items-create-helpers). Две стадии, промежуточный --no-verify, финал штатно.
mkdirSync side-effect — один, в helpers.js; мёртвый receiptUpload перенесён
как есть.

Одобренная обвязка (§7.3a, POST items ~387 строк): части тела хендлера
вынесены в функции items-create-helpers.js (18851 Б) без изменения логики —
куски тела дословны внутри функций.

Проверки: node --check 15/15; фасад резолвит default + 3 named; порядок
маршрутов 18/18 — статическая сверка HEAD-фабрики против index.js+модулей;
rate-limit карты публичных роутов остались per-factory-instance; тесты:
test:shop-delivery, test:sale-scan зелёные; gate-07 596→596; ci:source 4/4;
деплой success; прод: /shop 200, /api/shop/public/items 200 (публичный каталог
через параметризованный listVisibleShopItems), pm2 online, level≥50 ноль.
Агент стадии 2 упёрся в таймаут координации — работа была завершена,
верификация догнана координатором вручную (включая сверку порядка).

Из зоны лимита вышло: 1 (итого 35). Осталось в очереди: 24.

## Ревью волны 7 (2026-11-06, коммиты 2a4c519, 05a9282)

Сделано: МОНСТР backend/services/userbot.service.js (146812 Б, 3447 строк) →
**фасад 2550 Б** (mixin-цепочка из 12 + constructor + 4 named реэкспорта; 21
импортёр по старому пути не меняются, вкл. 2 ленивых await import) + 4
leaf-модуля (constants/telegram-errors/helpers/botfather-lib — весь
не-методный код) + **12 mixin-файлов** (2550→16954 Б). Две стадии,
промежуточный --no-verify, финал штатно.

Одобренная обвязка (§7.3b, mixin-композиция): методы дословны, 83/83
byte-equal (вкл. JSDoc), прототип 1:1 без дублей (рантайм-сверка в двух
процессах), this.X-скан 46 имён clean. Единственная обвязка — `super()` первой
строкой constructor (требование ES-классов при extends, behavior идентичен,
отмечено комментарием). dialogs порезан на dialogs+resolvers (>19К).
botFatherCreateBotInFlight Map — единственная, в botfather-lib; метод
импортирует её оттуда. Hoisted-функции хвоста стали ES-импортами листьев
(живые биндинги, behavior идентичен).

Проверки: node --check 13/13; import-smoke: typeof UserbotService function,
new UserbotService(null) не бросает, дым по 5 методам; тесты: test:autopost
(19, вкл. userbot-ops), test:entity (23), test:messaging (76), test:intake,
test:qr-auth, test:mcp, test:lifecycle (36); gate-07 596→596; ci:source 4/4;
деплой success; прод: pm2 online, level≥50 ноль, userbot-эндпоинты 401/200.

Из зоны лимита вышло: 1 (итого 36). Осталось в очереди: 23 (все фронт).

## Ревью волн 8–10 (2026-11-06, коммиты 75b9aee…8b45c66 + фиксы f353948, 9997f92)

Сделано (волны слиты в один цикл, 3 параллельных агента): 10 фронт-файлов
разрезаны на ~60 файлов — TariffsSection ×4, AbandonedPage ×3, RetentionPage
×4, useSalesContourController ×2 (API хука дословен, 22 поля), CustomersPage
×6, OfficialBotsSection ×4 (RightsBadges уехали с ContourCard — без цикла),
BroadcastPage ×7 (pollRef с poll в одном хуке), PayPage ×2, ProxyManagerPage
×9 (таблица порезана с ProxyTableParts — 21.5К не влезала),
UserbotCenterSection ×10 (самый связный, handoff-ключ не тронут). Все файлы
≤18.8КБ; вербатим-сверки агентов (61+50 блоков) и esbuild --bundle проходов.

**Два бага пойманы проверкой на проде (Browser Doctrine), оба исправлены:**
1. f353948 — useEffect без импорта в useThreadMessaging.js: /userbot/ падал
   «useEffect is not defined», ErrorBoundary гасил. Скан hook-imports по трём
   аппам после фикса — чисто.
2. 9997f92 — ChevronDown/ExternalLink (lucide) без импортов: второй пойман
   сканом Capitalized-идентификаторов по всем изменённым файлам (Boolean/
   String — глобалы-ложные отфильтрованы). ExternalLink был латентным
   (условный рендер). **Урок в цикл §4: после фронт-волн обязательны (а) скан
   hook-imports, (б) скан Capitalized-идентификаторов, (в) заход на каждую
   затронутую страницу в реальном Chrome** — no-undef-аудиты агентов дважды
   пропустили импорты.

Проверки: build ×3 аппа; check:design PASS (baseline обновлён, total
8826 → 8826 нулевой рост); ci:source 4/4; деплой success ×3; прод в реальном
Chrome: /paywall/ (тарифы+контур), /paywall/customers (метрики/доступ),
/paywall/broadcast (визард 4 шагов), /paywall/abandoned, /paywall/retention
(помощник-юзербот), /userbot/ (центр, Боевой режим), /userbot/proxies (формы
и список), /pay/:bogus (ErrorView штатен, 400 — задуманный поллинг) — после
фиксов 0 ошибок консоли нашего кода.

Из зоны лимита вышло: 10 (итого 46). Осталось в очереди: 13.

## Ревью волны 11 (2026-11-06, коммиты e77d8b4, 9a115c3, 5744822)

Сделано: два фронт-монстра разрезаны на 21 файл — AutopostManagePage.jsx
(111393→17653 Б, 11 секций+utils/journal; единая realtime-подписка осталась на
странице через ref-мост journalApiRef; no-undef-скан агента поймал 2
пропущенных импорта до коммита), ReferralsPage.jsx (109321→14201 Б, 10
модулей; refreshReferralState на странице; eslint no-undef поймал Fragment;
вербатим 17 диапазонов/2189 строк). Провалы и порядок таблиц сверены.

Проверки: build bots-v2 + admin-v2; check:design PASS (baseline обновлён
осознанно — bots-v2 секции: total 8826→8826); ci:source 4/4; деплой success;
прод в реальном Chrome: /bots/autopost (онбординг-состояние живо),
/paywall/referrals (Резервный фонд + таблицы через split-файлы) — 0 ошибок
консоли.

Из зоны лимита вышло: 2 (итого 48). Осталось в очереди: 11.

## Ревью волны 12 (2026-11-07, коммиты e845fa6…8846b7d)

Сделано: 11 oversized тестов разрезаны на 68 сценариев-модулей + shared.js в
11 папок backend/test/<suite>/; хосты-оркестраторы остались НА ИСХОДНЫХ
ПУТЯХ — **цепочки в package.json не потребовали ни одной правки** (рамка №4
закрыта без диффа). Ключевой урок ESM: top-level-код сценариев на import НЕ
секвенируется (async-модули уезжают в конец) — каждый сценарий export async
run(), хост вызывает последовательно; счётчики passed/failed — живой объект в
shared.js; ENCRYPTION_KEY-зависимые сьюты импортируют тестируемое динамически
после установки env (контракт utils/crypto.js сохранён).

Проверки: stdout/stderr побайтно идентичны базовым прогонам оригиналов (diff
пуст у 8 сьютов; checklist-ops — modulo nondeterministic logger-строки, было
и до разрезки); node --check 61+ файлов; полные прогоны: test:mcp (143+56),
test:autopost цепочка (вкл. userbot-ops и checklist-ops), test:broadcast-cleanup
(92/92), test:messaging (76/76), test:broadcast (75/75), test:sales,
test:intake, test:shop-delivery — зелёные; ci:source 4/4; деплой success;
pm2 online, /health 200.

Находка: test-sale-scan красный (1 проверка «public-лот: listed_item_id
проставлен») И на чистом HEAD до разрезки — предсуществующий: фикстура кладёт
shop_items без item_type, а attachListedItemIds после report-only коммитов
фильтрует .eq('item_type','account'). Поведение сохранено побайтно; починка —
решение владельца, заведено BACKLOG §30.

Из зоны лимита вышло: 11 (итого 59). **Очередь пуста: 0.**

## Ретроспектива (2026-11-07)

Итог: 59/59 кодовых oversized-файлов разрезаны, хук стал ежедневным
предохранителем — за 12 волн **96 коммитов разрезки, ни одного
непланового --no-verify** (три утверждённых промежуточных на стадиях монстров
5/6/7 + wave-1 exceptions commit). 3 бага пойманы проверками на проде и
исправлены в цикле волны (STALE_HEARTBEAT_MS — err-лог; useEffect — браузер;
ChevronDown/ExternalLink — латентный, полный скан). 4+ ловушек пойманы
сканами швов до коммита. Прод: ни одного инцидента вне двух фронтовых
падений, оба в ErrorBoundary и починены в той же сессии.

Что сработало: карты швов до разрезки (5 Explore-агентов на старте) + точные
промпты с линиями/размерами; стадийность монстров (229К/162К/147К по 2-3
стадии с коммитами); «props named как заменяемые переменные» — тела JSX без
правок; статические сверки порядка маршрутов (router.stack) и stdout тестов.

Системные уроки (LESSONS.md 2026-11-06): фронт — три обязательных скана
(hook-imports, Capitalized, браузер-заход) + err-лог-грепп для бэкенда;
ESM-секвенирование сценариев через export async run(). Bash-ловушка агента
(редирект > в читаемый файл) отловлена сверкой с git HEAD — добавить в
промпты: «никогда не пиши сборку в файл-источник».

Тонкие запасы (<2КБ) для будущих правок: referral/overview.js (1279),
bot-management.js (1895), build-audience.js/campaign-routes.js (~2.2К),
sales-contour.service.js (1584), health-check.js 18240, RetentionPage 17011
без проблем — при росте этих зон своя под-разрезка по тому же циклу.
BACKLOG: §30 (красный test-sale-scan — предсуществующий).

## Close-out (2026-11-07, по слову владельца «прими решение сам и доведи до конца»)

1. **§30 закрыт** (2127a4f): фикстуре sale-scan добавлен `item_type: 'account'`
   (интент теста — аккаунт-лот; сервис после report-only коммитов фильтрует
   .eq). Сьют 109/109, EXIT=0. BACKLOG §30 помечен закрытым.
2. **Закрывающий code-reviewer по диффу 138c9cf..HEAD** (87 коммитов, 355
   файлов, выборочно по риск-паттернам): вердикт REJECT — **два P0 одного
   класса** (делегирующий фасад зовёт неимпортированную функцию):
   - sales-contour.service.js:145 → loadContourRuntimeContext (loaders.js) —
     POST /contours/check-rights и крон bot-rights-monitor падали
     ReferenceError;
   - routes/shop/helpers.js:286 → verifyPaymentOnce (ton-connect-verify) —
     ReferenceError глотался try/catch → **каждая TON-оплата магазина
     считалась неоплаченной, авто-выдача не срабатывала** (тесты зелёные
     именно из-за глотания).
   Оба исправлены одной строкой импорта (5527f50), рантайм-пруфы дошли до
   БД-слоя; **check-rights подтверждён на проде через сессию владельца**:
   200 {"success":true,"admin_status":"administrator"} с реальным bot_id.
   Остальное ревью: фасады/экспорты OK (23 символа), порядок маршрутов 43/43
   + 28/28 + 24/24, mixin 82/82 без теней, mutable Maps по одной, запрещённые
   файлы не тронуты, package.json не изменён, вербатим-выборки чисты.
3. **eslint no-undef-свип всех 82 изменённых фронт-файлов** (flat-config,
   v10): 4 латентных бага импортов/пропсов исправлены тем же коммитом —
   askConfirm → JournalPanel, checkAccount-проводка до SessionPanel,
   selectedUserbot в useProfileEditing, import toast в proxyShared.
   Повторный свип чист (остаток — eslint-disable-комментарии на
   react-hooks/exhaustive-deps, не рантайм).
4. **Дизайн-критик по 8 прод-кадрам** (десктоп ×6, мобайл 390, hover):
   вердикт **PASS** — симптомов потерянных props/классов нет, мобайл не
   разваливается. P2.2 (hover-кадр не зафиксировал :hover) — цепочка hover
   проверена критиком в коде и прод-CSS. P2.1 (QR-панель чекаута партнёрок
   вылезала за карточку) — предсуществующий (byte-identical JSX до/после
   разрезки, проверено критиком), исправлен min-w-0 на текстовую колонку
   (f6ea56e), подтверждён свежим прод-скриншотом.

**Итог close-out: REJECT ревьюера отработан полностью — 2 P0 + 4 латентных
бага + 1 визуальный дефект исправлены и проверены на проде; критик PASS.**
Урок в LESSONS дополнен: закрывающий ревью-свип «свободных вызовов» по
backend и eslint no-undef по фронту — обязательный шаг после массовых
разрезок (no-undef-аудиты агентов пропустили 6 пропусков из 8 найденных).
