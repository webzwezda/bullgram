#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER="root@64.188.70.180"
SITE_DIR="/var/www/bullrun-site-v2"
APP_DIR="/var/www/bullrun-admin-v2"
BACKUP_ROOT="/var/backups/bullrun-deploy"
DEPLOY_TIMESTAMP="${DEPLOY_TIMESTAMP:-$(date -u +%Y%m%d-%H%M%S)}"
RELEASE_ROOT="$BACKUP_ROOT/releases/$DEPLOY_TIMESTAMP"
SITE_BACKUP_DIR="$RELEASE_ROOT/site-v2"
APP_BACKUP_DIR="$RELEASE_ROOT/admin-v2"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command npm
require_command rsync
require_command ssh

echo "==> Deploy timestamp: $DEPLOY_TIMESTAMP"

echo "==> Building site-v2"
(
  cd "$ROOT_DIR/site-v2"
  npm run build
)

echo "==> Building admin-v2"
(
  cd "$ROOT_DIR/admin-v2"
  npm run build
)

echo "==> Snapshotting current v2 frontend release on server"
ssh "$SERVER" "
  set -euo pipefail
  mkdir -p '$SITE_DIR' '$APP_DIR' '$SITE_BACKUP_DIR' '$APP_BACKUP_DIR'
  if [ -d '$SITE_DIR' ]; then
    rsync -a --delete '$SITE_DIR/' '$SITE_BACKUP_DIR/'
  fi
  if [ -d '$APP_DIR' ]; then
    rsync -a --delete '$APP_DIR/' '$APP_BACKUP_DIR/'
  fi
  mkdir -p '$BACKUP_ROOT'
  printf '%s\n' '$DEPLOY_TIMESTAMP' > '$BACKUP_ROOT/latest-v2'
"

echo "==> Deploying site-v2"
rsync -avz --delete "$ROOT_DIR/site-v2/dist/" "$SERVER:$SITE_DIR/"

echo "==> Deploying admin-v2"
rsync -avz --delete "$ROOT_DIR/admin-v2/dist/" "$SERVER:$APP_DIR/"

echo "==> Normalizing frontend ownership and permissions on server"
ssh "$SERVER" "
  set -euo pipefail
  chown -R n8nuser:n8nuser '$SITE_DIR' '$APP_DIR'
  find '$SITE_DIR' '$APP_DIR' -type d -exec chmod 755 {} +
  find '$SITE_DIR' '$APP_DIR' -type f -exec chmod 644 {} +
"

echo "==> Verifying deployed frontend artifacts"
ssh "$SERVER" "
  set -euo pipefail
  test -s '$SITE_DIR/index.html'
  test -s '$APP_DIR/index.html'
"

echo "==> Deployed v2 frontends"
echo "==> Rollback if needed: npm run rollback -- v2 $DEPLOY_TIMESTAMP"
