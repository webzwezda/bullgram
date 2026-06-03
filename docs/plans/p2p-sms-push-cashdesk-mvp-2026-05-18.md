# P2P / СБП касса через SMS/Push Forward MVP

Дата: 2026-05-18  
Статус: реализация начата

## Как я понимаю задачу

BullRun уже умеет принимать три типа оплат:

- `TON / крипта`;
- `СБП / P2P`;
- `Robokassa`.

Robokassa остается отдельной официальной кассой для платежей через Robokassa callback. Новый контур нужен не для Robokassa, а для клиентского `СБП / P2P`: продавец получает деньги напрямую на свои реквизиты, а BullRun помогает почти автоматически сводить оплату с заказом.

Сейчас в проекте уже есть куски:

- покупатель создает `shop_purchases` и выбирает `p2p`;
- покупатель видит реквизиты продавца и нажимает `Я оплатил`;
- покупатель может приложить чек / комментарий;
- продавец видит очередь `/app/shop-receipts` и вручную подтверждает или отклоняет;
- `/app/payments` хранит реквизиты в `payment_settings`;
- `/app/billing` показывает старый `webhook` блок, но он сейчас завязан на `invoices`, а не на `shop_purchases`.

Проблема: это собрано разрозненно и не выглядит как цельный продукт. Нужно собрать понятный MVP: реквизиты + webhook для SMS/Push Forward + входящие банковские уведомления + автосопоставление с P2P-заказами + ручная очередь только для спорных случаев.

## Главный продуктовый принцип

Не строим тяжелую идеальную бухгалтерию. MVP должен снять большую часть ручной сверки, не заставляя продавца и покупателя проходить сложный комплаенс-флоу.

Правило MVP:

- если банковское SMS/Push-уведомление продавца однозначно совпало с P2P-заказом, где покупатель уже нажал `Я оплатил`, BullRun сам подтверждает оплату;
- если совпадений нет или их несколько, событие уходит в ручную сверку;
- `pending` checkout без действия покупателя не автоподтверждаем: он может быть только подсказкой для ручной сверки;
- чек покупателя остается полезным дополнительным сигналом, но не блокирует автоматическое подтверждение;
- никаких уникальных копеек/рублей в сумме заказа.

Термины для всего плана:

- `подтвердить оплату` = перевести purchase/payment group в `paid`;
- `передать товар` = довести `ownership_transfer_status` до `completed`;
- `закрыть заказ` не используем как технический термин, потому что `paid` и `completed` в текущем коде разные состояния.

## Что уже есть в коде

### Backend

- `backend/routes/shop.routes.js`
  - основной контур shop;
  - таблица `shop_purchases`;
  - P2P checkout создает `pending` purchase с `payload.payment_method = p2p`;
  - `/api/shop/public/purchase/mark-paid` переводит P2P purchase в `awaiting_receipt`;
  - `/api/shop/seller/purchases/:id/approve` вручную подтверждает и запускает передачу товара;
  - `/api/shop/seller/purchases/:id/reject` отклоняет;
  - batch-варианты уже есть.

- `backend/routes/payment.routes.js`
  - старый `/api/payment/webhook/:provider`;
  - работает с `invoices`, `tariffs`, `payment_events`;
  - не подходит как основа для `shop_purchases` без смешивания доменов.

- `backend/server.js`
  - `/api/payment-settings` сохраняет `payment_settings`;
  - сейчас туда входят `sbp_phone`, `sbp_bank`, `sbp_fio`, `ton_wallet`, старые `billing_*` поля.

### Frontend

- `site-v2/src/pages/PurchasesPage.jsx`
  - покупатель видит P2P-реквизиты;
  - покупатель может отправить чек/комментарий через `mark-paid`.

- `admin-v2/src/pages/ShopReceiptsPage.jsx`
  - продавец видит P2P-чеки;
  - вручную подтверждает/отклоняет.

- `admin-v2/src/pages/PaymentSettingsPage.jsx`
  - режимы `/app/payments`, `/app/plans`, `/app/billing`;
  - реквизиты и старый webhook живут на разных вкладках.

- `admin-v2/src/pages/payment-settings/BillingWebhookSection.jsx`
  - сейчас написан как provider webhook для старого billing;
  - терминология `cryptomus/cryptobot/generic`, `Shop / Merchant ID`, `API key провайдера` не подходит для SMS/Push Forward кассы.

### Database

Текущие таблицы:

- `payment_settings` - реквизиты и старые billing-настройки;
- `shop_purchases` - shop/P2P покупки;
- `payment_events` - события старого invoice-webhook, `invoice_id` обязательный;
- `invoices` - Telegram invoice contour;
- `billing_events` - события Robokassa Normal billing.

Вывод: для SMS/Push P2P нельзя переиспользовать `payment_events`, потому что там обязательный `invoice_id` и смысл привязан к `invoices`. Нужна отдельная таблица событий P2P-уведомлений или отдельный shop payment events контур.

## Целевой UX

### Для продавца

Дом для MVP: раздел `Финансы`.

Нужно привести к такой логике:

1. `/app/payments` - реквизиты продавца:
   - TON;
   - СБП: телефон, ФИО, банк;
   - статус: можно принимать P2P.

2. `/app/billing` или новая переименованная карточка внутри `billing` - `Автосверка СБП`:
   - webhook URL;
   - Bearer token;
   - кнопка `Сгенерировать / обновить токен`;
   - короткая инструкция для SMS Forward;
   - тумблер `Автоматически подтверждать очевидные оплаты`;
   - тест webhook-а;
   - статус последнего события.

3. `/app/shop-receipts` становится не просто `Проверка чеков`, а `Сверка оплат`:
   - блок `Автоподтверждено`;
   - блок `Нужно проверить`;
   - блок `Входящие уведомления`;
   - для спорных событий кнопка `Привязать к заказу` / `Подтвердить` / `Отклонить`.

### Для покупателя

Покупательский путь остается простым:

1. выбрал `СБП`;
2. увидел реквизиты;
3. перевел сумму;
4. нажал `Я оплатил`;
5. при желании приложил чек;
6. если банковское уведомление продавца уже пришло и совпало, оплата может подтвердиться автоматически;
7. передача товара/актива отображается отдельно: `оплачено`, `передано`, `ошибка передачи`.

Не просим покупателя вводить лишние коды, уникальные копейки или сложные назначения.

## Замечания subagent-review

Этот план проверяли отдельные backend, frontend и architectural review агенты. В реализацию внесены следующие ограничения:

- автоподтверждение только для `awaiting_receipt`, а не для голого `pending`;
- matching unit = `payment group`, а не только один `shop_purchases` row, потому что batch P2P уже есть;
- не вызывать напрямую текущий `approveSellerPurchaseRecord` из webhook: нужен единый доменный confirm-сервис;
- token/hash/last webhook state нельзя прогонять через общий `/api/payment-settings` save-path;
- `/app/billing` нужно менять как целый экран, а не только `BillingWebhookSection`;
- `/app/shop-receipts` должен стать dual-feed экраном: очередь чеков отдельно, банковские события отдельно;
- buyer UI должен различать `ждем уведомление`, `оплата подтверждена`, `передача товара не завершилась`;
- raw банковские уведомления считаем чувствительными данными: redaction, body limit, запрет логирования raw body.

## Backend MVP дизайн

### Настройки P2P webhook

Не класть operational token-state в общий `/api/payment-settings` save-path. Текущий frontend читает `payment_settings` через `select('*')` и отправляет назад весь объект настроек, а backend делает широкий upsert. Если просто добавить secret/hash поля в `payment_settings`, их легко случайно утечь в client или затереть обычным сохранением реквизитов.

Предпочтительный вариант MVP: новая таблица `p2p_webhook_settings`.

Поля:

- `owner_id uuid primary key`;
- `token_hash text null unique`;
- `token_prefix text null`;
- `token_hint text null`;
- `enabled boolean not null default false`;
- `auto_confirm_enabled boolean not null default true`;
- `match_clock_skew_minutes integer not null default 10`;
- `last_webhook_at timestamptz null`;
- `last_used_at timestamptz null`;
- `last_used_ip text null`;
- `created_at timestamptz not null default now()`;
- `updated_at timestamptz not null default now()`.

Если решим все-таки хранить настройки в `payment_settings`, то обязательно:

- не отдавать `token_hash` в `/api/payment-settings`;
- не принимать `token_hash`, `token_hint`, `last_webhook_at`, `last_used_at`, `last_used_ip` в общем `POST /api/payment-settings`;
- менять эти поля только через dedicated endpoints.

Токен показываем полностью только один раз при генерации. В базе храним hash, prefix/hint и usage metadata. Паттерн близок к MCP token flow: полный token одноразовый, дальше только hint.

### Новая таблица `p2p_bank_events`

Назначение: хранить сырые SMS/Push webhook-события и результат сопоставления.

Поля MVP:

- `id uuid primary key`;
- `owner_id uuid not null`;
- `source text not null default 'sms_forward'`;
- `status text not null`;
- `raw_payload jsonb not null`;
- `raw_text text null`;
- `redacted_text text null`;
- `sender text null`;
- `amount_rub numeric null`;
- `currency text null default 'RUB'`;
- `bank_name text null`;
- `event_time timestamptz null`;
- `received_at timestamptz not null default now()`;
- `matched_purchase_ids uuid[] null`;
- `matched_batch_token text null`;
- `candidate_purchase_ids uuid[] null`;
- `candidate_batch_tokens text[] null`;
- `resolution_type text null`;
- `resolved_at timestamptz null`;
- `resolved_by_owner_id uuid null`;
- `confirm_source text null`;
- `match_reason text null`;
- `dedupe_key text null`;

Status vocabulary:

- `received` - событие принято, еще не распарсено;
- `parsed` - сумма/текст распознаны, matching еще не завершен;
- `unmatched` - подходящих payment groups нет;
- `ambiguous` - есть несколько кандидатов;
- `matched` - найден один кандидат, но автоподтверждение не применено;
- `confirmed` - оплата подтверждена;
- `auto_confirm_failed` - match был, но confirm service вернул ошибку;
- `duplicate` - повтор webhook-а;
- `ignored` - оператор скрыл событие;
- `error` - парсер/сервис упал.

Индексы:

- `(owner_id, received_at desc)`;
- `(owner_id, status, received_at desc)`;
- `(owner_id, amount_rub, received_at desc)`;
- unique nullable/partial по `(owner_id, dedupe_key)` where `dedupe_key is not null`.

Отдельно добавить lookup-индекс под matcher по `shop_purchases`: продавец, статус, created_at и payment method/amount из `payload`. Если expression index по JSONB будет неудобен, сначала можно жить без него для MVP, но план проверки должен включать объемы и latency.

### Новый backend route

Лучше добавить отдельный модуль:

- `backend/routes/p2p-bank-events.routes.js`
- mount: `/api/p2p-bank-events`

Публичный webhook:

- `POST /api/p2p-bank-events/webhook`
- auth: `Authorization: Bearer <token>`;
- по token hash находим owner и проверяем `enabled`;
- ограничиваем body size;
- не логируем raw webhook body;
- сохраняем raw event и redacted preview;
- парсим сумму/текст;
- запускаем matching;
- возвращаем `{ success: true, status, purchase_ids?, batch_token? }`.

Админские endpoints:

- `GET /api/p2p-bank-events`
  - последние события владельца;
  - фильтры `unmatched`, `ambiguous`, `confirmed`, `ignored`, `error`.

- `GET /api/p2p-bank-events/settings`
  - возвращает sanitized settings, webhook URL, token hint, last used metadata;
  - не возвращает `token_hash`.

- `POST /api/p2p-bank-events/token`
  - генерирует новый token;
  - возвращает token один раз;
  - сохраняет hash/hint.

- `POST /api/p2p-bank-events/test`
  - принимает тестовый текст;
  - прогоняет парсер/matcher без внешнего приложения.

- `POST /api/p2p-bank-events/:id/confirm`
  - вручную привязать event к `purchase_ids[]` или `batch_token`;
  - подтвердить через единый P2P confirm service.

- `POST /api/p2p-bank-events/:id/ignore`
  - убрать шум.

### Parser MVP

Функция:

- `parseBankNotificationPayload(body)`

Поддержать гибко:

- `text`;
- `message`;
- `content`;
- `title + body`;
- `notification.text`;
- `notification.title`;
- `sender`;
- `app`;
- `time`.

Сумма MVP:

- искать `1234 ₽`, `1 234,56 RUB`, `зачисление 900`, `перевод 900`;
- нормализовать до целых/десятичных рублей;
- не пытаться идеально определить все банки на первом этапе.

Privacy MVP:

- `raw_text` хранить только если нужно для разборов; для UI по умолчанию использовать `redacted_text`;
- редактировать баланс, хвост карты/счета, телефон, вероятные ФИО и длинные цифровые фрагменты;
- ограничить размер body и текста;
- не писать raw payload в `console.error`;
- добавить будущий TTL/cleanup для raw payload, если объем и чувствительность начнут расти.

### Matching MVP

Функция:

- `matchP2pBankEventToPaymentGroup({ ownerId, amountRub, eventTime })`

Matching unit:

- single purchase: один `shop_purchases.id`;
- batch payment group: общий `payload.batch_token` и список `purchase_ids[]`.

Кандидаты для автоподтверждения:

- `shop_purchases.seller_owner_id = ownerId`;
- `payload.payment_method = 'p2p'`;
- `status = 'awaiting_receipt'`;
- сумма равна snapshot `shop_purchases.payload.amount_rub`;
- для batch сумма равна сумме `payload.amount_rub` всех purchase в batch group;
- `purchase.created_at <= observed_event_time <= expires_at + small_skew`;
- не expired.

`pending` purchases:

- не автоподтверждать;
- можно показывать как low-confidence candidate в ручной сверке;
- перед matching явно прогонять expiry stale pending purchases.

Если `event_time` отсутствует или выглядит ненадежным, событие не автоподтверждаем, а отправляем в manual review.

Результаты:

- 0 кандидатов: `unmatched`;
- 1 payment group: если `auto_confirm_enabled = true`, вызвать единый confirm service; event -> `confirmed`; purchases -> `paid`;
- больше 1 payment group: `ambiguous`, сохранить `candidate_purchase_ids` и/или `candidate_batch_tokens`.

Canonical amount source:

- основной источник суммы для matching: `shop_purchases.payload.amount_rub`, зафиксированный при создании покупки;
- `shop_items.price_rub` использовать только как legacy/manual fallback, потому что продавец может поменять цену после создания заказа.

### P2P confirm service

Не вызывать напрямую текущий `approveSellerPurchaseRecord` из webhook path.

Нужно вынести единый доменный сервис:

- `backend/services/shop-p2p-confirm.service.js` или близкое имя;
- вход: `sellerOwnerId`, `purchaseIds[]` или `batchToken`, `confirmSource`, `bankEventId`;
- используется manual approve, batch approve и auto-confirm.

Сервис должен:

- повторно проверять buyer tier / ownership limits;
- проверять, что item еще не sold/conflict для asset flows;
- делать idempotent claim статуса, по возможности compare-and-swap из `awaiting_receipt` в `paid`;
- корректно отвечать `already_paid`, `conflict`, `expired`, `transfer_failed`;
- запускать существующий handoff/unlock только из одного места;
- писать audit trail: `confirmed_at`, `confirm_source`, `bank_event_id` в purchase payload или отдельную связку.

### Dedupe / retry contract

Dedupe key строим по приоритету:

1. явный event/message id из SMS Forward payload;
2. id уведомления/forwarder message id;
3. normalized `raw_text + amount + event_time bucket + sender`.

При duplicate webhook:

- не повторять confirm;
- вернуть `200` с текущим статусом найденного события;
- записать или обновить `status = duplicate` только если это отдельная повторная запись, но не плодить двойную передачу товара.

## Frontend MVP план

### `/app/billing`

Переделать не только `BillingWebhookSection`, а весь billing-mode экран, иначе верхняя часть будет про SMS/Push Forward, а stats/journal останутся про legacy invoice webhook.

Содержимое:

- новый `BillingHeader` copy: `Автосверка СБП`;
- новые `BillingStatsGrid` cards: token status, last webhook, auto-confirm enabled, events needing review;
- новые priority signals: token missing, no SBP requisites, invalid/failed webhook events;
- кратко: `Подключи SMS/Push Forward на телефоне, куда приходят уведомления банка. BullRun будет искать заказ по сумме и подтверждать очевидные оплаты.`;
- webhook URL: `https://bullrun.ru/api/p2p-bank-events/webhook`;
- Bearer token:
  - если нет: `Сгенерировать токен`;
  - если есть: показывать hint, не полный secret;
  - `Обновить токен`;
- пример заголовка: `Authorization: Bearer ...`;
- тумблер `Автоматически подтверждать очевидные оплаты`;
- тестовое поле `Вставить пример SMS/Push`;
- результат теста: сумма, кандидаты, что бы сделал BullRun.

Legacy invoice webhook:

- `PaymentEventsSection` сейчас читает `payment_events` и показывает invoice-oriented CSV;
- либо убрать его с основного `/app/billing` MVP-экрана, либо явно спрятать ниже как `Legacy invoice webhook`;
- `BillingAdminIdSection` не должен смешиваться с SMS/Push Forward setup, если он относится к старому Telegram invoice flow.

Навигация:

- обновить `admin-v2/src/App.jsx`: label `/billing` с `Касса / webhook` на `Автосверка СБП` или `Касса СБП`;
- обновить mobile current label через тот же nav item.

### `/app/shop-receipts`

Переосмыслить как `Сверка оплат`.

Оставить ручные чеки, но добавить банковские события как второй источник. Экран должен быть dual-feed, а не один общий список.

- верхние KPI:
  - ждут проверки;
  - автоподтверждено сегодня;
  - неоднозначные уведомления;
  - последние входящие.

- блок `Нужно проверить`:
  - старые `awaiting_receipt`;
  - `p2p_bank_events.status = ambiguous/unmatched`, если есть кандидаты.

- блок `Входящие уведомления`:
  - redacted text preview, не raw text по умолчанию;
  - сумма;
  - статус matching/confirm;
  - связанный payment group, если найден.

State model:

- receipt queue остается покупками/группами из `shop_purchases`;
- bank events feed приходит из `/api/p2p-bank-events`;
- badges различают `подтверждено банком`, `подтверждено вручную`, `неоднозначно`, `не распознано`, `ошибка передачи`;
- для auto-confirmed покупок сохранять audit trail и показывать источник подтверждения;
- empty/error states должны быть отдельными для receipt queue и bank events feed.

Ручные действия:

- для receipt queue сохранить текущие approve/reject;
- для bank event можно `Привязать к заказу`, `Подтвердить payment group`, `Игнорировать`;
- ручное подтверждение должно идти через тот же P2P confirm service, что и auto-confirm.

Навигация:

- обновить `admin-v2/src/App.jsx`: label `/shop-receipts` с `Проверка чеков` на `Сверка оплат`.

### `/app/payments`

Оставить чистым: только реквизиты. Не тащить туда сложную автосверку, чтобы первый запуск не стал тяжелым.

Можно добавить небольшой статус:

- `СБП включен`;
- `Автосверка не настроена / настроена`;
- кнопка-ссылка `Настроить автосверку`.

### `site-v2/src/pages/PurchasesPage.jsx`

Покупательский экран нужно обновлять аккуратно, потому что сейчас `receiptNote` и `receiptFile` являются общим state страницы.

Требования:

- не усложнять checkout;
- `pending`: показать реквизиты, кнопку `Я оплатил`, чек/комментарий опциональны;
- `awaiting_receipt`: текст не только `Чек отправлен`, а `Ждем подтверждение продавца или банковское уведомление`;
- `paid`: `Оплата подтверждена`;
- `paid + ownership_transfer_status !== completed`: `Оплата есть, передача товара еще идет / сломалась`;
- если авто-match произошел до клика `Я оплатил`, покупатель должен увидеть `Оплата подтверждена`, а не форму чека;
- если трогаем форму чека, держать `receiptNote/receiptFile` per purchase card или через scoped modal, а не общим state страницы.

## Очередность реализации

- [x] Этап 1. Backend foundation
  - [x] добавить migration для `p2p_webhook_settings`;
  - [x] добавить `p2p_bank_events`;
  - [x] добавить token hash/prefix/hint helpers;
  - [x] добавить route `/api/p2p-bank-events` и mount в `backend/server.js`;
  - [x] добавить sanitized `GET /api/p2p-bank-events/settings`;
  - [x] убедиться, что `/api/payment-settings` не отдает и не принимает token hash/operational webhook fields;
  - [x] добавить parser MVP;
  - [x] добавить redaction/body-size guard/no-raw-log rule;
  - [x] добавить batch-aware matcher MVP;
  - [x] добавить индексы для `p2p_bank_events` и matcher lookup;
  - [x] вынести единый `confirmShopPurchasePayment` / P2P confirm service;
  - [x] перевести manual approve и batch approve на новый confirm service;
  - [x] добавить duplicate/retry contract.

- [x] Этап 2. Admin setup UI
  - [x] обновить весь `/app/billing`: header, stats, priority signals, setup section;
  - [x] решить судьбу legacy invoice webhook UI: убрать с основного экрана или спрятать ниже отдельным legacy-блоком;
  - [x] генерация/обновление Bearer token;
  - [x] webhook URL и короткая инструкция для SMS Forward;
  - [x] тест парсинга и матчинга;
  - [x] тумблер auto-confirm;
  - [x] обновить nav/mobile label `/billing`.

- [x] Этап 3. Reconciliation UI
  - [x] обновить `/app/shop-receipts` до `Сверка оплат`;
  - [x] сделать dual-feed: receipt queue отдельно, bank events feed отдельно;
  - [x] показывать bank events с redacted preview;
  - [x] показывать auto-confirmed, ambiguous, unmatched, ignored, error;
  - [x] ручная привязка event -> payment group;
  - [x] сохранить текущие approve/reject чеков.
  - [x] обновить nav/mobile label `/shop-receipts`.

- [x] Этап 4. Buyer flow polish
  - [x] в `site-v2/src/pages/PurchasesPage.jsx` уточнить P2P states:
    - `pending`;
    - `awaiting_receipt` / ждем уведомление или продавца;
    - `paid`;
    - `paid + transfer failed/in progress`;
  - [x] сделать receipt note/file scoped per purchase, если форма меняется;
  - [x] не усложнять путь покупателя.

- [ ] Этап 5. Verification and deploy
  - [x] backend syntax/build checks;
  - [x] admin-v2 build;
  - [x] site-v2 build, если трогаем buyer copy;
  - [ ] deploy production, как просил пользователь;
  - [ ] проверить на сервере:
    - генерация token;
    - тестовый webhook с Bearer;
    - invalid Bearer -> rejected;
    - disabled webhook -> rejected;
    - duplicate webhook -> 200 без повторного confirm;
    - создание P2P purchase;
    - buyer `Я оплатил` -> `awaiting_receipt`;
    - auto-confirm одного `awaiting_receipt` заказа;
    - `pending` без `Я оплатил` не auto-confirm;
    - batch P2P auto-confirm;
    - ambiguous при двух одинаковых payment groups;
    - late notification / unreliable `event_time` -> manual review;
    - race manual approve vs webhook не делает двойной handoff;
    - redaction: UI не показывает raw банковские PII по умолчанию;
    - `/app/shop-receipts` без console/errors.

## Важные правила, чтобы не повторить ошибки

- Не смешивать Robokassa и P2P bank notifications. Robokassa callback остается источником истины только для Robokassa.
- Не переиспользовать `payment_events` для shop/P2P bank events: там обязательный `invoice_id` и старый invoice-смысл.
- Не ломать существующие `TON`, `СБП`, `Robokassa` способы оплаты.
- Не удалять ручную проверку чеков: она нужна как fallback.
- Не вводить уникальные копейки/рубли в счетах для MVP.
- Не требовать чек как обязательный блокер автооплаты.
- Не хранить Bearer token открытым текстом.
- Не показывать полный token после генерации.
- Не отдавать token hash через `/api/payment-settings` или frontend Supabase reads.
- Не логировать raw bank webhook body.
- Не подтверждать автоматически, если найдено несколько кандидатов.
- Не подтверждать автоматически `pending`, пока покупатель не нажал `Я оплатил`.
- Не считать `paid` и `completed` одним состоянием: оплата и передача товара разные этапы.
- Не ломать batch P2P: один банковский event может соответствовать группе `purchase_ids[]`.

## Открытые решения перед кодом

- Название UI: оставить `/app/shop-receipts` как путь, но назвать экран `Сверка оплат`.
- Старый `/app/billing` webhook UI лучше заменить/переформатировать под `Автосверка СБП`, а старый provider webhook оставить ниже как `Legacy invoice webhook`, если он реально еще нужен.
- Нужно ли сразу поддерживать Telegram invoice `invoices` в этом же SMS/Push контуре? Для MVP лучше нет: начать с `shop_purchases`, потому что именно там живет текущий P2P shop.
- Подтвердить реальный формат payload и поддержку custom `Authorization: Bearer` в конкретном SMS/Push Forward приложении перед финальной реализацией parser-а.
