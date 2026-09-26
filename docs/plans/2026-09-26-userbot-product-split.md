# Разделение продуктов: приложение «Юзербот» (/userbot) и paywall (/app)

Дата: 2026-09-26. Статус: план согласуется с владельцем, реализация не начата.

## Контекст

Позиционирование с 2026-09-21 — инфраструктура для билдеров ИИ-агентов («Дай своему ИИ-агенту Telegram-аккаунт»). Основной продукт — юзерботы + прокси + MCP/API. Сейчас после покупки покупатель попадает в общую кабину `/app`, где 90% интерфейса — инструменты платного доступа (paywall), не имеющие к нему отношения. Это убивает первые продажи.

Решение владельца (2026-09-26): вариант C — разделить на два продукта целиком, все переезды сразу, уровнем «профессиональный продукт», не MVP. Новое приложение называется **«Юзербот»**, живёт по пути **`/userbot`**, дизайн — тот же, что у admin-v2 (общая система токенов и канонический кит).

Жёсткое ограничение: **paywall продолжает работать с юзерботами** — сканирование групп привязанным юзерботом, авто-кик, retention, рассылки, контур продаж. Backend-контракты не меняются.

## Незыблемые принципы

1. Один аккаунт на всё: тот же self-hosted Supabase, Google OAuth, общий origin → общая сессия localStorage. Переход между `/`, `/userbot`, `/app` без повторного входа.
2. Backend остаётся один. `/api/userbot/*`, `/api/official-bot/contours*`, `/api/userbot-web/*`, `/api/mcp/*`, `/api/integrations/*`, `/api/shop/*`, `/api/dashboard` — без изменений контрактов. Правки бэкенда в этом плане — только 3 юзер-фейсы ссылки (см. Фазу 5).
3. Правило границы: **управление юзерботами — в «Юзерботе», использование юзерботов paywall-фичами — в `/app`** (пикеры, статусы, ссылки «управлять →»).
4. Продуктовые правила юзерботов сохраняются целиком: все онбординги через прокси, 1 прокси = 1 юзербот, safe-mode (`pending_activation`) до ручной активации, manual-by-default, заблокированные ассеты не продаются.
5. Дизайн: `userbot-v2` рендерится из того же источника токенов (`design/tokens/`) и того же канонического кита (`admin-v2/src/components/ui/`). Гейты расширяются на три приложения.
6. Paywall-регрессии недопустимы: матрица проверки (Фаза 7) — условие закрытия плана.

## Целевая архитектура

| Поверхность | Папка | Путь | Что внутри |
|---|---|---|---|
| Публичный сайт | `site-v2/` | `/` | Маркетинг, тарифы, `/pay/:id`, docs/blog |
| **«Юзербот»** | `userbot-v2/` (новая) | `/userbot` | Дашборд, Юзерботы (онбординг/центр/витрина/лоты), Прокси, Агент MCP, API-ключи, Покупки, Профиль |
| Paywall-кабина | `admin-v2/` | `/app` | Бот продаж (с контурной ротацией юзерботов), автопост, клиенты, удержание, брошенные корзины, партнёрка, базы, рассылки, касса, казна |

Важно: `userbot-v2` ≠ существующий `userbot-web/` (вендорный форк telegram-tt, раздаётся nginx'ом как `/app/telegram-web/`). Не переименовывать и не путать.

### Роуты userbot-v2 (basename `/userbot`)

- `/` — Дашборд: состояние юзерботов (safe-mode → CTA «Активировать»), прокси, статус подключения агента (MCP-токен, последние вызовы), онбординг-чеклист
- `/userbots` — весь текущий юзербот-режим `BotsAccountsPage`: онбординг QR/`.session`, центр управления, витрина покупки, лоты продавца, лоты платформы (для админа)
- `/proxies` — текущая `ProxyManagerPage` целиком
- `/mcp` — текущая `McpSettingsPage` («Подключение агента»)
- `/api` — текущая `ApiIntegrationsPage` (REST-ключ)
- `/purchases` — новая «Мои покупки» на `GET /api/shop/public/my-purchases`
- `/profile` — текущая `ProfilePage` (идентичность, апгрейд тарифа, TON-кошелёк, привязка Telegram)

### Карта редиректов (старое → новое)

| Старый путь | Новое |
|---|---|
| `/app/userbots` (`/app/bots`) | `/userbot/userbots` |
| `/app/proxies` | `/userbot/proxies` |
| `/app/mcp`, `/app/claw`, `/app/claw/log` | `/userbot/mcp` |
| `/app/api`, `/app/integrations`, `/app/api/mcp` | `/userbot/api` |
| `/app/profile` | `/userbot/profile` |
| `/shop`, `/purchases`, `/plan` (site-v2) | `/userbot/userbots`, `/userbot/purchases`, `/userbot/profile` |

Реализация в admin-v2 — компонент `ExternalRedirect` (мелкий route-элемент, `window.location.replace(to)`), т.к. react-router `Navigate` не переходит между SPA. Query-параметры прокидывать (deep-links из уведомлений несут `?userbot_id=`).

Telegram Web: добавить nginx-алиас `/userbot/telegram-web/` на тот же `/var/www/bullgram-telegram-web`; в переезжающем и остающемся коде `window.open` → `/userbot/telegram-web/<id>`; старый `/app/telegram-web/` не трогаем (закладки живы).

## Инвентарь переезда

### Едет в userbot-v2 (копия из admin-v2)

Страницы и их логика:
- `pages/bots/`: `useUserbotOnboarding.js`, `useLiveUserbotsController.js`, `useListedShopUserbotsController.js`, `useBotsAccountsDerivedState.js`, `bots-accounts.utils.js`, `UserbotOnboardingSection.jsx`, `UserbotStorefrontSection.jsx`, `UserbotCenterSection.jsx` (82КБ, с чтением handoff-ключа), `UserbotSaleComposer.jsx`, `ListedShopUserbotsSection.jsx`
- `pages/ProxyManagerPage.jsx`, `pages/McpSettingsPage.jsx`, `pages/ApiIntegrationsPage.jsx`, `pages/ProfilePage.jsx`

Копируется (нужно ОБЕИМ приложениям — в admin-v2 остаётся, в userbot-v2 ложится копия; НЕ удалять при зачистке):
- `features/ton-checkout/*` — `TonWalletSidebarRow` нужен `OpsRail` (остаётся), весь фиче-набор нужен покупкам в `/userbot`
- `features/telegram/TelegramSidebarRow.jsx` — нужен `OpsRail` в admin-v2
- `ui/`: `LoadingState`, `PlanBanner`, `UpgradeCallout`, `ExpiryCountdown`, `ErrorBoundary` — используются остающимися страницами (Broadcast, Customers и др.)
- `app/productTier.js` — нужен BroadcastPage в admin-v2; синхронизация через ui-sync SHARED_FILES
- базовая инфраструктура (`providers`, `api/client`, `lib/*`, `config.js`, кит `components/ui/*`, шрифты/токены) — по определению в обоих

Инфраструктура (копия из admin-v2):
- `app/providers/AuthProvider.jsx`, `app/providers/TonConnectProvider.jsx`, `app/productTier.js`
- `ui/AuthGate.jsx`, `api/client.js`, `config.js` (backendUrl = origin — работает из-под любого base)
- `lib/`: `supabase.js`, `ton-connect.js`, `build-ton-payload.js`, `utils.js`, `buffer-polyfill.js`
- Канонический кит `components/ui/`: `button, badge, card, input, select, command, popover, sonner` (+radix-deps) — байт-идентично, под ui-sync
- `components/bots/UserbotCombobox.jsx`, `components/shop/AdminLotsSection.jsx` — потребители только переезжающие (userbots-режим + ProxyManagerPage; проверено grep 2026-09-26), из admin-v2 удаляются
- `features/shop-storefront/*` (useShopStorefront, ProxyStorefrontSection) — потребители только переезжающие, едет целиком
- `features/profile/*` (3 карточки) и `features/billing/PlatformTierUpgradeCard.jsx` — едут вместе с `ProfilePage` (профиль целиком переезжает в `/userbot/profile`; в admin-v2 остаётся редирект)
- `ui/`: `LoadingState`, `PlanBanner`, `UpgradeCallout` (поправить `href='/billing'` → вести на апгрейд в /userbot/profile), `ExpiryCountdown`, `CodeBlock`, `RecentCallsTable`, `ErrorBoundary`
- Стили: `styles/tokens.css` (генерится пайплайном), `styles/tailwind.css` (замена префикса шрифтов `/app/` → `/userbot/`), `styles/app.css` (копия)
- `public/`: 4 woff2 шрифта; `index.html` с preload `/userbot/manrope-*`
- `vite.config.js` (base `/userbot/`, alias `@`, свой dev-port, тот же proxy-блок), `jsconfig.json`, `components.json`, `package.json` — линейка admin-v2 (React 19 + RR7), компоненты гарантированно совместимы

### Остаётся в admin-v2 (paywall)

- `pages/BotsAccountsPage.jsx` official-режим → `OfficialBotsPage` на `/app/sales-bot`: **`OfficialBotsSection` целиком, включая внутреннюю `UserbotsSection`** (контурная ротация юзерботов: pool/single, `toggleUserbotActive`, join-all, ensure-admin) — это и есть механика «paywall работает с юзерботами»; `useOfficialBotsController`, `useSalesContourController`, `BotTariffsSection` + `useBotTariffs`, `api/official-bot.js`
- Customers/Retention/Abandoned/Referrals/Broadcast/Bases/Cash/Kazna — как есть (правки только линков, см. Фазу 4)
- `features/billing/MyPurchasesCard.jsx`, `BillingContactsCard.jsx` (CTA в MyPurchasesCard → `/userbot/userbots`)
- `app/productTier.js` (нужен BroadcastPage; синхронизируется ui-sync — см. Фазу 1)

### Разрезается

- `BotsAccountsPage.jsx` — один файл на два режима. План разреза: сначала собрать в admin-v2 самостоятельный контейнер official-режима (свой срез данных: `tg_accounts` боты, contours, channels, payment_settings, tariffs) и доказать, что `/app/sales-bot` работает; только потом переносить юзербот-режим в userbot-v2 и удалять его из admin-v2.
- `useBotsAccountsData.js` — общий payload с поллингом 60с. Разрезать по потребителям (проверено по коду 2026-09-26):
  - **official-хук (остаётся в admin-v2)** — НЕСЁТ юзерботные данные, потому что контурная ротация юзерботов (`UserbotsSection` на `/app/sales-bot`) считает варианты из `accounts` (tg_accounts: боты + юзерботы), `proxies` (`GET /api/userbot/proxies`) и `reservedUserbotIds` (`GET /api/shop/seller/reserved-assets`) — `useSalesContourController` принимает их явными пропсами (`BotsAccountsPage.jsx:145-157`). Также тянет `/api/official-bot/contours`, channels, payment_settings. Может отдать только `/api/shop/seller/items` и `/api/userbot/recovery-status`.
  - **юзербот-хук (едет)** — tg_accounts, `/api/userbot/proxies` (включая `proxySupport.profile_role` из этого же ответа — нужна витрине), reserved-assets, seller/items, recovery-status; без contours/payment_settings.
  - ⚠️ Ловушка, которую поймала проверка: «официальному хуку прокси не нужны» — НЕВЕРНО; без `/api/userbot/proxies` + reserved-assets ротация юзерботов в контуре на `/app/sales-bot` теряет список вариантов. Это paywall-фича, ломать нельзя.

### Кросс-прикладной handoff «Написать через юзербота»

`CustomersPage` (остаётся) пишет черновик в localStorage `bullgram_userbot_center_handoff` и звал `navigate('/userbots?...')`. Протокол сохраняется: тот же ключ + query `?tg_user_id=`, но переход — полный `window.location.assign('/userbot/userbots?...')`. UserbotCenter в userbot-v2 читает ключ на маунте (логика `BotsAccountsPage.jsx:280-285` переезжает как есть). Один origin → работает.

## Фазы

### Фаза 0 — решения зафиксированы, серверная подготовка (до кода)

Зафиксировано владельцем 2026-09-26:
- [x] Путь `/userbot`, имя продукта «Юзербот», папка `userbot-v2`
- [x] Профиль переезжает целиком в `/userbot/profile` (в `/app` — редирект)
- [x] Касса (`/app/billing`) остаётся в paywall; апгрейд тарифа покупателем — через `/userbot/profile`
- [x] MCP и REST API остаются двумя страницами (слияние — отдельное решение позже)
- [x] ui-sync включаем на три приложения (с переписыванием логики, см. Фазу 1); `productTier.js` добавляем в SHARED_FILES
- [x] Telegram Web: алиас `/userbot/telegram-web/`, старый путь не трогаем
- [x] Seller-контур (лоты юзерботов) переезжает сразу — «все переезды сразу»

Сервер (вручную, вне репо, до первого деплоя) — ВЫПОЛНЕНО 2026-09-26:
- [x] `ln -sfn /srv/bullgram/userbot-v2/dist /var/www/bullgram-userbot-v2`
- [x] nginx: блоки `^~ /userbot/assets/` (иммутабельный кэш), `^~ /userbot/telegram-web/` (алиас на тот же /var/www/bullgram-telegram-web), `= /userbot` (301), `/userbot/` (SPA fallback) — по образцу `/app/`; бэкап в /root/nginx-backups/; `nginx -t` OK, reload OK
- [x] `ops/RESTORE.md` обновлён (третий симлинк, блок `/userbot`, отличие userbot-v2/userbot-web)

### Фаза 1 — дизайн-пайплайн на три приложения

- [x] `design/build.mjs`: OUTPUTS (строки ~27–30) += `userbot-v2/src/styles/tokens.css`; обновить комментарии/сообщения (~:3-8, :199-201, :341) и `design/README.md` (~:100)
- [x] `design/ui-sync.mjs`: APPS += `userbot-v2`; **переписать попарное сравнение (`const [a, b] = sides` ~:47-48) на «каждое приложение против канона admin-v2»** — сейчас третий элемент молча игнорируется; SHARED_FILES += `src/app/productTier.js` (пер-файловый список приложений: productTier — admin-v2 + userbot-v2, на site-v2 его нет)
- [x] `design/check-design.mjs`: LINT_TARGETS (~:47) += `userbot-v2/src`; после появления кода — осознанный `--update-baseline` (копируемый app.css уже учтён baseline админки; новый код писать токен-чистым)
- [x] Прогон: `tokens:build` + `tokens:check` зелёные на трёх копиях (211 переменных); ui-sync/hardcodes зеленеют с появлением скаффолда — проверено, что гейт корректно красный на его отсутствие

### Фаза 2 — каркас userbot-v2

- [ ] Скаффолд по списку «Инфентарь → Инфраструктура»: package.json (React 19 + RR7 + @tailwindcss/vite + radix/sonner/cmdk + @tonconnect), vite.config (base `/userbot/`, alias, proxy на :3000 и bullgram.xyz для /auth,/rest,/realtime), jsconfig, index.html (preload `/userbot/…`), styles (tailwind.css с префиксом `/userbot/` + tokens.css + app.css), шрифты
- [ ] `main.jsx`: buffer-polyfill → TonConnectProvider → AuthProvider → `BrowserRouter basename="/userbot"` → App
- [ ] App-оболочка: сайдбар в стиле admin-v2 (Юзерботы, Прокси, Агент, API, Покупки, Профиль; пилюля тарифа; TonWalletSidebarRow; TelegramSidebarRow), `ErrorBoundary`, роуты-заглушки, `ExternalRedirect` не нужен здесь — только свои роуты
- [ ] Смоук: логин Google, пустые экраны, `/api/userbot/proxies` отвечает (same-origin JWT) — локально против прода через proxy или сразу на проде после Фазы 6

### Фаза 3 — перенос страниц

- [x] Разрезать `useBotsAccountsData` по потребителям (см. «Разрезается»): official-хук СОХРАНЯЕТ `/api/userbot/proxies` + reserved-assets + юзерботы из tg_accounts (контурная ротация); юзербот-хук едет с витринными данными
- [x] В admin-v2 пересобрать `OfficialBotsPage` на official-хук (`pages/bots/OfficialBotsPage.jsx` + `useOfficialAccountsData.js`); юзербот-режим не тронут; сборка зелёная. Прод-гейт (контур, список юзерботов для ротации, join-all) — в матрице Фазы 7. Бонус: с `/app/userbots` ушли скрытые official-сайд-эффекты (загрузка админов бота, автосейв контура)
- [x] Перенести в userbot-v2: онбординг, центр (с чтением handoff), витрину, лоты продавца, `AdminLotsSection`, derived state, контроллеры (12 файлов байт-в-байт; `UserbotCenterSection` — 1 правка telegram-web; хук данных обрезан: без contours/payment_settings/official-флагов)
- [x] Перенести `ProxyManagerPage`, `McpSettingsPage`, `ApiIntegrationsPage`, `ProfilePage`
- [x] Новые экраны: Дашборд `/` (юзерботы/safe-mode CTA, прокси, MCP-токен+последние вызовы, чеклист; safe-mode-срез читается из tg_accounts через Supabase — тот же паттерн, что у страниц рассылок, нового бэкенда нет), Покупки `/purchases` (my-purchases, статусы, батчи, empty-state)
- [x] `UserbotCenterSection`: `window.open` → `/userbot/telegram-web/<id>`; `UpgradeCallout` → `/profile`; роуты в App.jsx на реальных страницах

### Фаза 4 — зачистка admin-v2

- [x] `App.jsx`: ExternalRedirect (query-прокид) на все старые пути; секция «Userbot» сайдбара → блок-ссылка «Юзерботы и прокси → /userbot/userbots»; футерные API/MCP — внешние; OfficialBotsPage на прямом импорте; сборка зелёная, мега-чанк BotsAccountsPage исчез из бандла
- [x] `CustomersPage` handoff: `window.location.assign('/userbot/userbots?...')`, localStorage-ключ не тронут; `BroadcastPage` линки → внешние; `CampaignReplies` window.open → `/userbot/telegram-web/`
- [x] `OpsRail` href → `/userbot/*`, пилюля профиля → `/userbot/profile`; `CommandCenterPage`, `MyPurchasesCard`, `AudiencePanel` ×2, `ReferralsPage` текст — обновлены; TelegramSidebarRow в admin — OAuth redirectTo + ссылка на `/userbot/profile`
- [x] grep-чистота: 0 ссылок на старые пути в admin-v2/src
- [x] Удалить из admin-v2 ТОЛЬКО доказанно переезжающее (25 файлов; grep-проверка перед каждым; `ui/CodeBlock.jsx` ОСТАВЛЕН — реальный потребитель QuickStartPage/автопост, `RecentCallsTable` удалён); `components/bots`, `components/shop`, `features/shop-storefront`, `features/profile` — папки опустели и удалены; сборка admin-v2 зелёная (1.84s), `pages/bots/` содержит только official-файлы
- [ ] Сборка admin-v2 зелёная, бандл ужался

### Фаза 5 — site-v2 и строки бэкенда

site-v2:
- [x] Редиректы `/shop`, `/purchases`, `/plan` → `/userbot/userbots`, `/userbot/purchases`, `/userbot/profile` (через `ExternalRedirect` — старые SPA-Navigate фактически вели на главную)
- [x] CTA сайта: «Начать бесплатно»/«Открыть кабинет»/login-редиректы → `/userbot`; бейдж тарифа → `/userbot/profile`; «Кабинет» в навигации → `/userbot`; `PayPage` после оплаты («Перейти в кабинет») → `/userbot`

Backend (только юзер-фейсы ссылки, контракты не трогаем):
- [x] `jobs/userbot-inbox.job.js:128`: deep-link → `${PUBLIC_APP_ORIGIN}/userbot/userbots?userbot_id=...`
- [x] `routes/dashboard.routes.js`: все href юзерботных карточек → `/userbot/userbots`, прокси-карточка → `/userbot/proxies` (нашлось 7 мест, разведка говорила про 1)
- [x] `services/userbot.service.js:3090`: текст SAFE_MODE_BLOCKED → `/userbot/userbots`
- [x] `shared/dispatch.js:83`: текст trial-квоты → `/userbot/profile`
- [x] `cd backend && npm run test:autopost` — зелёные

### Фаза 6 — деплой-механика

- [x] root `package.json`: `build:userbot-v2`; `build:v2` (:13) += userbot-v2; `install:active` (:9) и `install:v2` (:28) += userbot-v2
- [x] `scripts/deploy-pull.sh`: `need_userbot_v2_install` по образцу, **first-time node_modules-проверка** (ловушка первого деплоя закрыта), install, сборка через `build:v2`
- [x] `AGENTS.md`: четвёртый рантайм, продуктовое разделение, команды, статус MCP-онбординга
- [x] `ops/RESTORE.md`: третий симлинк + nginx-блок `/userbot/` + отличие userbot-v2/userbot-web
- [x] Деплой push-to-main (e52c16a + фикс-критика 2a75783, оба CI-деплоя success); smoke: `/userbot/` 200, SPA-fallback 200, `/userbot/telegram-web/` 200, старый `/app/telegram-web/` жив, ассеты 200, `/api/userbot-web/status` OK

### Фаза 7 — верификация (условие закрытия)

Матрица paywall-регрессий (по доктрине — на проде, в реальном Chrome через Playwright-расширение):
- [ ] `/app/sales-bot`: контур, привязка/ротация юзерботов (pool/single, toggle, join-all, ensure-admin) — с юзерботом, созданным в `/userbot`
- [ ] Сканирование групп: `/app/bases` AudiencePanel sync с `userbot_id`; ежедневный `audience-sync` (03:00) — `channel_audience_members` растёт; `/api/userbot/fetch-members` из CRM-контекста
- [ ] CRM: batch-add-days, batch-kick через привязанного юзербота; handoff «Написать через юзербота» → `/userbot/userbots` с черновиком
- [ ] Рассылка (полный путь): мастер видит юзерботов с прокси (tg_accounts+proxies читаются напрямую, без переезжающих модулей), выбор отправителей/пул, capacity-подсказка (`/api/messaging`), запуск, история, CampaignReplies (скан ответов через ops-center), Telegram Web из `/app` и из `/userbot`
- [ ] Jobs (логи/pm2): auto-kick fallback + DM, retention fallback, inbox watcher (уведомление с новым deep-link)
- [ ] Юзербот-флоу в `/userbot`: витрина → покупка → QR/импорт → привязка прокси (1:1) → активация из safe-mode → Telegram Web → выпуск MCP-токена → `tools/list` → лог вызовов; продажа лота продавцом
- [ ] Редиректы всей карты + query-прокид; сессия общая (вход в `/userbot` после входа на сайте)
- [ ] Гейты: `tokens:check`, `check:design`, `ui-sync` (3 приложения), autopost-тесты
- [ ] `code-reviewer` сабагент по диффу; после деплоя — `design-critic` на прод-скринах с мобильным кадром 390px и hover-кадрами ключевых контролов (standing rule)
- [ ] Секция «Ревью» ниже заполнена; пункт в BACKLOG.md закрыт

## Риски и закрытие

1. **Разрез `BotsAccountsPage`/`useBotsAccountsData`** — главный технический риск. Проверка 2026-09-26 уточнила: official-режим зависит от юзерботных данных (`accounts` + `proxies` + `reservedUserbotIds`, см. «Разрезается») — разрез с учётом этого. Закрытие: official-контейнер собирается и проверяется в admin-v2 ДО выноса юзербот-режима (gate Фазы 3, включая список вариантов ротации).
2. **Закладки/уведомления со старыми путями** — `ExternalRedirect` с прокидом query покрывает `/app/*`; старый `/app/telegram-web/` остаётся в nginx.
3. **ui-sync молча игнорит третье приложение** — переписывание на «каждый против канона» обязательно в Фазе 1, до появления кода.
4. **hardcodes-ratchet на новом коде** — новый код токен-чистый; `--update-baseline` осознанный, с обоснованием в коммите.
5. **Первый деплой без node_modules** — first-time проверка в deploy-pull.sh (Фаза 6).
6. **Rate-limit `/api/userbot-web/web-session` 5/мин/IP общий на два UI** — низкий риск, зафиксировано.
7. **Каскад `build:v2`** — падение любого фронта валит деплой (существующее поведение, `set -euo pipefail`); осознанно принимаем.

Откат: `git revert` + push (CI перекатит); nginx-location и симлинк безвредны без диста; при необходимости — временный `location /userbot/ { return 302 /app/userbots; }`.

## Ревью (2026-09-26, разделение задеплоено и проверено)

**Деплой:** e52c16a (разделение) + 2a75783 (фиксы критика); оба CI-прогона success. Сервер: симлинк + nginx-блоки `/userbot/` (+ алиас telegram-web) наложены до пуша, бэкап конфига сохранён.

**Локальная верификация:** сборки site/admin/userbot зелёные; `tokens:check` (3 копии байт-идентичны), `ui-sync` 6/6, `check:design` PASS (baseline 6015 → 6030 после фиксов критика, осознанный рост от rgba/hover-классов); autopost-тесты зелёные.

**Code-review (close-out, APPROVE WITH NOTES):** изоляция тенантов не ослаблена (anon-ключ, owner-скоуп, сервисных ключей во фронте нет); official-хук сохранил accounts+proxies+reserved-assets для контурной ротации; перенос дисциплинированный (23 файла байт-идентичны). Все 5 замечаний закрыты: nginx-порядок (выполнен до пуша), тихий rename `/admin-groups` (возвращён), baseline новых страниц (Dashboard/Purchases переписаны токен-чисто, +960→+819→финально ~+834 от перенесённого легаси), корневые jpeg (в коммит не попали), док-остатки (README, AGENTS fonts).

**Прод-верификация (реальный Chrome владельца, Playwright-расширение):**
- общая сессия трёх SPA работает (вход без повторного логина, профиль Pro/кошелёк/Telegram на месте)
- `/userbot`: дашборд с живыми данными (1 юзербот, 7/7 прокси, MCP подключён, журнал реальных вызовов агента); юзерботы (центр @Erik, онбординг, витрина лотов); MCP (токен, промпт, тест); покупки (empty-state с CTA); профиль (Google/Telegram/тариф/кошелёк)
- критический paywall-гейт: `/app/sales-bot` — контур показывает юзербота @Erik, «Участвует в ротации» включён; мастер рассылки на шаге «Юзерботы» выбирает @Erik с прокси и считает ёмкость
- редиректы: `/app/userbots?userbot_id=…` → `/userbot/userbots?userbot_id=…` (query сохранён)

**Design-critic (после деплоя, кадры: десктоп×2, мобайл 390×2, hover):** вердикт REVISE с тремя топ-фиксами — все три применены и задеплоены (2a75783): 4-я карточка «API-ключ (REST)» закрыла hero-сетку (2×2), `card--interactive` hover в app.css обоих приложений, журнал в карточном диалекте + шапка на 390px, копирайт онбординга на «ты».

**Осталось вне этого этапа (см. BACKLOG):** порядок секций на /userbots (центр ниже онбординга независимо от состояния), мобильный горизонтальный скролл журнала вызовов (статус за свайпом), e2e покупки за TON на живых деньгах, скан ответов рассылки (CampaignReplies) живой кампанией, Telegram Web открытие из обоих приложений живым кликом (алиас проверен curl 200).

**Урок:** разведка «3 строки бэкенда» оказалась 10 (grep по всем маршрутам обязателен); npm run script --flag не пробрасывает флаг — гейтовые флаги гонять напрямую `node design/…`.
