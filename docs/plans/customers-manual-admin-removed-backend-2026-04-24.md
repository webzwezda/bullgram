# Customers Manual Admin Removed Backend - 2026-04-24

## Goal

Закрыть узкий backend-slice для ручного удаления клиента админом из `Customers` без фронтовых правок и без поломки старых `CRM`/`Access` вызовов.

## Scope

- `backend/routes/userbot.routes.js`
- `backend/routes/customers.routes.js`
- `backend/routes/client-dossier.routes.js`

## Rules

- `batch-kick` должен отличать вызов из `Customers` от legacy batch-kick.
- Старые `CRM`/`Access` вызовы должны сохранить старый `event_source/access_note`.
- `/api/customers/workbench` должен отдавать отдельный сегмент для `manual admin removed`, отдельно от обычного `expired`.
- `Client Dossier` должен читать это состояние как отдельный источник/событие, если событие или нота уже есть.

## Implementation

- [x] Нормализовать источник вызова для `batch-kick` и писать отдельный `event_source` только для `Customers`.
- [x] Сохранить legacy семантику `manual_batch` для старых экранов.
- [x] Отделить `manual admin removed` от `expired` в `customers/workbench`.
- [x] Пробросить распознавание `manual admin removed` в `client-dossier`.
- [x] Прогнать syntax check по измененным backend-файлам.

## Review

- `Customers`-вызов пишет `event_source = customers_manual_admin_removed`, `payload.removal_kind = manual_admin_removed`, `subscriptions.access_note = "Удален админом вручную из Customers"`.
- Legacy batch-kick без нового источника продолжает писать `event_source = manual_batch` и старую ноту.
- `customers/workbench` возвращает отдельный массив `manualAdminRemovedCustomers` и не смешивает эти записи с `expiredCustomers`.
- `client-dossier` помечает такие подписки/события как `Удален админом вручную`.
