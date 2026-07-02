#!/usr/bin/env bash
# Shared config for userbot-web build scripts.

set -euo pipefail

# Upstream tag we vendor (https://github.com/Ajaxy/telegram-tt/releases).
# Bump this when syncing with upstream. Patches may need re-basing.
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/Ajaxy/telegram-tt.git}"
UPSTREAM_TAG="${UPSTREAM_TAG:-v10.9.51}"

# Paths (relative to userbot-web/).
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="$ROOT_DIR/upstream"
PATCHES_DIR="$ROOT_DIR/patches"
DIST_DIR="$ROOT_DIR/dist"

# Browser-side bridge config that the running admin must set before GramJS init.
# Injected into upstream/src/config.ts via patch during `apply-patches.sh`.
# These are read at runtime from `window.__BULLRUN__`.
