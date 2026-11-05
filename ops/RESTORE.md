# Restore Runbook (восстановление после утери машины)

Репозиторий — полный бэкап исходного кода. Секреты и серверные артефакты в нём
намеренно не хранятся. Здесь — что и где брать при восстановлении.

## 1. Код

Всё в этом репозитории: `backend/`, `admin-v2/`, `site-v2/`, `docs-site/`,
`scripts/`, `ops/`, `docs/`. Достаточно `git clone`.

```bash
git clone git@github.com:webzwezda/bullgram.git
cd bullgram
npm --prefix backend install
npm --prefix admin-v2 install
npm --prefix site-v2 install
npm --prefix docs-site install
```

## 2. Секреты (в репо НЕТ, копируются вручную)

| Файл / ресурс | Где взять |
|---|---|
| `backend/.env` | сервер: `/srv/bullgram/backend/.env`, или менеджер паролей |
| `.mcp.json` (Supabase MCP, Bullgram MCP токен) | менеджер паролей / старая машина |
| SSH-ключ к прод-серверу (`srv` = `root@64.188.70.180`) | старая машина `~/.ssh/`, либо добавить новый ключ на сервер |

## 3. Сервер (только на нём, в репо не хранится)

- **nginx**: `/etc/nginx/sites-enabled/bullgram.xyz`. Бэкапы: `/root/nginx-backups/`.
  Конфиг в репозиторий не выносится (решение владельца).
- **pm2**: `backend/ecosystem.config.cjs` — из репо, релоад: `pm2 reload ecosystem.config.cjs --env production`
- **Прокси (3proxy)**: при загрузке сервера systemd-юнит
  `bullgram-managed-proxies.service` (`ops/systemd/`) сверяет состояние с Supabase,
  рендерит `/var/lib/bullgram/managed-proxies/3proxy.cfg`, возвращает IPv6 на интерфейс
  и поднимает 3proxy. Юнит должен быть `enabled`. Ручной запуск:
  `cd /srv/bullgram/backend && node scripts/restore-managed-proxies.mjs`
  Бэкенд в pm2 дополнительно следит за процессом 3proxy в рантайме
  (два процесса 3proxy с reuseport — норма после пересозданий).
- **Статика**: `/var/www/bullgram-site-v2`, `/var/www/bullgram-admin-v2`,
  `/var/www/bullgram-userbot-v2`, `/var/www/bullgram-bots-v2`, `/var/www/bullgram-treasury-v2`, `/var/www/bullgram-profile-v2` — симлинки на `dist`
  из чекаута `/srv/bullgram`; собираются `scripts/deploy-pull.sh`. `/userbot/`
  (приложение «Юзербот»), `/bots/` (приложение «Боты»), `/treasury/` (Казна), `/profile/` (приложение «Профиль», вынесено из userbot-v2 2026-09-28) и `/paywall/`
  (paywall-кабина, папка admin-v2; URL переименован из `/app` 2026-09-27, nginx
  отдаёт 301 `/app/* → /paywall/*`) — nginx-location'ы с SPA-fallback; алиас
  `/userbot/telegram-web/` указывает на тот же `/var/www/bullgram-telegram-web`,
  что и легаси-алиас `/app/telegram-web/`. `userbot-v2/` — не путать с `userbot-web/`
  (вендорный telegram-tt для Telegram Web).
  Блог (`blog-site/`) собирается туда же в `dist/blog`, отдаётся на `/blog/`
  (nginx-блок по образцу `/docs`)
- **Архивы**: `/var/www/_archive/` (бывшие блог/курсы), `/root/nginx-backups/`
- **Логи бэкенда**: JSONL (pino) → `/srv/bullgram/backend/logs/app.out.jsonl`
  (stdout, уровни info/warn/error) и `app.err.jsonl` (stderr). Пишет сам процесс,
  файлы ведёт pm2; ротация — модуль `pm2-logrotate` (10MB × 14, gzip,
  ежедневно, `pm2 conf pm2-logrotate`). Арочная история до перехода на JSONL
  (2026-11-06): `logs/archive/*.pre-jsonl.log.gz`.
  Чтение: `tail -f /srv/bullgram/backend/logs/app.out.jsonl | jq 'select(.level=="error")'`;
  по арендатору — `jq 'select(.owner_id=="…")'`; по запросу — `jq 'select(.reqId=="…")'`.
  Успешные HTTP-запросы (<400) не логируются. Секреты (token/session/password/)
  цензурируются в `backend/utils/logger.js`; домен-аудит — в БД (`telegram_error_events`,
  `billing_events`, `mcp_tool_log` и др.), не в файлах. Детали и план миграции
  console.* — `docs/plans/2026-11-05-logging-research.md`.
  После пересоздания машины: `pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 10M && pm2 set pm2-logrotate:retain 14 && pm2 set pm2-logrotate:compress true && pm2 set pm2-logrotate:rotateInterval '0 0 * * *'`

## 4. Локальное окружение (опционально, для Supabase MCP)

- Туннель: `ops/scripts/ensure-mcp-tunnel.sh` (127.0.0.1:8080 → Kong, 5432 → Postgres)
- LaunchAgent: `com.webzwezda.supabase-mcp-tunnel` в `~/Library/LaunchAgents/`

## 5. Проверка после восстановления

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://bullgram.xyz/            # 200
curl -s -o /dev/null -w "%{http_code}\n" https://bullgram.xyz/docs/       # 200
curl -s https://bullgram.xyz/api/external/v1/health                       # JSON
```

Деплой: `git push` в `main` → GitHub Actions → `scripts/deploy-pull.sh`.
