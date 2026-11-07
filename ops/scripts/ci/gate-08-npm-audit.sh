#!/usr/bin/env bash
# gate-08: npm audit по lockfiles всех рантаймов (волна 2, п. 2.3).
# Логика в npm-audit.mjs: audit по package-lock БЕЗ установки
# (--package-lock-only), блокируют high/critical в prod-зависимостях,
# исключения — только задокументированные в npm-audit-baseline.json.
# Полный аудит (вкл. devDeps) — weekly workflow audit-weekly.yml (non-blocking).
# Ночные CVE сверх npm advisory DB — osv-scanner (workflow osv-nightly.yml).

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec node "$ROOT/ops/scripts/ci/npm-audit.mjs"
