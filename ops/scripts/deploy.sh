#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-root}"
if [ -z "$DEPLOY_HOST" ]; then
  echo "DEPLOY_HOST env required (e.g. DEPLOY_HOST=1.2.3.4 ./ops/scripts/deploy.sh)" >&2
  exit 1
fi
SERVER="${DEPLOY_USER}@${DEPLOY_HOST}"
BACKEND_DIR="/var/www/backend"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command npm
require_command ssh

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
"$ROOT_DIR/ops/scripts/deploy-v2.sh"

echo "==> Main product deploy complete"
