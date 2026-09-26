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

## Ревью (2026-09-27, вынос ботов задеплоен и проверен)

**Деплой:** cf26a94 (вынос) → 606b1e3 (копи-проход критика) → 01672a6 (хвост «вы»-формы). Все CI-прогоны success. Сервер: симлинк + nginx `/bots/` наложены до пуша, бэкап сохранён.

**Локальная верификация:** 4 сборки зелёные; tokens:check (4 копии байт-идентичны), ui-sync 7/7, check:design PASS (baseline 6885, осознанный рост от перенесённых файлов под новыми путями); autopost-тесты зелёные.

**Code-review (APPROVE WITH NOTES):** P0/P1 нет. Перенос AutopostManagePage хирургический — ровно 5 осознанных ханков на 1967 строк, realtime и защита от гонок сохранены; деплой-цепочка согласована (first-time install ловушка закрыта). Все 4×P2 закрыты в том же пуше (tonconnect-прокси, коммент tailwind, AGENTS Pipeline ×4, смоук деплоя вручную). Легаси `/app/bots` вернут на `/userbot/accounts` — семантика закладок юзерботов сохранена (правка решения сабагента C).

**Прод-верификация (реальный Chrome владельца):** хаб показывает 2 живых бота (@hermes_poster_bot, @bulrun_ru_poster_bot, «Активен») + «Подключить бота» + плейсхолдер «Скоро»; живой редирект `/app/autopost` → `/bots/autopost`; управление: выбор бота, расписание (#1, Europe/Moscow), предложки, журнал, инвайт-админа; `/app` — чистый paywall, автопостера нет ни в сайдбаре, ни в роутах.

**Design-critic (5 кадров, включая мобайл 390 и hover):** **ACCEPT.** Хаб «продаёт: здесь живут твои мелкие боты», «Скоро»-плейсхолдер — аккуратный слот роадмапа (без стрелки — некликабельность закодирована), прогрессивное раскрытие монолита работает. Фиксы применены и задеплоены: копи-проход онбординга на «ты» (13 строк + хвост), подзаголовок не называет приложение, hover:scale снят с карточек каналов (единый без-hover диалект). Замечание «переснять кадры» выполнено (bots2-*.jpeg; dark-темы в продукте нет — light-only).

**Обнаружено попутно (не регрессия этого сплита):** Supabase Realtime WS на проде отвечает 403 на handshake даже напрямую с сервера на Kong — прегреждающее состояние инфраструктуры; realtime используется только для живого пуша в журнале управления (REST-данные грузятся нормально). Перенесено в BACKLOG.

**Остатки (BACKLOG):** кит мелких ботов (обобщение bot-lifecycle/scheduler/скоупов/квоты под следующий бот), шифрование `autopost_bots.bot_token` (сейчас открытым текстом в БД), realtime WS 403, фильтр autopost-каналов в paywall-выдачах `channels`, опечатка `AUTOPST_LOG_LEVEL` + `CHECKLIST_EVENTS_RETENTION_DAYS` в .env.example, разделение QuickStart-монолита на подстраницы.

## Риски
1. **`channels` без фильтров**: paywall-запросы видят autopost-каналы (существующее поведение; при выносе не ломается — не трогаем). Отдельное решение о фильтрах — в BACKLOG.
2. **Realtime**: QuickStart подписки на 3 таблицы — same origin сохраняем, креды те же.
3. **Single-instance polling**: один процесс бэкенда — не трогаем, ничего не меняется.
4. **Квота trial=1/pro=3** в текстах ошибок может указывать на /app/billing — юзер-фейс, проверить при переносе.
