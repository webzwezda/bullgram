# Robokassa Normal Billing Handoff

Дата: 2026-05-12

Этот файл нужен как быстрый контекст для следующей сессии Codex по Robokassa/BullRun Normal.

## Что решили

- `Normal` продается как доступ к самому BullRun, а не как товар клиента в `Shop`.
- Клиентский `Shop/P2P` остается отдельным контуром для оплат клиентов BullRun-админов.
- `Normal` активируется только через отдельный backend billing-контур после валидного Robokassa Result callback.
- `SuccessURL` Robokassa не активирует доступ сам по себе, потому что пользовательский redirect можно открыть вручную.
- После истечения `normal_ends_at` пользователь возвращается в `trial`, а Normal-only функциональность закрывается лимитами.
- `pro` нельзя даунгрейдить автоматически.
- Продление до окончания срока добавляет 365 дней к текущему `normal_ends_at`, а не сжигает оставшиеся дни.

## Источники, которые уже проверены

### Robokassa requirements page

Проверена страница:

- `https://robokassa.com/how-works/`

Ключевые требования Robokassa к ресурсу:

- сайт должен быть публично доступен;
- на сайте должен быть актуальный контент;
- должны быть реальные товары/услуги, которые будут продаваться;
- должны быть цены и описание услуги;
- нужна оферта или пользовательское соглашение, если часть условий не вынесена прямо на сайт;
- должны быть контакты: телефон, email, Telegram/другой способ связи;
- для самозанятого нужно указать полностью ФИО и ИНН;
- для самозанятого достаточно указать город/регион;
- нужны условия получения услуги;
- нужны условия отказа/возврата денег;
- рекомендуется политика обработки персональных данных.

Что уже покрыто на `/pricing`:

- тарифы `Trial`, `Normal`, `Под заказ`;
- цена `Normal`: `900 ₽` за `365 дней`;
- описание дистанционной услуги BullRun;
- порядок получения услуги;
- блоки про оферту, возврат, персональные данные;
- продавец-самозанятый, ФИО, ИНН, регион, email, телефон/Telegram.

### Offer DOCX

Проверен локальный файл на рабочем столе:

- `/Users/webzwezda/Desktop/oferta_270415104864.docx`

Файл переписан под BullRun как дистанционную услугу/доступ, а не куплю-продажу физического товара.

Опубликованная копия в проекте:

- `site-v2/public/docs/oferta_270415104864.docx`
- live URL после деплоя: `https://bullrun.ru/docs/oferta_270415104864.docx`

Что внутри актуальной версии:

- заголовок: `ПУБЛИЧНАЯ ОФЕРТА`;
- продавец: самозанятый `Козель Илья Сергеевич`, ИНН `270415104864`;
- сайт: `https://bullrun.ru`;
- тариф `Normal`: `900 рублей` за `365 календарных дней`;
- услуга: дистанционный доступ к сервису BullRun;
- доступ выдается электронно после успешной оплаты через Robokassa;
- физической доставки, упаковки и передачи товара нет;
- после `normal_ends_at` пользователь возвращается в Trial;
- возврат до начала оказания услуги полный, после активации рассчитывается по неоказанной части;
- контакты: `webzwezda@gmail.com`, `+7 908 461-04-34`.

Ссылки на оферту добавлены:

- `/pricing` в блоке `Правила покупки`;
- `/billing/normal` перед кнопкой перехода к оплате.

## Самозанятый продавец

Публично на pricing указаны только данные, которые нужны для продавца/Robokassa:

- Продавец: `Козель Илья Сергеевич`
- ИНН: `270415104864`
- Статус: `Самозанятый`
- Регион: `Хабаровский край`
- Email: `webzwezda@gmail.com`
- Телефон/Telegram: `+7 908 461-04-34`

Паспортные данные пользователь присылал в чат, но их нельзя размещать на публичном сайте и не надо коммитить.

## Реализовано

### База данных

Миграции применены через Supabase MCP:

- `robokassa_normal_billing`
- `robokassa_billing_events_owner_index`

Локальный SQL-файл:

- `backend/sql/robokassa-normal-billing.sql`

Добавлено:

- `profiles.normal_started_at timestamptz`
- `profiles.normal_ends_at timestamptz`
- `billing_orders`
- `billing_events`
- `billing_order_inv_id_seq`
- индексы для order/event lookup, включая `billing_events_owner_idx`

### Backend

Новые файлы:

- `backend/routes/billing.routes.js`
- `backend/services/bullrun-billing.service.js`
- `backend/services/robokassa.service.js`

Подключение:

- `backend/server.js` монтирует `app.use('/api/billing', billingRoutes(supabase))`

Endpoint'ы:

- `GET /api/billing/orders/current`
  - требует auth;
  - возвращает текущий billing state, профиль, readiness и последний order.
- `POST /api/billing/checkout/normal`
  - требует auth;
  - создает pending order;
  - строит Robokassa payment URL;
  - если Robokassa не настроена, возвращает guided `503`.
- `GET|POST /api/billing/robokassa/result`
  - public callback;
  - принимает query и `application/x-www-form-urlencoded`;
  - проверяет подпись через password 2;
  - проверяет сумму;
  - пишет `billing_events`;
  - ставит order в `paid`;
  - активирует `profiles.product_tier = normal`;
  - возвращает `OK{InvId}`.
- `GET|POST /api/billing/robokassa/success`
  - не активирует доступ;
  - пишет event;
  - редиректит на `/billing/success`.
- `GET|POST /api/billing/robokassa/fail`
  - пишет event, если возможно;
  - редиректит на `/billing/fail`.

В `backend/utils/agent-mcp-auth.js` добавлен request-time guard:

- если `product_tier = normal` и `normal_ends_at <= now`, профиль переводится в `trial`;
- даты Normal сохраняются.

В `backend/routes/shop.routes.js` заблокирована старая выдача Normal через `applyShopOfferUnlock()`:

- `offer_code = normal` больше не пишет `profiles.product_tier = normal`;
- в лог пишется warning.

В `backend/routes/dashboard.routes.js` Normal signal теперь ведет на `/billing/normal`.

### Frontend site-v2

Новые страницы:

- `site-v2/src/pages/BillingNormalPage.jsx`
- `site-v2/src/pages/BillingSuccessPage.jsx`
- `site-v2/src/pages/BillingFailPage.jsx`

Маршруты в `site-v2/src/App.jsx`:

- `/billing/normal`
- `/billing/success`
- `/billing/fail`

Линки:

- `SALES_LINKS.ops = '/billing/normal'`
- hard-coded `/shop?offer=normal` заменены на `/billing/normal`
- legacy `/shop?offer=normal` редиректит на `/billing/normal` до auth gate

Auth:

- `AuthProvider.login(targetPath)` теперь сохраняет текущий `pathname + search + hash`;
- unauthenticated `/billing/normal` после Google login должен возвращаться обратно на `/billing/normal`, а не в `/shop`.

Profile UI:

- `UserProfileCard` показывает срок Normal по `normalEndsAt`.

Pricing:

- `/pricing` показывает три тарифа: `Trial`, `Normal`, `Под заказ`.
- `Normal`: `900 ₽` за `365 дней доступа`.
- `Под заказ` неактивен.
- Robokassa/legal blocks добавлены на страницу pricing.

## ENV для Robokassa

Файл-пример:

- `backend/.env.example`

Нужные переменные:

```env
ROBOKASSA_ENABLED=false
ROBOKASSA_TEST_MODE=true
ROBOKASSA_MERCHANT_LOGIN=
ROBOKASSA_PASSWORD_1=
ROBOKASSA_PASSWORD_2=
BILLING_NORMAL_PRICE_RUB=900
BILLING_NORMAL_DURATION_DAYS=365
BILLING_PENDING_ORDER_TTL_MINUTES=30
```

После регистрации Robokassa надо поставить:

```env
ROBOKASSA_ENABLED=true
ROBOKASSA_TEST_MODE=true
ROBOKASSA_MERCHANT_LOGIN=<из кабинета>
ROBOKASSA_PASSWORD_1=<из кабинета>
ROBOKASSA_PASSWORD_2=<из кабинета>
```

Для production после тестов:

```env
ROBOKASSA_TEST_MODE=false
```

Важно: Robokassa passwords не должны попадать во frontend, Supabase public tables, `payment_settings`, admin UI или логи.

## URL для кабинета Robokassa

Указать в кабинете:

- Result URL: `https://bullrun.ru/api/billing/robokassa/result`
- Success URL: `https://bullrun.ru/api/billing/robokassa/success`
- Fail URL: `https://bullrun.ru/api/billing/robokassa/fail`

Метод можно ставить `POST` для Result. Backend также принимает `GET`.

### Текущее состояние кабинета Robokassa

На 2026-05-13 магазин создан в партнерском кабинете:

- Shop name: `BullRun`
- Shop ID / MerchantLogin: `bullrun`
- State: `Activation request sent`
- Business type: `Web-based Service`
- Site URL: `https://bullrun.ru/`
- Withdrawal method добавлен в Robokassa; банковские реквизиты не дублировать в репозитории.
- Activation request отправлен на проверку Robokassa 2026-05-13.

Technical preferences сохранены:

- Result URL: `https://bullrun.ru/api/billing/robokassa/result`
- Result method: `POST`
- Success URL: `https://bullrun.ru/api/billing/robokassa/success`
- Success method: `GET`
- Fail URL: `https://bullrun.ru/api/billing/robokassa/fail`
- Fail method: `GET`
- Hash algorithm: `MD5`
- Test hash algorithm: `MD5`

Пароли Robokassa не сохранять в репозитории и не писать в чат.

2026-05-15: production `Password #1/#2` были пересинхронизированы между кабинетом Robokassa и серверным `/var/www/backend/.env`, потому что боевые платежные ссылки начали возвращать Robokassa error `29`. После email-подтверждения изменений backend был перезапущен через PM2 с `--update-env`; контрольная production-ссылка Robokassa перестала возвращать `code:29` и начала редиректить на `/Merchant/Index/...`.

На 2026-05-13 в кабинете Robokassa сгенерированы и сохранены:

- production `Password #1`
- production `Password #2`
- test `Password #1`
- test `Password #2`

Test passwords синхронизированы с production `Password #1/#2`, чтобы текущий backend мог работать в `ROBOKASSA_TEST_MODE=true` без отдельных test env-переменных.

Backend env на сервере `/var/www/backend/.env` обновлен, PM2 `bullrun-tg-backend` перезапущен с `--update-env`:

- `ROBOKASSA_MERCHANT_LOGIN=bullrun`
- `ROBOKASSA_ENABLED=true`
- `ROBOKASSA_TEST_MODE=true`
- `ROBOKASSA_PASSWORD_1` present, length `20`
- `ROBOKASSA_PASSWORD_2` present, length `20`

Перед production оплатами после активации магазина нужно переключить:

- `ROBOKASSA_TEST_MODE=false`

## Как работает Normal

При оплате:

1. Пользователь открывает `/billing/normal`.
2. Frontend вызывает `POST /api/billing/checkout/normal`.
3. Backend создает `billing_orders` с numeric `provider_invoice_id`.
4. Backend строит Robokassa URL.
5. Пользователь оплачивает в Robokassa.
6. Robokassa вызывает `ResultURL`.
7. Backend проверяет подпись и сумму.
8. Order становится `paid`.
9. Профиль получает:
   - `product_tier = normal`
   - `trial_started_at = null`
   - `trial_ends_at = null`
   - `normal_started_at = now`
   - `normal_ends_at = max(now, old_normal_ends_at) + 30 days`

При истечении:

1. Любой authenticated backend request грузит profile через `loadProfileForUser`.
2. Если Normal истек, backend пишет `product_tier = trial`.
3. `normal_started_at` и `normal_ends_at` остаются как история.

## Проверки, которые уже делались

Локально:

- `node --check backend/services/robokassa.service.js`
- `node --check backend/services/bullrun-billing.service.js`
- `node --check backend/routes/billing.routes.js`
- `node --check backend/server.js`
- `cd site-v2 && npm run build`

Деплой:

- полный deploy backend + frontend: `20260512-121914`
- v2 frontend fix deploy: `20260512-122339`
- v2 offer deploy: `20260512-124423`

Live проверено на `https://bullrun.ru`:

- `/pricing` открывается;
- `/billing/normal` открывается и unauthenticated показывает login gate;
- `/billing/success` рендерится после reload;
- `/billing/fail` рендерится после reload;
- `/shop?offer=normal` редиректит на `/billing/normal`;
- `/api/billing/orders/current` без auth возвращает `401`;
- пустой `/api/billing/robokassa/result` возвращает `400`;
- `/api/billing/robokassa/success?InvId=missing` возвращает redirect на `/billing/success?inv=missing`;
- PM2 процесс `bullrun-tg-backend` online.
- `/docs/oferta_270415104864.docx` отдается с `200`, MIME `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, размер `41312`;
- live DOCX скачан и проверен через `python-docx`: есть `ПУБЛИЧНАЯ ОФЕРТА`, `https://bullrun.ru`, ИНН, `900`, `Normal`, нет незаполненных `____`, нет формулировки `купли-продажи`;
- `/pricing?offer_check=20260512124423` содержит публичную ссылку `Скачать публичную оферту`;
- browser console/errors для live `/pricing` вернули `OK`.

Примечание: пустой Result smoke-test оставил ожидаемую строку в PM2 error log:

- `[Billing] Robokassa result error: Некорректный callback Robokassa.`

Это не production bug, а результат ручной проверки пустого callback.

## Supabase advisors

После DDL был performance warning по `billing_events.owner_id` без индекса. Он исправлен миграцией:

- `robokassa_billing_events_owner_index`

Оставшиеся advisor warnings в основном старые:

- `function_search_path_mutable` для старых функций;
- много unindexed FK/unused index по старым таблицам;
- unused indexes по новым billing таблицам ожидаемы, пока нет платежного трафика.

## Что осталось после регистрации Robokassa

1. Сначала пройти test payment.
2. Проверить:
   - `billing_orders.status = paid`
   - `billing_events.signature_valid = true`
   - `profiles.product_tier = normal`
   - `profiles.normal_ends_at` установлен
   - success page ведет к `/app`
   - на платежной форме/в Robokassa видна номенклатура чека `BullRun Normal 365 дней доступа`
3. После успешного теста backend env переключен:
   - `ROBOKASSA_TEST_MODE=false`

## Фискализация / Робочеки СМЗ

Robokassa после активации магазина рекомендовала подключить `Робочеки СМЗ` и предупредила, что отсутствие номенклатуры может привести к некорректным чекам.

Сделано 2026-05-14:

- backend теперь добавляет параметр `Receipt` в платежную ссылку Robokassa;
- `Receipt` участвует в `SignatureValue` по схеме `MerchantLogin:OutSum:InvId:Receipt:Password#1`;
- позиция чека для Normal:
  - `name`: `BullRun Normal 365 дней доступа`
  - `quantity`: `1`
  - `sum`: `900`
  - `cost`: `900`
  - `payment_method`: `full_payment`
  - `payment_object`: `service`
  - `tax`: `none`
- deploy backend/frontend выполнен с timestamp `20260513-142755` (UTC timestamp скрипта);
- server-side smoke check подтвердил, что payment URL содержит `Receipt` и `SignatureValue`.
- correction deploy on 2026-05-14 local time, deploy timestamp `20260513-145124`, switched `Normal` from the earlier draft `2 900 / 30 дней` to `900 / 365 дней` in backend defaults, server env, site copy, offer DOCX, and Receipt smoke check.

Robokassa `/Fiscalization`:

- заявка на переход с `Самостоятельное` на `Робочеки СМЗ` отправлена;
- после одобрения партнерского запроса в `Мой налог` кабинет Robokassa показывает `Текущее решение — Робочеки СМЗ`.
- текущий статус: `Робочеки СМЗ`, активное текущее решение.

## Test payment 2026-05-14

Live test payment for `Normal` was completed in Robokassa test mode:

- initial Robokassa page returned interface error `29` until `Receipt` was sent as an encoded value through `URLSearchParams`; keep `Receipt` in the signature as URL-encoded JSON and let the final query encode that value again for GET links;
- first ResultURL callback had invalid signature because Robokassa posted `OutSum=900`, while backend verification normalized it to `900.00`; signature verification must use the raw callback `OutSum` string and only normalize for order amount comparison;
- fixed files: `backend/services/robokassa.service.js`;
- final ResultURL retry returned `OK100001`;
- after the successful test, production backend env was switched to `ROBOKASSA_TEST_MODE=false` and PM2 was restarted with `--update-env`;
- server-side smoke check confirms future payment URLs no longer include `IsTest`, while `Receipt` remains `BullRun Normal 365 дней доступа` / `900`;
- `billing_orders.provider_invoice_id = 100001` is `paid`, `plan_code = normal_365d`, `amount_rub = 900.00`, `duration_days = 365`;
- `billing_events` has `robokassa_result` with `signature_valid = true`;
- profile `webzwezda@gmail.com` has `product_tier = normal`, `normal_started_at = 2026-05-13 16:19:17 UTC`, `normal_ends_at = 2027-05-13 16:19:17 UTC`;
- live `/billing/normal` shows `Normal активен до 14 мая 2027 г.` in local display.

## Shop inventory Robokassa

Добавлено 2026-05-15:

- витрины `/app/userbots` и `/app/proxies` для покупки BullRun-инвентаря теперь используют Robokassa;
- это касается `shop_items.item_type in ('userbot', 'proxy', 'bundle')`;
- клиентский `Shop/P2P` остается отдельным контуром: TON/СБП не убирались из внутренних клиентских сценариев;
- backend добавляет `robokassa` к существующим `available_payment_methods` для inventory items, если Robokassa включена и настроена;
- TON/СБП остаются доступными, если они есть в `shop_items.payment_methods` и у продавца настроены соответствующие реквизиты;
- у inventory-лота должна быть `payment_methods` с `robokassa` и `price_rub > 0`, иначе Robokassa-кнопка не показывается и Robokassa checkout отклоняется;
- в `/app/shop` блок `Proxy` умеет сохранять `Robokassa` как отдельный способ оплаты рядом с `TON` и `СБП`;
- в `/app/userbots` блок `Продажа юзербота` умеет сохранять `Robokassa` для `userbot` и `bundle` лотов; RUB-цена общая для `СБП / Robokassa`;
- `shop_items.payment_methods` нельзя очищать ради Robokassa: это отдельный новый метод поверх существующих способов оплаты;
- старые pending-покупки с `ton/p2p` могут продолжать отображаться как старые покупки, новые Robokassa-покупки получают `payload.payment_method = robokassa`.

Платежный поток:

1. Пользователь на `/app/userbots` или `/app/proxies` нажимает покупку.
2. Frontend вызывает существующие endpoint'ы:
   - `POST /api/shop/public/purchase`
   - `POST /api/shop/public/purchase/batch`
3. Backend создает `shop_purchases` в `pending`, генерирует numeric `robokassa_invoice_id` и кладет Robokassa данные в `shop_purchases.payload`:
   - `payment_method`
   - `amount_rub`
   - `robokassa_invoice_id`
   - `robokassa_payment_url`
   - `robokassa_description`
   - `robokassa_total_rub`
4. Frontend сразу редиректит пользователя на `robokassa_payment_url`.
5. Robokassa вызывает общий Result URL: `https://bullrun.ru/api/billing/robokassa/result`.
6. `billing.routes.js` сначала пробует Normal billing order, а если order не найден, передает callback в shop handler.
7. Shop handler проверяет подпись и сумму, пишет `billing_events`, переводит `shop_purchases.status = paid` и запускает текущий `transferShopAssets`.
8. Success/Fail redirect возвращает пользователя на:
   - `/app/userbots?shop_payment=success|fail&inv=...` для userbot/bundle;
   - `/app/proxies?shop_payment=success|fail&inv=...` для proxy.

Фискализация для shop inventory:

- платежная ссылка строится через общий `buildRobokassaPaymentUrl()`;
- чековая позиция сейчас одна на весь заказ;
- описание составляется как `BullRun inventory: ...`;
- для СМЗ это дистанционная услуга/цифровой доступ/инвентарь внутри BullRun, физической доставки нет.

## Важные ограничения

- Не писать BullRun Normal payments в `shop_purchases`: Normal остается только в `billing_orders`.
- Не активировать Normal через shop inventory callbacks.
- Не хранить Robokassa passwords в `payment_settings`, `shop_items`, `shop_purchases.payload`, frontend или логах.
- Не ломать TON/СБП: Robokassa для `/app/userbots` и `/app/proxies` добавляется как новый метод, а не заменяет существующие способы.
- Не активировать Normal с `SuccessURL`.
- Не возвращать старый `/admin`; активный путь admin-v2 это `/app`.
- Финальная проверка для этого проекта должна быть на live `https://bullrun.ru`, а не на localhost.
