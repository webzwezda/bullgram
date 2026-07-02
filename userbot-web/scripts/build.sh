#!/usr/bin/env bash
# End-to-end build: fetch upstream → apply patches → npm ci → npm run build →
# copy dist/ out. Output ends up in userbot-web/dist/.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/config.sh"

bash "$SCRIPT_DIR/fetch-upstream.sh"
bash "$SCRIPT_DIR/apply-patches.sh"

if [ ! -d "$UPSTREAM_DIR/node_modules" ]; then
    echo "==> Installing upstream dependencies (npm ci)"
    (cd "$UPSTREAM_DIR" && npm ci)
else
    echo "==> upstream/node_modules exists — skipping npm ci"
fi

echo "==> Building upstream (npm run build:production)"
# telegram-tt's webpack config requires these at build time via EnvironmentPlugin.
# They are the api_id/api_hash of the BROWSER app declaration. We pass the
# session's fingerprint at runtime via window.__BULLRUN_BRIDGE__, but webpack
# needs values at build time. Use the upstream defaults — actual fingerprint
# is applied at runtime by our patched GramJS init.
(cd "$UPSTREAM_DIR" && \
    TELEGRAM_API_ID=2040 \
    TELEGRAM_API_HASH=placeholder \
    npm run build:production)

echo "==> Copying dist/ → $DIST_DIR/"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
cp -r "$UPSTREAM_DIR/dist/." "$DIST_DIR/"

echo "==> Build complete: $DIST_DIR"
ls -lh "$DIST_DIR" | head -10
