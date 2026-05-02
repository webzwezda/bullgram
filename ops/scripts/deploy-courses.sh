#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER="root@64.188.70.180"
COURSES_DIR="/var/www/bullrun-courses"
BACKUP_ROOT="/var/backups/bullrun-deploy"
DEPLOY_TIMESTAMP="${DEPLOY_TIMESTAMP:-$(date -u +%Y%m%d-%H%M%S)}"
RELEASE_ROOT="$BACKUP_ROOT/releases/$DEPLOY_TIMESTAMP"
COURSES_BACKUP_DIR="$RELEASE_ROOT/courses"

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

echo "==> Building courses"
(
  cd "$ROOT_DIR/courses"
  rm -rf _site
  npm run build
)

echo "==> Snapshotting current courses release on server"
ssh "$SERVER" "
  set -euo pipefail
  mkdir -p '$COURSES_DIR' '$COURSES_BACKUP_DIR'
  if [ -d '$COURSES_DIR' ]; then
    rsync -a --delete '$COURSES_DIR/' '$COURSES_BACKUP_DIR/'
  fi
  mkdir -p '$BACKUP_ROOT'
  printf '%s\n' '$DEPLOY_TIMESTAMP' > '$BACKUP_ROOT/latest-courses'
"

echo "==> Deploying courses"
rsync -avz --delete "$ROOT_DIR/courses/_site/" "$SERVER:$COURSES_DIR/"

echo "==> Normalizing courses ownership and permissions on server"
ssh "$SERVER" "
  set -euo pipefail
  chown -R n8nuser:n8nuser '$COURSES_DIR'
  find '$COURSES_DIR' -type d -exec chmod 755 {} +
  find '$COURSES_DIR' -type f -exec chmod 644 {} +
"

echo "==> Verifying deployed courses artifacts"
ssh "$SERVER" "
  set -euo pipefail
  test -s '$COURSES_DIR/index.html'
  test -s '$COURSES_DIR/styles/courses.css'
  find '$COURSES_DIR' -mindepth 2 -maxdepth 2 -name index.html | grep -q .
"

echo "==> Deployed courses"
echo "==> Rollback if needed: npm run rollback -- courses $DEPLOY_TIMESTAMP"
