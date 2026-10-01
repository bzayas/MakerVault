#!/bin/bash
# MakerVault pre-deploy checks: lint, version-lockstep, API smoke test,
# invoice-parser harness. Exits non-zero on the first failing stage.
#
# Usage: scripts/check.sh            (from anywhere)
# Used by scripts/deploy.sh and the GitHub Actions CI workflow.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
PHP_BIN="$(command -v php || echo /opt/homebrew/bin/php)"

step() { printf '\n== %s\n' "$1"; }
die()  { echo "✗ $1" >&2; exit 1; }

step "PHP lint"
for f in "$WEB"/api/*.php; do
  "$PHP_BIN" -l "$f" >/dev/null || die "php -l failed: $f"
done
echo "✓ api/*.php"

step "JS syntax"
if command -v node >/dev/null; then
  for f in "$WEB"/js/*.js "$WEB"/sw.js; do
    node --check "$f" || die "node --check failed: $f"
  done
  echo "✓ js/*.js sw.js"
else
  echo "⚠ node not installed — skipping JS syntax + parser harness"
fi

step "Version lockstep"
"$ROOT/scripts/bump-version.sh" --check

step "API smoke test"
bash "$WEB/tests/smoke.sh"

if command -v node >/dev/null; then
  step "Invoice parser harness"
  node "$WEB/tests/parsers-harness.node.js" 2>&1 | grep -v -e 'Cannot polyfill' -e 'Require stack' -e '^- '
fi

printf '\n✓ ALL CHECKS PASSED\n'
