# Выдача юзербота + прокси при оплате Pro (2026-09-10)

Продуктовое правило: покупатель Pro получает вместе с тарифом тг-аккаунт (юзербот) и прокси.
Источник выдачи — бандлы (`shop_items`, `item_type='bundle'`) на общей витрине Shop.

## Флоу

заказ Pro стал `paid` → `fulfillProOrderBundle` (рядом с `activateProForOrder` на всех трёх
путях активации) → claim в `billing_orders.payload` → выбор published-бандла (юзербот не
restricted) → CAS `published → sold/private` → `shop_purchases` (`amount_ton=0`,
`source='pro_billing'`) → `transferShopAssets` → `payload.fulfillment_status='completed'`.
Ошибки/пустой сток → `failed`, ретрай recovery-свипом (`billing-activation-recovery.job.js`).
Поверхности: `fulfillment_status` в публичном billing-view (PayPage), `proFulfillmentPending`
в `/api/dashboard` (алерт в OpsRail), копирайт Pro на HomePage.

## Ключевые решения по итогам ревью

- Свип имеет нижнюю границу `PRO_FULFILLMENT_SINCE` (дефолт — дата запуска фичи), иначе
  первый деплой задним числом раздал бы бандлы всем историческим Pro-оплатам.
- Claim — CAS по паре (`fulfillment_status`, `fulfillment_claimed_at`); `completed` финален,
  `failed` и зависший `processing` (>10 мин) переигрываются; финализация тоже CAS — медленный
  воркер не перезапишет результат свипа и не выдаст второй бандл.
- Упавший transfer оставляет лот проданным (семантика Shop «нужен возврат»), заказ — `failed`,
  оператор видит алерт; двойной продаже частично перенесённого актива нет.
- `proFulfillmentPending` намеренно платформенный (сток бандлов общий), задокументировано в
  `backend/README.md`.
- Restricted-бандлы с витрины снимаются существующим `restricted-userbot-cleanup.job` →
  `purgeRestrictedUserbotAccount` → `unpublishShopItemsByUserbotId`; в момент выдачи ещё раз
  проверяется `runtime_status !== 'restricted'`.

## Проверка

- `node --check` всех тронутых backend-файлов, сборки site-v2 и admin-v2 — зелёные.
- Ревью-пасс (reviewer-фрейм): гонки, матрица отказов, покрытие путей активации, контракты
  полей — найденные блокеры (retro-grant, CAS финализации) исправлены до коммита.
- После деплоя рекомендован смоук: одна реальная оплата Pro → строка в `shop_purchases` с
  `payload.source='pro_billing'`, перенос owner_id, `fulfillment_status='completed'`, алерт
  гаснет. Джсонб-фильтры (`payload->>...`) впервые используются в проекте — если PostgREST их
  не примет, это будет видно в логах `[pro-fulfillment]` при первой выдаче.
