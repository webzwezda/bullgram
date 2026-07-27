#!/usr/bin/env bash
# Run all 6 CI gates sequentially. Fails fast on the first failure.
#
# Usage:
#   ./ops/scripts/ci/run-all-gates.sh                # all gates
#   ./ops/scripts/ci/run-all-gates.sh 03 05          # only gates 03 and 05
#   BASE_URL=http://localhost:3000 ./ops/scripts/ci/run-all-gates.sh
#
# Gates 1, 2, 6 are pure source checks — no backend needed.
# Gates 3, 4, 5 hit BASE_URL (default https://bullgram.xyz).
# For local backend testing, run backend/server.js on a port and set BASE_URL.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GATES_DIR="$ROOT/ops/scripts/ci"

# Default order — matters: cheap source checks first, network checks last.
default_gates=(01 02 06 03 04 05)

if [ "$#" -gt 0 ]; then
  gates=("$@")
else
  gates=("${default_gates[@]}")
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  Bullgram integrations CI — ${#gates[@]} gate(s)"
echo "  BASE_URL=${BASE_URL:-https://bullgram.xyz}"
echo "═══════════════════════════════════════════════════════════════"

for n in "${gates[@]}"; do
  script="$GATES_DIR/gate-$n-*.sh"
  # Use ls to expand the glob; fail if no match.
  match=$(ls $script 2>/dev/null | head -n1 || true)
  [ -n "$match" ] || { echo "FAIL: no gate script matches gate-$n-*"; exit 1; }
  echo
  bash "$match"
done

echo
echo "═══════════════════════════════════════════════════════════════"
echo "  ALL ${#gates[@]} GATES PASSED"
echo "═══════════════════════════════════════════════════════════════"
