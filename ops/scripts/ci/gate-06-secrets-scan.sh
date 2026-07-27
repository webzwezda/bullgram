#!/usr/bin/env bash
# CI Gate 06 — Secrets scan.
#
# Scans tracked source + docs for accidentally committed integration tokens.
# Real tokens have shape:
#   brapi_<33+ alphanumeric chars>     (REST tokens, purpose=api or custom)
#   brmcp_<33+ alphanumeric chars>     (MCP tokens, purpose=mcp)
#
# Placeholders like `brapi_paste_your_token`, `brmcp_...`, `brapi_$TOKEN`,
# and `$BULLGRAM_TOKEN` are intentionally allowed.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

echo "── Gate 06: secrets scan ──────────────────────────────────────"

fail() { echo "FAIL: $1"; exit 1; }

command -v git >/dev/null || fail "git is required"

# Determine scan set. In CI we want tracked files only (no node_modules, no
# random untracked artifacts). Locally, fall back to a find if git is bare.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  files=$(git ls-files | grep -vE '^(site-v2/node_modules|admin-v2/node_modules|userbot-web/node_modules|backend/node_modules)/' || true)
else
  files=$(find backend docs/integrations -type f \
            \( -name '*.js' -o -name '*.mjs' -o -name '*.md' -o -name '*.json' -o -name '*.yml' -o -name '*.sh' \))
fi

[ -n "$files" ] || fail "no files to scan"

# Regex for real-looking tokens:
#   brapi_/brmcp_ followed by at least 25 chars of [A-Za-z0-9_-] and NOT
#   immediately followed by a placeholder marker (`_your`, `_paste`, `...`,
#   `_<word>_`, or `$`).
leak_pattern='(brapi|brmcp)_[A-Za-z0-9_-]{25,}'

# Placeholders that legitimately appear in docs/code and must NOT trip the gate.
# Each is a grep -E pattern; lines matching any of them are skipped.
placeholder_patterns=(
  'brapi_paste_your'
  'brmcp_paste_your'
  'brapi_your_token'
  'brmcp_your_token'
  'brapi_\.\.\.'
  'brmcp_\.\.\.'
  '_paste_'
  '_your_'
  '_placeholder_'
  'brapi_\$TOKEN'
  'brmcp_\$TOKEN'
  'brapi_\$BULLGRAM'
  'brmcp_\$BULLGRAM'
  'brapi_\$\{'
  'brmcp_\$\{'
  'brapi_\$\{\{'
  'brmcp_\$\{\{'
)
placeholder_re=$(printf '|%s' "${placeholder_patterns[@]}")
placeholder_re=${placeholder_re#|}  # strip leading |

leaks=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  # Find real-looking token matches, then drop any line that also matches a placeholder.
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    echo "  ✗ potential leak in $f:"
    echo "    $line"
    leaks=$((leaks + 1))
  done < <(grep -nE "$leak_pattern" "$f" 2>/dev/null \
            | grep -vE "$placeholder_re" \
            | sed -E 's/^[0-9]+://' || true)
done <<< "$files"

if [ "$leaks" -gt 0 ]; then
  fail "found $leaks potential token leak(s) — investigate before merging"
fi

echo "  ✓ no leaked tokens detected"
echo "PASS: secrets scan clean"
