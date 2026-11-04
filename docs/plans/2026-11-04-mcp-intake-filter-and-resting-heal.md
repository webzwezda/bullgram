# MCP: скрыть отлёжку из списков агентов + авто-лечение флак-верdicts отлёжки (paintsmall)

Дата: 2026-11-04. Статус: в работе.

## Контекст

Владелец: «при подключении по MCP админ видит всех ботов, даже тех, кто выставлен
на витрину и в отлёжке» + «paintsmall постоянно отлетает в отлёжку, кажется это баг».

Диагностика (БД, прод):

- `bullgram_userbot_list` / `bullgram_infra_summary` отсекают только лоты
  `shop_items.status='published'` (`utils/shop-reservations.js`). Приёмочный сток
  (restore-сорс с `intake_batch_id`) в фильтре не участвует вообще → агенты видят
  отлёжку (`paintsmall`, `EQUATIONS2045`).
- `paintsmall` живой: проверка 2026-11-04 09:31 UTC — online, restriction clear,
  spambot clear, прокси «intake #3» is_working. История (`telegram_error_events`,
  2026-10-27): три health_check с «Telegram не отдал профиль аккаунта за
  отведённое время» — таймаут getMe на живой сессии. Известный флак (комментарий
  в `intake-stock.service.js`: «getMe иногда флакует таймаутом… 1 из 2 сканов дал
  ложный error»).
- Системный баг: джоба отлёжки (`jobs/intake-resting.job.js`) берёт цели только в
  статусах `pending_activation`/`online`. Аккаунт, получивший ложный `error`
  (или `dead_proxy` от упавшего коннекта), джобой больше НИКОГДА не проверяется —
  статус консервируется до ручного скана продажи/ручной проверки. Отсюда
  «постоянно отлетает»: флак → error → джоба молчит → владелец лечит руками.
  Ретрай getMe в `checkStockAccount` идёт по тому же (подгнившему) соединению.

## Изменения

- [ ] `backend/utils/intake-stock-reservations.js` (новый): `loadIntakeStockUserbotIds(supabase, ownerId)`
      — restore-сорсы с непустым `intake_batch_id`; зеркальный degrade при
      отсутствующей таблице (как в `shop-reservations.js`).
- [ ] `backend/mcp/tools/account/list-userbots.js`: при дефолтном вызове
      исключать витринные (published) + приёмочный сток; `include_reserved=true`
      показывает всё; описание инструмента обновить.
- [ ] `backend/utils/agent-tools.js` (`buildAgentInfraPayload`): тот же фильтр
      для `userbots`/`userbot_total`; новый счётчик `userbot_intake_stock`.
- [ ] `backend/services/intake-stock.service.js` (`checkStockAccount`): перед
      ретраем getMe — disconnect + reconnect (`connectWithProxyFallback`), ретрай
      не по подгнившему сокету.
- [ ] `backend/jobs/intake-resting.job.js`: цели отлёжки += `error`, `dead_proxy`
      (авто-лечение флак-верdicts; restricted/frozen/expired не трогаем — они
      односторонние/апелляционные). Переименовать
      `loadPendingActivationAccounts` → `loadIntakeStockAccounts`, обновить шапку.
- [ ] Тесты: `test/test-account-intake.js` — error/dead_proxy сток дочекивается и
      лечится в online, restricted/expired не трогаются; новый
      `test/test-mcp-userbot-list.js` — дефолт скрывает published-лот и отлёжку,
      `include_reserved` показывает всё, draft-лот виден; проводка в `test:mcp`.

## Не делаем

- Draft-лоты из MCP-списка не прячем (владелец говорил про витрину = published;
  draft остаётся видимым, вопрос поднят в отчёте).
- Verdict-гвард «не отпускать online в error» не добавляем: честный статус для
  карточки продажи важнее, лечение теперь автоматическое.

## Review (2026-11-04)

Сделано всё из списка изменений. Проверки:

- `npm run test:mcp` — зелёный (shared/dispatch/external-rest + новый
  `test-mcp-userbot-list.js`; в мок external-rest добавлен метод `.not()`,
  которого не хватало билдеру).
- `npm run test:intake` — зелёный, включая новый блок «error/dead_proxy
  дочекиваются и лечатся, restricted/expired — нет».
- `npm run test:sale-scan` — зелёный (общий `intake-stock.service.js` не сломан).
- Контроль по живой БД (владелец магазина 9fd78a21…): после фикса MCP-список
  возвращает только bookmarks_1968 / craps_1921 / Erik; legendary_2079 скрыт
  витриной, paintsmall и EQUATIONS2045 — отлёжкой.
- Реконнект-ретрай getMe в `checkStockAccount` юнит-тестом не покрыт (прямая
  работа с TelegramClient без инъекции зависимостей) — проверяется на проде по
  исчезновению error-циклов у стока на прокси «intake #3».

Не деплоено: изменения в рабочей копии, решение о пуше — за владельцем.
