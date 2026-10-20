# 2026-10-20 — Фикс: /userbot «Выбранный юзербот не найден» после подключения новой сессии

## Симптом

Владелец подключил новую сессию на `/userbot/connect`. Аккаунт не появился в списке
на `/userbot`, вся страница центра показывала «Выбранный юзербот не найден», хотя
рабочие аккаунты были (`Erik`, `Courtney`, оба `online`).

## Корневая причина

- Новый аккаунт (`bookmarks_1968`, создан 2026-10-20 09:16) корректно встал в
  safe-mode: `runtime_status=pending_activation` (продуктовое правило).
- Список аккаунтов сортируется `created_at DESC` → по умолчанию выбирается новейший,
  т.е. свежий импорт; селектор и `?userbot_id=` передают его id в `ops-center`.
- `GET /api/userbot/ops-center` искал запрошенный id только среди operational
  (без fresh-импортов и shop-reserved) → 404 «Выбранный юзербот не найден».
- Фронт при `state.error` заменяет весь центр карточкой ошибки — включая селектор
  аккаунтов, баннер safe-mode и кнопку «Выполнить активацию». Первый аккаунт
  владельца ловил родственный кейс: 409 «нет ни одного активированного» вместо
  центра с кнопкой активации.

## Решение

- [x] `backend/utils/ops-center-selection.js` — чистый резолв выбора юзербота:
      `no_userbots → reserved → safe_mode → no_operational → ok/not_found`;
      туда же вынесены `FRESH_IMPORT_RUNTIME_STATUS` / `isFreshImportedUserbot`.
- [x] `ops-center` на запрошенный свежий импорт отвечает `200 safe_mode`
      (пустые `groups`/`conversations`, operational-соседи, без живого скана);
      удалена недостижимая ветка `isFreshImportedUserbot(preferredUserbot)`;
      контракт задокументирован в `backend/README.md`.
- [x] `userbot-v2` центр: эффект загрузки зависит от `runtime_status` выбранного
      аккаунта; после активации перезагружается живым сканом (кэш свежего аккаунта
      пуст); handoff-гвард хранит ключ `bot::status`.
- [x] `admin-v2` CampaignReplies: отправитель, ушедший в safe-mode между фильтром
      eligible и сканом, даёт явную строку ошибки вместо тихого нуля ответов.
- [x] Регресс-тест `backend/test/test-ops-center-selection.js` (19 проверок,
      таблица решений) — включён в `npm run test:autopost`.

## Review

- Ревью: code-reviewer сабагент, вердикт proceed. По находкам сделаны правки
  (CampaignReplies, скан после активации, README); консолидация дубля
  `isFreshImportedUserbot` в `sales-contour.service.js` и HTTP-тест роуты
  осознанно отложены (стиль репо — роуты без HTTP-тестов; дубль не мешает).
- Гейты: `test:autopost` OK, `build:userbot-v2` OK, `build:admin` OK,
  `check:design` PASS.
- Поведение изменено ровно в двух точках: запрошенный fresh id (404/409 → 200
  safe_mode) и перезагрузка центра при смене статуса. Не-fresh сценарии
  (reserved/no_operational/not_found/дефолт) эквивалентны старым — зафиксировано
  тестами.
- Follow-up (владелец, тот же день, f8bf14e): кнопка «Выполнить активацию»
  продублирована в сам баннер Safe Mode, бейдж «Safe mode» у селектора удалён.
  Проверено на проде в Chrome владельца (десктоп + 390px).
