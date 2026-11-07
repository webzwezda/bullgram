#!/usr/bin/env bash

# Deploy script for pull-based CI/CD.
# Invoked by GitHub Actions after SSH'ing to prod.
# Pulls latest main, installs deps if package.json changed, rebuilds
# frontends, reloads PM2 backend. Designed to be safe + atomic:
# - `set -euo pipefail` aborts before pm2 reload if build fails
# - idempotent: safe to re-run
# - all output goes to stdout/stderr for Action logs

set -euo pipefail

# Resolve repo root regardless of where the script is called from.
SELF_DIR="${DEPLOY_SELF_DIR:-$(cd "$(dirname "$0")" && pwd)}"
cd "$SELF_DIR/.."
ROOT="$(pwd)"

# 1. Pull latest FIRST — так следующий запуск всегда исполняет свежую версию
#    этого же скрипта (git reset заменяет файл прямо под запущенным bash,
#    из-за чего раньше молча пропускались шаги).
echo "==> git fetch + reset --hard origin/main"
git fetch --all --prune
# PREV_HEAD должен пережить re-exec: в проходе 2 HEAD уже после reset, env между
# проходами ненадёжен (sudo/env_reset), поэтому пишем его в файл внутри .git —
# без этого diff всегда пуст и условный npm install никогда не запускается.
PREV_HEAD_FILE="$ROOT/.git/deploy-prev-head"
if [ -n "${DEPLOY_REEXEC:-}" ] && [ -f "$PREV_HEAD_FILE" ]; then
  # Проход 2: HEAD уже перезётнут проходом 1 — берём записанный там PREV,
  # иначе diff пуст и условный npm install никогда не запускается.
  PREV_HEAD="$(cat "$PREV_HEAD_FILE")"
else
  git rev-parse HEAD > "$PREV_HEAD_FILE"
  PREV_HEAD="$(cat "$PREV_HEAD_FILE")"
fi
git reset --hard origin/main
NEW_HEAD="$(git rev-parse HEAD)"
echo "    $PREV_HEAD → $NEW_HEAD"

# 2. Re-exec: перечитываем уже обновлённый скрипт из стабильной копии.
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  export DEPLOY_REEXEC=1
  export DEPLOY_SELF_DIR="$SELF_DIR"
  SELF="$(mktemp /tmp/deploy-pull.XXXXXX)"
  cp "$SELF_DIR/deploy-pull.sh" "$SELF"
  exec bash "$SELF"
fi

echo "    [debug pass2] SELF_DIR=$SELF_DIR DEPLOY_SELF_DIR=${DEPLOY_SELF_DIR:-UNSET} cwd=$(pwd)"
echo "==> [$(date -u +%FT%TZ)] deploy-pull start"
echo "    root: $ROOT"

# 3. Conditional install: npm ci for runtimes whose package.json OR package-lock.json
#    changed. Полный ci (с devDeps) — фронтам devDeps нужны для сборки (vite/tailwind),
#    детерминизм по lock (волна 2, п. 2.2; поправка Д-1). Рантайму backend devDeps
#    не нужны — сразу после ci делаем prune --omit=dev только в нём.
echo "==> checking for package.json/package-lock.json changes"
CHANGED_FILES="$(git diff --name-only "$PREV_HEAD" "$NEW_HEAD" 2>/dev/null || echo "")"

need_backend_install=0
need_admin_install=0
need_site_install=0
need_userbot_v2_install=0
need_bots_v2_install=0
need_treasury_v2_install=0
need_profile_v2_install=0
need_docs_install=0
need_blog_install=0

if echo "$CHANGED_FILES" | grep -qE '^backend/(package\.json|package-lock\.json)$'; then
  need_backend_install=1
fi
if echo "$CHANGED_FILES" | grep -qE '^admin-v2/(package\.json|package-lock\.json)$'; then
  need_admin_install=1
fi
if echo "$CHANGED_FILES" | grep -qE '^site-v2/(package\.json|package-lock\.json)$'; then
  need_site_install=1
fi
if echo "$CHANGED_FILES" | grep -qE '^userbot-v2/(package\.json|package-lock\.json)$'; then
  need_userbot_v2_install=1
fi
if echo "$CHANGED_FILES" | grep -qE '^bots-v2/(package\.json|package-lock\.json)$'; then
  need_bots_v2_install=1
fi
if echo "$CHANGED_FILES" | grep -qE '^treasury-v2/(package\.json|package-lock\.json)$'; then
  need_treasury_v2_install=1
fi
if echo "$CHANGED_FILES" | grep -qE '^profile-v2/(package\.json|package-lock\.json)$'; then
  need_profile_v2_install=1
fi
if echo "$CHANGED_FILES" | grep -qE '^docs-site/(package\.json|package-lock\.json)$'; then
  need_docs_install=1
fi
if echo "$CHANGED_FILES" | grep -qE '^blog-site/(package\.json|package-lock\.json)$'; then
  need_blog_install=1
fi

# First-time setup: no node_modules → install everything
if [ ! -d backend/node_modules ] || [ ! -d admin-v2/node_modules ] || [ ! -d site-v2/node_modules ] || [ ! -d userbot-v2/node_modules ] || [ ! -d bots-v2/node_modules ] || [ ! -d treasury-v2/node_modules ] || [ ! -d profile-v2/node_modules ]; then
  echo "    first-time install (node_modules missing)"
  need_backend_install=1
  need_admin_install=1
  need_site_install=1
  need_userbot_v2_install=1
  need_bots_v2_install=1
  need_treasury_v2_install=1
  need_profile_v2_install=1
fi
if [ ! -d docs-site/node_modules ]; then
  need_docs_install=1
fi
if [ ! -d blog-site/node_modules ]; then
  need_blog_install=1
fi

if [ "$need_backend_install" = "1" ]; then
  echo "==> npm ci backend"
  npm --prefix backend ci
  npm --prefix backend prune --omit=dev
fi
if [ "$need_admin_install" = "1" ]; then
  echo "==> npm ci admin-v2"
  npm --prefix admin-v2 ci
fi
if [ "$need_site_install" = "1" ]; then
  echo "==> npm ci site-v2"
  npm --prefix site-v2 ci
fi
if [ "$need_userbot_v2_install" = "1" ]; then
  echo "==> npm ci userbot-v2"
  npm --prefix userbot-v2 ci
fi
if [ "$need_bots_v2_install" = "1" ]; then
  echo "==> npm ci bots-v2"
  npm --prefix bots-v2 ci
fi
if [ "$need_treasury_v2_install" = "1" ]; then
  echo "==> npm ci treasury-v2"
  npm --prefix treasury-v2 ci
fi
if [ "$need_profile_v2_install" = "1" ]; then
  echo "==> npm ci profile-v2"
  npm --prefix profile-v2 ci
fi
if [ "$need_docs_install" = "1" ]; then
  echo "==> npm ci docs-site"
  npm --prefix docs-site ci
fi
if [ "$need_blog_install" = "1" ]; then
  echo "==> npm ci blog-site"
  npm --prefix blog-site ci
fi

# 3a. Backend tests on every push (волна 3, п.3.1: полный прогон ~13-22s;
# прерываем ДО pm2 reload — красные тесты не уезжают в прод)
echo "==> backend tests (all *.test.js)"
if (cd backend && ENCRYPTION_KEY="${ENCRYPTION_KEY:-ci-dummy-key-not-used-tests-mock-everything}" \
    node --test test/*.test.js > /tmp/backend-tests.log 2>&1); then
  grep -E "^# (tests|pass|fail)" /tmp/backend-tests.log | tr '\n' ' '
  echo
else
  echo "FAIL: backend tests — деплой прерван до pm2 reload:"
  tail -30 /tmp/backend-tests.log
  exit 1
fi

# 3. Build frontends
echo "==> npm run build:v2 (site-v2 + admin-v2 + userbot-v2 + bots-v2 + treasury-v2)"
npm run build:v2

# 3b. Build docs site into site-v2/dist/docs (static, served by nginx files-first)
echo "==> npm run build (docs-site)"
npm --prefix docs-site run build
rm -rf site-v2/dist/docs
cp -r docs-site/_site site-v2/dist/docs

# 3c. Build blog site into site-v2/dist/blog (static, served by nginx files-first)
echo "==> npm run build (blog-site)"
npm --prefix blog-site run build
rm -rf site-v2/dist/blog
cp -r blog-site/dist site-v2/dist/blog

# 4. Reload PM2 backend (zero-downtime if possible, else restart)
echo "==> pm2 reload bullgram-tg-backend"
ERR_SIZE_BEFORE="$(stat -c%s backend/logs/app.err.jsonl 2>/dev/null || echo 0)"
cd backend
if pm2 reload ecosystem.config.cjs --env production 2>&1; then
  echo "    pm2 reload OK"
else
  echo "    pm2 reload failed, falling back to restart"
  pm2 restart ecosystem.config.cjs --env production
fi
pm2 save
cd "$ROOT"

# 4b. Версия релиза для /health (волна 4.3): git describe -> backend/.release-version
git describe --tags --always --dirty > backend/.release-version 2>/dev/null || echo "dev" > backend/.release-version

# 5. Слоёный smoke (волна 4.1) + автороллбек (4.2).
# Д-6: если деплой шёл вместе с РУЧНОЙ миграцией БД — автооткат может увести
# код от схемы; такие деплои запускаются с DEPLOY_NO_ROLLBACK=1.
echo "==> smoke: слоёный (boot / api / nginx / pm2 / err-log 90с)"
sleep 3
smoke_fail=""

L1="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ || echo 000)"
[ "$L1" != "000" ] || smoke_fail="boot: localhost:3000 не отвечает"
echo "    L1 boot (localhost:3000): $L1"

if [ -z "$smoke_fail" ]; then
  L2="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/external/v1/health || echo 000)"
  [ "$L2" = "200" ] || smoke_fail="api: /api/external/v1/health → $L2"
  echo "    L2 api (health): $L2"
fi

if [ -z "$smoke_fail" ]; then
  L3A="$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://bullgram.xyz/ || echo 000)"
  L3B="$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://bullgram.xyz/api/external/v1/health || echo 000)"
  { [ "$L3A" = "200" ] && [ "$L3B" = "200" ]; } || smoke_fail="nginx: / → $L3A, health → $L3B"
  echo "    L3 nginx (витрина + health через домен): $L3A / $L3B"
fi

if [ -z "$smoke_fail" ]; then
  L4="$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name=="bullgram-tg-backend") | .pm2_env.status' 2>/dev/null)"
  [ "$L4" = "online" ] || smoke_fail="pm2: статус $L4"
  echo "    L4 pm2: ${L4:-?}"
fi

if [ -z "$smoke_fail" ]; then
  echo "    L5 err-log: тишина 90с…"
  sleep 90
  ERR_SIZE_AFTER="$(stat -c%s backend/logs/app.err.jsonl 2>/dev/null || echo 0)"
  [ "$ERR_SIZE_AFTER" -le "$ERR_SIZE_BEFORE" ] || smoke_fail="err.jsonl вырос за 90с (+$((ERR_SIZE_AFTER - ERR_SIZE_BEFORE)) байт — крэш-уровень)"
  echo "    L5 err.jsonl: $ERR_SIZE_BEFORE → $ERR_SIZE_AFTER"
  # информационно: новые error-строки out-лога (известный шум не фейлит деплой)
  NEW_ERRS=$(tail -400 backend/logs/app.out.jsonl | jq -r --arg since "$(date -u -d '-95 seconds' '+%Y-%m-%dT%H:%M:%S')" 'select(.time > $since and .level=="error") | .msg' 2>/dev/null | head -5)
  [ -n "$NEW_ERRS" ] && { echo "    ошибки в окне (информационно):"; echo "$NEW_ERRS" | sed 's/^/      /'; }
fi

if [ -n "$smoke_fail" ]; then
  if [ -n "${DEPLOY_NO_ROLLBACK:-}" ] || [ ! -f "$PREV_HEAD_FILE" ]; then
    /opt/alerts/tg-send.sh "🔴 Bullgram деплой $(git rev-parse --short HEAD 2>/dev/null) провалил смоук ($smoke_fail); АВТООТКАТ НЕДОСТУПЕН — нужен ручной откат (см. ops/RESTORE.md)" 2>/dev/null || true
    echo "FAIL: smoke ($smoke_fail), автороллбек недоступен"
    exit 1
  fi
  PREV="$(cat "$PREV_HEAD_FILE")"
  /opt/alerts/tg-send.sh "⚠️ Bullgram деплой $(git rev-parse --short HEAD) провалил смоук ($smoke_fail) — автооткат на ${PREV:0:7} и повторный деплой" 2>/dev/null || true
  echo "FAIL: smoke ($smoke_fail) — откат на $PREV и повторный деплой"
  git reset --hard "$PREV"
  rm -f "$PREV_HEAD_FILE"
  exec env DEPLOY_NO_ROLLBACK=1 DEPLOY_SELF_DIR="$SELF_DIR" bash "$SELF_DIR/deploy-pull.sh"
fi

rm -f "$PREV_HEAD_FILE"

echo "==> [$(date -u +%FT%TZ)] deploy-pull done"
