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

- [ ] Волна 1 (backend мелочь, 11)
- [ ] Волна 2 (фронт мелочь, 11)
- [ ] Волна 3 (backend роуты, 6)
- [ ] Волна 4 (backend сервисы, 5)
- [ ] Волна 5 (userbot.routes, 1 → ~20)
- [ ] Волна 6 (shop.routes, 1 → ~15)
- [ ] Волна 7 (userbot.service, 1 → ~14)
- [ ] Волна 8 (фронт средние, 5)
- [ ] Волна 9 (userbot-v2 крупные, 2)
- [ ] Волна 10 (admin-v2 крупные, 3)
- [ ] Волна 11 (фронт-монстры, 2)
- [ ] Волна 12 (тесты, 11 + package.json)
- [ ] Ретрошпектива + LESSONS.md

## Ревью волны N

(заполняется после каждого цикла)
