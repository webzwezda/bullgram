# Волна кита: hover у Button (BACKLOG §24)

Дата: 2026-10-22. Статус: в работе.

## Проблема

Канонический кит `admin-v2/src/components/ui/button.jsx` (копии в 6 аппах байт-идентичны):

- `variant="default"`: hover прописан как `[a]:hover:bg-primary/80` — скоуп только на
  анкоры. Настоящий `<button>` под курсором не меняется (замечено на safe-mode ряду
  `/userbot`, 2026-10-21). При этом `secondary` и `destructive` имеют обычный `hover:`
  — кит противоречит сам себе.
- `variant="outline"`: hover — `hover:bg-muted` (≈slate-100 на белом, почти неотличим),
  бордер не темнеет. Жалоба владельца: «outline почти невидим».

## Решение (канон-действие, минимум касаний)

1. `default`: `[a]:hover:bg-primary/80` → `hover:bg-primary/80`. Индиго-семантику
   (`action-primary-hover`) НЕ тащим: `--primary` в аппах — shadcn-дефолт (почти чёрный),
   `bg-primary/80` — родной hover этого слоя. Продлеваем его на кнопки.
2. `outline` (light): `hover:bg-muted hover:text-foreground` →
   `hover:border-border-strong hover:bg-surface-subtle-strong hover:text-foreground`.
   Токены существуют и каноничны: `border.strong` = slate-300 («границы, идентифицирующие
   контрол: инпуты, селекты, кнопки-обводки»), `surface.subtle-strong` = slate-100
   («selected-состояния, прижатые блоки»). Видимый сигнал даёт потемнение бордера.
3. `aria-expanded:*` у outline и все `dark:*` — не трогаем (минимальный дифф; тёмная тема
   в проде не активна, `.dark`-селектор при наличии перебил бы light-hover).
4. `[a]:hover`-скоупы в `badge.jsx` — вне скоупа волны (бейджи не интерактивные цели).

## Чек-лист

- [ ] Канонический `button.jsx` правится в admin-v2
- [ ] Байт-копии: site-v2, userbot-v2, bots-v2, treasury-v2, profile-v2 + `cmp`
- [ ] `design/CHANGELOG.md` — MINOR запись (1.2.0)
- [ ] `npm run check:design` зелёный (ratchet падает сам — убрали `bg-muted`)
- [ ] Коммит + push → деплой
- [ ] Прод-верификация в Chrome владельца: hover primary/outline на `/userbot`
- [ ] design-critic: прод-скриншоты desktop + 390px + hover-кадры
- [ ] BACKLOG §24 закрыт

## Вне скоупа / заметки

- Ghost намеренно тихий — это его роль; не трогаем.
- Destructive уже имеет видимый hover (`/10` → `/20`).
- Известный FAIL контраста `border.strong` задокументирован в гейте — бордер не текст,
  AA не требуется.
