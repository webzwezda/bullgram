#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-root}"
if [ -z "$DEPLOY_HOST" ]; then
  echo "DEPLOY_HOST env required (e.g. DEPLOY_HOST=1.2.3.4 ./ops/scripts/deploy-v2.sh)" >&2
  exit 1
fi
SERVER="${DEPLOY_USER}@${DEPLOY_HOST}"
SITE_DIR="/var/www/bullrun-site-v2"
APP_DIR="/var/www/bullrun-admin-v2"


require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command npm
require_command rsync
require_command ssh

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



echo "==> Deploying site-v2"
rsync -avz --delete "$ROOT_DIR/site-v2/dist/" "$SERVER:$SITE_DIR/"

echo "==> Deploying admin-v2"
rsync -avz --delete "$ROOT_DIR/admin-v2/dist/" "$SERVER:$APP_DIR/"



echo "==> Normalizing frontend ownership and permissions on server"
ssh "$SERVER" "
  set -euo pipefail
  chown -R www-data:www-data '$SITE_DIR' '$APP_DIR'
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
