# Приёмка tdata-пачек: конвертация Telegram Desktop → сессия внутри intake

Дата: 2026-11-15. Статус: в работе.

## Контекст

На столе владельца появилась папка tdata (Telegram Desktop-сессия: `key_datas`,
`D877F783D5D3EF8Cs`, `D877F783D5D3EF8C/maps`). Текущая приёмка пачек
(`POST /api/userbot/intake/batch`) требует на пачку пару `.session` + `.json`
и явно отвергает голый tdata («Файлы tdata не удалось привязать ни к одной
пачке»). Задача: научить приёмник принимать папки/зипы tdata целиком и самому
конвертировать их в рабочую сессию — без внешних конвертеров.

## Формат tdata (расшифрован, сверено с реальным файлом)

Эталон — opentele (`thedemons/opentele`, порт tdesktop), телеметрия совпала
байт в байт с папкой владельца:

- **TDF-контейнер** (`ReadFile`): `"TDF$"` (4Б) + версия u32 LE (= 3004000,
  версия приложения) + payload + md5-трейлер 16Б (md5 от payload+size+ver+magic).
  Payload — QDataStream **big-endian**: серии `[u32 len][bytes]` (QByteArray).
- **`key_datas`** (TDF): соль 32Б → wrappedLocalKey (EncryptedDescriptor,
  ключ = passcodeKey) → accountsInfo (шифр localKey): count i32 + индексы +
  active index.
  - `createLocalKey(salt, passcode)`: `p = sha512(salt‖passcode‖salt)`;
    PBKDF2-HMAC-SHA512(p, salt, 1 итерация если passcode пуст, иначе 100000,
    256Б).
- **`D877F783D5D3EF8Cs`** (TDF, mtp-авторизация; `...s`-суффикс — это
  ToFilePart(dataNameKey("datas")), легаси-вариант `key_data` в подпапке):
  EncryptedDescriptor под localKey → blockId 0x4B (75, MtpAuthorization) →
  QByteArray → userId i32, mainDcId i32, (wide-ids: u64 userId + i32 dc),
  count i32, ключи `[{dcId i32, authKey 256Б}]`, второй список (toDestroy).
  Рабочий ключ = тот, у которого dcId == mainDcId.
- **EncryptedDescriptor / DecryptLocal**: blob = [16Б msgKey][IGE-шифртекст
  (кратно 16)]; KDF — классический старый MTProto на SHA1
  (`prepareAES_oldmtp`, x=0): aesKey 32Б / aesIV 32Б из sha1(key[x..],
  msgKey); AES-256-IGE (реализация уже в `teleproto/crypto/IGE.js` —
  экспортируемый класс `IGE`); проверка `sha1(decrypted)[:16] == msgKey`;
  расшифрованное = [dataLen u32 **LE**][данные][паддинг], dataLen > fullLen-16.
- **IPv6-политика** (docs/dev/proxies.md, грабли 5-6, 10): адрес внутри строки
  сессии не критичен — коннект через managed-слот форсит
  `setDC(dc, TELEGRAM_DC_IPV6[dc], 80)` (`_forceManagedIpv6Dc`). Внутренняя
  строка сессии пакуем как у существующих импортов (IPv4), покупной `.session`
  тоже IPv4:443 (работает где угодно).

## Решения владельца / делегированные

- Fingerprint: дефолтный профиль платформы (`bullgram_android_a52`, api_id 4)
  с явным источником `fingerprint_source: 'tdata_import'` — осознанный выбор,
  не молчаливый дефолт (философия validatePack). Владелец: «найди лучшее
  решение, которое впишется».
- Покупатель обязан получать рабочие файлы: в restore source кладём
  синтезированный настоящий Telethon-совместимый sqlite `.session`
  (dc + IPv4:443 + auth key) + оригинальный `tdata.zip` — доставка магазина
  (`buildShopFileArchive`) отдаёт их без правок.
- Мультиаккаунтный tdata (несколько ключей): reject с понятным сообщением
  («раздай каждому аккаунту свою папку»). Владелец: «прими лучшее решение».
- Локальный passcode: пробуем пустой, затем пароль из `.txt`-заметки пачки
  (механизм заметок уже есть); Argon2/scrypt-wrap (новые пины 7.3+) — честный
  reject в v1.

## План

1. `backend/services/userbot/constants.js`: `TELEGRAM_DC_IPV4` (замороженная
   карта 1-5: 149.154.175.50 / 149.154.167.51 / 149.154.175.100 /
   149.154.167.91 / 91.108.56.130 — уже есть в ALLOWED_DC_IPS
   mtproto-bridge.service.js) рядом с `TELEGRAM_DC_IPV6`.
2. `backend/services/tdata.service.js` (новый, офлайн, чистые функции):
   - TDF-чтение, createLocalKey, decryptLocal (teleproto `IGE` +
     prepareAES_oldmtp на SHA1), парсинг key_datas и mtp-авторизации;
   - `extractTdataAccount(files, passcodes)` → `{ userId, dcId, authKey,
     sessionString, sessionSqliteBuffer }`;_sessionString — та же упаковка
     263Б `dc|IPv4|port|authKey` → `'1'+base64`, что в
     `session-parse.mixin.js:274-281` (не трогаем замороженный миксин,
     дублируем 10 строк с комментарием-ссылкой);
   - `buildSessionSqlite(dcId, addr, port, authKey)` — Telethon-DDL,
     пакет `sqlite3` уже в зависимостях;
   - санити-гейты на непроверяемые данные (размеры, blockId, ключей ≤100,
     authKey ровно 256Б), ключи в логи не пишем (docs/dev/logging.md).
3. `backend/services/account-pack.service.js`: группировка принимает
   tdata-only пачки — tdata привязан по dirName/scope, а `.session`/`.json`
  нет → `pack.tdataOnly = true`; ключ/лейбл = имя папки (не digits-only
   нормализация). Остальные правила без изменений.
4. `backend/services/account-intake.service.js`: для `tdataOnly` —
   `extractTdataAccount(passcodes: ['', note])` → fingerprint из дефолтного
   профиля с source `'tdata_import'` → обычный путь: `tg_accounts`
   (auth_source `'tdata_import'`, safe-mode `pending_activation`),
   `saveRecoverySource` (session_blob = синтезированный sqlite, tdata_blob =
   зип оригинала, 2FA из заметки, source_type оставляем `'session_bundle'`).
   Попутно фикс реальной баги: затенённый `insertedAccountId` (строка ~156)
   мёртвит rollback аккаунта в generic-catch.
5. UI `userbot-v2/src/pages/bots/BatchIntakeSection.jsx`: копия — «папка tdata
   без .session/.json тоже принимается, конвертируем сами».
6. Тесты `backend/test/account-intake/`: `tdata-fixture.js` (шифрующая сторона:
   собираем key_datas/mtp-файл сами — roundtrip с парсером), сценарии
   parse-roundtrip / passcode / multikey-reject / group-tdata-only /
   process-intake-tdata; проводка в `account-intake.test.js`. Все офлайн.
7. `backend/README.md`: абзац про приёмку tdata-пачек.

## Верификация

- `cd backend && npm run test:intake` — все сценарии зелёные.
- Сухой парз реальной папки `~/Desktop/tdata` однострочником (read-only,
  **без коннекта к Telegram с локальной машины** — не светим домашний IP):
  показать userId/dcId/ключ извлечён.
- `npm run ci` гейты → push (деплой через Actions) → приёмка реального
  `account-1-tdata.zip` через `/userbot` в Chrome владельца → Supabase MCP:
  `tg_accounts` (safe-mode) + `userbot_restore_sources` (оба блоба) →
  отлёжка/resting-джоба подхватит (интервал 12ч, статус увидим в гигиене).

## Review

**2026-11-15, реализовано.** Файлы: `tdata-format.js` (байты/крипто) +
`tdata.service.js` (конвертация/сборка), разрезка осознанная — оба под
лимитом pre-commit. Попутно: фикс затенённого `insertedAccountId` в
`account-intake.service.js` (catch-откат аккаунта был мёртвым кодом).

Верификация:
- Сьют `npm run test:intake` зелёный: раундтрип фикстуры → парсер →
  синтезированный sqlite → прод-читатель `extractSessionFromSqliteBuffer`
  возвращает ту же строку сессии; пин из заметки; мультиаккаунт-reject'ы;
  группировка tdata-only (включая мультипачечный zip с basename-заметкой);
  полный `processIntakeBatch` на tdata-пачке (safe-mode, `tdata_import`,
  оба блоба, освобождение прокси при отказе).
- **Реальная папка с рабочего стола** (`~/Desktop/tdata`, боевые байты
  Telegram Desktop): userId 9 283 810 131, DC 1, auth key извлечён,
  sessionString 353 символа (валидный IPv4 fast-path), sqlite 28 КБ.
  Полный путь на реальном `account-1-tdata.zip`: unpack → group →
  validateTdataPack.ok=true, fingerprint `bullgram_android_a52/tdata_import`.
  Коннект к Telegram с локальной машины не выполнялся (не светим домашний IP).
- `npm run ci` — все 8 гейтов.

Ревью (code-reviewer + security-auditor, оба «proceed»), применено в коммите:
- роль-чек перенесён ПЕРЕД multer в `/intake/batch` (до-диффовый P1:
  любой JWT мог писать 400×30 МБ в tmpdir до 403);
- PBKDF2 → async (threadpool, ~76мс × N пачек больше не стопят event loop);
- temp-файл сессии: `mkdtemp` 0700 + безусловная уборка в finally (auth key
  не остаётся в /tmp при падении INSERT);
- zip-бюджет проверяется ДО `getData()` (одна запись не аллоцирует
  гигабайт мимо лимита);
- два `key_datas` — отдельное сообщение; заметки tdata-only получили
  basename-фолбэк.

Отложено: `docs/plans/BACKLOG.md` §34 — волна миграции console.* (596→606
прилетела из чужих коммитов, базлайн поднят осознанно); вызов приватного
`_normalizeFingerprint` из intake-сервиса (тест-стаб это зеркалит) — при
следующей разрезке userbot-миксинов вынести публичный акцессор.

**Прод-приёмка 2026-11-15 (деплой 207e29d):** реальный `account-1-tdata.zip`
загружен через прод (`POST /api/userbot/intake/batch` из сессии владельца) —
`success, total=1, rejected=[]`, батч `ff4f5796…` → `completed 1/0`, аккаунт
`8024e504-99a1-4573-9471-060d3654d130`. Supabase: `custom_label
'account-1-tdata'`, safe-mode `pending_activation`, прокси «intake #1»
привязан и is_working, restore source со всеми тремя блобами
(session/json/tdata), `intake_batch_id` проставлен, fingerprint
`tdata_import`/`bullgram_android_a52`. Отлёжка/resting-джоба подхватит
аккаунт по расписанию; безопасные локальные копии сессии (Desktop-папка,
зипы, /tmp-скрипты) вычищены, кроме оригиналов на рабочем столе владельца.
