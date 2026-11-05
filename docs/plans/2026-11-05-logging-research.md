# Исследование: логирование для Bullgram (весь проект)

Дата: 2026-11-05. Статус: исследование, внедрение — по слову владельца.
Триггер исследования: инцидент 2026-11-04 (лот снят с витрины автопроверкой — причина была видна только в pm2-логах на сервере, в БД ни следа).

## 1. Топология (данность, вокруг которой строим)

- **Backend**: Node.js 22, ESM, Express-монолит `backend/`. Один процесс в PM2 (`bullgram-tg-backend`, cluster mode, instances=1, ~180 рестартов при деплоях, `max_memory_restart 500M`). Внутри процесса ~29 node-cron джоб (`backend/jobs/`), долгие Telegram-операции (GramJS userbot, Telegraf), внешний REST `/api/external/v1`, MCP endpoint (JSON-RPC от ИИ-агентов).
- **Логи сейчас**: PM2 `log_date_format 'YYYY-MM-DD HH:mm Z'` → `./logs/out.log` + `./logs/error.log`, merge_logs, **ротации нет** (71MB и растёт).
- **Данные**: self-hosted Supabase (PostgreSQL) на том же сервере в Docker. Docker уже есть (supabase-стек, n8n, 3proxy), journald есть, fail2ban есть.
- **Мультиарендность**: все запросы owner-scoped (`owner_id`).
- **Секреты в системе**: зашифрованные Telegram-сессии (`session_data`), `bot_token` в БД открытым текстом, пароли SOCKS-прокси, телефоны пользователей, TG API credentials.
- **Фронт**: 6 React/Vite SPA (site, admin, userbot, bots, treasury, profile), nginx раздаёт статику, общий ui-kit (canonical в admin-v2, гейт ui-sync).
- **Философия**: Simplicity First, минимальные зависимости, самохостинг, деплой push-to-main → `pm2 reload`, зависимость добавляется в том же коммите, что и код. Сопровождение: 1 владелец + ИИ-агенты; чтение логов — ssh + grep/jq.

## 2. Аудит текущего состояния (факты)

### 2.1 Объём и стиль console.*

Всего в prod-коде backend (без test/scripts): **604 вызова** — `console.error` 413, `console.log` 124, `console.warn` 67, `console.info` 0.

| Каталог | log | warn | error |
|---|---|---|---|
| `backend/routes/` | 14 | 15 | 163 |
| `backend/services/` | 19 | 17 | 131 |
| `backend/jobs/` | 87 | 31 | 97 |
| `backend/utils/` | 0 | 1 | 9 |
| `backend/shared/` | 0 | 0 | 4 |
| `backend/server.js` | 4 | 0 | 7 |

Топ файлов: `routes/userbot.routes.js` (51), `routes/shop.routes.js` (31), `services/official-bot.service.js` (27). Стили вперемешку: ~80 разных `[Тег]`-префиксов (RU+EN), emoji, русский текст без тегов, многострочные дампы объектов, один JSON.stringify (`jobs/telegram-web-health.job.js:61`).

**Единственный структурированный логгер — сирота**: `backend/services/autopost/logger.js` пишет JSON `{ts, level, module, event, ...}`, уровни debug/info/warn/error, но используется только 3 файлами (остальной autopost пишет `[Autopost]` в console). Баг: env-переменная `AUTOPST_LOG_LEVEL` (logger.js:13) vs задокументированная `AUTOSTRUCT_LOG_LEVEL` (строки 8-9).

### 2.2 Утечки секретов в логи (подтверждённые)

1. **Пароль SOCKS-прокси в error.log** — реальный инцидент (нашёлся при разборе 2026-11-04):
   - `services/userbot.service.js:491` — `console.error('[GramJS _errorHandler]', error)` дампит `SocksClientError` целиком, а тот несёт `.options` с `userId`/`password` (`socks/build/common/util.js:7-12`). Прокси строится в `_buildProxy` (userbot.service.js:716-740) с реальными кредами.
   - `services/userbot.service.js:1116` — `console.log('[QR-GENERATE] Создаем TelegramClient с proxyConfig:', proxyConfig)` — прямой дамп конфига с паролем. Ирония: сам `_buildProxy` (733-739) логирует sanitized-версию.
2. **Email получателя**: `services/email.service.js:58` логирует адрес.
3. Что НЕ течёт (проверено grep): `session_data`, значения `bot_token`, телефоны, JWT/заголовки — значения нигде не пишутся, только факты ошибок.
4. Кодовый факт вне логов: fallback `TG_API_HASH || '014b...'` захардкожен (`server.js:96`).

### 2.3 HTTP-слой

- **Request-логирование отсутствует**: в `server.js` нет ни morgan, ни pino-http, ни кастомного middleware — ни один запрос не логируется.
- **Error-middleware Express отсутствует**: каждый роут ловит ошибки локальными try/catch → `console.error` + `res.status(500)`.
- **Correlation ID отсутствует физически**: `shared/dispatch.js:154,201` пишет `request_id: req?.id || null`, но `req.id` никто не выставляет → колонка `mcp_tool_log.request_id` всегда null.
- `unhandledRejection` → console.error; `uncaughtException` → `console.error('[FATAL] ...')` и **процесс не завершается** (`server.js:108-113`) — сомнительная практика, но отдельное решение (см. §8, открытые вопросы).

### 2.4 Cron-джобы

- Сквозного run id нет ни в одной джобе; длительности прогонов не меряются; «конец прогона» логируется только предметными сообщениями.
- 16 джоб логируют `started { interval_ms }` при регистрации; ошибки тика — однострочный `console.error` с message, часто без стека.
- Пер-событийная болтливость: `official-bot-webhook-queue.job.js:111` логирует каждый update.

### 2.5 DB-аудит (уже есть — не дублировать!)

Граница «домен-аудит в БД» уже проведена и проведена правильно:

| Таблица | Кто пишет | Ретеншн |
|---|---|---|
| `telegram_error_events` | `utils/telegram-error-events.js:99` (+ классификатор ошибок TG) | **нет** |
| `mcp_tool_log` | `shared/audit-log.js` из dispatch/integrations | **да** — pg_cron 90d |
| `telegram_web_audit` | `services/mtproto-bridge.service.js:132` | **нет** |
| `userbot_send_log` | `services/messaging-router.service.js:201` (ledger квот) | **нет** (нужен для квот) |
| `userbot_join_log` | `services/broadcast-preparation.service.js:659` | **нет** |
| `access_events`, `billing_events`, `payment_events`, `referral_events`, `customer_funnel_events` | джобы/роуты/SQL-RPC | **нет** |

Вывод §7 внешнего исследования: это append-only аудит — ему место в БД, ретеншн по классам (деньги — годы, безопасность — 1-2 года). Файловые логи несут только **id** ссылок на события, не дубли.

### 2.6 Фронт (6 SPA)

- **Глобальных перехватчиков ноль**: ни `window.onerror`, ни `unhandledrejection` во всех 6 src.
- **ErrorBoundary есть** во всех 6 (почти идентичный `src/ui/ErrorBoundary.jsx`), но в 5 аппах из 6 стоит **внутри `<AuthGate>` и покрывает только `<Routes>`** — сайдбар, OpsRail, Toaster вне него. `site-v2` оборачивает всё приложение.
- **Endpoint-приёмника клиентских ошибок не существует** (grep sendBeacon/reportError/api/log — пусто). 36 console.* в src видит только пользователь.
- **Sourcemaps выключены** во всех 6 (`build.sourcemap` не задан, дефолт Vite false) — для безопасности это правильно, сохранить.

### 2.7 Тесты

- 28 ad-hoc node-скриптов без фреймворка. Console перехватывают ровно 2: canary «неожиданный console.error = fail» (`test/test-lifecycle-dm.js:171-180`) и `captureWarns` (`test/test-broadcast-cleanup.js:274-283`). Внедрение логгера не должно сломать canary (см. фазу 3).

## 3. Требования к целевому логированию (из топологии)

1. **Structured JSONL** — читается jq/grep по ssh; поля `time, level, module, event, reqId, owner_id, durationMs`.
2. **Секреты не утекают никогда** — redaction на своих вызовах + сериализатор ошибок белым списком + глушение сторонних дампов (GramJS).
3. **Tenant-разметка** — `owner_id` из аутентифицированного контекста в каждой строке запроса; никогда из body/query.
4. **Correlation** — request-id на каждый HTTP-запрос, run-id на каждый прогон джобы; заполнить `mcp_tool_log.request_id`.
5. **Уровни с политикой** — signal/noise: успешные HTTP не пишем (иначе health-check-джобы за месяц снова дадут 71MB).
6. **Ротация** — обязательна, с потолком размера.
7. **Фронт виден** — клиентские ошибки доезжают до backend, без внешних SaaS.
8. **Ноль новой обязательной инфры** — без Loki/Grafana/Sentry на текущем масштабе.
9. **Аудит-таблицы не дублируются** — файловый лог только со ссылками (id).
10. **Миграция без большого bang** — 604 console.* не переезжают за один коммит; новый код сразу на логгере, старый — по мере касания + ratchet-гейт.

## 4. Рекомендуемый стек (TL;DR)

| Слой | Выбор | Версия | Почему |
|---|---|---|---|
| Логгер | **pino** | `pino@10.4.0` | 3-10x быстрее winston, JSON из коробки, child loggers, redact (fast-redact), ESM, sonic-boom в stdout без worker'ов |
| HTTP | **pino-http** | `pino-http@11.0.0` | request-id, `req.log` child, customLogLevel |
| Pretty | pino-pretty | `pino-pretty@13.2.0` | **только dev** (пайпа `node server.js \| pino-pretty`), в прод не попадает |
| Контекст | нативный `AsyncLocalStorage` | встроен | cls-hooked мёртв; но стартуем с явной передачей child-логгера, ALS — при необходимости |
| Ротация | **pm2-logrotate** | `3.0.1` | 10M x 14 x gzip, без новой инфры; план Б — logrotate.d + copytruncate |
| PM2 | без замены, **убрать `log_date_format`** | — | префикс ломает JSONL и режет многострочные объекты (pm2#1505, #4519, #5244); время — поле `time` от pino |
| Фронт | свой capture → `POST /api/log` | — | ~100 строк на 6 аппов, ноль инфры; апгрейд-путь GlitchTip 6 |
| Агрегация | файлы + jq | — | Loki+Grafana = 0.5-1.5GB RAM ради одного источника — нет |
| OTel | отложить | — | один процесс-монолит; JSONL-контракт совместим с OTel semconv на будущее |

Ключевые конфиги (полные наброски — в приложении к исследованию, ниже сокращённо):

```js
// backend/utils/logger.js — фабрика
export const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: safeErr },   // type/message/code + stack ≤5 строк; НЕ тянем err.cause/socket/config — там жили пароли прокси
    redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie',
                '*.bot_token', '*.session_data', '*.proxy_password', '*.password',
                '*.api_id', '*.api_hash', '*.phone', '*.ton_seed', '*.mnemonic', ...],
        censor: '[redacted]',
    },
});

// server.js — HTTP
app.use(pinoHttp({
    logger,
    genReqId: (req, res) => { const id = req.headers['x-request-id'] ?? randomUUID(); res.setHeader('x-request-id', id); return id; },
    autoLogging: { ignore: (req) => req.url.startsWith('/api/health') },
    customLogLevel: (req, res, err) => (err || res.statusCode >= 500) ? 'error' : res.statusCode >= 400 ? 'warn' : 'silent',
}));
// после auth-middleware: req.log = req.log.child({ owner_id: req.user.id })

// джоба
const runId = randomUUID();
const log = logger.child({ job: 'health-check', runId });
const t0 = performance.now();
log.info('started'); /* ... */ log.info({ durationMs: Math.round(performance.now() - t0), ok: n, failed: m }, 'finished');
```

```bash
# ротация (один раз на сервере)
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
pm2 flush   # разово погасить текущие 71MB
```

Политика уровней:
- `error` — провал с потерей функции/данных (неуспешная оплата, мёртвая сессия, необработанное исключение).
- `warn` — деградация с самовосстановлением (FloodWait, прокси-таймаут с ретраем, fallback, клиентская ошибка из `/api/log`).
- `info` — бизнес-факты и переходы состояний (start/finish джобы с durationMs, выдача лота). Успешные HTTP — silent.
- `debug` — только dev (`LOG_LEVEL=debug`).

## 5. Ключевые решения и обоснования

### 5.1 Почему pino, а не winston/consola/tslog
Winston — гибкие транспорты, которых нам не нужно (пишем в stdout, файлы ведёт PM2); не JSON по умолчанию, без redact. Consola/tslog — DX-инструменты без redact/HTTP-интеграции под прод. pino v10 (ESM, Node ≥20) закрывает всё. Источники: betterstack.com pino-vs-winston, dash0.com nodejs-logging-libraries.

### 5.2 PM2: без pino-транспортов
`pino.transport()`/targets/pretty-transport работают в worker thread и известны проблемами на SIGTERM/reload (pino#2002; в PM2 cluster — directus#21271) — при ~180 деплой-рестартах это потеря буфера/зависания. Решение: дефолтный stdout-режим pino (sonic-boom, без worker), файлы — зона ответственности PM2. Pretty — только dev-пайпой.

### 5.3 `log_date_format` убрать в том же деплое, что и pino
PM2 префиксует stdout-строки своим timestamp и режет многострочные объекты → JSONL невалиден для jq (причём error-лог у PM2 вообще без времени — pm2#4519). Время живёт в поле `time` JSON.

### 5.4 Redaction двухслойная
pino redact работает только на **наших** вызовах. Против дампов сторонних библиотек:
1. Сериализатор `err` белым списком (type/message/code/stack≤5) — отсекает `SocksClientError.options` с паролем прокси (наш реальный инцидент).
2. GramJS глушится: `baseLogger: new Logger('error')` в `prepareServiceClient` (сейчас `setLogLevel('none')` стоит не на всех клиентах) + убрать прямой дамп `proxyConfig` (userbot.service.js:1116). Репозиторий gramjs заархивирован (14.07.2026, read-only) — рассчитываем только на себя.
3. Опционально: shim `console.error/warn` → pino в `server.js` — чужой console-вывод тоже попадает в JSONL и redact-контур. Shim ставится только в entry-точке сервера — тестовый canary `test-lifecycle-dm.js` продолжает работать (он подменяет console.error в тестовом процессе, до шима дело не доходит).

### 5.5 Correlation без магии
Стартуем с явной передачей: `req.log` от pino-http в роуты → child в сервисы аргументом. Это дороже в строках, но соответствует explicit-философии репо; ALS — только если протаскивание станет невыносимым (контекст рвётся на экзотических EventEmitter — nodejs/node#33723). `dispatch.js` получает `req.id` бесплатно от `genReqId` — колонка `mcp_tool_log.request_id` начинает заполняться без изменения таблицы.

### 5.6 Аудит остаётся в БД
Граница уже правильная: деньги/безопасность — `billing_events`/`payment_events`/`telegram_error_events`/`mcp_tool_log` (append-only, ретеншн годами), диагностика — ротируемые JSONL (14 дней). Файловая строка о денежном событии несёт только id. Сопутствующая находка аудита: **9 из 10 audit-таблиц без ретеншна** — отдельная задача (BACKLOG §29).

### 5.7 Фронт: DIY capture, GlitchTip — апгрейд-путь
- Один capture-модуль в общем ui-kit (по образцу `src/ui/OpsRail.jsx` — byte-identical копии, гейт ui-sync): `window.addEventListener('error')` + `unhandledrejection` (rejections НЕ триггерят onerror) + расширение ErrorBoundary (заодно вынести его за AuthGate в 5 аппах).
- Доставка: батч ≤10, `sendBeacon`/`fetch keepalive` на pagehide + таймер 5с, клиентский rate-limit ~10/сессия, payload ≤4KB, allowlist-поля (`app, message, stack≤2000, url, ts, release`).
- Приёмник: публичный `POST /api/log` с жёстким rate-limit по IP (express-rate-limit, ~10/мин), валидация allowlist, уровень warn + `source:'web'`; `owner_id` присоединяется только при валидном JWT.
- Sourcemaps в прод **не включать** (утечка исходников; минифицированные стектрейсы по message+URL достаточны). Апгрейд-путь: GlitchTip 6 (4 контейнера, ~512MB-1GB, Sentry-совместимый SDK) — когда DIY надоест; Sentry self-hosted (40+ контейнеров, 8-16GB) — не наш вариант.

### 5.8 OpenTelemetry — отложить
Один процесс-монолит: trace_id без трейсера — шум. `instrumentation-pino` сломан (otel-js-contrib#3292, Dec 2025). Наш JSONL-контракт (`time/level/reqId/owner_id/durationMs`) — совместим с OTel semconv: когда появится второй источник, collector (filelog receiver) подхватит файлы без переписывания приложения.

## 6. Целевая картина (после внедрения)

- `logs/app.out.jsonl` / `logs/app.err.jsonl` (PM2), ротация 10M x 14 gzip — потолок ~150MB вместо бесконечного роста.
- Чтение: `ssh srv "tail -100 /srv/bullgram/backend/logs/app.out.jsonl | jq 'select(.level>=40)'"`, по арендатору: `jq 'select(.owner_id=="…")'`, по инциденту: `jq 'select(.reqId=="…")'`.
- Каждый HTTP-запрос ≥400 и каждая джоба имеют id; `mcp_tool_log.request_id` заполнен; секретов в логах нет (проверяется grep'ом по маскам).
- Клиентские ошибки 6 SPA видны в тех же логах (`source:'web'`).
- Домен-аудит — как раньше, в БД.

## 7. План внедрения (фазы, каждая — отдельный PR)

- **Фаза 0 — инфра (без кода приложения)**: pm2-logrotate + конфиг; `log_date_format` убрать из `ecosystem.config.cjs` (применится в первом же `pm2 reload` фазы 1 — отдельный деплой ради этого не нужен); разово `pm2 flush`. В `ops/RESTORE.md` — секция «Логи» (где лежат, как читать, потолок).
- **Фаза 1 — ядро backend**: `pino` + `pino-http` (та же зависимость в том же коммите — правило репо); фабрика `backend/utils/logger.js` (redact, safeErr); pinoHttp middleware (genReqId, silent <400, ignore health); `owner_id` child после auth; console-shim в `server.js`; глушение GramJS (`baseLogger`) + удаление двух дампов с паролем прокси; `unhandledRejection`/`uncaughtException` через logger. Мигрировать `autopost/logger.js` на общий factory (сохранить поля `module/event` как bindings, починить опечатку `AUTOPST_LOG_LEVEL` → `LOG_LEVEL`).
- **Фаза 2 — джобы**: общий хелпер прогона (runId, durationMs, счётчики ok/failed) — обёртка для ~15 setInterval-джоб; end-of-run лог. Инцидент 2026-11-04 после этого виден в JSONL, а с BACKLOG §27 — и в `telegram_error_events`.
- **Фаза 3 — миграция 604 console.***: не разом. Правило «трогаешь файл — мигрируешь его логи»; ratchet-гейт в CI (`ops/scripts/ci/`): подсчёт `console.*` в backend prod-коде против baseline, рост блокирует push (по образцу design hardcodes-ratchet). Canary `test-lifecycle-dm.js` сохраняется — новый код console.error не вызывает вовсе.
- **Фаза 4 — фронт**: capture-модуль в ui-kit (byte-identical по аппам, ui-sync) + глобальные listeners в `main.jsx` всех 6; ErrorBoundary за AuthGate; `POST /api/log` (rate-limit, allowlist); client rate-limit и batching.
- **Фаза 5 — опционально, по триггерам**: GlitchTip (надоело разбирать клиентские ошибки руками); Loki+Alloy (источников ≥3-4 и grep-сессии стали рутиной).

## 8. Открытые вопросы (решение владельца)

1. **Успешные HTTP-запросы**: принимать silent (рекомендация) или всё же info для аудита доступа (тогда nginx access log может закрыть это дешевле)?
2. **`uncaughtException` не завершает процесс** (`server.js:108-113`) — антипаттерн (состояние после uncaught может быть неконсистентным). Менять поведение на log&exit — отдельное решение, в лог-фазы не заворачивать.
3. **Ratchet-гейт на console.*** — добавлять в `npm run ci` или держать дисциплину на ревью?
4. **`POST /api/log` без JWT** — принять публичный приёмник с rate-limit (рекомендация: да, ошибки бывают до логина) или требовать JWT?
5. **Аудит-таблицы без ретеншна** (9 шт.) — завести отдельную задачу на pg_cron-чистку по классам (деньги — годы, безопасность — 1-2 года, остальное — 90d)?
6. Хардкод `TG_API_HASH || '014b...'` в `server.js:96` — убрать fallback (fail-fast без env)?

## 9. Чего НЕ делать (антипаттерны под наш масштаб)

1. Не включать `log_date_format` вместе с JSON-логами.
2. Не использовать pino transports/worker threads в проде под PM2.
3. Не ставить Loki+Grafana ради одного источника логов (0.5-1.5GB RAM против `tail | jq`).
4. Не строить Sentry self-hosted (8-16GB RAM).
5. Не дублировать аудит в файлы (и наоборот) — двойная запись разойдётся.
6. Не логировать успешные HTTP на high-frequency маршрутах (health-checks, MCP polling).
7. Не надеяться на pino redact против сторонних библиотек — глушить источники (GramJS baseLogger) и резать err-объекты белым списком.
8. Не тащить cls-hooked и `@opentelemetry/*` SDK «про запас».
9. Не публиковать `.map` в прод; не логировать session_data/токены целиком «для отладки».
10. Не заменять PM2 на systemd/journald ради логов.

## 10. Источники

Логгеры и pino: betterstack.com/community/guides/scaling-nodejs/pino-vs-winston · dash0.com/guides/nodejs-logging-libraries · last9.io/blog/node-js-logging-libraries · github.com/pinojs/pino/releases/tag/v10.0.0 · github.com/pinojs/pino/issues/2002 · github.com/pinojs/pino/blob/main/docs/redaction.md · github.com/directus/directus/issues/21271 · adventures.nodeland.dev/archive/from-fast-redact-to-slow-redact

PM2 и ротация: pm2.keymetrics.io/docs/usage/log-management · pm2.io/docs/runtime/best-practices/graceful-shutdown · github.com/Unitech/pm2/issues/1505 · /issues/4519 · /issues/5244 · /issues/114 · serverfault.com/questions/966536 · dev.to/mochafreddo/managing-logs-with-pm2-and-pm2-logrotate-1amc

Контекст: nodejs.org/api/async_context.html · pkgpulse.com/guides/unctx-vs-asynclocalstorage-vs-cls-hooked-async-context-2026 · dash0.com/guides/contextual-logging-in-nodejs · github.com/nodejs/node/issues/33723

Telegram: github.com/gram-js/gramjs/issues/24 (репо заархивировано 14.07.2026)

Агрегация: grafana.com/docs/alloy/latest/set-up/estimate-resource-usage · dozzle.dev · onidel.com/blog/log-shipping-benchmark-2025

Фронт: developer.mozilla.org/en-US/docs/Web/API/Window/error_event · blog.sentry.security/abusing-exposed-sourcemaps · glitchtip.com/blog/2026-02-03-glitchtip-6-released · glitchtip.com/documentation/install · bugsink.com/blog/glitchtip-vs-sentry-vs-bugsink

Аудит и OTel: axonbuild.com/blog/audit-logging-best-practices · sonarsource.com/resources/library/audit-logging · opentelemetry.io/docs/specs/otel/logs · github.com/open-telemetry/opentelemetry-js-contrib/issues/3292 · uptrace.dev/opentelemetry/logs

## Ревью (фазы 0-1, 2026-11-06)

Внедрено и проверено на проде:

- **Фаза 0**: pm2-logrotate установлен (10MB × 14, gzip, ежедневно, `pm2 conf` проверен); старые out/error.log (71MB) заархивированы в `logs/archive/*.pre-jsonl.log.gz`; `pm2 flush` выполнен; `ecosystem.config.cjs` — `log_date_format` убран, файлы `app.out.jsonl`/`app.err.jsonl`, `kill_timeout 5000`.
- **Фаза 1**: `backend/utils/logger.js` (фабрика pino: redact, safeErr, sanitizeConsoleArg, installConsoleShim) + `backend/test/test-logger.js` (9 проверок, `npm run test:logging`); server.js — pinoHttp (reqId, silent <400), глобальные хендлеры, стартовые логи, console-shim; auth.middleware — `owner_id` child; userbot.service — убраны оба дампа с паролями прокси; autopost/logger.js — мигрирован на фабрику (API прежний, `LOG_LEVEL` + фолбэк `AUTOPST_LOG_LEVEL`); RESTORE.md — секция «Логи».
- **Локально**: `test:logging` ✓, `test:lifecycle` ✓ (canary console.error чист), `test:autopost` ✓ (вся цепочка).
- **Прод (коммит 683927f, деплой success)**: `pm2 delete+start+save` применён (reload не перечитывает ecosystem — учтено для будущих смен pm2-конфига); файлы пишутся, **0 не-JSON строк**, стартовые строки/флаги в JSON; внешний запрос вернул `x-request-id`, строка `request completed` в логе с reqId; error-строки сериализуются без секретов (пример: lifecycle bot_launch_failed, err {type,message,code,stack}); grep паролей по новым логам — чисто; API живой (2 аккаунт-лота на /shop), процесс online.
- Отклонение от плана: pinoHttp-лог для ≥400 пишет полный `res.headers` (частично санитизируется pino-http: authorization/cookie вырезаны). Наблюдаем; при необходимости — кастомный serializer в фазе 3.
- Дальше: фазы 2-5 по BACKLOG §28 (джобы → миграция console.* с ratchet-гейтом → фронт-capture).
