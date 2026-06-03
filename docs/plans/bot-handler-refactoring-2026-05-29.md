# Refactoring: official-bot.service.js

## Context

`backend/services/official-bot.service.js` — 3503 строк, весь бот в одном файле. Метод `registerHandlers()` (~1600 строк) регистрирует все 26 action-обработчиков, 4 event-обработчика и 4 вспомогательные функции. Это привело к багу: regex `/^buy_(.+)$/` перехватывал `buy_tariff` раньше точного match'а — час отладки.

Цель: разбить на доменные модули так, чтобы:
- порядок регистрации был гарантирован (exact перед regex)
- добавление новых ботов (автопостер и т.д.) было изолированным
- файл `official-bot.service.js` остался на своём месте (потребители не меняются)

## Структура

```
backend/services/official-bot/
  shared/
    menu-builders.js          — sendAdminMenu, sendUserMainMenu, sendMainMenu, createInvoiceForTariff
    pending-state.js          — pendingGiftCodeInputs, pendingReferralWalletInputs + key helpers
  handlers/
    handler-registry.js       — registerAllHandlers(): явный порядок вызовов + dev-валидация
    start.handler.js          — bot.start()
    navigation.handler.js     — back_to_main, user_menu, check_status, my_status, gift_code_redeem, open_referral
    referral.handler.js       — referral_info, referral_wallet_setup, referral_payout_request
    tariff.handler.js         — buy_tariff, show_tariff_*, buy_*, pay_tariff_*, tariffs_page_*, category_*
    payment.handler.js        — fiat_paid_*, check_payment_*
    admin.handler.js          — admin_panel, admin_gift_code, admin_gift_code_tariff_*, admin_tariffs, admin_referral, admin_profile, admin_stats, admin_approve_*, admin_reject_*
    message.handler.js        — bot.on('message') — gift codes, wallets, receipts
    chat-events.handler.js    — my_chat_member + chat_join_request (оба небольшие, логически связаны)
```

## Ключевые решения (обновлено после ревью)

### 1. Паттерн регистрации — прямой вызов bot.action()
Каждый handler-файл экспортирует `register*Handlers(bot, regCtx)` — **напрямую вызывает** `bot.action()`, `bot.start()`, `bot.on()`. Без descriptor-массивов и без авто-сортировки.

```js
// Пример: tariff.handler.js
export function registerTariffExactHandlers(bot, { service, botId }) {
    bot.action('buy_tariff', async (ctx) => { /* ... */ });
}

export function registerTariffRegexHandlers(bot, { service, botId }) {
    bot.action(/^show_tariff_(.+)$/, async (ctx) => { /* ... */ });
    bot.action(/^buy_(?!tariff$)(.+)$/, async (ctx) => { /* ... */ });
}
```

### 2. Гарантия порядка — явный порядок вызовов в handler-registry.js
Registry вызывает модули в фиксированном порядке: сначала exact-match, потом regex, потом catch-all. Это видно глазами, без магии:

```js
export function registerAllHandlers(bot, regCtx) {
    // 1. start + exact-match actions
    registerStartHandlers(bot, regCtx);
    registerNavigationHandlers(bot, regCtx);
    registerReferralHandlers(bot, regCtx);
    registerTariffExactHandlers(bot, regCtx);
    registerPaymentExactHandlers(bot, regCtx);
    registerAdminHandlers(bot, regCtx);

    // 2. regex actions (ПОСЛЕ exact)
    registerTariffRegexHandlers(bot, regCtx);
    registerPaymentRegexHandlers(bot, regCtx);

    // 3. catch-all event handlers
    registerMessageHandlers(bot, regCtx);
    registerChatEventHandlers(bot, regCtx);
}
```

Dev-валидация (`validateNoExactShadowedByRegex`) остаётся как дополнительная защита — при старте проверяет что ни один regex не перекрывает exact-match.

### 3. Зависимости — минимальный regCtx
```js
const regCtx = { service, botId, username, role: normalizedRole };
```
- `service` — OfficialBotService instance. Доступ ко всем ~30 методам через `service.supabase`, `service.getBotAdminContext(botId)`, etc.
- Обработчики используют `service` вместо `this` — тот же паттерн что сейчас
- `pendingGiftCodeInputs`/`pendingReferralWalletInputs` — handler импортирует напрямую из `../shared/pending-state.js`
- Menu builders — handler импортирует `createMenuBuilders()` из `../shared/menu-builders.js` и вызывает с `{ service, botId }`
- Дополнительные импорты внутри handlers: `QRCode` (tariff), `decrypt` (admin), `getReferralEconomics`/`reconcileReferralReserveAccount` (referral), `convertAmountToTon` (payment)

### 4. activeBots — НЕ перемещать
`activeBots` (module-level Map, строка 11) остаётся в `official-bot.service.js`. Она разделяется между всеми экземплярами сервиса (by design) и используется методами `startBot`, `stopBot`, `getBot`, `stopAllBots`. 9 файлов-потребителей создают экземпляры `OfficialBotService` — все они корректно работают с общей Map.

### 5. Потребители не меняются
`official-bot.service.js` остаётся по тому же пути. Экспортируется только `OfficialBotService`. Класс и все методы остаются в файле. Меняется только тело `registerHandlers`.

## План миграции (3 фазы — Фаза 2 удалена)

### Фаза 1: Scaffold — shared модули
1. Создать `backend/services/official-bot/` директорию
2. Создать `shared/pending-state.js` — перенести pending Maps + helpers + utility функции (строки 12-62: generateGiftCode, normalizeTonWallet, looksLikeTonWallet, normalizeTelegramUsername, resolveTelegramVisibility, buildChannelVisibilityPayload)
3. Создать `shared/menu-builders.js` — вынести sendAdminMenu, sendUserMainMenu, sendMainMenu, createInvoiceForTariff (строки 1899-1970, 2171-2274)
4. Обновить импорты в `official-bot.service.js`
5. **Проверка**: деплой, `/start` в боте, навигация по меню

### Фаза 2: Вынос обработчиков по одному домену
Сразу создаём `handler-registry.js` и начинаем выносить. Каждый шаг: создать handler файл → обновить registry → удалить inline код из registerHandlers → проверить → деплой.

По порядку (от простого к сложному):
- **2a** start.handler.js + navigation.handler.js (самые простые, без regex)
- **2b** referral.handler.js (3 обработчика)
- **2c** admin.handler.js (8 обработчиков)
- **2d** payment.handler.js (fiat_paid_*, check_payment_*)
- **2e** tariff.handler.js (6 обработчиков, критичный — exact + regex в одном файле)
- **2f** message.handler.js (1, но большой — gift codes, wallets, receipts)
- **2g** chat-events.handler.js (my_chat_member + chat_join_request)

### Фаза 3: Cleanup
- Удалить dead code: `tariffs_page_` handler вызывает несуществующий `sendPaginatedTariffsMenu` (строка 3068)
- Удалить неиспользуемые импорты `TelegramClient`, `StringSession` (строки 8-9)
- Итог: `official-bot.service.js` → ~1900 строк (service methods + constructor + startBot/stopBot + slim registerHandlers)

## Защита от buy_tariff бага — 3 слоя

1. **Структурный**: registry вызывает exact-match модули перед regex модулями — явно, видно глазами
2. **Dev-валидация**: при старте `validateNoExactShadowedByRegex()` проверяет все regex vs exact, логирует конфликт
3. **Конвенция**: в tariff.handler.js exact и regex обработчики разделены на две export-функции

## Файлы

| Файл | Действие |
|------|----------|
| `backend/services/official-bot.service.js` | Уменьшается с 3503 → ~1900 строк |
| `backend/services/official-bot/shared/pending-state.js` | Новый |
| `backend/services/official-bot/shared/menu-builders.js` | Новый |
| `backend/services/official-bot/handlers/handler-registry.js` | Новый |
| `backend/services/official-bot/handlers/*.handler.js` | 7 новых файлов |
| `backend/routes/official-bot.routes.js` | Без изменений |
| `backend/jobs/official-bot-webhook-queue.job.js` | Без изменений |

## Верификация

После каждой фазы:
1. `npm run deploy`
2. В боте: `/start` → навигация по меню → `💳 Покупка тарифа` → список тарифов → нажатие на тариф → выбор оплаты
3. Админ-панель: `🔧 Админка` → каждый пункт меню
4. `my_chat_member`: добавить бота в канал, проверить что права обновились

## Пропущенные зависимости (найдены при ревью)

Эти импорты используются внутри handlers — handler-файлы должны импортировать их напрямую:
- `QRCode` (из `qrcode`) — tariff.handler.js
- `decrypt` (из `../../utils/crypto.js`) — admin.handler.js
- `getReferralEconomics`, `reconcileReferralReserveAccount` (из referral-reserve.service.js) — referral.handler.js, navigation.handler.js
- `convertAmountToTon` — payment.handler.js
