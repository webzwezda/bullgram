#!/usr/bin/env bash
# Copies every file in patches/ over the corresponding file in upstream/,
# preserving the relative path. patches/src/foo.ts replaces upstream/src/foo.ts.
# This is a full-file-replace strategy: each patch file is the complete new content.
#
# To add a new patch: copy the upstream file into patches/<same/path>, edit it,
# re-run `npm run patch`. To see what's patched: `find patches -type f`.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/config.sh"

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
    echo "==> upstream/ missing — run 'npm run fetch' first"
    exit 1
fi

PATCH_COUNT=$(find "$PATCHES_DIR" -type f | wc -l | tr -d ' ')
if [ "$PATCH_COUNT" -eq 0 ]; then
    echo "==> No patches to apply"
    exit 0
fi

echo "==> Applying $PATCH_COUNT patch file(s):"
while IFS= read -r patch_file; do
    rel="${patch_file#$PATCHES_DIR/}"
    target="$UPSTREAM_DIR/$rel"
    mkdir -p "$(dirname "$target")"
    cp "$patch_file" "$target"
    echo "   - $rel"
done < <(find "$PATCHES_DIR" -type f)

echo "==> Patches applied"
