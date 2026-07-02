#!/usr/bin/env bash
# Fetches the upstream telegram-tt tag into ./upstream/ (shallow, single tag).
# Idempotent — if upstream/ already exists and points at the right tag, no-op.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/config.sh"

if [ -d "$UPSTREAM_DIR/.git" ]; then
    CURRENT_TAG="$(cd "$UPSTREAM_DIR" && git describe --tags --exact-match 2>/dev/null || echo "unknown")"
    if [ "$CURRENT_TAG" = "$UPSTREAM_TAG" ]; then
        echo "==> upstream/ already at $UPSTREAM_TAG"
        exit 0
    fi
    echo "==> upstream/ at $CURRENT_TAG, need $UPSTREAM_TAG — re-cloning"
    rm -rf "$UPSTREAM_DIR"
fi

echo "==> Cloning Ajaxy/telegram-tt@$UPSTREAM_TAG (shallow)"
git clone --depth 1 --branch "$UPSTREAM_TAG" "$UPSTREAM_URL" "$UPSTREAM_DIR"

echo "==> Cloned $UPSTREAM_TAG at $(cd "$UPSTREAM_DIR" && git rev-parse --short HEAD)"
