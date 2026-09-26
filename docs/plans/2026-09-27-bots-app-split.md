# Вынос мелких ботов: приложение «Боты» (/bots), Автопостер — первый модуль

Дата: 2026-09-27. Статус: реализация. Плейбук — docs/plans/2026-09-26-userbot-product-split.md (обкатан, задеплоен).

## Решения (зафиксированы владельцем 2026-09-27)

- «Автопостер» и будущие мелкие боты — отдельная поверхность **«Боты», путь `/bots`, папка `bots-v2`**. Хаб: карточки ботов владельца + «подключить нового». Paywall остаётся в `/app` обособленно («Бот продаж» и весь контур продаж).
- Разведка (2026-09-27): автопостер самодостаточен — свои таблицы (`autopost_bots`…), свой Telegraf-polling lifecycle, 3 джобы, 12 MCP-тулов, внешний REST; во фронте 2 файла (~2000 строк); paywall-зависимостей ноль, обратных тоже. Общее: `channels` (двойная принадлежность `owner_id/bot_id` + `autopost_bot_id`, мерж по `tg_chat_id` — схему НЕ трогаем), auth/owner_id, tier-квота (оставляем).
- Бэкенд не трогаем. Токен-чистые новые экраны. `bot_token` в БД открытым текстом — осознанно оставляем (шифрование — отдельная задача кита мелких ботов, в BACKLOG).

## Фазы

### Фаза 1 — дизайн-пайплайн на 4 приложения (главная)
- [ ] `design/build.mjs`: OUTPUTS += `bots-v2/src/styles/tokens.css` (+комментарии)
- [ ] `design/ui-sync.mjs`: APPS += `bots-v2`
- [ ] `design/check-design.mjs`: LINT_TARGETS += `bots-v2/src` (filter уже есть)
- [ ] tokens:build/check зелёные; ui-sync PASS — после каркаса (Фаза 2 кладёт 5 shared-файлов байт-в-байт)

### Фаза 2 — каркас bots-v2 (сабагент A)
- [ ] Копия инфраструктуры из **userbot-v2** (чище админки): config, api/client, lib/{supabase,utils}, AuthProvider, AuthGate, ErrorBoundary, LoadingState, CodeBlock, кит ui (по импортам QuickStart: button/card/input/select/badge + sonner + зависимости), styles (tailwind.css с `/bots/`-префиксом, app.css, tokens.css НЕ трогать), шрифты, vite (base `/bots/`, порт 4374), index.html («Боты — Bullgram»)
- [ ] БЕЗ productTier, БЕЗ ton-connect/buffer-polyfill/TonConnectProvider, БЕЗ shop/telegram-фич — автопостеру не нужны
- [ ] main.jsx: AuthProvider → BrowserRouter basename="/bots"; App.jsx: сайдбар «Боты» (Хаб `/`, Автопостер `/autopost`), профиль-строка → внешняя `/userbot/profile`, «На сайт»
- [ ] Build зелёный, ui-sync PASS 6/6, grep без `/app/` (кроме осознанных внешних)

### Фаза 4-админ — admin-v2 (сабагент C, параллельно A)
- [ ] Роут `/autopost` + lazy-импорт QuickStartPage убрать → ExternalRedirect `/autopost` → `/bots/autopost`
- [ ] Сайдбар: секция «BotFather-боты» → пункт «Бот продаж» (paywall) без секционной обвязки
- [ ] Битый `/admin-groups` (`to="/app"` даёт `/app/app`) → `to="/"`
- [ ] Файлы QuickStartPage.jsx/pages/autopost НЕ удалять (удалит главная после Фазы 3)
- [ ] Build зелёный, grep autopost-линков чист

### Фаза 6 — деплой-механика (главная)
- [ ] root package.json: `build:bots-v2`, `build:v2` += bots, install:active/install:v2 += bots
- [ ] deploy-pull.sh: need_bots_install + first-time
- [ ] AGENTS.md (5-й рантайм), ops/RESTORE.md (4-й симлинк + nginx `/bots/`)

### Фаза 3 — перенос UI (сабагент B, после A)
- [ ] QuickStartPage.jsx + autopost/api.js → bots-v2 (адаптации: `/app/integrations` → `/userbot/api` (протухший указатель), заголовки/подписи под «Боты»)
- [ ] Хаб `/` (токен-чисто): GET /api/autopost/bots → карточки ботов (статус, username, каналы) + CTA «Подключить бота» → /autopost; плейсхолдер «следующий бот — скоро»
- [ ] Роуты: `/` хаб, `/autopost` управление, fallback → хаб
- [ ] Build зелёный; realtime (channels/autopost_bots/autopost_items) работает — same origin

### Фаза 4-удаления (главная, после B)
- [x] Удалить admin-v2/src/pages/QuickStartPage.jsx и pages/autopost/ (grep потребителей перед этим — чисто)
- [x] Все 4 сборки + гейты + осознанный baseline (6885, рост от перенесённых файлов под новыми путями) + autopost-тесты

### Фаза 7 — ревью и деплой
- [ ] code-review сабагент → фиксы
- [x] Сервер (выполнено до пуша): symlink /var/www/bullgram-bots-v2, nginx `= /bots` (301) + `/bots/assets/` (иммутабельный кэш) + `/bots/` (SPA fallback), по образцу `/userbot/`; бэкап конфига в /root/nginx-backups/
- [ ] Пуш; smoke `/bots/`, редирект `/app/autopost`, ассеты
- [ ] Браузер-матрица в реальном Chrome: логин, хаб с ботом, QuickStart-управление (каналы/журнал/админы), пост по расписанию живьём, чек-лист тапается, MCP-тулы живые, /app — чистый paywall
- [ ] design-critic (десктоп + мобайл 390 + hover) → фиксы
- [ ] Ревью-секция здесь + BACKLOG

## Риски
1. **`channels` без фильтров**: paywall-запросы видят autopost-каналы (существующее поведение; при выносе не ломается — не трогаем). Отдельное решение о фильтрах — в BACKLOG.
2. **Realtime**: QuickStart подписки на 3 таблицы — same origin сохраняем, креды те же.
3. **Single-instance polling**: один процесс бэкенда — не трогаем, ничего не меняется.
4. **Квота trial=1/pro=3** в текстах ошибок может указывать на /app/billing — юзер-фейс, проверить при переносе.
