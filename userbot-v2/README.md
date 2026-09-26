# userbot-v2

Приложение «Юзербот» Bullgram на React/Vite — кабинет управления юзерботами,
прокси, агентом (MCP) и API-ключами. Отделяется от paywall-кабины `admin-v2`
(план `docs/plans/2026-09-26-userbot-product-split.md`).

## Принцип
- живёт по пути `/userbot` (vite `base: '/userbot/'`, router `basename="/userbot"`)
- backend, аккаунт и сессия общие с `site-v2` и `admin-v2` (один origin, self-hosted Supabase)
- дизайн — общая система токенов (`design/tokens/`) и канонический кит `components/ui`
  из admin-v2; общие файлы держит байт-в-байт гейт `design/ui-sync.mjs`
- граница продуктов: управление юзерботами — здесь, использование юзерботов
  paywall-фичами (рассылки, сканирование, авто-кик) — в `admin-v2` (`/app`)

## Старт
```bash
cd userbot-v2
npm install
npm run dev      # dev-port 4274
npm run build
```

## Контур
Полностью реализовано (Фаза 3b): дашборд, юзерботы (онбординг/центр/витрина/лоты), прокси, MCP-агент, API-ключи, покупки, профиль.

- Дашборд `/`
- Юзерботы `/userbots` (онбординг, центр управления, витрина, лоты)
- Прокси `/proxies`
- Агент `/mcp` (подключение ИИ-агента, Bullgram MCP)
- API-ключи `/api` (REST)
- Покупки `/purchases`
- Профиль `/profile` (идентичность, тариф, TON-кошелёк, Telegram)

Не путать с `userbot-web/` — это вендорный форк telegram-tt, который nginx
отдаёт как `/app/telegram-web/` (позже алиас `/userbot/telegram-web/`).
