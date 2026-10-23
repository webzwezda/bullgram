# Changelog дизайн-токенов Bullgram

Формат — SemVer: **MAJOR** (изменено/удалено значение примитива, переименован или удалён токен — меняет визуал продукта) / **MINOR** (новый токен, рампа, semantic-пара — аддитивно) / **PATCH** (доки, описания, гейты — значения не трогает).

## [1.3.0] — 2026-10-23

### Changed
- baseline ratchet: рост в `userbot-v2/src/pages/bots/ProxyConnectPanel.jsx`
  (новый файл, +191) — осознанно. Это дословная копия карточек поднятия
  прокси со страницы `/proxies` (ProxyManagerPage), вставленная в инлайн-
  панель на `/userbot`; миграция классов в semantic-токены отложена до
  вынесения формы создания прокси в общий компонент (страница + панель),
  чтобы не расходить копии. План: docs/plans/2026-10-23-proxy-connect-panel.md

## [1.2.0] — 2026-10-22

### Changed (волна кита: hover у Button, BACKLOG §24)
- Канонический кит `components/ui/button.jsx` (байт-копии во всех шести аппах):
  - `default`: hover `[a]:hover:bg-primary/80` → `hover:bg-primary/80` — hover больше
    не скоупится на анкоры, настоящий `<button>` под курсором темнеет (раньше не
    реагировал вовсе; замечено на safe-mode ряду `/userbot`)
  - `outline`: light-hover `hover:bg-muted` → `hover:border-border-strong
    hover:bg-surface-subtle-strong hover:text-foreground` — видимый сигнал даёт
    потемнение бордера (slate-200 → slate-300, «кнопки-обводки» в описании токена) плюс
    заливка slate-100; `aria-expanded:*` и `dark:*` не тронуты
- baseline ratchet: без роста — из button.jsx удалён raw-класс `bg-muted`

## [1.1.0] — 2026-09-16

### Added (волна 6b)
- Эммит `--font-sans` / `--font-mono` (font.family из typography.json)

### Changed
- baseline ratchet: 5301 → 5298 (var()-стеки mono больше не считаются hardcoded font-family)

## [1.0.0] — 2026-09-16

Первый релиз единой дизайн-системы (волны 1–6).

### Added
- **Примитивы** (134): 12 палитр 50–950 (slate, indigo, amber, rose, emerald, blue, red, sky, violet, orange, purple, teal), значения байт-в-байт из Tailwind v4 `theme.css` + white/black
- **Семантика** (29): text.ink.{strong,body,muted,faint}, surface.{page,card,raised,subtle,subtle-strong}, border.{default,strong}, action.{primary,primary-hover,primary-text,ton,ton-hover,ton-text,destructive,destructive-text}, feedback.{success,warning,error,info} парами bg/text, component.money-zero, component.micro-label
- **Типографика**: font.family (Manrope / JetBrains Mono, целевые стеки), размерная шкала + машинный слой sizeLineHeight, веса, интерлиньяжи, трекинг
- **spacing** (базовый шаг 4px + шкала), **radius** (дефолтная шкала v4; per-app override остаются приложениям), **motion** (150/200/300ms, ease-out)
- Пайплайн: `npm run tokens:build` / `tokens:check` — байт-идентичные tokens.css в admin-v2 и site-v2, гейт нулевой дельты (132 значения = theme.css), гейт полноты (12×11), STALE-детект
- Гейты `npm run check:design`: tokens / contrast (известный FAIL border.strong задокументирован) / hardcodes-ratchet / axe / ui-sync (5 общих компонентов admin↔site)

### Правила продвижения
- Новый компонент в канонический кит (`components/ui/`) попадает при **≥2 реальных использованиях**; до этого — локальный класс в странице
- Новая палитра в коде = новая рампа в color.primitives.json (MAJOR-ветка не нужна, но коммит обязан обновить EXPECTED_RAMP_CHECKS в build.mjs и baseline)
- Смена значения примитива = MAJOR + запись здесь + прогон контраста + design-critic на деплой
