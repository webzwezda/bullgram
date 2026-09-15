# Bullgram Design Tokens

Единый источник дизайн-решений продукта (волна 1 плана единой дизайн-системы). Формат — [DTCG](https://design-tokens.github.io/community-group/format/) (`$type`/`$value`/`$description`, алиасы `{path}`).

## Архитектура: 3 тира

```
design/tokens/
├── color.primitives.json   # сырье: 12 полных рамп 50–950 + white/black
├── color.semantic.json     # студийные правила: алиасы на примитивы
├── typography.json         # шрифты, размеры, веса, интерлиньяж, трекинг
├── spacing.json            # базовый шаг 4px + шкала
├── radius.json             # дефолтная шкала Tailwind v4
└── motion.json             # де-факто длительности/кривая
```

1. **Примитивы** (`primitive.*`) — сырое значение. Никогда не используются в компонентах напрямую.
2. **Семантика** (`text.ink.*`, `surface.*`, `border.*`, `action.*`, `feedback.*`, `component.*`) — алиасы на примитивы, кодификация студийных правил. Компоненты ссылаются только сюда.
3. **Компонентный слой** (`component.*`) — именованные паттерны поверх семантики.

### Железное правило

Значения примитивов — **байт-в-байт** из `admin-v2/node_modules/tailwindcss/theme.css` (Tailwind v4 default, oklch; white/black — `#ffffff`/`#000000`). Примитивы неприкосновенны: **изменение значения примитива = изменение визуала всего продукта**. Новое semantic-значение вводится алиасом на существующий шаг рампы; новый шаг рампы не «подгоняется» под хотелку. Набор палитр (slate, indigo, amber, rose, emerald, blue, red, sky, violet, orange, purple, teal) — только те, что реально встречаются в `admin-v2/src` и `site-v2/src`; новая палитра в коде = новая рампа здесь.

Нюанс Tailwind v4: oklch-значения v4 при рендере дают hex, отличающийся от v3-палитры на насыщенных цветах (red-600 → `#e7000b`, indigo-600 → `#4f39f6`). Для любых контрастных расчётов конвертируй oklch в sRGB стандартным пайплайном (как браузер), а не по v3-таблицам.

## Маппинг токенов → Tailwind v4 @theme (контракт волны 2)

Наивное уплощение DTCG-путей в CSS-переменные ломает namespace'ы v4. Железный маппинг для build-скрипта:

| DTCG | CSS-переменная |
|---|---|
| любая color-семантика, включая `text.ink.*` | `--color-…` (`text.ink.muted` → `--color-ink-muted`, `action.primary` → `--color-action-primary`) — **никогда** `--text-*`, в v4 это namespace размера шрифта |
| `font.size.*` | `--text-*` (`font.size.sm` → `--text-sm`) |
| `font.sizeLineHeight.*` | `--text-*--line-height` (`--text-sm--line-height`) |
| `lineHeight.*` | `--leading-*` |
| `letterSpacing.*` | `--tracking-*` |
| `font.family.sans` / `font.family.mono` | `--font-sans` / `--font-mono` |
| `spacing.base` | только `--spacing: 0.25rem`; per-step spacing-переменных в v4 нет |

`component.micro-label` — нестандартный композит (`textCase`/`color` вне DTCG-typography): build-скрипт волны 2 обрабатывает его явно, строгие DTCG-инструменты эти поля молча потеряют.

## Semantic-токен → студийное правило

| Токен | Правило, которое он кодифицирует |
|---|---|
| `text.ink.muted` = slate-500 | «Контентный текст минимум slate-500» — это floor; светлее только декоративный `text.ink.faint` (slate-400) |
| `component.money-zero` = slate-900 | Правило нулей: денежные нули тёмные (ноль в балансе — число, а не отсутствие данных); приглушаются только деятельные нули-счётчики |
| `component.micro-label` = 11px + uppercase + tracking-widest + slate-500 | Единый паттерн микро-лейблов (надсеточные подписи, рубрикаторы) |
| `feedback.error` = red-50 → red-700 | Feedback живёт парами фон+текст из одного набора; текст-шаг каждой пары проходит AA на своём фоне |
| `feedback.warning` = amber-50 → amber-700 | То же; amber светлее 700 на светлом фоне контраст не проходит |
| `feedback.success` = emerald-50 → emerald-700 | То же; правило «emerald не светлее 700 на светлом» |
| `feedback.info` = sky-50 → sky-700 | То же |
| `action.ton` = sky-700 (+hover sky-800) | TON-экраны, утверждённое решение — **не менять** на indigo |
| `action.primary` = indigo-600 (+hover 700) | Основное действие; ссылки и фокус — в том же индиго |
| `surface.card` = white, `surface.raised` = white | Уровни поверхностей различаются ring/тенью, а не заливкой (кит admin безтеневой, разделение — ring-1/border) |
| `border.default` = slate-200 / `border.strong` = slate-300 | Декоративная линия vs граница, идентифицирующая контрол |

## Что сознательно НЕ токенизировано

- **Тени** — кит admin безтеневой (разделение поверхностей через `ring-1`), шкала теней Tailwind остаётся дефолтной.
- **Per-app радиусы** — admin-v2 (`--radius: 0.625rem`, shadcn) и site-v2 имеют собственные override и **оставляются per-app до отдельного решения**; `radius.json` фиксирует только общую дефолтную шкалу Tailwind v4.
- **Паттерн «градиентная иконка + color-matched shadow-lg»** (из DESIGN.md) — это паттерн применения, не токен: градиент собирается из двух шагов одной рампы (`from-X-500 to-X-700`), тень — `shadow-lg` с цветом шага и прозрачностью.
- Тёмная тема — не заведена; файлы описывают текущую light-реальность.

## Валидация

Из каталога кита `~/.zcode/ux-ui-agent-skills/`:

```bash
# структура: JSON + резолв всех алиасов (строгий режим — самодостаточный набор)
python3 scripts/validate_tokens.py /Users/webzwezda/Desktop/bullgram/design/tokens

# контраст: официальный скрипт ожидает один DTCG-файл с группой semantic.* и hex-значениями.
# Примитивы у нас oklch, поэтому перед прогоном собери hex-слепок semantic-токенов
# (резолв алиасов + конвертация oklch→sRGB) и подай его скрипту:
python3 scripts/validate_contrast.py <hex-слепок> --aaa
```

Прогон от 2026-09-16: `validate_tokens` — 6/6 файлов, 259 токенов (134 примитива + 29 semantic + 48 typography с машинным слоем интерлиньяжей + 34 spacing + 10 radius + 4 motion), 0 ошибок, 0 висячих алиасов. Контраст — все обязательные AA-пары проходят (ink.strong/body/muted, 4 feedback-пары, primary/ton/destructive текст-на-действии); `ink.muted` = 4.76:1 на белом и 4.55:1 на slate-50. Единственный FAIL официального скрипта — его собственная доп. пара `border.strong ≥ 3:1` (WCAG 1.4.11): slate-300 на slate-50 даёт 1.42:1. Это де-факто студии; примитивы не трогаем (см. Risks плана волны 1) — если когда-нибудь решим ужесточать, кандидат `border.strong` = slate-400/500, но это отдельное визуальное решение.
