# bots-v2

Приложение «Боты» Bullgram на React/Vite — хаб мелких ботов владельца.
Первый модуль — **автопостер** (переносится из paywall-кабины `admin-v2`).
План: `docs/plans/2026-09-27-bots-app-split.md`; плейбук разделения —
`docs/plans/2026-09-26-userbot-product-split.md`.

## Принцип
- живёт по пути `/bots` (vite `base: '/bots/'`, router `basename="/bots"`, dev-port 4374)
- backend, аккаунт и сессия общие с `site-v2`, `userbot-v2` и `admin-v2`
  (один origin, self-hosted Supabase) — вход без повторного логина
- дизайн — общая система токенов (`design/tokens/`, генерат
  `src/styles/tokens.css` не редактируется руками) и канонический кит
  `components/ui` из admin-v2; общие файлы держит байт-в-байт гейт
  `design/ui-sync.mjs` (`lib/utils.js`, `button/input/badge/card.jsx`)
- профиль и тариф живут в «Юзерботе» (`/userbot/profile`) — сайдбар ведёт
  туда внешней ссылкой; paywall-кабина (`/app`) остаётся обособленной

## Старт
```bash
cd bots-v2
npm install
npm run dev      # dev-port 4374, proxy /api на localhost:3000
npm run build
```

## Контур (Фаза 2 — каркас)
- `/` — хаб ботов (заглушка; карточки ботов появятся в Фазе 3)
- `/autopost` — управление автопостером (заглушка; QuickStart-UI переедет из admin-v2)

Не путать: paywall-продажи («Бот продаж», автопост до переезда) остаются
в `admin-v2` (`/app`); юзерботы и прокси — в `userbot-v2` (`/userbot`).
