# NOTICE — Third-Party Attribution

BullRun использует работы следующих проектов. Лицензии каждого — в соответствующих репозиториях.

## Core dependencies

| Проект | Лицензия | Где используется |
|---|---|---|
| [Supabase](https://github.com/supabase/supabase) | Apache-2.0 | База данных, auth, storage (self-hosted) |
| [Express](https://github.com/expressjs/express) | MIT | HTTP-сервер в `backend/` |
| [Telegraf](https://github.com/telegraf/telegraf) | MIT | Официальные Telegram-боты в `backend/services/official-bot/` |
| [GramJS (telegram)](https://github.com/gram-js/gramjs) | MIT | Userbot-клиент в `backend/services/userbot.service.js` |
| [node-cron](https://github.com/node-cron/node-cron) | ISC | Фоновые jobs в `backend/jobs/` |
| [pg](https://github.com/brianc/node-postgres) | MIT | PostgreSQL-клиент |
| [axios](https://github.com/axios/axios) | MIT | HTTP-клиент для внешних API |
| [qrcode](https://github.com/soldair/node-qrcode) | MIT | QR-код для userbot onboarding |
| [multer](https://github.com/expressjs/multer) | MIT | File uploads в backend |
| [pdf-parse](https://github.com/aftership/pdf-parse) | MIT | Парсинг PDF-чеков в shop |

## Frontend

| Проект | Лицензия | Где используется |
|---|---|---|
| [React](https://github.com/facebook/react) | MIT | admin-v2 и site-v2 |
| [Vite](https://github.com/vitejs/vite) | MIT | Сборка admin-v2 и site-v2 |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | MIT | Стили в admin-v2 и site-v2 |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | MIT | UI-компоненты |
| [Lucide](https://github.com/lucide-icons/lucide) | ISC | Иконки |
| [React Router](https://github.com/remix-run/react-router) | MIT | Routing |

## Telegram Web (userbot-web)

| Проект | Лицензия | Где используется |
|---|---|---|
| [Ajaxy/telegram-tt](https://github.com/Ajaxy/telegram-tt) | GPL-3.0 | Вендорный веб-клиент Telegram в `userbot-web/upstream/` (gitignored, ставится отдельным clone) |

**Важно про лицензию telegram-tt:**

- Сам проект Ajaxy/telegram-tt распространяется под **GPL-3.0**.
- BullRun содержит **патчи** поверх upstream в `userbot-web/patches/` — они распространяются под **AGPL-3.0** как часть этого репо.
- Совместимость: GPL-3.0 совместим с AGPL-3.0 — патчи и upstream могут жить в одном дистрибутиве.
- Upstream не коммитится в BullRun-репо (см. `.gitignore`); для локальной работы нужен отдельный clone upstream (см. `userbot-web/README.md`).

## Supabase self-host

BullRun запускает self-hosted Supabase. Состав Supabase распространяется под смешанными лицензиями (Apache-2.0 / FreeBSD / PostgreSQL). Полный attribution — на [supabase.com/legal](https://supabase.com/legal).

## Иконки и asset'ы

- Lucide icons (ISC) — см. выше
- Логотипы и бренд-asset'ы BullRun — авторские, разрешены к использованию только как часть дистрибутива BullRun под AGPL-3.0.

## License summary

Код BullRun — под [AGPL-3.0](./LICENSE). Все вышеперечисленные third-party работы остаются под их собственными лицензиями.
