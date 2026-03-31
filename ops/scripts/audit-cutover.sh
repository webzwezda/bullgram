#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> Active code references to /admin or legacy runtime"
rg -n "([\"']\\/admin(?:\\/|[\"'])|legacy reserve|legacy bridge|legacy admin|old public shell)" \
  "$ROOT_DIR/admin-v2/src" \
  "$ROOT_DIR/site-v2/src" \
  "$ROOT_DIR/backend/jobs" \
  -g '!**/dist/**' || true

echo
echo "==> Legacy runtime sources still tracked"
LEGACY_LEFTOVERS="$(find "$ROOT_DIR/archive" -maxdepth 2 -type d \( -name 'frontend-legacy' -o -name '_site' -o -name 'node_modules' \) -print || true)"
if [[ -n "$LEGACY_LEFTOVERS" ]]; then
  printf '%s\n' "$LEGACY_LEFTOVERS"
else
  echo "none"
fi

echo
echo "==> Active runtime roots"
printf '%s\n' \
  "backend/" \
  "admin-v2/" \
  "site-v2/" \
  "docs/" \
  "ops/" \
  "archive/"
