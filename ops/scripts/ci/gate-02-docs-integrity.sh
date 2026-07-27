#!/usr/bin/env bash
# CI Gate 02 — Documentation integrity.
#
# Verifies the docs/integrations/ tree is complete and internally consistent:
#   1. Every page in the README index actually exists on disk.
#   2. Every required page in the canonical inventory is present.
#   3. No internal markdown links are dangling (excluding http(s) and mailto).
#   4. No "pending Plan 03 P<N>" markers remain for phases 1-5 (those shipped).
#
# Exits non-zero on any failure. No network required.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DOCS="$ROOT/docs/integrations"

echo "── Gate 02: docs integrity ────────────────────────────────────"

fail() { echo "FAIL: $1"; exit 1; }

[ -d "$DOCS" ] || fail "docs/integrations/ not found at $DOCS"

# 1. Canonical page inventory (paths relative to docs/integrations/).
required_files=(
  "README.md"
  "getting-started.md"
  "authentication.md"
  "scopes.md"
  "rate-limits.md"
  "errors.md"
  "safety.md"
  "changelog.md"
  "support.md"
  "contributing.md"
  "operations/README.md"
  "operations/infra-summary.md"
  "operations/proxy-preview.md"
  "operations/proxy-import.md"
  "operations/userbot-list.md"
  "operations/userbot-health.md"
  "operations/userbot-dialogs.md"
  "operations/userbot-messages.md"
  "operations/userbot-messages-search.md"
  "operations/userbot-participants.md"
  "operations/userbot-message-send.md"
  "transports/mcp.md"
  "transports/rest.md"
  "guides/security-best-practices.md"
  "guides/n8n-collect-and-analyze.md"
  "guides/claude-desktop.md"
  "guides/curl-cookbook.md"
  "guides/sdk.md"
)

for rel in "${required_files[@]}"; do
  [ -f "$DOCS/$rel" ] || fail "missing required file: integrations/$rel"
done
echo "  ✓ all ${#required_files[@]} required files present"

# 2. Walk every .md under docs/integrations/ and check [text](relative-path) links.
# Skip http(s), mailto, and anchor-only links — only resolve relative file paths.
broken=0
checked=0
while IFS= read -r -d '' mdfile; do
  dir="$(dirname "$mdfile")"
  # Extract markdown links like [label](path). The grep -oE pulls the raw
  # `(target)` piece; we then strip parens and filter external URLs below.
  while IFS= read -r link; do
    [ -z "$link" ] && continue
    # Strip optional anchor `#frag` from path.
    path="${link%%#*}"
    [ -z "$path" ] && continue
    # Skip external links — they're validated by gate-03/05 hitting the live API,
    # not by file-existence checks here.
    case "$path" in
      http://*|https://*|mailto:*) continue ;;
    esac
    checked=$((checked + 1))
    # Resolve relative to the file containing the link.
    target="$dir/$path"
    if [ ! -e "$target" ]; then
      echo "  ✗ broken link in ${mdfile#$ROOT/}: $link"
      broken=$((broken + 1))
    fi
  done < <(grep -oE '\]\([^)]+\)' "$mdfile" | sed -E 's/^\]\(//; s/\)$//')
done < <(find "$DOCS" -type f -name '*.md' -print0)

if [ "$broken" -gt 0 ]; then
  fail "found $broken broken internal link(s) across docs/integrations/"
fi
echo "  ✓ all $checked internal links resolve"

# 3. Phase-shipped markers. Phases 1-5 are done — no "pending Plan 03 P[1-5]" should remain.
# `|| true` neutralises grep's exit-1-on-no-match so `set -e`/`pipefail` don't kill the script.
stale=$(grep -rnE 'pending Plan 03 P[1-5]\b' "$DOCS" 2>/dev/null || true)
if [ -n "$stale" ]; then
  echo "Found 'pending Plan 03 P[1-5]' markers in shipped docs:"
  echo "$stale"
  fail "stale phase marker(s) — phase shipped, update the doc"
fi
echo "  ✓ no stale 'pending Plan 03 P[1-5]' markers"

echo "PASS: docs integrity OK"
