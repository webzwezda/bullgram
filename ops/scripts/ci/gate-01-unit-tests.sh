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

# Волна 3 (3.1): полный прогон — все 29 сьютов ~22s локально, укладывается
# в лимит воркфлоу, поэтому гоняем ВСЕ *.test.js на каждый push (правило
# плана: ≤6 мин → всё на push). Файлы переименованы в *.test.js (3.2, фаза 1
# node:test); npm-цепочки в package.json работают параллельно.
# Дамми-значения: сьюты мокают supabase/шифрование — реальные ключи не нужны.
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-ci-dummy-key-not-used-tests-mock-everything}"
export SUPABASE_URL="${SUPABASE_URL:-https://dummy.supabase.co}"

total=0
fail=0
for file in test/*.test.js; do
  total=$((total + 1))
  echo "── running $file"
  if ! node "$file"; then
    echo "FAIL: $file"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "FAIL: backend tests (${total} suites)"
  exit 1
fi

echo "PASS: all backend tests green (${total} suites)"
