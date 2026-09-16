# Контур: универсальная выдача максимальных прав (ensure-admin)

**Контекст.** Права в контуре выдавались только внутри join-all, одним промоутом без проверки, юзерботам — только can_invite_users (kick неплательщиков через юзербот был структурно сломан), состояние прав юзерботов нигде не персистилось, «админ назначен владельцем» выглядел как ошибка. Исследование и дизайн: см. финальный отчёт субагента в сессии 2026-09-16.

**Решение.** Ядро `backend/services/contour-admin-rights.service.js` (verify-first, классификация исходов, персист в `sales_contour_actor_rights`, миграция 20260916200000): роут `POST /api/official-bot/contours/ensure-admin` (синхронный), самовосстановление в 12ч мониторе прав (repair: промоут без авто-вступания), join-all выдаёт юзерботам максимальный набор (`can_invite_users` + `can_restrict_members`), foundation-матчер сужен до кодов 42P01/42703, кнопка «Выдать права» в контуре. Тесты: `backend/test/test-contour-admin-rights.js` (`npm run test:sales`).

## Ревью и фиксы (2026-09-16)
- Код-ревью поймало P0: самопроверка юзербота через GramJS была мёртвой (`getParticipant` нет в telegram@2.26.22; `InputUserSelf` не кастится в InputPeer) — тесты скрывали это моком с несуществующим методом. Переписано на рантайм-проверенный паттерн: `getInputEntity` → `channels.GetParticipant` + `InputPeerSelf` (канал/супергруппа) / `messages.GetFullChat` (базисная группа). Попутно починен тот же баг в `chat-admin-rights.service.js` (findPromoterUserbot).
- P1: owner_appointed теперь честно показывает нехватку флагов («выдай вручную»), а при достаточных правах — `ok`; P1: откатана регрессия `paid_chat.oppositeField` (внесена фронт-слайсом).
- P2: actor_username в ответе, flood-cooldown у официального бота, членство с ошибкой проверки больше не пишется как missing_membership, валидация bot_id в роуте.
- Итог: test:sales 59/59, test:autopost/test:mcp зелёные, build + check:design зелёные.

## Хвосты
- Живой прогон GetFullChat-ветки на базисной группе (все наши цели — супергруппы/каналы, ветка про запас).
- prod nginx proxy_read_timeout vs ~60s синхронного запроса — если кнопка начнёт обрывать, перевести роут на claim+poll по образцу join-all.
- Если понадобится «юзербот-промоутер» (выдача админок самим юзерботом) — флаг в CONTOUR_USERBOT_MAX_RIGHTS + путь из chat-admin-rights.service.js.
