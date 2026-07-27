#!/usr/bin/env bash
# CI Gate 01 — Backend unit & integration tests.
#
# Runs the three test files that cover the shared MCP/REST infrastructure:
#   - test-mcp-shared.js    (143 tests: errors, pagination, rate-limiter,
#                            scope-guard, content-sanitizer)
#   - test-mcp-dispatch.js  (24 tests: dispatcher, audit log, allowlist)
#   - test-external-rest.js (47 tests: REST router, OpenAPI, scope enforcement)
#
# Exits non-zero on any failure. No network required.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT/backend"

echo "── Gate 01: backend test suite ─────────────────────────────────"

if [ ! -d test ]; then
  echo "FAIL: backend/test/ directory not found"
  exit 1
fi

# Node 22 is required; refuse to run on older versions to avoid silent skips.
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 22 ]; then
  echo "FAIL: Node 22+ required (got $major)"
  exit 1
fi

# Run each file separately so a single crash doesn't hide later failures.
for file in test-mcp-shared test-mcp-dispatch test-external-rest; do
  echo "── running test/$file.js"
  if ! node "test/$file.js"; then
    echo "FAIL: test/$file.js"
    exit 1
  fi
done

echo "PASS: all backend tests green"
