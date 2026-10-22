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

- [x] Канонический `button.jsx` правится в admin-v2
- [x] Байт-копии: site-v2, userbot-v2, bots-v2, treasury-v2, profile-v2 + `cmp`
- [x] `design/CHANGELOG.md` — MINOR запись (1.2.0)
- [x] `npm run check:design` зелёный (ratchet падает сам — убрали `bg-muted`)
- [x] Коммит + push → деплой (c06b482, GH Actions success)
- [x] Прод-верификация в Chrome владельца: hover primary/outline на `/userbot`
- [x] design-critic: прод-скриншоты desktop + 390px + hover-кадры — PASS
- [x] BACKLOG §24 закрыт (латентный dark-хвост → §25)

## Ревью (2026-10-22)

Сделано ровно по плану, без расширения скоупа. Коммит c06b482: 6 байт-копий
button.jsx, baseline 8770 → 8763 (осознанное понижение — из кита ушёл raw
`bg-muted`), CHANGELOG 1.2.0. Гейты: check:design PASS (дважды — до и после
обновления baseline), ui-sync 7/7, axe 0 serious/critical, build:admin ok,
деплой success.

Прод-верификация в Chrome владельца (`/userbot`, программный клик по опциям
комбобокса — страница непрерывно перерисовывается, координатные клики не
держатся):
- kit-default «Выполнить активацию» (safe-ряд): oklch(0.205 0 0) →
  oklab(0.205 0 0 / 0.8) при hover — `<button>` теперь реагирует;
- kit-outline «Перейти в Safe mode» (боевой ряд, аккаунт @Erik): white /
  #d9e2f2 → slate-100 / slate-300 — заметный сигнал, канонные токены;
- кнопка витрины «Купить за 15 TON» с локальным
  `bg-action-primary`/`hover:bg-action-primary-hover` работала и раньше —
  не регрессия, не тронута.

Дизайн-критик (роль-фрейм на general-purpose — файловый design-critic упал
с `[1210][Invalid API parameter]`): PASS без блокирующих. Замечания: isolation
hover побайтно чистый, ритм рядов не прыгает, мобильные 390px складываются
вертикально без разъезда. Риски не блокируют: (1) resting-outline по-прежнему
тихий — отдельное семантическое решение, молча не трогать; (2) `bg-primary/80`
композится с подложкой — на будущих тонированных поверхностях посветлеет
иначе; (3) dark-пары hover отсутствуют — записано в BACKLOG §25.

Скриншоты и хелперы верификации — временные, удалены после волны.

## Вне скоупа / заметки

- Ghost намеренно тихий — это его роль; не трогаем.
- Destructive уже имеет видимый hover (`/10` → `/20`).
- Известный FAIL контраста `border.strong` задокументирован в гейте — бордер не текст,
  AA не требуется.
