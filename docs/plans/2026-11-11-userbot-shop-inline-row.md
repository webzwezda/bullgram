# План: витрина магазина на /userbot — одна строка в шапке карточки

Решение владельца (2026-11-11): большую карточку «Магазин аккаунтов» на
UserbotsPage ужать до одной строки (лот · цена · [− qty +] · «Купить») и
встроить в основную карточку юзербота (CenterAccountCard, шапка под
селектором аккаунта). Оплата — редирект на существующую страницу счёта
`/pay/:purchaseId` (site-v2 PayPage). ConnectPage не трогаем (там остаётся
большая витрина UserbotStorefrontSection). /shop не трогаем.

## Чек-лист

- [x] Изучение: batch-механика (batch_token = `batch_<random>` — не UUID;
      memo общий на все строки пакета; матчинг суммы — `verifyPaymentOnce`
      «перевод ≥ ожидаемого на строку», поэтому authed check-batch работает)
- [x] Предыдущий контур: покупка со /shop уже редиректит на /pay; публичная
      отмена брони с кнопкой на /pay готова (26c83ac)
- [x] Бэкенд `delivery.js`: `public-view` и `verify-public` понимают
      batch_token (резолв `payload->>'batch_token'`, агрегат статуса как в
      check-batch, сумма пакета, title «Лот × N», delivery=null — выдача
      пакетов живёт в кабинете)
- [x] `useShopStorefront`: `openCheckout`/`createBatchCheckout` возвращают
      `{ id, error }` (аддитивно; ConnectPage игнорирует)
- [x] Компонент `ShopInlineRow` (семантические токены — ратчет-нейтрально) +
      slim-строка неоплаченных покупок («Открыть счёт» → /pay, только pending)
- [x] CenterAccountCard: проп `shopInlineSlot` в шапке; UserbotCenterSection:
      тот же слот в пустой карточке («Боевых аккаунтов пока нет»)
- [x] UserbotsPage: снять UserbotStorefrontSection, почистить неиспользуемые
      хуки; клик «Купить» → window.location.assign('/pay/<id>')
- [x] Сборки userbot-v2 + site-v2 (PayPage без изменений), check:design,
      test:sales
- [x] Пуш, деплой, e2e на проде: single-покупка (создать → /pay view → отмена) — ок
      (6b7cf05, 2026-11-11); batch-роутинг проверен (batch_* → 404 вместо 400);
      живая покупка qty>1 — ручная проверка владельцем (нужен JWT в кабинете)

## Не трогаем
ConnectPage, /shop, purchase flow (кроме read-only public-view/verify),
ownership-transfer, выдачу архивов.

## Риски
- Batch e2e на проде требует JWT — живая проверка только single-флоу,
  batch проверяет владелец руками.
- pending-покупка из кабинета и /pay: autoRestore inline-чекаута в
  useShopStorefront остаётся для ConnectPage; на UserbotsPage UI его не
  использует (инертно).

## Ревью (2026-11-11)

Сделано и задеплоено (6b7cf05):
- UserbotsPage: UserbotStorefrontSection снят; строка магазина + slim-строка
  неоплаченных покупок собираются в `shopInlineSlot` и рендерятся в шапке
  CenterAccountCard (под селектором) и в пустой карточке центра.
- ShopInlineRow (новый файл, семантические токены, ратчет-нейтрально):
  лот · цена/шт · [− qty +] · «Купить N TON»; клик → openCheckout/
  createBatchCheckout → window.location.assign('/pay/<id>').
- useShopStorefront: openCheckout/createBatchCheckout возвращают { id, error }
  (аддитивно; ConnectPage не менялся).
- Бэкенд delivery.js: public-view и verify-public принимают batch_token
  (BATCH_TOKEN_RE + .contains('payload',{batch_token})), агрегат статусов как
  в authed check-batch, сумма пакета, title «Лот × N», delivery=null.
- Verified: build userbot-v2/site-v2, check:design PASS, test:sales 7/7,
  node --check; e2e прод: single view ok, cancel-public ok, batch_* роутится.
Открытое: живая batch-покупка qty>1 из кабинета — руками владельца.
