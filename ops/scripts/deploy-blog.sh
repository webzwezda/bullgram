#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER="root@64.188.70.180"
BLOG_DIR="/var/www/bullrun-blog"
BACKUP_ROOT="/var/backups/bullrun-deploy"
DEPLOY_TIMESTAMP="${DEPLOY_TIMESTAMP:-$(date -u +%Y%m%d-%H%M%S)}"
RELEASE_ROOT="$BACKUP_ROOT/releases/$DEPLOY_TIMESTAMP"
BLOG_BACKUP_DIR="$RELEASE_ROOT/blog"

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

echo "==> Building blog"
(
  cd "$ROOT_DIR/blog"
  npm run build
)

echo "==> Snapshotting current blog release on server"
ssh "$SERVER" "
  set -euo pipefail
  mkdir -p '$BLOG_DIR' '$BLOG_BACKUP_DIR'
  if [ -d '$BLOG_DIR' ]; then
    rsync -a --delete '$BLOG_DIR/' '$BLOG_BACKUP_DIR/'
  fi
  mkdir -p '$BACKUP_ROOT'
  printf '%s\n' '$DEPLOY_TIMESTAMP' > '$BACKUP_ROOT/latest-blog'
"

echo "==> Deploying blog"
rsync -avz --delete "$ROOT_DIR/blog/_site/" "$SERVER:$BLOG_DIR/"

echo "==> Normalizing blog ownership and permissions on server"
ssh "$SERVER" "
  set -euo pipefail
  chown -R n8nuser:n8nuser '$BLOG_DIR'
  find '$BLOG_DIR' -type d -exec chmod 755 {} +
  find '$BLOG_DIR' -type f -exec chmod 644 {} +
"

echo "==> Verifying deployed blog artifacts"
ssh "$SERVER" "
  set -euo pipefail
  test -s '$BLOG_DIR/index.html'
  test -s '$BLOG_DIR/styles/blog.css'
  find '$BLOG_DIR' -mindepth 2 -maxdepth 2 -name index.html | grep -q .
"

echo "==> Deployed blog"
echo "==> Rollback if needed: npm run rollback -- blog $DEPLOY_TIMESTAMP"
