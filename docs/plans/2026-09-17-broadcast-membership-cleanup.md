# Выход юзерботов из групп по окончании рассылки (membership cleanup)

Дата: 2026-09-17. Статус: **в реализации**. Продолжение docs/plans/2026-09-16-messaging-router.md.

## Задача владельца

Рассылка прошла успешно → юзерботы, которые **вступали** в группы ради охвата, должны выйти
(вместе с админкой, если её дали), а те, кто **и там был раньше**, остаются. Галочка на странице
рассылки: «выйти по окончанию рассылки» — если стоит, происходит очистка после успешной кампании.

## Семантика

- **Кто «вступал»**: факт join'а ради кампании фиксируется в момент вступления — таблица
  `broadcast_preparation_joins` (preparation_id, userbot_id, tg_chat_id, granted_admin).
  Всё, что не записано здесь, cleanup не трогает (включая контурные площади и «старых» админов).
- **Когда**: кампания в терминальном успехе (`sent` или `completed_with_errors`) и в её
  `meta.leave_groups_on_complete === true`. `failed`/`cancelled` — не трогаем (нужен ретрай).
- **Как**: юзербот выходит сам (channels.LeaveChannel / messages.DeleteChatUser для basic-групп).
  Выход сам снимает админку — отдельного demote не нужно. Если self-leave упал — kick через
  промоутера (официальный бот / юзербот-админ в той группе, findPromoter* из chat-admin-rights).
- **Защита (никогда не выходим)**: собственные каналы/чаты владельца (таблица channels) и
  все 4 слота контуров (sales_bot_contours) → `skipped_protected`. Restricted/pending_activation
  юзерботы → `skipped_restricted` (не дёргаем).
- **manual-by-default**: очистка только по явной галочке конкретной кампании.

## Миграция 20260917120000 (применена)

`broadcast_preparation_joins` (owner_id, preparation_id, userbot_id, tg_chat_id text, chat_title,
granted_admin bool, joined_at, removed_at, remove_status left|kicked|failed|skipped_protected|skipped_restricted,
remove_error), RLS owner-only, индексы (preparation_id) и частичный (owner_id, removed_at) where removed_at is null.

## Чеклист

- [x] Миграция применена + эталон backend/sql/broadcast-preparation-joins.sql
- [x] **Бэкенд:** phaseJoin (и пути admin-grant) пишут успешные join'ы; POST /api/broadcast/send принимает `leave_groups_on_complete` → meta кампании; новый jobs/broadcast-membership-cleanup.job.js — батчами с пейсингом (~4s+jitter, ≤20/тик), самовыход, kick-фолбэк через промоутера, протекция своих чатов/контуров, restricted-skip, meta.cleanup = {total, done, failed} на кампании; тесты test:broadcast-cleanup
- [x] **Фронт:** чекбокс на шаге «Отправка» (копия + hint), поле в теле POST /send; в CampaignDetail — заметка и прогресс meta.cleanup
- [x] Гейты: тесты, build, check:design, код-ревью, CI
- [x] Ревью-секция + BACKLOG

## Ревью

Реализовано 2026-09-17 (оркестратор + срезы; коммит — см. git log).

**Код-ревью (staff, adversarial): REJECT → все находки исправлены до пуша.**
- **P0**: join-строки писали голый TL id, а `channels.tg_chat_id` — marked (`-100…`) → защита «своих чатов» никогда не совпадала и cleanup мог выкинуть юзербота из собственного канала. Проверено по прод-БД (формат подтверждён). Фикс: `toMarkedChatId`/`resolveMarkedChatId` при записи (marked `target.chat_id` приоритетен, иначе вывод из `joined.kind`).
- **P1**: `messages.DeleteChatUser` требовал `InputUser`, а не `InputPeerSelf` — basic-group self-leave падал бы на проводе всегда. Фикс: `InputUserSelf` (+ тест на конструктор).
- **P1**: при упавшем скане диалогов или рестарте процесса «уже участник» записывался как join-ради-кампании → eject старого админа. Фикс: phaseScan персистит `phase_detail.scanned_chats`; phaseJoin объединяет persisted ∪ кэш; без скан-данных юзербот не вступает вслепую.
- **P2×4**: кик считается завершённым только после проверенного unban (иначе failed с пометкой «разбанить вручную»); zero-join кампании больше не поллются вечно; кандидаты выбираются от pending-строк (голодание старых исключено); ошибка вставки join-строки логируется.

**Проверено:** test:broadcast-cleanup 92, test:broadcast 75, test:messaging 76, test:lifecycle 36, test:sales 80, test:contours 12, test:autopost — зелёные; admin build PASS; check:design PASS.

**Хвосты:** после деплоя — prod-проход по браузеру владельца (галочка, прогресс cleanup в кампании); на первой реальной рассылке с галочкой проверить, что `broadcast_preparation_joins.tg_chat_id` ложится в marked-форме и `meta.cleanup` закрывается.
