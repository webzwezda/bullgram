# Чек-листы автопостера — цельный продукт

**Контекст.** ИИ-агент (Гермес/ZCode) ведёт списки дел пользователя и публикует их в группу Telegram через автопостер: «на завтра купить картошку и капусту». Домочадцы отмечают пункты прямо в сообщении. На следующий день агент читает состояние («картошка ✅ — Вася, капуста ⬜») и учитывает это в своей памяти/сводках. Обычный крон Hermes для этого не годится: у Bot API нет нативного чекбокс-UI, а сообщения крон-джобов содержат мусор (`job_id`, футеры), от которого не избавиться. Автопостер решает обе проблемы: агент сам формирует чистый текст через MCP, а интерактив дают inline-кнопки.

**Миграция:** `20260917150000` `autopost_checklists` (применяется через Supabase MCP; SQL-копия по конвенции — `backend/sql/autopost-checklists.sql`). В миграции, кроме таблиц: plpgsql-RPC атомарного тоггла, RLS-политики, добавление в realtime-publication, функция и триггеры `set_updated_at` (прописываем явно — копируемого образца в `backend/sql/` нет).

**Внешняя поверхность:** пять новых операций в общем реестре (`shared/operations.js`) → автоматически появляются в MCP (`tools/list`), во внешнем REST `/api/external/v1` и в доках `/api/external/v1/docs` (Scalar строит спеку из реестра per-request — ручная правка нужна только для `info.description` в `external/openapi.js`).

## Осознанные решения (фиксирую до имплементации)

1. **Свой рендер, не нативные чек-листы.** `sendChecklist` (Bot API 9.x) работает только в business-чатах — для групп/каналов пути нет. Рендерим сами: текст (заголовок + подсказка) + inline-кнопка на пункт с состоянием в тексте кнопки (паттерн tobedo: `⬜ Картошка` → `✅ Картошка — Вася`).
2. **Состояние — в БД, а не только в кнопках.** Кнопка — это view; истина — в таблицах. Тоггл идёт через БД с гонко-защитой, потом одна перерисовка клавиатуры.
3. **Очередь — через `autopost_items`.** Чек-лист не заводит собственный пайплайн: публикуется как `autopost_items` c `media_type='checklist'` и FK `checklist_id` — наследует планировщик, слоты, collapse, статусы, `scheduled_at` из MCP.
4. **Состояние общее на все цели fan-out.** Один чек-лист → N чатов → один и тот же `is_checked`; `chat_id` пишется в события. При тоггле перерисовываются клавиатуры **всех** опубликованных копий.
5. **В обсуждение (linked chat) чек-листы не форвардятся.** Копия в обсуждении дала бы вторую живую клавиатуру с чужим контекстом callback'ов. Осознанно выключено, конфиг на релиз не тянем.
6. **Seed-реакции на чек-листах не ставятся**, реакции от юзеров считаем (не мешают). В best-of чек-листы исключаются **жёстким фильтром по `media_type`**, а не «естественным» отсутствием реакций: случайная юзер-реакция накрутит `reaction_total` через GIN-lookup, и фильтр `reaction_total > 0` чек-лист пропустит.
7. **Тогглы доступны всем участникам чата** (семейный сценарий). Права «только админы» — не строим до спроса; атрибуция «кто отметил» пишется всегда.
8. **Канальные URL-кнопки в чек-лист не подмешиваем** — клавиатура чек-листа принадлежит его пунктам; `buttons_config` канала на чек-лист не влияет.
9. **Отмена списка живёт на чек-листе, а не на строках очереди**: новый статус `cancelled` для `autopost_items` не вводим (ломает фильтры scheduler/статистики/recovery — все ждут фиксированный набор статусов).
10. **Сосуществование с Hermes-ботом в одной группе** — пересечения нет по построению: Telegram доставляет `callback_query` тому боту, чья кнопка нажата, а автопостер реагирует только на свой префикс `cli:` и редактирует только свои сообщения. Hermes продолжает свои сводки как раньше; чек-лист-напоминания переезжают от крона Hermes к автопостеру (чистый текст + интерактив), чтобы одно дело не приходило дважды. Гермесу для чек-листов не нужен собственный бот в группе — он работает через MCP, а его собственный бот остаётся в чате просто как ещё один участник.
11. **Атрибуция с именами — только приватным чатам**: в группах отмеченный пункт показывает «✅ Картошка — Вася»; в публичных каналах (`visibility='public'`) имена из кнопок убираем (просто `✅ Картошка`) — кнопки публичного канала видны всему интернету через t.me/s/. Прогресс в тексте остаётся везде.

## Архитектура

### Данные (миграция `20260917150000` + SQL-копия)

- `autopost_checklists`: `id uuid pk`, `owner_id uuid not null`, `bot_id uuid not null → autopost_bots **on delete cascade**` (иначе существующий DELETE /bots/:botId падает с FK-violation — конвенция репо: family-checklist-bots.sql), `title text`, `created_by text` (`agent|admin|bot`), `expires_at timestamptz null`, `cancelled_at timestamptz null`, `dedup_key text null`, `created_at/updated_at`. Partial unique index `(bot_id, dedup_key) WHERE dedup_key IS NOT NULL` — защита от дублей при ретраях агента.
- `autopost_checklist_items`: `id uuid pk`, `checklist_id uuid not null → autopost_checklists (on delete cascade)`, `bot_id uuid not null` (денормализация — под RLS-политику и realtime-фильтр админки; проставляется из строки чек-листа в единой точке вставки, дрейф денормализации исключён), `text text not null`, `position int not null`, `is_checked bool default false`, `checked_by_tg_id bigint null`, `checked_by_name text null`, `checked_at timestamptz null`. Индекс `(checklist_id, position)`.
- `autopost_checklist_events`: `id bigserial pk`, `checklist_id uuid not null`, `item_id uuid null`, `action text not null` (`created|published|checked|unchecked|added|renamed|removed|reset|cancelled`), `actor_source text` (`telegram|agent|admin|bot`), `actor_tg_id bigint null`, `actor_name text null`, `chat_id bigint null`, `created_at`. Индекс `(checklist_id, created_at desc)`. Это лента памяти для агента: не только итог, но и история.
- `autopost_items`: `+ checklist_id uuid null references autopost_checklists on delete cascade`, индекс `checklist_id`; индекс `posted_message_ids` GIN уже есть. `caption` чек-лист-строки = заголовок чек-листа (иначе карточки в очереди и админской выгрузке пустые — addPostItem жёстко пишет `caption || ''`).
- **RPC `autopost_toggle_checklist_item(p_item_id uuid, p_actor_tg_id bigint, p_actor_name text, p_chat_id bigint)`** — plpgsql в той же миграции: `pg_advisory_xact_lock(hashtext('cli:' || checklist_id))`, инверсия `is_checked`, запись/снятие `checked_by_*`, вставка события, возврат свежих items. Хендлер зовёт одним `supabase.rpc()` — интерактивных транзакций из кода нет (supabase-js/PostgREST), прецеденты: `autopost_apply_reaction_delta`, advisory-лок внутри RPC — `project-treasury-withdrawal-rpc.sql:46`.
- **RLS**: enable на трёх новых таблицах + owner-политики `ALL`: `autopost_bots_owner`-паттерн (`owner_id = uid()`) для чек-листов, паттерн `autopost_items_owner` (`bot_id IN (SELECT id FROM autopost_bots WHERE owner_id = uid())`) для items (денормализованный `bot_id` позволяет скопировать дословно), для events — через чек-лист: `checklist_id IN (SELECT id FROM autopost_checklists WHERE owner_id = uid())` (у events нет ни owner_id, ни bot_id — дословно скопировать некуда). Админка и realtime ходят юзерским токеном — в проде RLS включён именно на `autopost_bots`/`autopost_items`/`channels`, без политик realtime-подписки данных не увидят.
- Новые таблицы добавить в publication `supabase_realtime` (проверено: `autopost_items`/`autopost_bots`/`channels` там есть, новых нет).
- Номер версии уточнить по факту: взять следующий свободный слот после `20260917120000`.

### Публикация

- `autopost.service.js addPostItem`: расширить — `media_type='checklist'` + `checklist_id` (резать неявный fallback `mediaType || 'text'`, service.js:187 — чек-лист всегда передаётся явно).
- `services/autopost/sender.js sendItemToChannel`: **ранний выход** `if (item.media_type === 'checklist') { …render…; return [messageId]; }` сразу после альбом-ветки и **до** `if (!fileId)` — иначе строка ушла бы в текстовую ветку и опубликовалась бы как «заголовок + канальные URL-кнопки» (caption = заголовок — непустой), нарушив решение 8. Данные в sender не грузятся: у `sendItemToChannel` нет доступа к supabase — `publishItem` (там есть `this.supabase`) загружает checklist+items и прокидывает их через `options`. Возврат message_ids — как у текста.
- `pin`: `checklist_create` c `pin: true` после успешной публикации первого таргета делает `pinChatMessage` — ошибка non-fatal (без прав бота на закрепление список просто не закрепится, но будет жить).
- `publishItem` (service.js:322): для `checklist` пропустить seed-реакцию и discussion-forward (один if); UPDATE в `posted` и запись события `published` — без изменений пайплайна.
- Рендер: `buildChecklistMessage(checklist, items)` в новом `services/autopost/checklist.js` — чистая функция (текст: заголовок + **живая строка прогресса** «Выполнено 2 из 3» + подсказка «Отмечайте выполненное — я запомню кто и когда»; кнопки: по одной на пункт, текст `⬜ <текст>` / `✅ <текст> — <имя отметившего>`, truncate 48 символов). `callback_data = cli:<item_uuid>` (40 байт, в лимит 64 укладывается).
- Капы (валидация **в хендлерах** — dispatch args по inputSchema не валидирует, operation-routes только коерчит типы; прецедент create-post.js:47-61): пунктов 1–25, текст пункта 1–100, заголовок 0–200, `dedup_key` ≤128; `actor_name` усекается в RPC (`left(..., 100)`). Лейбл кнопки целиком ≤64 символов — лимит `InlineKeyboardButton.text`: текст пункта ≤48, имя ≤24, при переполнении режем имя первой (иначе честное длинное имя валит публикацию в 400).

### Интерактив (тогглы)

- Новый `services/autopost/handlers/checklist-callbacks.js`, регистрация в `handlers/index.js` после queue-callbacks. `bot.action(/cli:(.+)/)`:
  1. Загрузить item → checklist. Не найдено (удалён, каскад) → `answerCbQuery('Список больше не доступен')` и выход. Далее проверить `bot_id === botId`, статус `posted`, `cancelled_at IS NULL` (иначе `answerCbQuery('Список ещё не опубликован'/'Список закрыт')`).
  2. Один вызов RPC `autopost_toggle_checklist_item(...)` — атомарный тоггл внутри plpgsql: advisory-лок по чек-листу закрывает lost-update при параллельных кликах (уроки checkbot). Хендлер транзакцию не держит — supabase-js интерактивных транзакций не умеет; RPC возвращает свежие items. Серверные проверки отмены/истечения (`cancelled_at`, `expires_at < now()`) живут **внутри RPC** — хендлер-проверки выше нужны только для человекочитаемых тостов; в миграции — `REVOKE EXECUTE ON FUNCTION ... FROM anon, authenticated` (бэкенд зовёт сервисным ключом; иначе прямой вызов под любым JWT обходит хендлер и подделывает атрибуцию).
  3. По свежим items — `editMessageText` **вместе с** новой клавиатурой (один вызов обновляет и текст с прогрессом «Выполнено N из M», и кнопки) для **всех** строк `autopost_items` этого checklist в статусе `posted` (по `posted_message_ids`), ошибки per-chat non-fatal; `answerCbQuery('✅ Отмечено — Вася' / '↩️ Вернул в список')`.
- Flood-защита перерисовки: N одновременных тогглов = N edits в чат подряд → при `FLOOD_WAIT` один ретрай по `retry_after` (паттерн `getFloodWaitSeconds`), дальше `log.warn` и выход — истина в БД, клавиатура догонит следующим тогглом.
- Дебаунс: тот же (user, item) чаще раза в 1–2с — тихий `answerCbQuery` без записи в БД, до RPC (спам-кнопка в публичном канале не должна штамповать events).
- Деградации, которые ничего не роняют: пункт/чек-лист удалён между тапами — RPC-UPDATE вернёт 0 строк, вернётся просто свежее состояние (без события); сообщение удалено из чата админом группы — тоггл уже записан в БД, перерисовка падает non-fatal в `log.warn`.
- `update`/`cancel` сериализуются с тогглами тем же advisory-локом — агент может править список, пока семья тапает: худший исход гонки — «последняя перерисовка выигрывает», БД остаётся консистентной.
- Хендлер stateless — всё нужное несёт callback_data (урок tobedo: admin_states в памяти — антипаттерн для интерактива). Логи тогглов/отмен/ошибок перерисовки — через `services/autopost/logger.js` (как в reactions.js).

### Управление списком после публикации

- `updateChecklist`: add/rename/remove пунктов + `reset` (массовое снятие отметок — для циклических списков). Payload: `add[]`, `rename[{item_id, text}]`, `remove[item_id]`, `reset: true`. Сохранение отметок: `rename` несёт `item_id` и переносит флаг **по id** (текст — плохой ключ для переименования, дубликаты текста делают match неоднозначным); text-match — только при remove/add (урок tobedo). После изменения — перерисовка всех posted-клавиатур; события `added/renamed/removed/reset`.
- `cancelChecklist`: `cancelled_at` на чек-листе; queued/scheduled-строки `autopost_items` — **удалить** (семантика `del_post`, queue-callbacks.js:221-225); posted остаются `posted` со снятой клавиатурой (`editMessageReplyMarkup` без клавиатуры); событие `cancelled`.
- Queue-UI guard'ы — в Фазе 1, не «потом»: `showQueueForChannel` рендерит чек-лист карточкой «☑️ <заголовок> · N пунктов» и прячет для чек-листов «📝 Изменить текст» (caption-edit рассинхронил бы items), «⚡️ Опубликовать» (post_now одной строки при fan-out опубликовал бы один канал из N) и «Перенести» (move_post молча увёл бы строку в чужой канал списка); `del_post` на чек-лист-строке = отмена списка (иначе чек-лист останется «активным», но непубликуемым).
- Словарь статусов чек-листа — вычисляемый, без новых статусов у items: `active` (по умолчанию) / `expired` (`expires_at < now()`) / `cancelled` (`cancelled_at IS NOT NULL`). Его отдают `list` и `state`, по нему фильтрует `list`.

### Жизненные циклы: один механизм, разные режимы (из кейсов пользователей @chchecker_bot, Pikabu)

Новых сущностей не нужно — режим задаётся тем, **как агент ведёт список**:
- **Разовый** (базовый, сценарий Гермеса): опубликовали → отметили → агент забрал итог через `checklist_state` → закрытие/TTL.
- **Циклический** (покупки): после цикла — `reset` (массовый uncheck), список живёт дальше; не надо пересоздавать.
- **Долгоживущий** («фильмы», «книги», «цели на год», GTD-«Когда-нибудь»): `expires_at` не ставится; пункты добавляются/удаляются через `checklist_update`; агент следит за новыми отметками по events-ленте.
- **Ситуационный шаблон** (вещи в спортзал/командировку, аптечка): шаблон хранит агент в своей вики, по триггеру создаёт разовый экземпляр.
- **Регулярный** (повторы + перенос невыполненных): самый востребованный режим, которого нет у @chchecker_bot, потому что у бота нет «мозга». У нас мозг есть — агент: по крону читает `checklist_state`, создаёт новый список из невыполненных пунктов, публикует на `scheduled_at`. Отдельная кодовая фича не нужна.
- `renderChecklistSummary(checklist, items, events?)`: «Итог: 2 из 3 — картошка ✅ (Вася, 10:12), капуста ⬜» — используется state-инструментом, админкой и бот-меню.
- TTL: `expires_at` — при чтении state просроченный список помечается `expired` и клавиатуры снимаются лениво (без нового джоба).

## Поверхности

### MCP + внешний REST (5 операций; файлы в `mcp/tools/autopost/`, импорт в `mcp/tools/index.js`)

| Операция | Скоупы / класс | REST |
|---|---|---|
| `bullgram_autopost_checklist_create` | write | `POST /autopost/bots/{bot_id}/checklists` — `target_channel_ids[]` (валидация как create-post.js:86-103 — только каналы этого бота), `title`, `items[]`, `publish_now`/`scheduled_at`, `expires_at?` (TTL разового режима), `dedup_key?` (повторный вызов → существующий список + `already_exists: true`, дубль в чат не улетает; unique-violation-гонка → тоже вернуть существующий), `pin?` (закрепить опубликованное сообщение — для долгоживущих списков в группе) |
| `bullgram_autopost_checklist_state` | read | `GET /autopost/bots/{bot_id}/checklists/{checklist_id}` — пункты+атрибуция+прогресс, `include_events` (≤100, дефолт 20 — лента без лимита раздувает ответ) |
| `bullgram_autopost_checklist_list` | read | `GET /autopost/bots/{bot_id}/checklists` — фильтр `status` (`active|expired|cancelled` — вычисляемый), `created_after`, `limit` + курсор `created_at`+`id` (ежедневные списки агента быстро растут) |
| `bullgram_autopost_checklist_update` | write | `PATCH /autopost/bots/{bot_id}/checklists/{checklist_id}` — add/rename/remove/`reset` |
| `bullgram_autopost_checklist_cancel` | write | `POST /autopost/bots/{bot_id}/checklists/{checklist_id}/cancel` |

- Skeleton каждой операции — по `create-post.js:260-308`: `inputSchema` c `additionalProperties:false`, `requiresIntegrationToken:true`, owner-check одним каноническим паттерном (probe бота + `owner_id !== req.user.id → NOT_FOUND`) — новые ручки не размазывают owner-проверку по трём стилям (это зафиксированный риск старых маршрутов). Owner-check бота необходим, но не достаточен: **каждая загрузка чек-листа во всех пяти операциях — строго `.eq('id', checklist_id).eq('bot_id', bot_id)`** после probe бота, мимо → `NOT_FOUND` «список удалён или не существует» (иначе IDOR: чужой `checklist_id` под своим `bot_id` читает и правит чужой список).
- Описания пяти инструментов — мини-инструкции для агента: какой когда звать (`create` вечером с `scheduled_at` → утром `state`; `reset` для циклических списков; `dedup_key` во всех крон-путях; `update` для правок с сохранением отметок). Копия — для обычных админов и агентов, не для инженеров: агент должен уметь пользоваться без чтения исходников.
- Ошибки — структурные и по-человечески: `NOT_FOUND` с текстом «список удалён или не существует» на state/update/cancel мимо исчезнувшего id; статус `cancelled`/`expired` — поле в ответе `state`, а не ошибка. Гермес кэширует `checklist_id` в своей памяти и должен спокойно переживать исчезнувший список — это штатный путь, а не исключение. Уникальную гонку dedup (два одновременных create с одним ключом) ловим: unique violation → вернуть существующий список.
- Сценарий агента замыкается: `checklist_create` (вечером, `scheduled_at` на утро) → люди тыкают → утром `checklist_state` (+`include_events` для памяти) → следующая сводка учитывает реальность.
- Доки: `external/openapi.js` — дополнить `info.description` (перечислить чек-листы); тег `autopost` уже есть. `test-external-rest.js` — актуализировать баздайн `paths.length` и добавить smoke по новой ручке.

### Бот-меню (Telegram)

- `keyboard.js getAdminKeyboard`: «☑️ Чек-листы» — третьей кнопкой в последний ряд (сетка 4 ряда, без роста); `bot.hears('☑️ Чек-листы', …)` в `admin-commands.js` с обязательным `getBotAdminContext` guard: список активных чек-листов с прогрессом (renderChecklistSummary) + инлайн-кнопки «Закрыть список».
- Создание из чата: диалог «заголовок → пункты (по одному в строке) → канал(ы)» — паттерн await-веток `queue-callbacks.js` (bot.on('text')) + свой минимальный пикер `clch:` (общий `channel-select.js` жёстко шьёт текстовые посты без checklist_id — задокументировано в ревью). `created_by='admin'`, событие с `actor_source='admin'`.

### Админка (admin-v2)

- `pages/autopost/api.js`: `fetchChecklists/createChecklist/patchChecklist/cancelChecklist` → новые ручки `/api/autopost/bots/:botId/checklists*` (thin routes в `autopost.routes.js`, тот же owner-паттерн).
- `QuickStartPage.jsx`: секция «Чек-листы» (после карточек каналов, до «Администраторов»): форма создания (заголовок, пункты построчно, мультипикер каналов, сейчас/время), список активных с прогресс-барами и «кто отметил» (renderChecklistSummary c бэка), кнопка «Закрыть». Realtime — в уже существующий `supabase.channel('autopost-bot-${botId}')` добавить подписку на `autopost_checklist_items` с фильтром `bot_id=eq.${botId}` — денормализованный `bot_id` в items добавлен именно под это; пустая заготовка подписки уже стоит (QuickStartPage.jsx:250-254).
- Command center/orders/access/broadcast/shop не трогаем: чек-лист — контент автопостера, не операционное состояние (осознанно).

## Тесты (`test:autopost`, офлайн-детерминированные)

Новый `backend/test/test-autopost-checklists.js`, включить в цепочку `package.json`:
- рендер: текст+клавиатура, state-эмодзи, атрибуция в кнопке, лейбл ≤64 (текст ≤48 + имя ≤24), callback_data упаковка/парсинг;
- капы-валидация (1–25 пунктов, длины, `dedup_key` ≤128);
- update-семантика: отметки переживают rename по `item_id`; text-match — только для add/remove;
- summary-композер («2 из 3», с именами и временем);
- маска событий (checked/unchecked/added/renamed/removed/reset/cancelled, actor_source);
- cancel-флоу: снятие клавиатур, удаление queued-строк, `del_post` на чек-листе = отмена, скрытые действия очереди;
- SQL-смоук RPC: применение миграции и вызов `autopost_toggle_checklist_item` (plpgsql офлайн-тестом не покрывается) — **выполнен оркестратором на проде 2026-09-17**: вызов с фейковым uuid вернул `{ok:false, reason:'not_found'}`, `proacl` после REVOKE = только `supabase_admin/postgres/service_role`.

## Порядок работ (фазы; каждая деплоибельна отдельно)

### Фаза 1 — ядро (данные + публикация + тогглы)
- [x] Миграция `20260917150000` через Supabase MCP + SQL-копия `backend/sql/autopost-checklists.sql` (шапка по образцу autopost-discussion.sql): таблицы с FK `on delete cascade`, partial unique `(bot_id, dedup_key)`, RPC `autopost_toggle_checklist_item` (advisory-лок внутри, серверные проверки отмены/истечения, `REVOKE EXECUTE` от `anon`/`authenticated`), RLS + owner-политики (events — через `checklist_id → checklists`), realtime publication, `set_updated_at` прописан явно
- [x] `services/autopost/checklist.js`: render/build/validate/summary (чистые функции)
- [x] `addPostItem` + `sendItemToChannel` ветка `checklist`; `publishItem` пропуск реакций/обсуждения
- [x] `handlers/checklist-callbacks.js` + регистрация; advisory-lock тоггл; перерисовка всех копий
- [x] `updateChecklist`/`cancelChecklist`/`expireChecklist` в сервисе
- [x] `test-autopost-checklists.js` + цепочка `test:autopost`
- [x] Queue-UI guard'ы: карточка чек-листа с заголовком; скрыты «📝 Изменить текст», «⚡️ Опубликовать», «Перенести»; `del_post` на чек-листе = отмена
- [x] Жёсткий фильтр чек-листов в `composeBestOfMonth` + тест в test-autopost-bestof
- [x] Логирование тогглов/отмен/ошибок перерисовки через `services/autopost/logger.js`

### Фаза 2 — агентская поверхность (MCP + внешний REST + доки)
- [x] 5 операций в `mcp/tools/autopost/checklist-*.js` + импорт бареля
- [x] Валидации и idempotency create: `target_channel_ids` как create-post.js:86-103, `collapseQueue` для queued-пути (create-post.js:222-227), `expires_at`, `.eq('bot_id')` на каждой загрузке чек-листа
- [x] `checklist_create` с `publish_now` повторяет жизненный цикл create-post.js:109-131 (проверка is_active, startBot если не запущен, retryable-ошибка при медленном старте)
- [x] Тесты операций: чужой `tg_chat_id` → `INVALID_PARAMS`; чужой `checklist_id` под своим ботом → `NOT_FOUND`; dedup (повтор + unique-violation-гонка); branch-покрытие create (channel_ids, publish_now vs scheduled_at vs expires_at); non-fatal `pin`
- [x] `openapi.js`: `info.description`; smoke в `test-external-rest.js` (paths-базлайн)
- [x] REST-ручки `/api/autopost/*` для админки (единый owner-паттерн)
- [x] Обновить `backend/README.md` — секция автопостера с чек-листами (заодно поправить «node-cron» → setInterval)

### Фаза 3 — поверхности людей
- [x] Секция «Чек-листы» в QuickStartPage + api.js + realtime-подписка
- [x] Бот-меню «☑️ Чек-листы»: список/закрытие + диалог создания (пикер каналов)

### Фаза 4 — цельность и хвосты
- [x] getStats: убедиться, что чек-лист-строки в общих счётчиках очереди выглядят осмысленно (решение: считаем вместе — чек-листы честно занимают слоты)
- [x] Lazy-expiry по `expires_at` (при state-чтении и при тоггле)
- [x] Ретеншен `autopost_checklist_events` (крон по образцу audit-cleanup) — лента без TTL растёт бесконечно
- [x] `BACKLOG.md` §15: операционка после релиза (e2e в реальной группе, критика админ-секции, unlink канала с живыми чек-листами — жизненный путь отвязанных списков)
- [ ] Верификация и ревью (ниже)

## Верификация (после деплоя, на проде)

- [ ] e2e агентом: `checklist_create` (2 пункта, тестовая группа) → тогглы юзером в Telegram → `checklist_state` показывает отметку с именем/временем → `checklist_update` (переименовать пункт — отметка сохранилась) → `cancel` снял клавиатуры
- [ ] Гонка: два быстрых клика по разным пунктам — оба засчитаны, клавиатура консистентна (RPC-лок)
- [ ] Удаление бота с существующими чек-листами (posted и queued) — строки каскадно удалены, FK-violation нет; живой инстанс отвечает «Список больше не доступен» (удалённый бот остановлен — polling снят, его кнопки молчат)
- [ ] Прямой вызов `autopost_toggle_checklist_item` под anon/authenticated — отказ (REVOKE), подделка атрибуции невозможна
- [ ] Публичный канал: в кнопках нет имён, прогресс в тексте на месте
- [ ] publish_now при незапущенном боте — бот поднимается, чек-лист публикуется
- [ ] Очередь: карточка чек-листа рендерится с заголовком; «Изменить текст» недоступна; `del_post` отменяет список
- [ ] Повторный `checklist_create` с тем же `dedup_key` — возвращает существующий список с `already_exists: true`, дубль в группу не улетает
- [ ] `pin: true` закрепляет сообщение; без прав на закрепление — non-fatal, список живёт
- [ ] Тап по кнопкам удалённого/закрытого списка — тихий `answerCbQuery`, никаких unhandled-ошибок; правка списка агентом при живых тапах — отметки на месте
- [ ] Fan-out на 2 канала: тоггл в одном — клавиатура обновилась в обоих
- [ ] Скидка в обсуждение отсутствует; в best-of чек-лист не попадает
- [ ] Внешний REST `brapi_`-токеном: create/state/cancel + доки-страница показывает 5 новых ручек
- [ ] После pm2 reload: scheduled-чеклист публикуется, stuck-recovery не зацикливает
- [x] Код-ревью (`code-reviewer`) + `security-auditor` на owner-изоляцию новых ручек до пуша — пройдены 2026-09-17, все находки закрыты (см. «Ревью»); design-critic по админ-секции — после деплоя на прод-скриншотах (standing rule)

## Правила

- Ничего не хранить в памяти процесса для интерактива: callback_data несёт id, истина в БД.
- Один тоггл = один RPC в БД; перерисовки сообщений (`editMessageText` вместе с клавиатурой) best-effort с ретраем по `retry_after` — истина всегда в БД, не в кнопках.
- Отметки переживают правку списка: `rename` переносит флаг по `item_id`, text-match — только для remove/add.
- SQL-схема не живёт только в проде: копия миграции в `backend/sql/` обязательна в том же коммите — вместе с RPC, RLS и realtime-publication.
- Каждая загрузка чек-листа — строго по паре `(id, bot_id)`; чужой `checklist_id` под своим ботом — штатный `NOT_FOUND`.
- Отмена/истечение проверяются на сервере (RPC); хендлер-проверки — только для человекочитаемых ответов.
- Новый код не добавляет второй/третий паттерн owner-проверки — один канонический.

## Ревью (клоуз-ап 2026-09-17)

**Код-ревью: REQUEST-CHANGES → все находки закрыты.** P1: best-of `.ne('media_type', …)` молча терял бы строки с NULL `media_type` (в проде их 0 — проверено запросом через Supabase MCP; заменено на `.or('media_type.neq.checklist,media_type.is.null')` + тест на NULL-случай). P2: REST PATCH валидировал rename/remove слабее MCP (добавлены uuid/длина → 422); FLOOD_WAIT-sleep без потолка замораживал бы обработку апдейтов бота-инстанса (cap 10с — истина в БД, клавиатура догонит); smoke 5 REST-путей в `test-external-rest.js` добавлен. P3: cancel-идемпотентность, fail-closed `resolveChecklistShowNames`, курсор без мёртвого id-хвоста, каноничный `actor_source:'admin'` для меню, человеческий тост post_now, обработка `.error` у postedRows, `CHECKLIST_EVENTS_RETENTION_DAYS` в README.

**Security: SAFE-WITH-FIXES → закрыто.** Item-count оракул: `checklist_update` прегружал items чужого списка до scoped NOT_FOUND — кап «≤25 суммарно» перенесён в `service.updateChecklist` сразу после (id, bot_id)-гейта, прегрузка из хендлера удалена (тест: 0 вызовов на чужом id). Rate limit распространён на PATCH/cancel; `clch:go` фильтрует выбранные каналы по state. Подтверждено ревью: owner-паттерн един во всех 10 ручках, REVOKE/RLS в проде соответствуют плану, чек-листы рендерятся plain text без parse_mode (инъекция невозможна), dedup скоупится по боту, callback_data подделать нельзя.

**Компромиссы (осознанные):** `update`/`cancel` не RPC-сериализуются с тогглами — гонка даёт «последняя перерисовка выигрывает», БД консистентна; SQL-смоук RPC выполнен на проде (офлайн plpgsql не тестируется); RLS-политики без явного `with check` (USING покрывает INSERT — как у существующих таблиц автопостера); курсор listChecklists только по `created_at` (ties пропадают — масштаб мелкий); ретеншен events тикает раз в 6ч, дефолт 90 дней.

**Гейты на момент клоуз-апа:** `test:autopost` — 10 файлов зелёные; `test:mcp` — 56/56 (включая smoke 5 путей); `admin-v2 build` — OK; `check:design` — PASS. Прод-верификация (раздел выше) — после деплоя, по BACKLOG §15.
