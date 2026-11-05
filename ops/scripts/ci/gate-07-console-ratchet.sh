#!/usr/bin/env bash
# CI Gate 07 — console.* ratchet для backend prod-кода (фаза 3 логирования).
#
# Считаем строки с console.(log|warn|error|info) в backend/ (без
# node_modules/test/scripts/logs) и сравниваем с baseline
# (console-ratchet.baseline.json): рост total ИЛИ любого отдельного файла
# блокирует push. Легаси-вызовы мигрируются по правилу «трогаешь файл —
# мигрируешь его логи» на utils/logger.js. Обновить baseline нарочно
# (осознанная операция, обоснуй в коммите):
#   ops/scripts/ci/gate-07-console-ratchet.sh --update-baseline
#
# План: docs/plans/2026-11-05-logging-research.md (§7, фаза 3).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "── Gate 07: console.* ratchet (backend prod) ──────────────────"

node "$SCRIPT_DIR/console-ratchet.mjs" "${1:+--update-baseline}"
