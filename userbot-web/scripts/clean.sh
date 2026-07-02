#!/usr/bin/env bash
# Remove all generated/local artifacts. Doesn't touch patches/ or scripts/.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/config.sh"

echo "==> Removing upstream/ dist/"
rm -rf "$UPSTREAM_DIR"
echo "==> Removing dist/"
rm -rf "$DIST_DIR"
echo "==> Clean"
