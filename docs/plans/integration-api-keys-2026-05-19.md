# План: единые интеграции и API-ключи

Дата: 2026-05-19  
Статус: реализовано и задеплоено, нужна продуктовая проверка владельцем  
Цель: собрать MCP, P2P/SMS Forward кассу и будущие n8n/API сценарии в один понятный контур `Интеграции / API-ключи`, где пользователь может выпускать, видеть, копировать, перевыпускать и отзывать ключи.

## Решения пользователя

- Ключи должны быть удобными: пользователь может вернуться на страницу, увидеть ключ и скопировать его.
- Для MVP не делаем режим `показать только один раз`.
- Для MVP не требуем повторный вход, 2FA или отдельное подтверждение для просмотра ключа.
- Ключи нельзя хранить plain text: нужен `token_hash` для проверки и `token_encrypted` для повторного показа в UI.
- У ключей должны быть `scopes`, чтобы MCP, касса и будущий n8n не получали лишние права.

## Текущий контекст

Сейчас есть два независимых token-контура:

1. MCP:
   - UI: `/app/claw`;
   - backend: `backend/routes/agent-mcp.routes.js`;
   - auth helper: `backend/utils/agent-mcp-auth.js`;
   - таблица: `agent_mcp_tokens`;
   - хранит `token_hash`, `token_prefix`, но не хранит полный токен для повторного показа.

2. P2P/SMS Forward касса:
   - UI: `/app/billing`;
   - backend: `backend/routes/p2p-bank-events.routes.js`;
   - webhook: `POST /api/p2p/webhook`;
   - compatibility webhook: `POST /api/p2p-bank-events/webhook`;
   - таблица: `p2p_webhook_settings`;
   - хранит `token_hash`, `token_prefix`, `token_hint`, но не хранит полный токен для повторного показа.

Это работает, но продуктово разрознено: пользователь не понимает, где выпускать ключи и почему MCP-token, SMS-token и будущий n8n-key живут в разных местах.

## Целевая модель

Добавить единую таблицу `integration_tokens`.

Рекомендуемые поля:

```sql
id uuid primary key default gen_random_uuid(),
owner_id uuid not null references auth.users(id),
label text not null,
purpose text not null,
scopes text[] not null default '{}',
token_prefix text not null,
token_hint text not null,
token_hash text not null unique,
token_encrypted text not null,
metadata jsonb not null default '{}',
last_used_at timestamptz null,
last_used_ip text null,
revoked_at timestamptz null,
revoked_reason text null,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

`purpose`:

- `mcp`;
- `p2p_webhook`;
- `n8n`;
- `custom`.

Начальные `scopes`:

- `mcp:use`;
- `p2p:webhook`;
- `integrations:read`;
- `orders:read`;
- `shop:read`;
- `payments:read`;
- `cashdesk:read`;
- `n8n:automation`.

Для MVP реально включить только:

- `mcp:use`;
- `p2p:webhook`;
- `integrations:read`.

Остальные scopes завести как будущий контракт, но не давать им доступ к endpoint-ам до появления самих endpoint-ов.

## Генерация и хранение ключа

Формат ключа:

- MCP: можно оставить `brmcp_<prefix>_<secret>` для совместимости;
- P2P: можно оставить `br_p2p_<secret>` для совместимости;
- новый общий формат для n8n/custom: `brapi_<prefix>_<secret>`.

Проверка:

- `token_hash = sha256(fullToken)`;
- lookup по `token_hash`;
- revoked token не принимается;
- после успешного использования обновлять `last_used_at`, `last_used_ip`.

Повторный показ:

- `token_encrypted = encrypt(fullToken)` через существующий `backend/utils/crypto.js`;
- UI получает полный токен только через authenticated user endpoint;
- в списке показываем mask/hint, кнопки `Показать` и `Скопировать`.

Важно: это менее строго, чем one-time secrets, но соответствует текущей продуктовой цели. Риск компенсируем тем, что токены не plain text в БД, имеют scopes и могут быть отозваны/перевыпущены.

## Backend-план

### Этап 1. DB migration

- [ ] Создать `backend/sql/integration-tokens.sql`.
- [ ] Создать таблицу `public.integration_tokens`.
- [ ] Добавить индексы:
  - `integration_tokens_owner_idx(owner_id, created_at desc)`;
  - `integration_tokens_hash_idx(token_hash) unique`;
  - `integration_tokens_active_purpose_idx(owner_id, purpose) where revoked_at is null`.
- [ ] Добавить check constraint на `purpose`.
- [ ] Добавить check constraint или backend validation для scopes.

### Этап 2. Token service

Создать `backend/utils/integration-tokens.js` или `backend/services/integration-tokens.service.js`.

Функции:

- `generateIntegrationToken({ purpose })`;
- `hashIntegrationToken(token)`;
- `encryptIntegrationToken(token)`;
- `decryptIntegrationToken(record)`;
- `normalizeScopesForPurpose(purpose, requestedScopes)`;
- `listIntegrationTokens(ownerId)`;
- `createIntegrationToken(ownerId, payload)`;
- `reissueIntegrationToken(ownerId, tokenId)`;
- `revokeIntegrationToken(ownerId, tokenId)`;
- `authenticateIntegrationToken({ authorizationHeader, requiredScopes, requestIp })`;

Правила:

- `purpose=mcp` автоматически получает `mcp:use`;
- `purpose=p2p_webhook` автоматически получает `p2p:webhook`;
- `purpose=n8n` на MVP можно создавать как disabled/soon или не создавать вообще;
- перевыпуск создает новый token/hash/encrypted для той же записи или отзывает старую запись и создает новую. Предпочтение: отозвать старую и создать новую, чтобы audit был проще.

### Этап 3. API routes

Добавить `backend/routes/integrations.routes.js`.

Endpoint-ы:

- `GET /api/integrations/tokens`
  - список ключей текущего owner;
  - возвращает metadata, scopes, hint, last_used, статус;
  - не возвращает full token по умолчанию.

- `POST /api/integrations/tokens`
  - body: `{ purpose, label, scopes? }`;
  - создает ключ;
  - возвращает full token, encrypted storage остается на backend.

- `GET /api/integrations/tokens/:id/secret`
  - возвращает full token для своего active token;
  - MVP без re-auth и без one-time reveal.

- `POST /api/integrations/tokens/:id/reissue`
  - отзывает старый ключ;
  - создает новый ключ с тем же purpose/scopes/label;
  - возвращает full token.

- `POST /api/integrations/tokens/:id/revoke`
  - ставит `revoked_at`, `revoked_reason`.

- `POST /api/integrations/tokens/test`
  - проверяет предоставленный token и возвращает purpose/scopes/profile summary.

Mount:

- `app.use('/api/integrations', integrationsRoutes(supabase));`

### Этап 4. MCP compatibility

Нельзя резко сломать `/api/mcp/tokens` и существующий `/app/claw`.

План:

- [ ] `authenticateAgentOrUserToken` сначала проверяет `integration_tokens` с scope `mcp:use`;
- [ ] если не найдено, fallback в текущую `agent_mcp_tokens`;
- [ ] `POST /api/mcp/tokens` можно временно оставить, но внутри создавать запись в `integration_tokens` purpose `mcp`;
- [ ] `GET /api/mcp/tokens` можно временно читать `integration_tokens where purpose='mcp'` и при необходимости добавлять legacy `agent_mcp_tokens`;
- [ ] старую таблицу `agent_mcp_tokens` не удалять на MVP.

### Этап 5. P2P/SMS compatibility

Нельзя сломать текущий webhook и настройки кассы.

План:

- [ ] `POST /api/p2p/webhook` проверяет `integration_tokens` со scope `p2p:webhook`;
- [ ] если не найдено, fallback в текущую `p2p_webhook_settings.token_hash`;
- [ ] `GET /api/p2p/settings` или текущий `GET /api/p2p-bank-events/settings` возвращает token info из нового `integration_tokens`, если есть активный `purpose=p2p_webhook`;
- [ ] `POST /api/p2p/token` или текущий `POST /api/p2p-bank-events/token` создает/перевыпускает `integration_tokens purpose=p2p_webhook`;
- [ ] старую таблицу `p2p_webhook_settings` оставить для operational settings: `enabled`, `auto_confirm_enabled`, `match_clock_skew_minutes`, `last_webhook_at`, `last_used_at`, `last_used_ip`.

Важно: `p2p_webhook_settings` больше не должна быть источником token secret после миграции, но остается источником настроек автосверки.

### Этап 6. n8n/API foundation

В MVP не обязательно делать реальные n8n actions.

Минимум:

- [ ] на UI показать `n8n` как `Скоро`;
- [ ] backend scopes для n8n завести как контракт;
- [ ] не давать `n8n:automation` доступ к опасным endpoint-ам, пока нет отдельного API contract.

Будущий API слой:

- `/api/integrations/orders`;
- `/api/integrations/shop/purchases`;
- `/api/integrations/cashdesk/events`;
- `/api/integrations/customers`;
- каждый endpoint требует конкретный scope.

## Frontend-план

### Этап 1. Навигация

В `admin-v2/src/App.jsx`:

- добавить route `/integrations`;
- добавить пункт меню в `Инфраструктура` или `Финансы`.

Решение: лучше `Инфраструктура`, потому что страница объединяет MCP, кассу и будущий n8n, а не только деньги.

Label:

- `Интеграции / API`.

Не удалять:

- `/app/claw`;
- `/app/billing`;
- `/app/shop-receipts`.

### Этап 2. Новый экран

Создать:

- `admin-v2/src/pages/IntegrationsPage.jsx`;
- при необходимости `admin-v2/src/pages/integrations/*`.

Структура:

- overview:
  - `Интеграции / API-ключи`;
  - короткий текст: `Тут выпускаем ключи для внешних контуров BullRun: MCP, P2P касса / SMS Forward и будущие сценарии n8n.`;

- summary cards:
  - `Активные ключи`;
  - `Живые интеграции`;
  - `Последнее использование`;

- integration cards:
  - `BullRun MCP`;
  - `P2P касса / SMS Forward`;
  - `n8n` с badge `Скоро`;

- таблица:
  - `Интеграция`;
  - `Название`;
  - `Права`;
  - `Ключ`;
  - `Создан`;
  - `Последний вход`;
  - `Статус`;
  - `Действия`.

Действия:

- `Показать`;
- `Скопировать`;
- `Перевыпустить`;
- `Отозвать`;
- `Открыть клешню`;
- `Открыть кассу`;
- `Открыть сверку`.

### Этап 3. Тексты

Тексты должны быть пользовательские, без лишней инженерности:

- MCP: `Ключ для BullRun MCP. Агент увидит только разрешенные tools.`;
- P2P: `Bearer token для SMS/Push Forward. Нужен, чтобы BullRun принимал банковские уведомления.`;
- n8n: `Скоро. Здесь будут ключи для сценариев автоматизации.`;
- Empty: `Пока нет ключей. Выпусти ключ для нужного контура.`;
- Reissue confirm: `Старый ключ сразу перестанет работать. В SMS Forward, MCP или n8n нужно будет вставить новый.`;
- Revoke confirm: `После отзыва эта интеграция больше не сможет обращаться к BullRun.`;

Запрещенный текст для MVP:

- `Ключ показываем один раз`;
- `Сохрани сейчас, потом не увидишь`.

### Этап 4. Что делать со старыми экранами

`/app/claw`:

- оставить onboarding MCP;
- заменить копирайт про one-time token;
- добавить ссылку `Управлять API-ключами` -> `/app/integrations`;
- можно оставить кнопку выпуска MCP token, если она использует новый backend.

`/app/billing`:

- оставить readiness, webhook URL, автоподтверждение, тест SMS;
- заменить генерацию token на новый integration token backend;
- добавить ссылку `Управлять API-ключами` -> `/app/integrations`;
- в поле Authorization показывать полный доступный ключ, если он есть.

`/app/shop-receipts`:

- не смешивать с ключами;
- это рабочее место сверки оплат.

## Совместимость и миграция данных

Вариант MVP без миграции старых secrets:

- новые ключи создаются в `integration_tokens`;
- старые MCP/P2P hash-only ключи продолжают работать через fallback;
- старые hash-only ключи нельзя показать полностью, потому что полного секрета нет;
- UI должен честно показать: `Старый ключ нельзя показать. Перевыпусти, чтобы его можно было копировать с этой страницы.`

Это самый безопасный путь, потому что мы не можем восстановить full token из hash.

Вариант с миграцией metadata:

- создать placeholder-записи в `integration_tokens` без `token_encrypted` нельзя, потому что целевая модель требует повторного показа;
- поэтому лучше не мигрировать старые записи в новую таблицу автоматически, а показывать их как legacy source до перевыпуска.

## Security и ограничения MVP

MVP намеренно удобнее, чем строгий enterprise flow:

- нет one-time reveal;
- нет re-auth при `Показать`;
- нет 2FA;
- нет IP allowlist;
- нет per-token expiration.

Обязательные ограничения даже в MVP:

- full token не хранится plain text;
- full token не попадает в логи;
- full token не возвращается в общем списке;
- full token возвращается только по отдельному `GET /secret`;
- scopes проверяются на каждом integration endpoint;
- revoked token не работает;
- legacy hash-only токены нельзя показать, только перевыпустить.

## Acceptance criteria

- [ ] Пользователь видит страницу `/app/integrations`.
- [ ] Пользователь может создать MCP token и потом повторно открыть/скопировать его.
- [ ] Пользователь может создать P2P/SMS token и потом повторно открыть/скопировать его.
- [ ] Новый MCP token работает на `/api/mcp`.
- [ ] Новый P2P token работает на `/api/p2p/webhook`.
- [ ] Старые MCP tokens продолжают работать.
- [ ] Старый P2P token из `p2p_webhook_settings` продолжает работать.
- [ ] Старые hash-only tokens в UI не обещают повторный просмотр, а предлагают перевыпуск.
- [ ] `Отозвать` блокирует дальнейшее использование token.
- [ ] `Перевыпустить` отключает старый token и показывает новый.
- [ ] `last_used_at` и `last_used_ip` обновляются после успешного использования.
- [ ] В UI нет текста `показываем один раз`.
- [ ] `npm run build` в `admin-v2` проходит.
- [ ] `node --check` проходит для новых backend routes/services.
- [ ] После deploy сервер показывает `/app/integrations`, `/app/billing`, `/app/claw` без console/runtime errors.

## Реализационная очередность

1. DB migration `integration_tokens`.
2. Backend token service.
3. Backend `/api/integrations/tokens`.
4. Auth helper для `integration_tokens` + fallback legacy.
5. P2P webhook auth через новый service + fallback legacy.
6. Frontend `/app/integrations`.
7. Линки из `/app/claw` и `/app/billing`.
8. Проверка MCP и P2P токенов на сервере.
9. После стабилизации: решить, нужно ли убирать прямой выпуск ключей из `/app/claw` и `/app/billing`, или оставить как быстрые contextual actions.

## Ожидаемые проверки субагентов

Frontend-субагент уже предложил структуру нового экрана: route `/integrations`, карточки MCP/P2P/n8n, общая таблица ключей, ссылки в `/claw`, `/billing`, `/shop-receipts`. Его рекомендацию `one-time reveal` отклоняем, потому что пользователь явно выбрал повторный просмотр и копирование.

Backend/review-субагенты не успели вернуться на момент записи плана. Перед кодом нужно проверить их выводы и внести сюда новые blockers, если они найдут риск в schema/auth/compatibility.

## Важное правило на реализацию

Не делать один root key “ко всему”. Даже если UI показывает ключи в одном месте, каждый ключ должен иметь назначение и scopes. Это позволит подключать n8n и будущие API сценарии без выдачи полного доступа к кабинету.

## Реализация 2026-05-19

- Добавлена таблица `integration_tokens` через Supabase migration.
- Добавлен backend service `backend/services/integration-tokens.service.js`.
- Добавлен route `backend/routes/integrations.routes.js`.
- `/api/mcp` теперь принимает новые `integration_tokens` со scope `mcp:use` и сохраняет fallback на `agent_mcp_tokens`.
- `/api/p2p/webhook` теперь принимает новые `integration_tokens` со scope `p2p:webhook` и сохраняет fallback на `p2p_webhook_settings`.
- Добавлен экран `/app/integrations`.
- `/app/claw` и `/app/billing` связаны с новым экраном API-ключей.
- Старые hash-only ключи показываются как `Legacy`: их нельзя раскрыть, но можно перевыпустить.

## Проверка 2026-05-19

- `node --check` пройден для новых/измененных backend файлов.
- `admin-v2 npm run build` прошел.
- `npm run deploy` прошел, release `20260519-135804`.
- На сервере `/app/integrations`, `/app/billing`, `/app/claw` открываются без console/runtime errors.
- Smoke custom key: create -> reveal -> test -> revoke успешно.
- Smoke MCP key: create -> `/api/mcp tools/list` -> revoke успешно.
- Smoke P2P key: create -> test -> revoke -> `/api/p2p/webhook` возвращает `403` после отзыва.

## Обновление навигации 2026-05-19

- В левом меню добавлен отдельный раздел `API`.
- В разделе три пункта: `/app/api/mcp`, `/app/api/sms-push`, `/app/api/n8n`.
- Старые маршруты `/app/claw`, `/app/billing`, `/app/integrations` оставлены рабочими для совместимости и прямых ссылок.
- `/app/api/mcp` использует существующий экран MCP.
- `/app/api/sms-push` использует существующий экран кассового webhook.
- `/app/api/n8n` добавлен как отдельная страница-заготовка под будущие n8n сценарии.
- CTA на странице API-ключей переведены на новые API-маршруты.
- Проверка: `admin-v2 npm run build`, `npm run deploy:v2` release `20260519-171521`, серверные страницы `/app/api/mcp`, `/app/api/sms-push`, `/app/api/n8n` открываются без console/runtime errors.

## Остаточные ограничения

- n8n пока только как будущий контур в UI и scopes, без реальных automation endpoint-ов.
- Старые hash-only ключи невозможно восстановить из hash; для повторного копирования их нужно перевыпустить.
- В MVP просмотр ключа не требует повторной авторизации, потому что выбран приоритет удобства.
