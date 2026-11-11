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
| Ключ шифрования бэкапов БД | сервер `/opt/backups/.dumpkey` + офлайн-копия у владельца (wiki `infrastructure/bullgram-backup-dumpkey.txt`); на NAS ключа НЕТ — /sata читается гостём через Samba |

## 3. Сервер (только на нём, в репо не хранится)

- **nginx**: `/etc/nginx/sites-enabled/bullgram.xyz`. Бэкапы: `/root/nginx-backups/`.
  Конфиг в репозиторий не выносится (решение владельца).
- **Алерт-скрипты** (`/opt/alerts/*.sh` — log-digest, disk-alert, proxy-probe,
  metrics-digest, tg-send): исходники в репо `ops/scripts/alerts/` (с 2026-11-11),
  на сервер накладываются руками: `cp /srv/bullgram/ops/scripts/alerts/*.sh
  /opt/alerts/ && chmod +x /opt/alerts/*.sh` (deploy-pull их не трогает).
  State-файлы дедупа/флапа живут в `/var/lib/` (`disk-alert.state*`,
  `proxy-probe.state*`, `proxy-probe.tg6flap`/`.tg6daily`).
- **pm2**: `backend/ecosystem.config.cjs` — из репо, релоад: `pm2 reload ecosystem.config.cjs --env production`
- **Прокси (3proxy)**: при загрузке сервера systemd-юнит
  `bullgram-managed-proxies.service` (`ops/systemd/`) сверяет состояние с Supabase,
  рендерит `/var/lib/bullgram/managed-proxies/3proxy.cfg`, возвращает IPv6 на интерфейс
  и поднимает 3proxy. С 2026-11-07: контейнер с `nofile=65535`, конфиг содержит
  `monitor` (hot-reload слотов без рестарта); hourly-таймер
  `bullgram-managed-proxies-reconcile.timer` — самовосстановление слушателей/IPv6
  с TG-алертом; probe-cron `/opt/alerts/proxy-probe.sh` (*/10) различает «слот
  мёртв» и «IPv6→Telegram флап». `bullrun-managed-3proxy` остановлен (конфликт
  портов двух проектов на host-network; откат `docker start`). Детали и грабли:
  wiki `infrastructure/managed-proxies-bullgram.md`. Юнит должен быть `enabled`. Ручной запуск:
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

## 6. Бэкапы БД (с 2026-11-07, волна 1 плана укрепления)

Две копии дампа Supabase (Postgres, контейнер `supabase-db`):

| Копия | Где | Формат | Ретеншн |
|---|---|---|---|
| Локальная | srv: `/backups/postgres/*.dump` | plaintext `pg_dump -Fc` | 14 суток |
| Off-site | ORICO NAS: `/sata/bullgram-backups/*.dump.enc` (в chroot: `/media/bullgram-backups/`) | aes-256-cbc + pbkdf2-600k поверх -Fc | 30 суток |

Цепочка: cron srv `0 4 * * *` (Asia/Vladivostok) → `/opt/backups/pg-dump.sh` (pg_dump → sanity-check ≥1MB → шифрование `openssl enc -aes-256-cbc -pbkdf2 -iter 600000` ключом `/opt/backups/.dumpkey` → `/opt/backups/publish/`, держит 3 свежих `.enc`) → cron NAS-chroot `30 18 * * *` UTC (= 04:30 +10) → `/opt/bullgram-backup/pull-backup.sh` (rsync выделенным restrict-ключом, лог `/var/log/bullgram-pull.log`, prune 30 суток). DMS-пинги обеих джобов уходят в **Uptime Kuma на home lab** (LXC 114 на pve: тишина >24ч = Telegram-алерт; детали wiki `infrastructure/uptime-kuma-pve.md`; healthchecks.io — отложенный резерв, строка закомментирована в pg-dump.sh).

Восстановление БД из NAS-копии:

```bash
# 1. расшифровать офлайн-ключом (на любой машине, openssl 1.1.1+)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in bullgram-YYYY-MM-DD_HHMM.dump.enc -out restored.dump \
  -pass file:/путь/к/bullgram-backup-dumpkey.txt
# 2. проверить читаемость и состав
pg_restore -l restored.dump | less
# 3. развернуть (ОСТОРОЖНО: --clean пересоздаёт объекты; перед боевым restore —
#    стоп трафика pm2 + консультация postgres-pro правил; впервые делаем на драйлле)
docker cp restored.dump supabase-db:/tmp/restored.dump
docker exec supabase-db pg_restore -U postgres -d postgres --clean --if-exists /tmp/restored.dump
```

Ежемесячный smoke — **автоматизирован** (2026-11-07, вместо календаря владельца):
cron srv `0 6 8 * *` (8-го числа, 06:00 +10) → `/opt/backups/smoke-restore.sh` —
берёт свежий `.enc`, расшифровывает офлайн-ключом, гоняет `pg_restore -l` в
контейнере, шлёт итог в Telegram («✅ … Бэкап-цепочка здорова» / «🔴 FAILED»).
В месяцах янв/апр/июл/окт сообщение напоминает о квартальном ПОЛНОМ драйлле
(человек) и записи в Drill log. Ретеншн лога: `/var/log/smoke-restore.log`.

### Drill log

| Дата | Что делали | Результат |
|---|---|---|
| 2026-11-07 | Приёмочный тест цепочки: pg-dump → .enc → ручной pull на NAS (111MB, 14с) → расшифровка офлайн-ключом на Mac → sha256 == plaintext-дампу → `pg_restore -l` (1728 TOC-записей) | OK |
| 2026-11-07 | Первый автоматический цикл без человека: cron 04:00 дамп+шифрование → cron NAS 04:30 pull (107MB, 14с); месячный smoke-restore введён (cron 8-го числа), тестовый прогон: 111MB, TOC 16685 | OK |
| (пусто) | Полный restore в чистую БД (квартальный драйлл) | — |
