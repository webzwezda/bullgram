#!/usr/bin/env bash

set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-root}"
if [ -z "$DEPLOY_HOST" ]; then
  echo "DEPLOY_HOST env required (e.g. DEPLOY_HOST=1.2.3.4 ./ops/scripts/rollback.sh)" >&2
  exit 1
fi
SERVER="${DEPLOY_USER}@${DEPLOY_HOST}"
BACKUP_ROOT="/var/backups/bullrun-deploy"
BACKEND_DIR="/var/www/backend"
SITE_DIR="/var/www/bullrun-site-v2"
APP_DIR="/var/www/bullrun-admin-v2"


TARGET="${1:-all}"
TIMESTAMP="${2:-}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

usage() {
  cat <<'EOF'
Usage:
  npm run rollback -- all <timestamp>
  npm run rollback -- v2 <timestamp>

  npm run rollback -- backend <timestamp>

If timestamp is omitted, the script uses the latest recorded backup for the target.
EOF
}

resolve_timestamp() {
  local key="$1"
  if [ -n "$TIMESTAMP" ]; then
    printf '%s\n' "$TIMESTAMP"
    return
  fi

  ssh "$SERVER" "if [ -f '$BACKUP_ROOT/latest-$key' ]; then cat '$BACKUP_ROOT/latest-$key'; fi"
}

restore_backend() {
  local ts="$1"
  local backup_dir="$BACKUP_ROOT/releases/$ts/backend"

  echo "==> Restoring backend from $backup_dir"
  ssh "$SERVER" "
    set -euo pipefail
    test -d '$backup_dir'
    rsync -a --delete \
      --exclude 'node_modules' \
      --exclude '.env' \
      --exclude '.env.backup-*' \
      --exclude 'logs' \
      --exclude 'uploads' \
      '$backup_dir/' '$BACKEND_DIR/'
    cd '$BACKEND_DIR'
    npm install --omit=dev
    node scripts/restore-managed-proxies.mjs
    pm2 restart bullrun-tg-backend
    pm2 flush bullrun-tg-backend
    pm2 describe bullrun-tg-backend >/dev/null
  "
}

restore_v2() {
  local ts="$1"
  local site_backup_dir="$BACKUP_ROOT/releases/$ts/site-v2"
  local app_backup_dir="$BACKUP_ROOT/releases/$ts/admin-v2"
  echo "==> Restoring v2 frontends from $BACKUP_ROOT/releases/$ts"
  ssh "$SERVER" "
    set -euo pipefail
    test -d '$site_backup_dir'
    test -d '$app_backup_dir'
    rsync -a --delete '$site_backup_dir/' '$SITE_DIR/'
    rsync -a --delete '$app_backup_dir/' '$APP_DIR/'
    test -s '$SITE_DIR/index.html'
    test -s '$APP_DIR/index.html'
  "
}



require_command ssh
require_command rsync

if [ "$TARGET" = "-h" ] || [ "$TARGET" = "--help" ] || [ "$TARGET" = "help" ] || [ "$TIMESTAMP" = "-h" ] || [ "$TIMESTAMP" = "--help" ] || [ "$TIMESTAMP" = "help" ]; then
  usage
  exit 0
fi

case "$TARGET" in
  all)
    ts="$(resolve_timestamp all)"
    if [ -z "$ts" ]; then
      echo "No recorded backup timestamp found for target: all" >&2
      exit 1
    fi
    restore_backend "$ts"
    restore_v2 "$ts"
    ;;
  backend)
    ts="$(resolve_timestamp backend)"
    if [ -z "$ts" ]; then
      echo "No recorded backup timestamp found for target: backend" >&2
      exit 1
    fi
    restore_backend "$ts"
    ;;
  v2)
    ts="$(resolve_timestamp v2)"
    if [ -z "$ts" ]; then
      echo "No recorded backup timestamp found for target: v2" >&2
      exit 1
    fi
    restore_v2 "$ts"
    ;;

  *)
    echo "Unknown rollback target: $TARGET" >&2
    usage
    exit 1
    ;;
esac

echo "==> Rollback complete"
