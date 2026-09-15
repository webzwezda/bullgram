> **SUPERSEDED / ЗАКРЫТ 2026-09-16** — открытых пунктов нет: спот-чек кода 2026-09-16: candidates/reconciliation/demo-seed в customers.routes.js отсутствуют — dead-code удалён
> Живой список открытых задач: docs/plans/BACKLOG.md

# План: чистка мёртвого кода /app/customers

Дата: 2026-09-13. Источник: код-ревью `code-reviewer` (fix-first) — после
редизайна `744054c` (вырез под-вкладок) осталось ~40% мёртвого кода, на
котором спотыкаются ИИ-агенты. Проверено через Supabase MCP:
`customer_reconciliation_sources` = 0 строк, `customer_reconciliation_resolutions`
= 0, демо-строк с `[DEMO` нет — большие куски удаляются без потерь.

## Решения владельца (делегированы оркестратору)

- **Candidates-фича** — удалить целиком: фронт-кластер + поллинг раз в 60с
  (нагружал БД вхолостую) + 4 бэкенд-роута (candidates GET/import/resolve
  POST+DELETE).
- **Reconciliation-контур** — удалить целиком: фронт-остатки, 5 роутов
  (discover/POST/PATCH/scan/sync-members), сервис
  `customer-reconciliation.service.js` (964 строки, единственный импортёр —
  customers.routes.js). Довязывать не будем: фича не жила, данных ноль.
- **demo-seed** — удалить оба роута (~430 строк) + `sanitizeDemoLabel`
  (демо-данных в БД нет).
- **Редиректы** `/crm`, `/orders`, `/access` → `/customers` без tab
  (текущие `?tab=` ведут в пустую таблицу).
- **AbandonedPage**: кнопка pushToOrders удаляется целиком вместе с записью
  `orders_manual_selection` — её потребитель (вкладка access) мёртв;
  pushToBroadcast живой, не трогать.
- **Живой баг**: `syncingType={audienceState.syncingState}` →
  `audienceState.syncingType`.
- **Дубль сегмента**: оставить `removedByAdmin`, выкинуть
  `manualAdminRemovedCustomers` (и из summary).
- **Трим workbench-ответа**: убрать поля без живых потребителей
  (summary, selectedBotId, abandonedInvoices, recentOrders, needsAccessCheck,
  inGroupLeaks, bases-сегмент + baseStatsById/basesResp), СОХРАНИВ
  presence-логику (фетч channel_audience_members жив — питает активные
  подписки). Фронт чистит своих мёртвых читателей синхронно.
- **Мелочь**: runBulkAction/mutatingBulk, handoff-кластер localStorage
  (orders_search_preset, abandoned_filter_preset, orders_manual_selection),
  мёртвые хелперы (formatWhen, getClientInitial, AUDIENCE_TAB_MAP,
  ABANDONED_STATUS_LABELS, buildQueue, getInvoiceStatus, formatAttempt*,
  getAccessReason, getRemovedAdminReason, openBroadcastManualSelection,
  getStartedReason, getContextDisplay-ветки, stats.viewed/abandoned/…,
  selectedBot memo, state.refreshing, prop loading в AudienceTable, мёртвые
  ключи CUSTOMERS_TAB_LABELS), пустой каталог pages/customers/.

## Не делаем

- `POST /direct-access` — живой (вызывается из runSubscriptionAction).
- Сегменты started/viewed/invoice-created/customers-active/customers-expired/
  audience-* — живая воронка, не трогать.
- Восстановление reconciliation/candidates как фич — отклонено.

## Слайсы

- [x] Фронт: CustomersPage.jsx (сегменты, ветки, хелперы, candidates-поллинг,
      handoff, sanitizeDemoLabel, опечатка), App.jsx (редиректы), AbandonedPage.jsx
      (pushToOrders), rmdir pages/customers — ✅ проверено 2026-09-16 (CustomersPage.jsx: 0 вхождений sanitizeDemoLabel/candidates/handoff-ключей orders_search_preset·abandoned_filter_preset·orders_manual_selection/manualAdminRemovedCustomers/мёртвых хелперов; 60s-интервал :534-537 остался только для workbench-воронки; App.jsx:209-211 /crm·/orders·/access → Navigate to /customers без tab; AbandonedPage.jsx: pushToOrders 0, pushToBroadcast жив :364; pages/customers/ не существует)
- [x] Бэк: customers.routes.js (роуты candidates/reconciliation/demo-seed, трим
      workbench), удалить customer-reconciliation.service.js — ✅ проверено 2026-09-16 (customers.routes.js — только POST /direct-access :121 и GET /workbench :223, grep candidates|reconciliation|demo-seed = 0; workbench-ответ :535-542 = {success, updatedAt, bots, segments, channels, caps} без summary/selectedBotId/abandonedInvoices/recentOrders/needsAccessCheck/inGroupLeaks/bases, presence-логика сохранена :386-401,459-461; customer-reconciliation.service.js удалён — 0 упоминаний в backend)
- [x] Валидация: builds + кросс-греп удалённых полей — ✅ проверено 2026-09-16 (записано в «Итог» ниже: node --check + npm run build зелёные, grep 0 хвостов; кросс-греп перепроверен 2026-09-16 — 0 хвостов по всем ключам)
- [x] code-reviewer по диффу — ✅ проверено 2026-09-16 (записано в «Итог»: verdict proceed, P0/P1 нет; правки после ревью — hasCrmSub, segments.invoiceCreated — вошли в код)
- [x] Коммит, пуш, CI, прод — ✅ проверено 2026-09-16 (коммиты ca967a2 «чистка мёртвого кода» и хотфикс 2cb0009 в истории; «Итог» фиксирует прод-проверку: 0 ошибок консоли, воронка рендерится; follow-up customers-коммиты 0d3c05f, 483c91d поверх)

## Итог

- Коммиты: docs(AGENTS.md skills-раздел, отдельным коммитом) +
  `refactor(customers): чистка мёртвого кода`
- Ревью: code-reviewer по диффу — **proceed**, живое не отрезано, P0/P1 нет.
  Правки после ревью: (1) hasCrmSub дочищен от мёртвых tab-id; (2) вскрыто
  и починено: под-вкладка «Создали счет» была структурно всегда пустой —
  бэк не отдавал invoice_created в viewedTariffs (а дедуп по инвойсам
  исключил бы их и там); заведён отдельный сегмент
  `segments.invoiceCreated` из funnel_events, фронт читает его.
- Масштаб: CustomersPage 2528 → ~1215 строк, customers.routes.js 2243 → ~490,
  удалён customer-reconciliation.service.js (964). Поллинг reconciliation-
  candidates раз в 60 сек убран.
- Проверено: node --check, npm run build (зелёный), grep-репорты 0 хвостов,
  БД через Supabase MCP (reconciliation пуст, демо-строк нет,
  customers_candidate_import = 0 строк).
- Не делали: -
- Хотфикс после деплоя: `invoiceCreated` отсутствовал в начальном стейте —
  rowsByTab падал до первой загрузки (`2cb0009`). Урок: новое поле state
  добавлять и в useState-инициализацию, не только в маппинг ответа.
  Прод-проверка: 0 ошибок консоли, воронка рендерится.
