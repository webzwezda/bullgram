# Операционная карта Bullgram — что где живёт, как поднимается, кто кричит

Аудитория: агент/разработчик на дежурстве. Это карта рантайма: где что
работает, что поднимается после перезагрузки автоматически, как устроено
самовосстановление и наблюдаемость. Диагностика по логам —
[`runbooks.md`](runbooks.md); восстановление машины — `ops/RESTORE.md`;
детали прокси-системы — wiki `infrastructure/managed-proxies-bullgram.md`;
мониторинг — wiki `infrastructure/uptime-kuma-pve.md`; NAS-бэкапы — wiki
`infrastructure/orico-nas-cd3510.md`. Инфраструктурные креды — в вики, не здесь.

## 1. Карта рантайма

### VDS `srv` = 64.188.70.180 (Senko DE-EP-2 #248854, TZ Asia/Vladivostok = UTC+10)

| Что | Где | Как поднято |
|---|---|---|
| Backend API | PM2 `bullgram-tg-backend`, :3000 (наружу только через nginx) | `pm2-root` enabled + `pm2 save` (dump после каждого деплоя) |
| Деплой | push в main → GH Actions → `scripts/deploy-pull.sh` (тесты 29 сьютов → build → pm2 reload → слоёный smoke → автороллбек на PREV_HEAD → semver-тег → GitHub Release) | — |
| nginx | `/etc/nginx/sites-enabled/*` (конфиг НЕ в репо, бэкапы `/root/nginx-backups/`) | systemd |
| Supabase | docker-стек `/home/n8nuser/supabase/docker` | `restart=unless-stopped`; published-порты kong/pooler/analytics — 127.0.0.1 (волна 5.1, бэкап compose `.bak.20261107-perimeter`); nginx ходит в kong через 127.0.0.1:8000 |
| n8n | контейнер `n8n-n8n-1`, :5678 (127.0.0.1 + tailnet-IP), UI через `https://prsng.ru` | `unless-stopped` |
| Managed-прокси юзерботов | контейнер `bullgram-managed-3proxy`, host-network, 218 слотов (порты 21115-21345 на 193.23.197.169 — доп. IPv4 нашего VPS; 200 — свободный платформенный пул), выход per-slot IPv6 | `unless-stopped` + юнит `bullgram-managed-proxies` (enabled) |
| Tailscale | `vds-prsng` = 100.118.222.13 | tailscaled enabled |
| 3x-ui | :2053 — личная панель владельца (осознанно наружу) | — |
| Кроны сервера | `/opt/backups/*` (дамп, smoke-restore), `/opt/alerts/*` (диск, дайджесты, proxy-probe) — root crontab, см. §3 | cron |

Ключевой факт: `193.23.197.169` — дополнительный IPv4 ЭТОГО VPS (не внешний
провайдер). Остановка `bullrun-managed-3proxy` (братский проект на том же
хосте, конфликт портов) 2026-11-07 — осознанная, откат `docker start`.

### Home lab (перезагрузка VDS на него не влияет)

| Что | Где | Как поднято |
|---|---|---|
| Uptime Kuma (мониторинг) | LXC 114 `kuma` на pve, 192.168.10.205:3001 (UI, креды в вики) | LXC `onboot` + контейнер `unless-stopped` |
| gost-форвардер для пушей | LXC 103 `ru-exit`: `100.127.7.20:3004 → 192.168.10.205:3001` | systemd `gost-kuma-forward`, LXC `onboot` |
| ORICO NAS (off-site бэкапы) | 192.168.10.124, chroot Debian | `start_debian.sh` поднимает sshd/cron; pull-джоба в chroot-кроне 18:30 UTC |

## 2. Автостарт после перезагрузки VDS (проверено аудитом 2026-11-07)

Всё в `enabled`: `pm2-root`, `docker`, `tailscaled`, `bullgram-managed-proxies`,
`bullgram-managed-proxies-reconcile.timer` (Persistent=true — догоняет
пропущенный прогон). Docker-контейнеры — `unless-stopped`. LXC kuma/ru-exit —
`onboot`. NAS — независим; его собственный ребут закрывает `start_debian.sh`.

Транзиентное окно 1-3 мин: pm2/docker/прокси-юнит стартуют параллельно; если
3proxy поднялся раньше IPv6-адресов слотов — reconcile-таймер пересоздаёт
контейнер в течение часа, юнит — при своём старте. `ProxyBootSweep` (60с после
бута backend) с 2026-11-07 консервативен: не переворачивает `is_working`.
Kuma пошлёт алерты «down» на время самого ребута — это норма. Если что-то не
поднялось — probe-cron крикнет в Telegram в течение 10 минут (см. §4).

## 3. Кроны сервера (root crontab, TZ +10)

| Расписание | Скрипт | Что делает |
|---|---|---|
| `0 4 * * *` | `/opt/backups/pg-dump.sh` | дамп БД → шифрование → publish для NAS; Kuma-push DMS |
| `*/10 * * * *` | `/opt/alerts/proxy-probe.sh` | слот 21143 жив? IPv6→Telegram флап? (алерты 🔴/🟡, dedup 1ч) |
| `0 * * * *` | `/opt/alerts/disk-alert.sh` | диск 80/90% → Telegram (dedup 6ч) |
| `0 */4 * * *` | `/opt/alerts/log-digest.sh` | сводка error/warn из JSONL (фильтр n8n-шума) + Kuma-push |
| `0 9 * * *` | `/opt/alerts/metrics-digest.sh` | диск/мем/load/БД/pm2 одной строкой + Kuma-push |
| `0 6 8 * *` | `/opt/backups/smoke-restore.sh` | месячный smoke бэкапа (расшифровка + pg_restore -l → Telegram); янв/апр/июл/окт — напоминает о квартальном драйлле |

Креды всех алертов — `TG_BOT_TOKEN`/`TG_ADMIN_CHAT_ID` из `backend/.env`
(скрипты их не хранят). DMS-пинги Kuma вшиты в pg-dump/nas-pull/log-digest/
metrics («тишина = сбой»).

## 4. Слои наблюдаемости и самовосстановления

1. **Uptime Kuma (home lab)** — 7 мониторов: витрина/health-API//shop (5 мин) +
   4 DMS-push (pg-dump 24ч, nas-pull 24ч, log-digest 4ч, metrics 24ч). Алерты
   в Telegram. Тишина чата дайджестов = скрипт сломан.
2. **Лог-дайджест (4ч)** — топ error/warn, фильтр n8n-шума; «✅ тихие» тоже шлёт.
3. **ProxyBootSweep + анти-флап** — свип только подтверждает живых прокси
   (не переворачивает `is_working`); инфра-карантин лота — минимум 2 подряд
   неудачи; Telegram-авторитетные (restricted/frozen) — сразу.
4. **Reconcile managed-прокси (hourly timer + при деплое)** — сверяет
   state/DB/слушателей/IPv6: пересоздаёт контейнер и адреса, алерт на каждый
   self-heal. `monitor` в 3proxy.cfg — hot-reload слотов без рестарта.
5. **Деплой-смок + автороллбек** — 5 слоёв (boot/api/nginx/pm2/err-log 90с);
   провал → tg-алерт → откат на PREV_HEAD → повторный деплой
   (`DEPLOY_NO_ROLLBACK=1` отключает; миграционные деплои — только с ним).
6. **Диск-алерт** — 80/90% с дедупом 6ч.

## 5. Известные системные особенности (не баги)

- **RLS-пилот**: `proxies`, `userbot_restore_sources` под owner_isolation —
  service-ключ backend НЕ задет (bypassrls), anon/authenticated видят только
  свои строки. Расширение на новые таблицы — security-ritual §5.

- **IPv6→Telegram DC флапает** минутными окнами (сигнатура №5 в runbook) —
  все IPv6-слоты прокси «умирают» разом на окно; анти-флап держит витрину,
  probe-cron фиксирует факт.
- **`proxies.is_working=false` = короткое замыкание** health-check (проверка
  не пытается соединяться). Отравленный флаг лечится только осознанно
  (`is_working=true` + причина).
- **3proxy кэширует IPv6-адреса при старте** — новые адреса требуют рестарта
  контейнера (reconcile это делает сам).
- Home lab без SLA: нет света/интернета дома — алертов Kuma нет (бэкапы на
  VDS продолжают идти); осознанный трейд-офф self-hosted мониторинга.
- Tailscale key expiry `vds-prsng`: 2027-01-28 (после — переавторизация,
  DMS-пуши напомнят).

## 6. Порядок действий при инциденте

1. Открыть [`runbooks.md`](runbooks.md) — сигнатуры и реакции.
2. Логи: `ssh srv` → команды из runbook §«Команды».
3. Прокси-слоты: `docs`-нет — wiki `infrastructure/managed-proxies-bullgram.md`
   (RCA, грабли, reconciliation).
4. Полная потеря машины: `ops/RESTORE.md` (§6 — бэкапы, drill log).
5. После инцидента — запись в `docs/plans/LESSONS.md`.
