# Логирование Bullgram — как работает и как пользоваться

Аудитория: следующий ИИ-агент или разработчик. Документ — практический гайд;
полное исследование с обоснованиями: `docs/plans/2026-11-05-logging-research.md`.

## Коротко: что где лежит

| Что | Где |
|---|---|
| Фабрика логгера (pino) | `backend/utils/logger.js` |
| Обёртка cron-джоб | `backend/utils/job-runner.js` (`wrapJobTick`) |
| HTTP-логирование | `backend/server.js` — pinoHttp (req.id, silent <400) |
| Приёмник клиентских ошибок | `backend/routes/client-log.routes.js` — `POST /api/log` |
| Клиентский capture (6 SPA) | `<app>/src/ui/log-capture.js` — байт-в-байт копии, гейт `design/ui-sync.mjs` |
| Ratchet-гейт на console.* | `ops/scripts/ci/gate-07-console-ratchet.sh` + `console-ratchet.mjs` + `console-ratchet.baseline.json` |
| Логи на проде | `srv:/srv/bullgram/backend/logs/app.out.jsonl` (+ `app.err.jsonl`), ssh-алиас `srv` |
| Ротация | pm2-logrotate: 10MB × 14 × gzip, ежедневно |
| Тесты | `npm run test:logging`, `test:jobs`, `test:client-log` (в `backend/`) |

## Формат строки (JSONL)

```json
{"level":"info","time":"2026-11-06T04:00:00.000Z","pid":123,"hostname":"…",
 "req":{"id":"<uuid>","method":"GET","url":"/api/…"},"res":{"statusCode":404,…},
 "responseTime":5,"owner_id":"…","job":"health-check","runId":"…","durationMs":42000,
 "source":"web","web_app":"site","module":"scheduler","event":"post_published",
 "err":{"type":"Error","message":"…","code":null,"stack":"≤5 строк"},"msg":"…"}
```

- `level` — строка-лейбл: `debug | info | warn | error | fatal`.
- `time` — ISO. PM2 НЕ добавляет свой timestamp (log_date_format убран — его
  префикс ломал JSONL); не возвращай его обратно.
- `req.id` — request-id, равен заголовку ответа `x-request-id` и
  `mcp_tool_log.request_id`. Корреляция запроса со всеми его записями — по нему.
- `owner_id` — арендатор; проставляется child-логгером в auth-middleware после
  валидации JWT. Никогда не брать из body/query.
- `job` + `runId` — у записей cron-тиков; `durationMs` у `job finished`.
- `source: "web"` + `web_app` — клиентская ошибка из `POST /api/log`.
- `err` — только `{type, message, code, stack≤5}`. Это safeErr-сериализатор:
  enumerable-пропсы ошибок (у SocksClientError это `.options` с паролем прокси)
  в лог не попадают намеренно.
- `data` — sanitized-аргументы легаси `console.*` (через console-shim в
  server.js, пока 596 старых вызовов не мигрированы).

## Политика уровней

- `error` — провал с потерей функции/данных: неуспешная оплата, мёртвая сессия,
  необработанное исключение, `job failed`, клиентский `error`.
- `warn` — деградация с самовосстановлением: FloodWait, таймаут прокси с
  ретраем, HTTP ≥400, клиентский `warn`.
- `info` — бизнес-факты: старт/финиш джобы (если ≥30с), выдача лота, флаги при
  старте. **Успешные HTTP не пишутся** (silent <400) — не отключай это.
- `debug` — не пишется в проде (уровень по умолчанию info): быстрые тики джоб,
  детали.

## Читать логи (на проде)

```bash
ssh srv
tail -f /srv/bullgram/backend/logs/app.out.jsonl | jq 'select(.level=="error")'
# по арендатору
jq 'select(.owner_id=="…")' /srv/bullgram/backend/logs/app.out.jsonl
# по запросу (req.id == x-request-id из ответа)
grep -F '<reqId>' logs/app.out.jsonl | jq .
# упавшие и медленные джобы
jq 'select(.msg=="job failed" or .msg=="job finished (slow)")' logs/app.out.jsonl
# клиентские ошибки SPA
jq 'select(.source=="web")' logs/app.out.jsonl
# топ причин ошибок за 24ч
jq -r 'select(.time > (now - 86400 | todateiso8601) and .level=="error") | .msg' logs/app.out.jsonl | sort | uniq -c | sort -rn
```

`app.err.jsonl` — только сторонний вывод в stderr (GramJS без prepareServiceClient,
крэши); в норме пустой. Старые логи до перехода на JSONL — `logs/archive/*.gz`.

## Писать логи в новом коде (правила)

1. **Backend: только `logger` из `backend/utils/logger.js`.**

   ```js
   import { logger } from '../utils/logger.js';

   logger.info({ userbot_id, durationMs }, 'джойн выполнен');      // факт
   logger.warn({ proxy_id, attempt }, 'прокси не ответил, ретрай');  // деградация
   logger.error({ err, purchase_id }, 'оплата не прошла');           // провал
   ```

   - В `err` передавай сам объект ошибки — сериализатор сам всё безопасно
     обрежет. Не строй строки из `err.stack` и не логируй `err` целиком.
   - Логируй скаляры и id, не объекты из недр библиотек (`socket`, `config`,
     `cause`) — там жили пароли прокси.
   - В роутах бери `req.log` (pino-http) — он уже с `req.id` и (после auth)
     `owner_id`: `req.log.warn({...}, 'msg')`.

2. **Cron-джоба обязана быть обёрнута**: `setInterval(wrapJobTick('<имя>',
   run), intervalMs)` из `utils/job-runner.js` — даёт runId/длительность/outcome.
   Предметные счётчики (сколько отправлено, сколько упало) логирует сама джоба.

3. **Новый `console.*` в backend заблокирует CI** — gate-07 (ratchet, baseline
   596 строк). Правило миграции легаси: **трогаешь файл — мигрируй его логи**.
   Осознанно поднять потолок: `ops/scripts/ci/gate-07-console-ratchet.sh
   --update-baseline` + обоснование в коммите.

4. **Секреты**: redact цензурирует ключи вида `token`, `session`, `password`,
   `api_hash`, `phone`, `email` и т.п. (список в `utils/logger.js`) на наших
   вызовах; shim санитизирует легаси-console. Но redact — не оправдание, чтобы
   логировать секрет «в надежде на цензуру»: секреты в логи не кладём.

5. **Фронтенд (6 SPA)**: ошибки собирает `src/ui/log-capture.js` (копии
   байт-в-байт — правишь в admin-v2 (канон), переносишь во все шесть тем же
   коммитом, иначе упадёт `check:design`/ui-sync). Из кода фронта ошибки
   репортим через `reportWebError({ message, stack, level })`; React-boundary —
   `reportCaughtError(error, info)`. Своих `console.*` на фронте не добавляем
   без нужды — пользователь их видит, бэкенд нет.

6. **Не дублируй домен-аудит в файлы**: деньги (`billing_events`,
   `payment_events`), безопасность (`telegram_error_events`, `mcp_tool_log`) —
   это БД-таблицы, их не трогаем. В файловый лог о таком событии — только id
   (`purchase_id`, `owner_id`).

## Чего НЕ делать (проверено, будет больно)

- Не возвращать `log_date_format` в pm2 — сломает JSONL (префиксы режут строки).
- Не использовать pino-транспорты/worker-threads (`pino.transport()`,
  pino-pretty как transport) в проде под PM2 — теряют буфер и зависают на
  reload. Pretty — только локально: `node server.js | pino-pretty`.
- Не логировать успешные HTTP — health-checkи и сканеры задавят сигнал
  (вчера: 978 warn, из них ~750 — 404-скан, который ищет n8n на нашем домене).
- Не хранить логи в БД и не растить аудит-таблицы без ретеншна (BACKLOG §29).
- Не подключать Loki/Grafana/Sentry — для одного процесса это оверкилл;
  порог пересмотра и план: `docs/plans/2026-11-05-logging-research.md` (§5, фаза 5).

## Связанные места

- Дежурный runbook по сигнатурам: `docs/dev/runbooks.md` (на него ссылается
  лог-дайджест `/opt/alerts/log-digest.sh` на srv)
- Исследование и план: `docs/plans/2026-11-05-logging-research.md`
- Бэклог внедрения: `docs/plans/BACKLOG.md` §28 (логирование), §29 (ретеншн аудит-таблиц)
- Инфра-восстановление: `ops/RESTORE.md` — секция «Логи»
- Тесты: `backend/test/test-logger.js`, `test-job-runner.js`, `test-client-log.js`
