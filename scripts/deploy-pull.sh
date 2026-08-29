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
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SELF_DIR/.."
ROOT="$(pwd)"

# 1. Pull latest FIRST — так следующий запуск всегда исполняет свежую версию
#    этого же скрипта (git reset заменяет файл прямо под запущенным bash,
#    из-за чего раньше молча пропускались шаги).
echo "==> git fetch + reset --hard origin/main"
git fetch --all --prune
PREV_HEAD="$(git rev-parse HEAD)"
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

echo "==> [$(date -u +%FT%TZ)] deploy-pull start"
echo "    root: $ROOT"

# 3. Conditional install: only run npm install for runtimes whose package.json changed
echo "==> checking for package.json changes"
CHANGED_FILES="$(git diff --name-only "$PREV_HEAD" "$NEW_HEAD" 2>/dev/null || echo "")"

need_backend_install=0
need_admin_install=0
need_site_install=0
need_docs_install=0
need_blog_install=0

if echo "$CHANGED_FILES" | grep -q '^backend/package\.json$'; then
  need_backend_install=1
fi
if echo "$CHANGED_FILES" | grep -q '^admin-v2/package\.json$'; then
  need_admin_install=1
fi
if echo "$CHANGED_FILES" | grep -q '^site-v2/package\.json$'; then
  need_site_install=1
fi
if echo "$CHANGED_FILES" | grep -q '^docs-site/package\.json$'; then
  need_docs_install=1
fi
if echo "$CHANGED_FILES" | grep -q '^blog-site/package\.json$'; then
  need_blog_install=1
fi

# First-time setup: no node_modules → install everything
if [ ! -d backend/node_modules ] || [ ! -d admin-v2/node_modules ] || [ ! -d site-v2/node_modules ]; then
  echo "    first-time install (node_modules missing)"
  need_backend_install=1
  need_admin_install=1
  need_site_install=1
fi
if [ ! -d docs-site/node_modules ]; then
  need_docs_install=1
fi
if [ ! -d blog-site/node_modules ]; then
  need_blog_install=1
fi

if [ "$need_backend_install" = "1" ]; then
  echo "==> npm install backend"
  npm --prefix backend install
fi
if [ "$need_admin_install" = "1" ]; then
  echo "==> npm install admin-v2"
  npm --prefix admin-v2 install
fi
if [ "$need_site_install" = "1" ]; then
  echo "==> npm install site-v2"
  npm --prefix site-v2 install
fi
if [ "$need_docs_install" = "1" ]; then
  echo "==> npm install docs-site"
  npm --prefix docs-site install
fi
if [ "$need_blog_install" = "1" ]; then
  echo "==> npm install blog-site"
  npm --prefix blog-site install
fi

# 3. Build frontends
echo "==> npm run build:v2 (site-v2 + admin-v2)"
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
cd backend
if pm2 reload ecosystem.config.cjs --env production 2>&1; then
  echo "    pm2 reload OK"
else
  echo "    pm2 reload failed, falling back to restart"
  pm2 restart ecosystem.config.cjs --env production
fi
pm2 save
cd "$ROOT"

# 5. Sanity: backend HTTP responding
echo "==> smoke: backend HTTP"
sleep 2
HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ || echo "000")"
if [ "$HTTP_CODE" = "000" ]; then
  echo "    ERROR: backend not responding on localhost:3000"
  pm2 logs bullgram-tg-backend --lines 20 --nostream || true
  exit 1
fi
echo "    backend HTTP $HTTP_CODE (alive)"

echo "==> [$(date -u +%FT%TZ)] deploy-pull done"
