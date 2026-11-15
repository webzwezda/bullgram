# План: честные проверки SpamBot, гейт магазина «limited», апелляции

Дата: 2026-11-15. Статус: в работе.

## Контекст

Ручная проверка спам-лимитов 15.11 (MCP, по одному /start на аккаунт):

| Аккаунт | Вердикт |
|---|---|
| webzwezda | нет данных (peer-cache баг: send не видит access_hash от resolve) |
| NESTED_tremendous | **LIMITED** («will not be able to send messages to people who do not have your number…»); 18.10 был clean — лимит свежий |
| bookmarks_1968 | frozen (read-only с 09.11), проверка невозможна |
| Erik | нет данных (тот же peer-cache баг) |
| Misato_Katsuragi_herm | известна LIMITED, под токеном не видна |

При этом платформенный «Проверить Telegram» показывает все бейджи зелёными. Корень:

- `inspectSpamBlockStatus` (`backend/services/userbot/health.mixin.js`) в проде пассивен —
  активная проба (`/start`) gated на `options.activeProbe`, ни один вызыватель не передаёт.
  Пассивное чтение хвоста диалога SpamBot'а путает «старый чистый ответ» с «чист сейчас».
- Спам-лимит «только контакты» не виден в `me.restricted` из getMe — только живой `/start`.
- `spambot_signal`/`spambot_checked_at` — in-memory кэш на 15 мин, не персистент.
- Гейты магазина завязаны на `runtime_status` — «лимит» невидим, лимитированный лот продавался бы.
- Баг: `user_resolve` не пишет `userbot_peer_cache` → MCP `message_send` к SpamBot падает
  «Юзербот не знает этот TG ID» для аккаунтов без диалога.

## Решения владельца (15.11)

1. Активная проба — **только вручную** (кнопка «Проверить Telegram», публикация/скан лотов).
   Расписаний с /start НЕ добавляем.
2. Вердикт — **новый `runtime_status='limited'`** (первоклассный статус рядом с frozen/restricted).
   Следствие: липкость — пассивные проверки не имеют права возвращать limited → online;
   очистить может только чистая активная проба.
3. Апелляция — **полуавтомат**: платформа прокликивает @SpamBot («Подать жалобу» → «Это ошибка»),
   останавливается на шаге подтверждения «человек», финал человек завершает в Telegram Web сессии
   (deep-link `#?tgaddr=https://t.me/SpamBot`, правок форка не нужно).

## Чек-лист

### Wave 1 — Backend: честный вердикт
- [x] `telegram-errors.js`: `classifySpambotReply(text)` → clear/limited/blocked (EN+RU фразы)
- [x] `health.mixin.js`: активная проба (резолв пира, фиксация id, /start, опрос, классификация только новых), source-метки, липкость persisted-limited в `inspectAccountHealth`, `getHealthSnapshot` fallback к health_summary
- [x] `health-check.js` + `telegram-profile.js`: activeProbe на ручном чеке, `runtime_status='limited'`, health_summary + spambot_state/reason/source/checked_at, событие `spambot_limited` c `is_restriction=false` (пурга 72h не трогает limited)
- [x] `backend/routes/userbot/appeal.js`: `POST /api/userbot/appeal/:id` — клики кнопок до шага «человек»
- [x] peer-cache: `PEER_CACHE_SOURCES += 'resolve'`, `resolveTelegramUser` пишет кэш
- [x] активная проба на ручных сценариях магазина (sale-scan через `checkStockAccount({activeProbe})`; DM-guard limited в `dm.mixin.js`)

### Wave 2 — Гейт магазина
- [x] limited в карантинных списках: items-create-helpers, purchase-core, listed-userbot-health.job, intake-stock.service
- [x] `account-sale-rules.js`: limited = unsellable («Аккаунт лимитирован Telegram») — и по статусу, и по spambot_state; `isTransferableAccountLot` тоже
- [x] listed job: limited → unpublish, sentinel healthy_streak=-1, без proxy-cleanup/пурга; чистая проба сбрасывает sentinel (route healthy_streak=0 при probe clear)
- [x] Defense-in-depth UI: ShopPage HealthRow красный бейдж; AdminLotsSection TYPE_LABELS+account + health-точка (market-lots отдаёт health по userbot-активам)

### Wave 3 — UI userbot-v2
- [x] Sketch-first: 2 статических варианта (баннер с кнопками / баннер+шаги frozen) — docs/plans/sketches/2026-11-15-spambot-appeal/
- [x] `buildCheckLines`: зелёный только probe-verified clear; пассив/устаревшее — янтарный; limited/blocked — красный
- [x] `restrictedMarker` + limited-текст; `summarizeCheckStatus` limited
- [x] `StatusBadge` → feedback-токены (тон-контракт сохранён)
- [x] `SpamBotAppealCard` + баннер в CenterAccountCard (Подать апелляцию / Открыть @SpamBot в Telegram Web / Перепроверить; для frozen — только гид)

### Wave 4 — Env, тесты, доки
- [x] `USERBOT_SPAMBOT_PROBE_ENABLED` / `USERBOT_SPAMBOT_PROBE_TIMEOUT_MS` в .env.example + README
- [x] `backend/test/spambot-verdict.test.js` (9 тестов) + script `test:spambot`
- [x] Верификация локально: все 10 сьютов OK (spambot/sales/sale-scan/intake/shop-delivery/messaging/mcp/lifecycle/jobs/logging), build:v2 OK, check:design PASS (ratchet чист)

## Review (после реализации)

Локальная верификация зелёная (см. чек-лист Wave 4). Прод-верификация после
деплоя — по Browser Doctrine в реальном Chrome владельца: карточка NESTED
(баннер+апелляция), клик «Подать апелляцию», deep-link в Telegram Web, гейт
магазина на limited-лоте, MCP health с персист-сигналом, Supabase сверка.

Отложенное: ничего в BACKLOG не вынесено — объём вошёл в этот план.


## Верификация на проде (после деплоя)

- NESTED_tremendous: карточка не зелёная, баннер + апелляция. 6h-правило: последний /start — 00:42 UTC 15.11.
- «Подать апелляцию» → needs_human + deep link; deep link открывает Telegram Web в чате @SpamBot.
- Гейт: скан/публикация limited-аккаунта отказывает с внятной причиной.
- MCP `bullgram_userbot_health` NESTED: spambot_signal = limited из персиста.
- Supabase read-only: health_summary.spambot_* заполнены; событие spambot_limited с is_restriction=false; лоты limited = draft/private.

## Риски

- Ручной-only: лимит обнаруживается при ручных чеках/публикации; гасится липкостью + fail-closed гейтами на booking/transfer.
- Смена меток кнопок Telegram → fallback `needs_human` с гидом.
- Клик кнопок = запись в Telegram: одноразово, по явному клику владельца, без ретраев.
