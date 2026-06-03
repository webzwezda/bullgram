#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER="root@64.188.70.180"
BACKEND_DIR="/var/www/backend"
BACKUP_ROOT="/var/backups/bullrun-deploy"
DEPLOY_TIMESTAMP="${DEPLOY_TIMESTAMP:-$(date -u +%Y%m%d-%H%M%S)}"
RELEASE_ROOT="$BACKUP_ROOT/releases/$DEPLOY_TIMESTAMP"
BACKEND_BACKUP_DIR="$RELEASE_ROOT/backend"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command npm
require_command ssh

echo "==> Deploy timestamp: $DEPLOY_TIMESTAMP"

echo "==> Snapshotting current backend release on server"
ssh "$SERVER" "
  set -euo pipefail
  mkdir -p '$BACKEND_DIR' '$BACKEND_BACKUP_DIR'
  if [ -d '$BACKEND_DIR' ]; then
    rsync -a --delete \
      --exclude 'node_modules' \
      --exclude '.env' \
      --exclude '.env.backup-*' \
      --exclude 'logs' \
      --exclude 'uploads' \
      '$BACKEND_DIR/' '$BACKEND_BACKUP_DIR/'
  fi
  mkdir -p '$BACKUP_ROOT'
  printf '%s\n' '$DEPLOY_TIMESTAMP' > '$BACKUP_ROOT/latest-backend'
  printf '%s\n' '$DEPLOY_TIMESTAMP' > '$BACKUP_ROOT/latest-all'
"

echo "==> Deploying backend"
(
  cd "$ROOT_DIR/backend"
  npm run deploy
)

echo "==> Installing backend dependencies on server"
ssh "$SERVER" "cd '$BACKEND_DIR' && npm install --omit=dev"

echo "==> Reconciling managed proxies on server"
ssh "$SERVER" "cd '$BACKEND_DIR' && node scripts/restore-managed-proxies.mjs"

echo "==> Restarting backend on server"
ssh "$SERVER" "pm2 restart bullrun-tg-backend && pm2 flush bullrun-tg-backend && pm2 describe bullrun-tg-backend >/dev/null"

echo "==> Deploying primary v2 frontends"
DEPLOY_TIMESTAMP="$DEPLOY_TIMESTAMP" "$ROOT_DIR/ops/scripts/deploy-v2.sh"

echo "==> Main product deploy complete"
echo "==> Rollback if needed: npm run rollback -- all $DEPLOY_TIMESTAMP"
