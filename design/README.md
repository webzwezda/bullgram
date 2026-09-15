# Bullgram Design Tokens

Единый источник дизайн-решений продукта (волна 1 плана единой дизайн-системы). Формат — [DTCG](https://design-tokens.github.io/community-group/format/) (`$type`/`$value`/`$description`, алиасы `{path}`). Версионирование и политика изменений — [design/CHANGELOG.md](design/CHANGELOG.md) (SemVer: значение примитива = MAJOR, новый токен = MINOR, доки = PATCH; компонент в канонический кит — при ≥2 использованиях).

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
| `font.family.sans` / `font.family.mono` | `--font-sans` / `--font-mono` — эммитится с волны 4 (сначала admin-v2; site-v2 подключит токены в волне 6) |
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

Единый гейт качества (волна 5), из корня репозитория:

```bash
npm run check:design
```

Что проверяет `design/check-design.mjs` (kit-скрипты вызываются из `~/.zcode/ux-ui-agent-skills/`, в репо не копируются):

1. **tokens** — `validate_tokens.py design/tokens`: JSON валиден, все алиасы резолвятся. Обязателен exit 0.
2. **contrast** — `design/contrast-snapshot.mjs` собирает hex-слепок semantic-токенов (резолв алиасов + oklch→sRGB, round-trip проверен на #dc2626, #62748e, #4f39f6, #e7000b) → `validate_contrast.py /tmp/bullgram-contrast.json`. Exit 1 с **единственным** FAIL `border.strong ≥ 3:1` (WCAG 1.4.11) — зелёный (известный, задокументирован ниже); любой **другой** FAIL — гейт красный.
3. **hardcodes** — `lint_hardcodes.py admin-v2/src site-v2/src` против ratchet-снапшота `design/lint-baseline.json`. Гейт падает **только** если текущих findings стало больше baseline (total + по каждому типу + по каждому файлу). Меньше — зелёный с подсказкой обновить baseline. Baseline перегенерируется осознанно при миграции на семантику: `node design/check-design.mjs --update-baseline`.
4. **axe** (опционально) — `axe_audit.mjs` по `design/qa/harness-studio-pairs.html`: рендер-аудит студийных пар (нужны playwright + Chrome в окружении; без них шаг честно SKIPPED). Падение — только на serious/critical. Harness: статичная страница, `:root` — дословный слепок `admin-v2/src/styles/tokens.css`, измеряемая разметка — слой `--qa-*` (те же значения в sRGB-hex из пайплайна contrast-snapshot: kit-скрипт `measure_render.mjs` парсит computed style только в rgb()/hex, строки oklch он не читает).

Разовые проверки того же harness вручную (measure_render — реальный рендер, ground truth):

```bash
node ~/.zcode/ux-ui-agent-skills/scripts/measure_render.mjs design/qa/harness-studio-pairs.html
```

Нюанс Tailwind v4 (важно для любых контрастных расчётов): oklch-значения v4 при рендере дают hex, отличающийся от v3-палитры на насыщенных цветах (red-600 → `#e7000b`, indigo-600 → `#4f39f6`, slate-900 → `#0f172b`). Конвертируй oklch в sRGB стандартным пайплайном (как браузер), а не по v3-таблицам — так делает `contrast-snapshot.mjs`.

Из каталога кита `~/.zcode/ux-ui-agent-skills/` те же гейты можно позвать руками:

```bash
# структура: JSON + резолв всех алиасов (строгий режим — самодостаточный набор)
python3 scripts/validate_tokens.py /Users/webzwezda/Desktop/bullgram/design/tokens

# контраст: собираем hex-слепок semantic-токенов и подаём официальному скрипту:
node design/contrast-snapshot.mjs   # из корня репо; пишет /tmp/bullgram-contrast.json
python3 scripts/validate_contrast.py /tmp/bullgram-contrast.json
```

Сборка артефактов и гейт актуальности — из корня репозитория: `npm run tokens:build` (перегенерировать оба `tokens.css`) и `npm run tokens:check` (байт-сверка копий + сверка color-примитивов с `tailwindcss/theme.css`).

Прогон от 2026-09-16: `validate_tokens` — 6/6 файлов, 259 токенов (134 примитива + 29 semantic + 48 typography с машинным слоем интерлиньяжей + 34 spacing + 10 radius + 4 motion), 0 ошибок, 0 висячих алиасов. Контраст — все обязательные AA-пары проходят (ink.strong/body/muted, 4 feedback-пары, primary/ton/destructive текст-на-действии); `ink.muted` = 4.76:1 на белом и 4.55:1 на slate-50. Единственный FAIL официального скрипта — его обязательная пара `border.strong ≥ 3:1` (WCAG 1.4.11): slate-300 на slate-50 даёт 1.42:1, поэтому exit-код 1 у `validate_contrast` на этом слепке — ожидаемое поведение, а не регрессия. Это де-факто студии; примитивы не трогаем (см. Risks плана волны 1) — если когда-нибудь решим ужесточать, кандидат `border.strong` = slate-400/500, но это отдельное визуальное решение.

### Резолюция по `border.strong` и WCAG 1.4.11 (2026-09-16, закрыто анализом)

1.4.11 требует контраст ≥3:1 для границы, только когда она — единственный визуальный индикатор контрола. В ките контролы залиты (input `bg-slate-50` = surface.subtle, кнопки filled) и несут focus `ring-3 ring-ring/50` — граница никогда не единственный индикатор, поэтому FAIL kit-валидатора консервативнее требований WCAG. Значение `border.strong` = slate-300 не меняем (глобальная видимая дельта против де-факто). Пересматривать, только если появятся контролы без заливки, где граница — единственный индикатор; тогда для них точечно slate-400/500, а не смена токена. Полный разбор — `docs/plans/BACKLOG.md`, п.3.
