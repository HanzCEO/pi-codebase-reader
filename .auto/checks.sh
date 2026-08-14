#!/bin/bash
set -euo pipefail
# Correctness checks: typecheck + full test suite (single run). Minimal output.
cd "$(dirname "$0")/.."

if ! npm run typecheck >/dev/null 2>&1; then
  echo "TYPECHECK FAILED"
  exit 1
fi

TEST_OUT=$(npm test 2>&1) || {
  echo "$TEST_OUT" | grep -iE "fail|✖|not ok" | head -20
  exit 1
}
echo "$TEST_OUT" | grep -E "^ℹ (tests|pass|fail)"
echo "=== checks ok ==="