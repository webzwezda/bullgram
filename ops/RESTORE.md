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
- **Статика**: `/var/www/bullgram-site-v2` и `/var/www/bullgram-admin-v2` — симлинки
  на `dist` из чекаута `/srv/bullgram`; собираются `scripts/deploy-pull.sh`.
  Блог (`blog-site/`) собирается туда же в `dist/blog`, отдаётся на `/blog/`
  (nginx-блок по образцу `/docs`)
- **Архивы**: `/var/www/_archive/` (бывшие блог/курсы), `/root/nginx-backups/`

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
