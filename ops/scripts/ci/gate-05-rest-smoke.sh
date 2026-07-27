#!/usr/bin/env bash
# CI Gate 05 — REST API smoke.
#
# Verifies the public REST surface answers correctly without auth:
#   - GET /health            → 200, service=bullgram-external-api
#   - GET /openapi.json      → 200, .openapi=3.0.3
#   - GET /docs              → 200, text/html
#   - GET /me (no auth)      → 401 with JSON error envelope
#   - GET /userbots (no auth)→ 401 with JSON error envelope
#
# Requires: curl, jq, BASE_URL reachable.

set -euo pipefail

BASE_URL="${BASE_URL:-https://bullgram.xyz}"
API="$BASE_URL/api/external/v1"

echo "── Gate 05: REST API smoke ────────────────────────────────────"
echo "  target: $API"

fail() { echo "FAIL: $1"; exit 1; }

command -v jq >/dev/null || fail "jq is required"
command -v curl >/dev/null || fail "curl is required"

# --- /health -----------------------------------------------------------------
http=$(curl -sS -o /tmp/rest-health -w "%{http_code}" --max-time 15 "$API/health")
[ "$http" = "200" ] || fail "GET /health returned HTTP $http (expected 200)"
svc=$(jq -r '.service' /tmp/rest-health)
ver=$(jq -r '.version' /tmp/rest-health)
[ "$svc" = "bullgram-external-api" ] || fail "GET /health service='$svc' (expected bullgram-external-api)"
[ "$ver" = "v1" ] || fail "GET /health version='$ver' (expected v1)"
echo "  ✓ GET /health → 200, service=$svc, version=$ver"

# --- /openapi.json -----------------------------------------------------------
http=$(curl -sS -o /tmp/rest-openapi -w "%{http_code}" --max-time 15 "$API/openapi.json")
[ "$http" = "200" ] || fail "GET /openapi.json returned HTTP $http (expected 200)"
oa=$(jq -r '.openapi' /tmp/rest-openapi)
[ "$oa" = "3.0.3" ] || fail "GET /openapi.json .openapi='$oa' (expected 3.0.3)"
paths=$(jq -r '.paths | length' /tmp/rest-openapi)
[ "$paths" -ge 9 ] || fail "GET /openapi.json has only $paths paths (expected ≥9)"
echo "  ✓ GET /openapi.json → 200, openapi=$oa, paths=$paths"

# --- /docs (Scalar) ----------------------------------------------------------
http=$(curl -sS -o /tmp/rest-docs -w "%{http_code}" --max-time 15 "$API/docs")
[ "$http" = "200" ] || fail "GET /docs returned HTTP $http (expected 200)"
ct=$(curl -sS -I --max-time 15 "$API/docs" | awk -F': ' 'tolower($1)=="content-type"{print $2}' | tr -d '\r')
case "$ct" in
  text/html*) : ;;
  *) fail "GET /docs content-type='$ct' (expected text/html)" ;;
esac
grep -q 'api-reference' /tmp/rest-docs || fail "GET /docs body does not contain Scalar mount point"
echo "  ✓ GET /docs → 200 HTML (Scalar explorer)"

# --- /me (no auth) -----------------------------------------------------------
http=$(curl -sS -o /tmp/rest-me -w "%{http_code}" --max-time 15 "$API/me")
[ "$http" = "401" ] || fail "GET /me without token returned HTTP $http (expected 401)"
jq -e '.error.code != null' /tmp/rest-me > /dev/null || fail "GET /me 401 body missing .error.code"
echo "  ✓ GET /me without token → 401 JSON error envelope"

# --- /userbots (no auth) -----------------------------------------------------
http=$(curl -sS -o /tmp/rest-userbots -w "%{http_code}" --max-time 15 "$API/userbots")
[ "$http" = "401" ] || fail "GET /userbots without token returned HTTP $http (expected 401)"
jq -e '.error.code != null' /tmp/rest-userbots > /dev/null || fail "GET /userbots 401 body missing .error.code"
echo "  ✓ GET /userbots without token → 401 JSON error envelope"

echo "PASS: REST API smoke OK"
