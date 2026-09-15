# site-v2 аудит и рефакторинг — бэклог (2026-09-15)

Тот же цикл, что и для admin-v2 (docs/plans/2026-09-14-retention-review-backlog.md), теперь для публичного сайта.

## Цикл (порядок нарушать нельзя)

1. код-ревью (code-reviewer сабагент, один страница за раз)
2. фиксы (параллельные general-purpose сабагенты по несвязанным правкам)
3. ревью диффа
4. депой: push-to-main, `gh run watch` (CI гоняет scripts/deploy-pull.sh)
5. дизайн-критика ТОЛЬКО после деплоя (скриншоты прода через computer-use → реальные PNG пути критику)
6. рантайм-проверки в реальном Chrome (владельца) на проде

## Студийные правила (нарушать нельзя)

- контентный текст минимум text-slate-500; uppercase микро-лейблы 11px — slate-500
- «деятельные» нули (счётчики) — slate-500; «денежные» нули — slate-900
- AA: контент 4.5:1, large 3:1; red-50→red-700, amber-50→amber-700; emerald-700+
- легаси-RUB не трогать
- GramJS lifecycle строго (decrypt → _updateLoop off → connect → disconnect в finally)
- userbot-флаги manual-by-default; у DM-поверхностей предупреждение про общий чат
- тестовые данные — с меткой «аудит», убирать за собой
- бэкслеши в PostgREST or() не работают
- депой только push-to-main

## Продуктовые правила для site-v2

- hero продаёт ОДИН исход: «купил → получил готовое и работающее». Технические фичи
  (прокси, API, MCP, инфра) не перечислять на первом экране (решение владельца 2026-09-12)
- P2P — активный флоу, резолвится через shop; /p2p/* — совместимые маршруты
- Кошельки — два разных money flow, не смешивать (решение владельца 2026-09-15):
  тарифы и юзерботы — платформенный (наш админский) кошелёк;
  платный доступ чужих приваток в сейлер-боте — payment_settings.ton_wallet продавца
- Trial → Normal → Seller путь сохранять и усиливать

## Карта (Explore, 2026-09-15)

Маршруты (src/App.jsx:54-71): `/` HomePage (549) · `/pay/:purchaseId` PayPage (518, PayLayout
с TonConnectUIProvider) · `/create` CreateInvoicePage (547) · `/created/:id` CreatedInvoicePage
(302) · `/access-request` AccessRequestPage (174) · редиректы /shop /purchases /plan →
/app/profile, /quick-start → /docs/quick-start/, `*` → `/`. Прочие маршруты обёрнуты в
SiteAuthGate (пусто на сейчас).

Общее: App.jsx (шелл 185) · AuthProvider (178, supabase.from('profiles') напрямую) ·
api/client.js (fetch без таймаута) · features/ton-checkout/ (useTonCheckout,
TonConnectPayButton, ManualTonPaymentCard) · SecretRevealBlock · lib/my-invoices.js
(localStorage) · lib/build-ton-payload.js.

Бэкенд-связки: /api/billing/checkout/ton-connect + /api/billing/orders/current
(billing.routes.js) · /api/billing/public/:id/* (billing-public.routes.js) ·
/api/public-invoices/* (public-invoices.routes.js) · /api/shop/public/purchase/:id/*
(shop.routes.js ~2698/2763) · /api/invoices/public/* (invoice-public.routes.js) ·
/api/access-requests (access-requests.routes.js).

Риски из разведки: PayPage угадывает kind перебором 4 эндпоинтов (4x poll amplification);
Manrope woff2 в public/ без @font-face (шрифт фактически не подключен); index.html без
meta description/OG; tailwind.css токен-слой мёртв (teal/cream) — страницы на slate/indigo;
`@fontsource-variable/geist` в зависимостях и не импортирован; dist/ закоммичен; anon-key
в конфиге (норма для Supabase, проверить соответствие проекту).

## Волны

| # | Поверхность | Статус |
|---|---|---|
| 1 | `/` HomePage + POST /api/billing/checkout/ton-connect | **done (ACCEPT)** |
| 2 | `/pay/:purchaseId` + PayLayout + ton-checkout + 4 публичных view/verify бэка | in progress |
| 3 | `/create` + `/created/:id` + public-invoices бэкенд | pending |
| 4 | `/access-request` + access-requests бэкенд | pending |
| 5 | общий шелл: App.jsx, AuthProvider, SiteAuthGate/LoginCard/UserProfileCard, api client, config, index.html (шрифты/OG) | pending |
| 6 | батч-рантайм: редиректы, 404, hero-контент против правила «ОДИН исход», финальная дизайн-прогонка | pending |

## Журнал

- 2026-09-15: бэклог создан, волна 1 (код-ревью HomePage) запущена.

## Review

### Волна 1 — `/` (HomePage) — ЗАКРЫТА, дизайн-критика ACCEPT

Код-ревью: fix-first, 3 P1 + 8 P2, P0 нет. Money-path изоляция (owner_id, платформенный
кошелёк, claim-idempotency verify) подтверждена ревьюером.

P1-фиксы:
1. verify-поллинг: catch-ветка спала только на pending → 13 ретраев выгорали за ~2с при
   HTTP-ошибках; теперь sleep в catch (окно ~65с сохранено).
2. После неудачной verify кнопка предлагала ПОВТОРНУЮ оплату (двойная оплата, деньги
   теряются) → recovery-режим «Проверить платёж снова» (verifyCurrent), свежая оплата
   только из idle; «Платёж не ушёл — оплатить заново» — явная ссылка-reset; busy-герд
   на recovery-кнопке (доработано в ревью диффа); кошелёк-отвал → честное сообщение.
3. H1 «Юзерботы для Telegram с API и MCP» нарушал правило «ОДИН исход» → «…которые
   работают с первого дня» (+ запятая перед «которые», nbsp против висячих предлогов).

P2: GRAM→TON на карточках/бейдже (цепная валюта); provider-гард pending-баннера
(фронт) + .eq('provider','ton_connect') в getCurrentBillingState (бэк, consumers
проверены — безопасно); «Счёт истёк» при 00:00 вместо вечного «Завершить оплату»;
маскировка PLATFORM_TON_WALLET из 503-ответа (лог серверно); сетевые ошибки без
английского «Failed to fetch»; slate-400→500 микро-лейблы; мёртвый href/комментарии.

Дизайн-критика (3 раунда): REJECT(скриншоты секций показали героя 4 раза —
программный скролл не пробил scroll-snap) → починена съёмка через hash-ссылки,
заодно найден реальный баг: hash-скролл работал только для #tariffs, #paywall/
#userbots/#quick-start не работали — эффект обобщён на все секции. REJECT(секция 3:
нет кнопки покупки в пике желания, жаргон AI-Agents/n8n первым предложением) →
добавлена primary «Купить готового юзербота» (→ /app/userbots), REST API/MCP понижены
до ghost, подзаголовок исход-первым. ACCEPT (все 5 секций pass, P1/P2 нет).

Рантайм-клики (прод, реальный Chrome владельца): флагман-CTA → /app/userbots ✓;
«Пройти Quick Start» → /docs/quick-start/ ✓; «Открыть кабинет» → /app/profile ✓.
Консоль браузера недоступна из computer-use — не проверена (билд+смок+рендер ок).

Отложено (записать владельцу при случае): фиат-якорь к «10 TON» (нужен курс/решение);
proof-бит в нижней трети героя; порядок буллитов Pro (исход «уже готовый тг-аккаунт»
первым вместо «безлимит по API и MCP») — взять в волну 6; мобильная прогонка.

Коммиты волны: 179cb1d (бэклог), e00c24c (фиксы кода), + правки критики и hash-скролл
(2 коммита), + финальные P3.
