# Contributing to BullRun

Спасибо, что хочешь вложиться в BullRun. Проект — под AGPL-3.0, и любой код, попадающий в `main`, становится частью copyleft-релиза.

## Перед стартом

- Прочитай `README.md` для общего контекста и `CLAUDE.md` для рабочих правил.
- Backend — ESM, plain JavaScript (не TypeScript).
- Node.js `22.22.0`, npm `10.x` (см. `.nvmrc`).
- Userbot-автоматизация — `manual-by-default`. Любое новое risky-действие за фича-флагом (см. `USERBOT_*_ENABLED` в `backend/.env.example`).

## Подъём локально

```bash
git clone https://github.com/webzwezda/bullrun.git
cd bullrun
npm run install:active
cp backend/.env.example backend/.env
# заполнить SUPABASE_URL, SUPABASE_SERVICE_KEY, ENCRYPTION_KEY, TG_API_ID, TG_API_HASH
```

Dev-запуск:

```bash
cd backend && node server.js
cd admin-v2 && npm run dev
cd site-v2 && npm run dev
```

Полноценный локальный запуск с реальными Telegram-сессиями требует рабочего Supabase-инстанса и валидных `TG_API_ID` / `TG_API_HASH`. Для UI-only работы достаточно собрать фронты:

```bash
npm run build:v2
```

## Стиль

### Backend

- ESM (`import`/`export`), `package.json` с `"type": "module"`
- kebab-case имена файлов: `official-bot.routes.js`, `auto-kick.job.js`
- 2-space indent, без trailing whitespace
- Ранние `return` для валидации, без глубокой вложенности
- Маленькие модули, descriptive имена функций
- GramJS userbot lifecycle строго: init → `_updateLoop = async () => {}` → `connect` → execute → `disconnect` in `finally`

### Frontend (admin-v2 и site-v2)

- React функциональные компоненты + hooks
- Tailwind v4, shadcn/ui — не переписывать существующий UI «под библиотеку»
- Имена страниц в `src/pages/` PascalCase (`UserbotCenterPage.jsx`)

### Коммиты

Conventional Commits, короткое описание, часто на русском:

```
feat: ...
fix: ...
refactor: ...
chore: ...
docs: ...
test: ...
```

## PR-процесс

1. Форкни репо или работай в ветке.
2. Подними локально, убедись что `npm run build:v2` зелёный.
3. Открой PR в `main` с описанием:
   - что меняется и почему
   - какие surface'ы затронуты (backend / admin-v2 / site-v2 / userbot-web)
   - как проверял
4. В PR-описании добавь строку:
   ```
   I agree my contribution is licensed under AGPL-3.0.
   ```
   Это заменяет CLA — отдельной подписки не нужно.

## Чего не делать

- Не реинтродьюсить `/admin` (legacy, 410 Gone).
- Не возвращать seller-tier (только `trial`/`normal`/`pro`).
- Не добавлять фиатный биллинг (Robokassa, bank transfer, ИНН/самозанятость) — платформа crypto-only.
- Не вводить авто-userbot-сценарии по умолчанию.
- Не коммитить `.env`, `.session`-файлы, `tdata/`, `PROD_SSH_KEY` или любые боевые credentials.

## Code review

PR смотрит мейнтейнер. Ожидаемый цикл — 1–3 дня. Если change большой, лучше сначала открыть issue/дискуссию.

## Литература внутри репо

- `CLAUDE.md` — рабочие правила для AI-агентов (и людей тоже)
- `AGENTS.md` — контракт для subagents
- `backend/README.md` — backend-детали
- `docs/autopost_design_spec.md` — design spec автопостера
- `SECURITY.md` — куда слать security-баги
