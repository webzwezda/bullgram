# Security Ritual — квартальный чеклист

Квартальная процедура безопасности Bullgram (волна 2, п. 2.7; источник —
исследование в.16). Напоминание приходит внутри месячного smoke-restore в
январе/апреле/июле/октябре (`/opt/backups/smoke-restore.sh` на srv шлёт
«📅 Квартал: сделай полный драйлл…» — в тот же месяц пройди и этот чеклист).

Запуск ритуала: агент проходит пункты по очереди, результаты — короткой
таблицей в ответе владельцу; найденное — в `docs/plans/BACKLOG.md` с
owner/trigger. Пункт считается пройденным, когда показано фактическое
состояние, а не «сходу ок».

## 1. Инвентарь секретов

- Перечислить все внешние креды: `backend/.env` (TG_BOT_TOKEN, TG_API_HASH,
  SUPABASE_* ключи, RESEND_API_KEY, TON-ключи), NAS-ключи (`/root/.backup-ssh`,
  nasbackup authorized_keys на srv), ключ шифрования бэкапов
  (`/opt/backups/.dumpkey` + офлайн-копия владельца), Tailscale-ноды,
  GitHub-токены (`gh auth status`), прокси-креды в БД.
- Для каждого: где живёт, когда менялся последний раз, что будет при утечке.
- Кред, который нельзя найти в инвентаре — либо найти, либо пересоздать.

## 2. Утечки (gitleaks)

```bash
brew install gitleaks   # на Mac
cd bullgram && gitleaks detect --source . --verbose
gitleaks detect --source . --log-opts="--since=3 months" --verbose  # недавние коммиты
```

Находка → ротация скомпрометированного секрета НЕМЕДЛЕННО, потом разбор.

## 3. Ротация (цель — 90 дней)

Проверить возраст (по инвентарю из п.1) и ротировать то, что старше 90 дней
или разделяется с внешними подрядчиками. Минимум для проверки:

- `TG_BOT_TOKEN` платформенного бота — ротация через BotFather (/revoke)
- `SUPABASE_SERVICE_ROLE_KEY` — через Supabase (Service Role Keys → rotate)
- `RESEND_API_KEY` — в дашборде Resend
- ключ NAS→VDS (`/root/.backup-ssh/id_ed25519` на NAS + authorized_keys на srv)
- `.dumpkey` — ротация означает: сгенерировать новый, перешифровать publish,
  отдать владельцу новую офлайн-копию

## 4. Доступы

- GitHub: коллабораторы репо (`gh api repos/webzwezda/bullgram/collaborators`),
  активные сессии/токены, включён ли 2FA у владельца.
- VDS `srv`: `authorized_keys` root — только знакомые ключи; `passwd -S root`.
- NAS: пароли хост/chroot из вики, gost-креды ru-exit.
- Supabase: пользователи auth.users с админ-ролью платформы (через Supabase MCP).

## 5. Периметр (ревизия 2026-11-07, волна 5.1)

- `ssh srv` → `ss -tlnp | grep -v 127.0.0.1` и `docker port` по контейнерам:
  наружу должны торчать только 22/80/443 (+ известные: 41081 VLESS, wg,
  21115-21145 слоты прокси, личные сервисы владельца — 3x-ui 2053/2096,
  xray/outline/wg-easy/ASF).
  Всё лишнее — вопрос владельцу или ufw-точечное правило
  (риски из [[network-audit-2026-10-18]]: ufw `1024:65535/tcp ALLOW`).
- Kong/PostgREST/pooler Supabase — только localhost: **исполнено 2026-11-07** —
  kong 8000/8444, pooler 5432/6543, analytics 4000 перебиндены на 127.0.0.1
  (`/home/n8nuser/supabase/docker/docker-compose.yml`, бэкап
  `docker-compose.yml.bak.20261107-perimeter`). Проверять, что не откатилось.
- **ufw НЕ защищает docker-порты**: DNAT-трафик идёт через FORWARD
  (DOCKER-USER пуст, routed=allow) мимо INPUT — даже явный `DENY IN` не
  работает. Слушатель на 0.0.0.0 у контейнера = снаружи достижим, если
  порт не пробит протокольной пробой. Пробы только протокольные
  (Postgres SSLRequest / HTTP curl), голый TCP невалиден (SYN-proxy края
  хостинга отвечает всем портам).
- Остатки на слово владельца: minio 9002/9003 (ручной контейнер владельца,
  не supabase-стек); ufw `3000 ALLOW` — backend напрямую мимо nginx;
  ANON_KEY в supabase `.env` не декодируется PostgREST (старый ключ —
  юзеры работают на своих JWT, но ключ сверить).
- nginx: актуальные vhostы против `ls /etc/nginx/sites-enabled/`.
- RLS-пилот (волна 5.2): `proxies`, `userbot_restore_sources` под
  owner_isolation (`(select auth.uid())`, FORCE; service-ключ bypassrls —
  backend не задет). Расширение на новые таблицы — миграция + прогон
  `ops/scripts/db/rls-jwt-smoke.mjs` с srv (12 проверок; PATCH от чужого
  подтверждать состоянием строки — PostgREST отвечает 204 и на 0 строк).

## 6. Restore-тест

- Свежий monthly smoke (`/opt/backups/smoke-restore.log`) — зелёный?
- Квартальный ПОЛНЫЙ драйлл: restore дампа в чистую БД по
  `ops/RESTORE.md` §6 (в чистый контейнер/схему, НЕ поверх боевой) и запись
  строки в Drill log.

## 7. Зависимости (между ритуалами автоматом)

- gate-08 (push): high/critical prod — блокируют.
- Weekly workflow «Audit Weekly»: полный аудит — красный крест = разбор.
- Nightly «OSV Nightly»: osv-scanner по lockfiles — report-only.
- `npm audit-baseline.json` — ревизия исключений: не истёк ли смысл у каждого.

## История ритуалов

| Дата | Пункты | Находки / действия |
|---|---|---|
| 2026-11-07 | — (ритуал создан, первый прогон — квартал 2027-Q1) | gate-08 введён; Dependabot alerts включены; baseline: zod через @ton/ton |
