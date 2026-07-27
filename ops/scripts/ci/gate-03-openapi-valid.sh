#!/usr/bin/env bash
# CI Gate 03 — OpenAPI spec is valid and exposes all 10 operations.
#
# Fetches /api/external/v1/openapi.json from BASE_URL (default:
# https://bullgram.xyz) and verifies:
#   - Swagger/openapi version is 3.0.3
#   - info.version is "v1"
#   - The 10 canonical operation paths are present
#   - Each operation has the right HTTP verb
#
# Requires: curl, jq, BASE_URL reachable.

set -euo pipefail

BASE_URL="${BASE_URL:-https://bullgram.xyz}"
SPEC_URL="$BASE_URL/api/external/v1/openapi.json"

echo "── Gate 03: OpenAPI spec validity ─────────────────────────────"
echo "  fetching: $SPEC_URL"

fail() { echo "FAIL: $1"; exit 1; }

command -v jq >/dev/null || fail "jq is required"
command -v curl >/dev/null || fail "curl is required"

# Fetch spec.
spec=$(curl -fsS --max-time 15 "$SPEC_URL" || fail "could not fetch $SPEC_URL")

# Validate top-level fields.
version=$(echo "$spec" | jq -r '.openapi')
[ "$version" = "3.0.3" ] || fail "openapi field is '$version', expected '3.0.3'"

info_version=$(echo "$spec" | jq -r '.info.version')
[ "$info_version" = "v1" ] || fail "info.version is '$info_version', expected 'v1'"

title=$(echo "$spec" | jq -r '.info.title')
[ -n "$title" ] || fail "info.title is empty"
echo "  ✓ $title (openapi $version, info.version=$info_version)"

# Required REST paths × methods for all 10 operations.
# These mirror backend/mcp/tools/*/transports.rest.
declare -a expected=(
  "GET:/health"
  "GET:/me"
  "GET:/userbots"
  "GET:/userbots/{userbot_id}/health"
  "GET:/userbots/{userbot_id}/dialogs"
  "GET:/userbots/{userbot_id}/messages"
  "GET:/userbots/{userbot_id}/messages/search"
  "GET:/userbots/{userbot_id}/participants"
  "POST:/userbots/{userbot_id}/messages"
  "POST:/proxies/preview"
  "POST:/proxies/import"
)

missing=0
for entry in "${expected[@]}"; do
  method="${entry%%:*}"
  path="${entry#*:}"
  has=$(echo "$spec" | jq -r --arg p "$path" --arg m "$method" \
    '.paths[$p] | (if . then (has($m | ascii_downcase)) else false end)')
  if [ "$has" != "true" ]; then
    echo "  ✗ missing $method $path"
    missing=$((missing + 1))
  fi
done
[ "$missing" -eq 0 ] || fail "$missing operation path(s) missing from OpenAPI spec"
echo "  ✓ all ${#expected[@]} operation paths present"

# Sanity: every operation must declare a non-empty operationId and at least one tag.
bad_ops=$(echo "$spec" | jq -r '
  [.paths | to_entries[]
    | .value | to_entries[]
    | {op: .value.operationId, tags: (.value.tags | length)}]
  | map(select(.op == null or .op == "" or .tags == 0))
  | length
')
[ "$bad_ops" -eq 0 ] || fail "$bad_ops operation(s) missing operationId or tags"
echo "  ✓ every operation has operationId + tags"

echo "PASS: OpenAPI spec valid"
