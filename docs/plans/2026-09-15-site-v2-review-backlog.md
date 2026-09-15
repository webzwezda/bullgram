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
| 1 | `/` HomePage + POST /api/billing/checkout/ton-connect | in progress |
| 2 | `/pay/:purchaseId` + PayLayout + ton-checkout + 4 публичных view/verify бэка | pending |
| 3 | `/create` + `/created/:id` + public-invoices бэкенд | pending |
| 4 | `/access-request` + access-requests бэкенд | pending |
| 5 | общий шелл: App.jsx, AuthProvider, SiteAuthGate/Login/UserProfileCard, api client, config, index.html (шрифты/OG) | pending |
| 6 | батч-рантайм: редиректы, 404, hero-контент против правила «ОДИН исход», финальная дизайн-прогонка | pending |

## Журнал

- 2026-09-15: бэклог создан, волна 1 (код-ревью HomePage) запущена.

## Review

(заполняется по ходу)
