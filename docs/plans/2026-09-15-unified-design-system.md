# Единая дизайн-система Bullgram: admin-v2 → site-v2

Дата: 2026-09-15. Статус: план прошёл второй проход — аудит на достижимость цели (см. 5.6), найденные дыры закрыты; реализация ждёт «действуй».

## 1. Арсенал

### Скиллы (user-scope, `~/.zcode/skills/`)

Генерация:
- `brandkit` — полный бренд-фундамент: DTCG-токены (primitive → semantic → component), light+dark, единый theme.css, WCAG-верификация
- `design-tokens` — авторство/аудит DTCG-токенов 3 тиров
- `token-build` — пайплайн DTCG → Tailwind v4 `@theme` / CSS vars
- `design-component` — спека компонента: анатомия, варианты, 8 состояний, маппинг токенов, a11y
- `design-code` — код React+Tailwind строго по токенам (запрет хардкода, 8 состояний, один примитив на атом)

Контроль:
- `design-qa` — гейты: validate_tokens / validate_contrast / lint_hardcodes + axe + measure_render (контраст реального рендера) + чеклист ручной a11y
- `a11y-audit` — точечный WCAG-аудит
- `design-review` — эвристика Нильсена (дублирует design-critic — используем критика)

Миграция/направление:
- `migrate-design-system` — кроссволк shadcn/ui ↔ наши токены
- `apply-aesthetic` / `redesign` — смена визуального направления; вне скоупа v1 (унификация де-факто, не ребрендинг)

Кит-ассеты (проверено `ls` 2026-09-15): `~/.zcode/ux-ui-agent-skills/scripts/` — `validate_tokens.py`, `validate_contrast.py`, `lint_hardcodes.py`, `measure_render.mjs`, `axe_audit.mjs`, `build_tokens.mjs`, `taste_audit.mjs` и др.

### Субагенты (роли)
- `Explore` (context-manager фрейм) — разведка по волнам
- `general-purpose` с frontend-developer фреймом — срезы реализации
- `design-critic` — вкусовой вердикт ПОСЛЕ код-ревью и деплоя (стоячее правило)
- `code-reviewer` — клоз-аут диффов
- `test-engineer` — если гейты оформляем как тесты в package.json
- `deployment-engineer` — предпуш-ревью

## 2. Состояние репо (аудит 2026-09-15, две Explore-разведки)

### admin-v2
- Tailwind v4.2.2 CSS-first; shadcn radix-nova кит: 14 вокендоренных компонентов (button/badge — cva), card на `ring-1`; **table.jsx нет** (8+ самописных таблиц), tabs.jsx самописный вне системы вариантов
- Токенный слой мёртв: **~3506 сырых палитр-классов vs 1 семантический**; DESIGN.md канонизирует slate-палитры + indigo-градиентные иконки
- `app.css`: 2439 строк legacy BEM (`stat-card`/`action-card`/`nav`), `--brand:#0f766e`, ссылки на **НЕзагруженные** Manrope и JetBrains Mono (работают системные фолбэки)
- Шрифт: Geist Variable (`@fontsource-variable/geist`); dark mode декларирован в CSS, фактически мёртв (нет ThemeProvider, sonner хардкодит light)
- Правило нулей и 11px slate-500 микро-лейблы кодифицированы в DESIGN.md и `docs/plans/08-customers-screen.md`

### site-v2
- Manrope self-hosted (woff2 cyr+latin, unicode-range сплит); `@theme`: primary teal `#0f766e`, тёплый фон `#f7f7f2`
- **377 сырых палитр vs 0 семантики** вне card.jsx; акцент кнопок дрейфует: blue (Home/AccessRequest) → indigo (Pay/CreateInvoice) → sky (TON-checkout)
- shadcn-инфра готова (components.json, radix-ui/cva в deps), вокендорен только card.jsx; button/input/badge примитивов нет
- `site.css`: legacy, грузится **асинхронно** динамическим импортом в main.jsx (гонка с Tailwind)
- React 18 + RRD 6 (admin: React 19 + RRD 7)

### Общее
- Workspace нет: стек дублируется руками, общий код (card.jsx, cn()) уже разъехался
- Де-факто бренд в legacy-слоях обоих приложений одинаков: `--brand:#0f766e` — но кнопки в обоих рисуются indigo/blue/sky, а не teal. Заявленный @theme-teal мёртв в обоих.

## 3. Стратегия

Ядро: **один DTCG-источник токенов → сгенерированный @theme-CSS раздаётся в оба приложения.** Компонентный код общим пакетом НЕ делаем (React 18/19, RRD 6/7 — мажорный дрейф); общими остаются токены, сгенерированный CSS и правила.

Ключевой приём — **алиасинг палитр**: в `@theme` обоих приложений значения `--color-slate-*`, `--color-indigo-*`, `--color-emerald-*` и т.д. генерируются из DTCG-примитивов. Тогда ~3900 существующих сырых классов страниц становятся токен-дривн **без единого диффа в pages**. Новые и мигрируемые места постепенно переводятся на семантические утилиты (`bg-surface-card`, `text-ink-muted`, `bg-action-primary`).

## 4. Дефолтные решения (меняются одним значением токена — в этом смысл токенов)
1. **Акцент** — де-факто indigo-600/sky (рекомендация: ноль визуальных изменений). Переход на teal `#0f766e` — это ребрендинг, отдельное решение через apply-aesthetic.
2. **Шрифт** — Manrope в оба приложения (уже self-hosted в site-v2 и уже упомянута в app.css админки; грузим тем же сплитом cyr+latin).
3. **Dark mode** — вне скоупа v1; токены структурируем dark-ready, слой `.dark` не включаем.

## 5. Оркестрационный план

Главный сеанс — оркестратор: декомпозиция, ТЗ воркерам, приёмка диффов, интеграция, коммиты/пуш, мониторинг CI, рантайм-проверки, финальный синтез. Детальную работу — вниз, воркерам.

### 5.1 Распределение ролей

Главный сеанс (без делегирования):
- ТЗ воркерам: точный скоуп, разрешённые файлы, что валидировать, формат возврата
- приёмка: читаю каждый дифф, ключевые проверки запускаю сам (не верю отчётам на слово)
- коммиты (Conventional Commits), push-to-main, `gh run watch`
- рантайм-проверки на проде в реальном Chrome — browser-use **main-agent-only**, сабагентам не делегируется
- запуск design-critic (строго после код-ревью и деплоя), code-reviewer, deployment-engineer
- итоговый синтез и отчёт пользователю

Делегирование (все воркеры: запрет dev-серверов, запрет деплоя, возврат в формате Scope/Changed/Validated/Risks/Needs):
- волны 1, 3, 4a, 6 — `general-purpose` с frontend-developer фреймом
- волна 2 — `general-purpose` скриптовый срез
- волна 4b — `general-purpose` с documentation-engineer фреймом
- волна 5 — `general-purpose` + `test-engineer`
- каждый волной с кодом — `code-reviewer`; видимые правки — `design-critic`

Правило ТЗ: у воркеров нет Skill tool — правила скиллов (design-tokens, design-code, migrate-design-system) передаю текстом внутри ТЗ; kit-скрипты воркер запускает из `~/.zcode/ux-ui-agent-skills/scripts/`.

### 5.2 Волны

**Волна 1 — DTCG-токены** (design/tokens/*.json + design/README.md, приложений не трогаем)
- Правила в ТЗ: примитивы = значения де-факто палитр (slate/indigo/sky/emerald/amber/red, teal — резерв бренда), ровно как в текущем Tailwind; semantic = студийные правила: `text-ink-{strong,body,muted,faint}` (900/700/500/400), `surface.{page,card,raised}`, `border.{default,strong}`, `action.{primary,primary-hover,destructive}`, `feedback.{success,warning,error,info}` парами фон/текст (red-50/700, amber-50/700, emerald≥700), `micro-label` (11px, tracking-widest, slate-500), `money-zero` (slate-900); typography (Manrope, шкала), radius, spacing 4px, motion
- Валидация воркера: `validate_tokens.py` + `validate_contrast.py` — реальные выводы скриптов в отчёте
- Приёмка: я перегоняю оба скрипта, читаю дифф

**Волна 2 — Пайплайн**
- Скоуп: `design/build.mjs` (адаптация kit `build_tokens.mjs`), root package.json: `tokens:build` (эммитит `admin-v2/src/styles/tokens.css` + `site-v2/src/styles/tokens.css` в виде `@theme`-совместимого CSS) и `tokens:check` (fail на stale) + скрипт сверки палитровых значений с Tailwind defaults
- Гейт: regenerate → no diff; сверка значений показывает 0 расхождений

**Волна 3 — admin-v2: подключение токенов, алиасинг палитр** (нулевая визуальная дельта)
- Скоуп: только `admin-v2/src/styles/` — импорт tokens.css, `--color-slate-*` и остальные палитры указывают на примитивы; pages не трогаем
- Жёсткий гейт до деплоя: сгенерированные значения == значениям Tailwind из `node_modules/tailwindcss/theme.css` → пиксельной дельты быть не может
- Перед деплоем: baseline-скриншоты 3–4 ключевых экранов прода (в /tmp, вне git)
- После деплоя: рантайм-сверка тех же экранов с baseline (сам, browser-use); design-critic не нужен — изменения нет

**Волна 4 — admin-v2: компонентный слой, шрифт, app.css**
- 4a (frontend-developer), порядок шагов важен:
  1. Рантайм-проверка: какой шрифт админка рендерит СЕЙЧАС. Каскад неочевиден — Geist загружен через @fontsource, но app.css задаёт `font-family` на `:root` из unlayered-слоя (побеждает layered), и ссылается на незагруженный Manrope; вероятен системный фолбэк вместо Geist
  2. Manrope в admin-v2: копия `manrope-{cyrillic,latin}.woff2` в public + тот же @font-face сплит; `--font-sans` отдаёт tokens.css; ВСЕ шрифтовые ссылки (и @theme, и app.css) идут через `var(--font-sans)`; app.css перестаёт задавать font-family на `:root` — один источник шрифта, каскадная война закончена
  3. `@fontsource-variable/geist` снимается с зависимости
  4. tabs.jsx → cva-стиль кита
  5. hex в app.css → `var(--token)` ТОЛЬКО при байт-в-байт равенстве значений; расходящиеся legacy-значения токенизируем как legacy-алиасы с их текущими значениями (унификация значений app.css — отдельное осознанное решение, не v1); BEM-структуру не переписываем
- 4b (documentation-engineer, параллельно — файлы не пересекаются): DESIGN.md переписан с «канона slate-палитр» на семантику токенов
- Вне скоупа v1: примитив table.jsx и миграция 8+ самописных таблиц — отдельная задача, когда дойдёт до таблиц
- Гейты: билд; деплой; рантайм; **design-critic обязателен** — смена шрифта меняет вид и метрики текста
- Риск переполнений из-за другой метрики шрифта: при массовых поломках — откат шрифта отдельным решением, остальное остаётся

**Волна 5 — Гейты качества**
- Скоуп: root `check:design` = validate_tokens + validate_contrast + lint_hardcodes; measure_render-harness ключевых студийных пар; axe на dialog-harness; опционально step в CI
- lint_hardcodes по всему src даст ~3900 находок → ворота, которые никогда не открываются. Схема ratchet: baseline-снапшот текущего числа находок (`design/lint-baseline.json`), гейт падает только при РОСТЕ; снижение фиксируем осознанным обновлением baseline по мере миграции на семантику
- Red-green: намеренно ломаем пару в тестовом примере → гейт ловит → чистим за собой; отдельно проверяем, что ratchet ловит добавление нового raw-класса
- Гейт: `check:design` зелёный на чистом дереве

**Волна 6 — Перенос на site-v2**
- Скоуп: tokens.css в site-v2; вокендорить button/input/badge через существующий components.json; семантика действий: **два именованных действия вместо трёх случайных цветов** — настоящий дрейф (blue-600 лендинга vs indigo-600 Pay/CreateInvoice) сливается в `action.primary` (indigo); sky-700 TON-checkout — это утверждённое владельцем решение аудита site-v2, а не дрейф: токенизируем как `action.ton` и НЕ меняем визуально; прибить `site.css`: перед удалением grep потребителей `var(--surface)` и прочих, нужное слить в tailwind.css, асинхронный импорт из main.jsx убрать
- `check:ui-sync`: hash-сверка общих компонентных файлов (cn, card, button, badge, input, dialog) между приложениями; канон — admin-v2, site-v2 копирует; расхождение ломает гейт
- Гейты: билд; check:ui-sync; деплой; рантайм по всем 5 маршрутам (по одной странице за раз); **design-critic обязателен** — первая видимая правка сайта
- Тонкость: не смешивать с правками money-флоу логики

**Волна 7 — Закрытие**
- governance: CHANGELOG токенов, SemVer-правила в design/README.md, правило «компонент продвигается при ≥2 использованиях»
- финальный code-reviewer + deployment-engineer предпуш; раздел «Ревью» плана; коммит доков

### 5.3 Definition of Done волны
1. Локальные гейты волны зелёные — я запускаю сам
2. code-reviewer по диффу волны (волны 1–6)
3. push-to-main → `gh run watch` зелёный
4. Рантайм на проде в реальном Chrome (я, browser-use; по одной странице за раз)
5. Видимая правка → design-critic ACCEPT (строго после п. 1–4)
6. Conventional Commit, пункт плана отмечен

### 5.4 Риски и стоп-правила
- kit-скрипты рассчитаны на структуру кита → правила передаю текстом в ТЗ, скрипты гоняем из каталога кита
- алиасинг может незаметно сменить значения → гейт «значения == Tailwind defaults» до деплоя; откат `git revert`
- app.css хрупкий (2439 строк, unlayered) → только точечные правки, BEM не переписываем в v1
- Manrope в админке меняет ширину текста → возможны переполнения; критик + рантайм обязательны
- action-цвет site-v2 — видимая правка → изолированная волна, лёгкий откат
- React 18/19, RRD 6/7 → общий код компонентов не пакуем; общие только токены + сгенерированный CSS
- стоп-правило: что-то идёт вбок → стоп, перепланирование прямо в этом файле

### 5.5 Критерий приёмки цели (проверяется в волне 7, до закрытия)
1. **Тест единства**: временно меняем одно значение примитива → `tokens:build` → tokens.css ОБОИХ приложений изменились, оба билда зелёные → revert. Единственный прямой доказатель слова «единая»
2. Чек-лист: один DTCG-источник; оба приложения рендерят палитры из tokens.css; один шрифт в обоих; у действий две именованные семантики (primary/ton) вместо случайных цветов; `check:design` + `check:ui-sync` ловят регресс; CHANGELOG и SemVer-правила на месте

### 5.6 Аудит плана (второй проход, 2026-09-15): 6 дыр → закрыты
1. Не было приёмочного критерия цели → добавлен 5.5 (тест единства)
2. Волна 4 не унифицировала бы шрифт: каскад app.css(:root, unlayered) против @layer base мог дать два шрифта на разных слоях → 4a начинается с рантайм-проверки фактического шрифта, затем один источник `var(--font-sans)` и снос каскадной войны
3. lint-гейт был бы красным с первого дня (~3900 находок) → ratchet-схема с baseline
4. «Один action-цвет» отменил бы утверждённое sky-700 TON-решение → две именованные семантики: action.primary (indigo, туда сливаем реальный дрейф blue/indigo) и action.ton (sky, не меняем)
5. app.css hex→var мог тихо сменить визуал (значения расходятся с токенами) → правило байт-в-байт равенства, расходящиеся — legacy-алиасы
6. Компонентные копии уже разъехались (card.jsx, cn) и разъехались бы снова → check:ui-sync + канон admin-v2

Процесс (стоит всегда): деплой только push-to-main; браузерные проверки только на проде в реальном Chrome; modern-web-guidance перед любым CSS-кодом; критик только после код-ревью и деплоя.

## 6. Ревью
(заполняется после реализации)
