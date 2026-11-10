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
- [ ] Пуш, деплой, e2e на проде: single-покупка (создать → /pay view → отмена),
      batch — ручная проверка владельцем

## Не трогаем
ConnectPage, /shop, purchase flow (кроме read-only public-view/verify),
ownership-transfer, выдачу архивов.

## Риски
- Batch e2e на проде требует JWT — живая проверка только single-флоу,
  batch проверяет владелец руками.
- pending-покупка из кабинета и /pay: autoRestore inline-чекаута в
  useShopStorefront остаётся для ConnectPage; на UserbotsPage UI его не
  использует (инертно).
