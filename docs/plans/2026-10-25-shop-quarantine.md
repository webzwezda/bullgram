# Отстойник для юзербот-аккаунтов: гейты продажи + карантин

Дата: 2026-10-25. Статус: в работе.

## Контекст

Кейс 2026-10-24: купленный аккаунт @bookmarks_1968 заморозили («Violation of Terms»,
read-only, апелляция до 2026-11-20 через @SpamBot — подана вручную владельцем).
Health-check классифицировал его как `error` (getMe не уложился в таймаут), а `error`
НЕ входит в блоклист публикации лотов — аккаунт свободно продаётся. Плюс: ни бронь,
ни передача прав не перепроверяют здоровье аккаунта; выставленные лоты никто
не перепроверяет по расписанию; пурж может удалить аккаунт под живой покупкой.

Правило AGENTS.md: «blocked/restricted userbot assets must not remain public in the
shop storefront». Расширяем его: проблемный аккаунт не должен доходить до покупателя
на любом этапе, а жил в видимом отстойнике.

## Решение

Гейты на всех этапах воронки + карантинная секция + автопроверка выставленных лотов.

1. **Публикация** (`shop.routes.js`, guard ~:1540): блоклист расширен на `'error'`;
   для публикации требуется свежая проверка (`last_checked_at` ≤ 6ч) у юзербот-ассетов.
2. **Бронь** (`createOrRefreshBuyerPurchase`): отказ при проблемном статусе ассета
   (`restricted/expired/dead_proxy/error`) — покрывает одиночную и batch-покупку.
3. **Передача прав** (`runShopPurchaseCheck` перед `transferShopAssets`): плохой статус →
   `paid + ownership_transfer_status='failed' + ownership_transfer_error` (по образцу
   sold-race) — платёж зафиксирован, возврат вручную; плюс guard в `transferShopAssets`.
4. **Job `listed-userbot-health.job.js`**: каждые 6ч (флаг `USERBOT_LISTED_HEALTH_CHECK_ENABLED`,
   `USERBOT_LISTED_HEALTH_INTERVAL_MS`) проверяет юзерботов опубликованных лотов той же
   проверкой, что кнопка «Проверить Telegram»: restricted → unpublish + proxy cleanup +
   `telegram_error_events(is_restriction)`; expired/dead_proxy/error → только unpublish;
   живая покупка блокирует purge, но не снятие лота.
5. **Пурж** (`restricted-userbot-cleanup.job.js`): skip при живой покупке (pending/paid
   без завершённого трансфера).
6. **UI «Отстойник»** (userbot-v2): секция в UserbotsPage со всеми аккаунтами
   в проблемных статусах: причина (бейдж), runtime_error, время последней проверки,
   пометка «В продаже не участвует».

Не делаем в v1: миграций нет (TTL пуржа остаётся на `telegram_error_events`, job теперь
гарантированно пишет событие); детект `FROZEN_METHOD_INVALID` не нужен — замороженные
ловятся через `error`-гейт и SpamBot-текст, который `inspectSpamBlockStatus` уже матчит.

## Чек-лист

- [x] Гейт публикации: `error` в блоклисте + свежесть last_checked_at ≤ 6ч
- [x] Гейт брони в `createOrRefreshBuyerPurchase` (+batch, вкл. `pending_activation`)
- [x] Гейт передачи в `runShopPurchaseCheck` + guard в `transferShopAssets`
- [x] Job `listed-userbot-health` + реестр в `server.js` + `.env.example` + README
- [x] Пурж-джоб: skip при живой покупке
- [x] UI: секция «Отстойник» + бейджи причин
- [x] Тесты: transfer-guard (online/error/pending_activation), пурж (skip/полный),
      job (unpublish expired, restricted-событие + чистка прокси, online-нон-троганье,
      свежий скип). Прямых тестов route-гейтов публикации/брони нет — они inline
      в express-хендлерах; покрытие через код-ревью + прод-проверку.
- [ ] `npm run ci`, деплой push-to-main, прод-проверка по Browser Doctrine

## Review

Реализовано 2026-10-25. Код-ревью (code-reviewer subagent) нашло 3 P1, исправлены:
1. Job не выбирал `last_checked_at` → фильтр свежести был мёртв (в проде каждый
   прогон перепроверял бы всех; поймано эмпирическим прогоном на PostgREST-верном
   моке). Исправлено + мок в тестах теперь честно проецирует select-колонки.
2. `pending_activation` проходил гейты брони/передачи (кейс: восстановление из
   файлов возвращает аккаунт в safe-mode при живом лоте) → добавлен в оба списка.
3. Job классифицировал «getMe ok + SpamBot таймаут» как `error` и снимал бы
   здоровый лот; приведено к поведению ручной проверки (degraded → `online`).

P2-решения: пурж fail-safe при любой ошибке проверки покупок (отложить, не рисковать);
paid+failed покупки не истекают — пурж откладывается до ручного возврата, это осознанно
(покупатель важнее расписания); флаг job'а default-ON как у
RESTRICTED_USERBOT_AUTO_DELETE_ENABLED — проверка пассивная, того же класса, что и
кнопка «Проверить Telegram»; перекрытие прогонов job'а защищено running-флагом.

Прод-проверка (Browser Doctrine): см. чек-лист, выполняется после деплоя —
попытка опубликовать лот на error-аккаунте, появление секции «Отстойник»,
бронь на снятом лоте невозможна.
