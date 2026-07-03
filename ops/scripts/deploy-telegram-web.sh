#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-root}"
if [ -z "$DEPLOY_HOST" ]; then
  echo "DEPLOY_HOST env required (e.g. DEPLOY_HOST=1.2.3.4 ./ops/scripts/deploy-telegram-web.sh)" >&2
  exit 1
fi
SERVER="${DEPLOY_USER}@${DEPLOY_HOST}"
APP_DIR="/var/www/bullrun-telegram-web"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command npm
require_command rsync
require_command ssh

echo "==> Building userbot-web"
(
  cd "$ROOT_DIR/userbot-web"
  npm run build
)

echo "==> Deploying userbot-web to $APP_DIR"
rsync -avz --delete "$ROOT_DIR/userbot-web/dist/" "$SERVER:$APP_DIR/"

echo "==> Normalizing ownership and permissions on server"
ssh "$SERVER" "
  set -euo pipefail
  chown -R www-data:www-data '$APP_DIR'
  find '$APP_DIR' -type d -exec chmod 755 {} +
  find '$APP_DIR' -type f -exec chmod 644 {} +
"

echo "==> Verifying deployed artifacts"
ssh "$SERVER" "
  set -euo pipefail
  test -s '$APP_DIR/index.html'
"

echo "==> Deployed userbot-web"
echo "==> If nginx config changed: ssh $SERVER 'nginx -t && systemctl reload nginx'"
