#!/bin/bash
set -euo pipefail

# Benchmark: packed distribution size for pi-codebase-reader.
# Emits METRIC lines: my_primary_size, unpacked_size, file_count, tests_pass.

cd "$(dirname "$0")/.."

# --- 1. Typecheck + build first (correctness gate, fast-fail on <5s) ---
if ! npm run typecheck >/dev/null 2>&1; then
  echo "METRIC typecheck_pass=0"
  echo "METRIC my_primary_size=-1"
  exit 0
fi
echo "METRIC typecheck_pass=1"

# --- 2. Measure packed + unpacked size ---
rm -f *.tgz >/dev/null 2>&1 || true
PACK_OUT=$(npm pack 2>/dev/null)
TGZ=$(ls -t pi-codebase-reader-*.tgz 2>/dev/null | head -1)
if [ -z "${TGZ:-}" ]; then
  echo "METRIC my_primary_size=-1"
  exit 0
fi

# packed size in kB
PACKED_BYTES=$(wc -c < "$TGZ")
PACKED_KB=$((PACKED_BYTES / 1024))

# unpacked size in kB and file count
UNPACK_DIR=$(mktemp -d)
tar -xzf "$TGZ" -C "$UNPACK_DIR"
UNPACKED_BYTES=$(du -sb "$UNPACK_DIR" | cut -f1)
UNPACKED_KB=$((UNPACKED_BYTES / 1024))
FILE_COUNT=$(find "$UNPACK_DIR" -type f | wc -l)
rm -rf "$UNPACK_DIR"

echo "METRIC my_primary_size=$PACKED_KB"
echo "METRIC unpacked_size=$UNPACKED_KB"
echo "METRIC file_count=$FILE_COUNT"

# --- 3. Run full test suite (pass = 1, fail = 0) ---
if npm test >/dev/null 2>&1; then
  echo "METRIC tests_pass=1"
else
  echo "METRIC tests_pass=0"
fi

# Clean up the tarball so it doesn't accumulate
rm -f pi-codebase-reader-*.tgz