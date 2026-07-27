#!/usr/bin/env bash
# CI Gate 04 — MCP endpoint smoke.
#
# Sends a JSON-RPC tools/list request to /api/mcp without auth.
# The server must respond with a well-formed JSON-RPC error envelope
# (auth failure), proving the endpoint is alive and speaks the protocol.
#
# Requires: curl, jq, BASE_URL reachable.

set -euo pipefail

BASE_URL="${BASE_URL:-https://bullgram.xyz}"
MCP_URL="$BASE_URL/api/mcp"

echo "── Gate 04: MCP endpoint smoke ────────────────────────────────"
echo "  target: $MCP_URL"

fail() { echo "FAIL: $1"; exit 1; }

command -v jq >/dev/null || fail "jq is required"
command -v curl >/dev/null || fail "curl is required"

# 1. tools/list without Authorization → expect JSON-RPC error envelope, not HTML, not 5xx.
http_code=$(curl -sS -o /tmp/mcp-smoke-body -w "%{http_code}" --max-time 15 \
  -X POST "$MCP_URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' || true)

body=$(cat /tmp/mcp-smoke-body 2>/dev/null || echo "")
[ -n "$body" ] || fail "empty response body (http=$http_code)"

# Status code 400 or 401 is acceptable. 5xx or 200 means protocol violation.
case "$http_code" in
  400|401) : ;;  # auth rejection — expected
  *) fail "unexpected HTTP status $http_code for unauthenticated tools/list (body: ${body:0:200})" ;;
esac

# Body may be either a single JSON-RPC envelope OR an SSE stream of them.
# Strip SSE framing if present, then parse the JSON envelope.
json=$(echo "$body" | sed -E 's/^data: //' | head -n1)
[ -n "$json" ] || fail "could not extract JSON envelope from response"

# Must be valid JSON with jsonrpc=2.0 and an error or result object.
proto=$(echo "$json" | jq -r '.jsonrpc // empty' 2>/dev/null || echo "")
[ "$proto" = "2.0" ] || fail "response is not JSON-RPC 2.0 (got: ${json:0:200})"

has_id=$(echo "$json" | jq -r 'has("id")' 2>/dev/null || echo "false")
[ "$has_id" = "true" ] || fail "JSON-RPC response missing 'id' field"

has_error=$(echo "$json" | jq -r 'has("error")' 2>/dev/null || echo "false")
[ "$has_error" = "true" ] || fail "expected JSON-RPC error envelope for unauthenticated call"

err_code=$(echo "$json" | jq -r '.error.code // empty')
[ -n "$err_code" ] || fail "error envelope missing .code"
echo "  ✓ JSON-RPC error envelope returned (code=$err_code, http=$http_code)"

# 2. Unrecognized method → JSON-RPC -32601 (method not found), but only when authed.
#    Without auth we still expect the auth error, so we don't probe this further
#    — Gate 04 is just "is the endpoint speaking JSON-RPC".

echo "PASS: MCP endpoint alive and JSON-RPC compliant"
