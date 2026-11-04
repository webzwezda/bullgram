# QR-логин: AUTH_TOKEN_EXPIRED при неспешном скане

Дата: 2026-11-04. Статус: в работе.

## Первопричина (проверено по коду)

- Токен QR-логина Telegram живёт ~30 секунд; грамджсовский
  `signInUserWithQrCode` (node_modules/telegram/client/auth.js:185+) опрашивает
  `ExportLoginToken` раз в 30 секунд (`QR_CODE_TIMEOUT=30000`) и **не имеет
  обработки `AUTH_TOKEN_EXPIRED`** — первый же цикл, где скан не успели,
  отклоняет весь auth-promise.
- `generateQR` (services/userbot.service.js) при отклонении ставит
  `authState='failed'`, `authError` — и роут `/qr-status` отдаёт сырую строку
  «AUTH_TOKEN_EXPIRED» на экран (роуты: routes/userbot.routes.js:2603/2679).
- Вторая половина: `qrCode`-коллбек GramJS дёргается на каждый цикл с новым
  токеном, но бэкенд резолвит только первый — изображение QR на экране вообще
  не ротируется, владелец сканирует заведомо протухший код.

Фикс делаем на нашем уровне (node_modules не патчим):

- [ ] `backend/utils/qr-auth.js` (новый): `runQrAuthWithRotation(startCycle, opts)`
      — перезапуск auth-цикла при `AUTH_TOKEN_EXPIRED`, лимит перезапусков
      (60 ≈ окно TTL-сессии 20 минут), инъектится `isRotatable` для тестов.
- [ ] `services/userbot.service.js` `generateQR`: auth-promise через
      `runQrAuthWithRotation`; `qrCode`-коллбек обновляет
      `qrSession.currentQrCode` на каждом токене (первый — как раньше, resolve);
      константа `QR_TOKEN_RESTART_LIMIT`.
- [ ] `routes/userbot.routes.js` `/qr-status`: в pending-ответе отдавать
      `qr_code` (свежая картинка), если она есть.
- [ ] `userbot-v2/src/pages/bots/useUserbotOnboarding.js`: поллинг сравнивает
      `qr_code` с последним показанным (ref) и обновляет `qrCodeUrl` на ротации.
- [ ] Тесты: `backend/test/test-qr-auth.js` — ротация переживает двойной
      AUTH_TOKEN_EXPIRED, не-ротируемая ошибка падает сразу, лимит уважается;
      проводка `test:qr-auth` в package.json; сборка userbot-v2.

## Не делаем

- Патч node_modules/telegram (QR_CODE_TIMEOUT) — только наши обёртки.
- Перевод сырых ошибок в UI-копирайт: после ротации AUTH_TOKEN_EXPIRED до
  экрана больше не доходит (лимит 60 перезапусков — теоретический хвост).

## Волна 2: 2FA «Account has 2FA enabled.» (тот же день)

После ротации владелец дошёл до скана — и упёрся в 2FA. Первопричина: после
принятого скана Telegram для аккаунтов с облачным паролем отвечает
SESSION_PASSWORD_NEEDED, GramJS зовёт коллбек `password` — мы его не передавали,
`signInWithPassword` умирал с заготовленной «Account has 2FA enabled.»
(node_modules/telegram/client/auth.js:332). С 2FA-аккаунтами QR-вход был
невозможен в принципе.

- [x] `utils/qr-auth.js`: `createQrPasswordGate()` — парковка авторизации на
      deferred-промисе, одноразовый сабмит, hint/error-акцессоры.
- [x] `generateQR`: коллбек `password` (парковка через гейт),
      PASSWORD_HASH_INVALID → ошибка на форме, authState `2fa_required`.
- [x] `routes/userbot.routes.js`: `/qr-status` отдаёт `2fa_required` +
      hint/error; новый `POST /qr-password` (404 без парковки, 409 повтор).
- [x] Фронт: форма облачного пароля под QR (UserbotOnboardingSection), ветка
      `2fa_required` в поллинге, `submitQrPassword` через панель в секцию.
- [x] Тесты гейта в `test-qr-auth.js`.

## Review (волна 2)

- `test:qr-auth` (гейт: парковка/сабмит/повтор после неверного пароля) —
  зелёный; `test:mcp` / `test:intake` / `test:sale-scan` — зелёные.
- `node --check` services/userbot.service.js, routes/userbot.routes.js,
  utils/qr-auth.js.
- `npm run build:userbot-v2` — зелёная.
- Ограничение: реальный вход с 2FA проверяется только на проде (нужен живой
  аккаунт с облачным паролем) — по документации Telegram auth-API
  SESSION_PASSWORD_NEEDED → GetPassword → CheckPassword ровно этот путь.

## Review (волна 1)

Сделано всё из списка изменений. Проверки:

- `npm run test:qr-auth` (новый скрипт) — зелёный: двойное истечение токена
  переживается, не-ротируемая ошибка падает сразу, лимит 60 уважается.
- `test:intake` / `test:mcp` / `test:sale-scan` — зелёные (service-файл тронут,
  регрессий нет).
- `node --check` — services/userbot.service.js, routes/userbot.routes.js,
  utils/qr-auth.js.
- `npm run build:userbot-v2` — сборка прошла.

Ограничение верификации: скан реального QR можно проверить только на проде
после деплоя (живая Telegram-авторизация). Поведение «AUTH_TOKEN_EXPIRED →
новый ExportLoginToken → свежий токен в qrCode-коллбек» следует документации
Telegram auth-API. Владельцу: после пуша повторить QR-вход — код на экране
теперь обновляется сам, ошибка не должна воспроизводиться даже при неспешном
скане.
