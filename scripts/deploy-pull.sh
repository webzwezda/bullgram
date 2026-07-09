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
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "==> [$(date -u +%FT%TZ)] deploy-pull start"
echo "    root: $ROOT"

# 1. Pull latest
echo "==> git fetch + reset --hard origin/main"
git fetch --all --prune
PREV_HEAD="$(git rev-parse HEAD)"
git reset --hard origin/main
NEW_HEAD="$(git rev-parse HEAD)"
echo "    $PREV_HEAD → $NEW_HEAD"

# 2. Conditional install: only run npm install for runtimes whose package.json changed
echo "==> checking for package.json changes"
CHANGED_FILES="$(git diff --name-only "$PREV_HEAD" "$NEW_HEAD" 2>/dev/null || echo "")"

need_backend_install=0
need_admin_install=0
need_site_install=0

if echo "$CHANGED_FILES" | grep -q '^backend/package\.json$'; then
  need_backend_install=1
fi
if echo "$CHANGED_FILES" | grep -q '^admin-v2/package\.json$'; then
  need_admin_install=1
fi
if echo "$CHANGED_FILES" | grep -q '^site-v2/package\.json$'; then
  need_site_install=1
fi

# First-time setup: no node_modules → install everything
if [ ! -d backend/node_modules ] || [ ! -d admin-v2/node_modules ] || [ ! -d site-v2/node_modules ]; then
  echo "    first-time install (node_modules missing)"
  need_backend_install=1
  need_admin_install=1
  need_site_install=1
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

# 3. Build frontends
echo "==> npm run build:v2 (site-v2 + admin-v2)"
npm run build:v2


# 4. Reload PM2 backend (zero-downtime if possible, else restart)
echo "==> pm2 reload bullrun-tg-backend"
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
  pm2 logs bullrun-tg-backend --lines 20 --nostream || true
  exit 1
fi
echo "    backend HTTP $HTTP_CODE (alive)"

echo "==> [$(date -u +%FT%TZ)] deploy-pull done"
