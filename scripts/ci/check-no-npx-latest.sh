#!/bin/sh
# check-no-npx-latest.sh — Ratchet: count `npx -y` / `@latest` invocations across
# the IMAGE-baked shipping surface and WARN (do not fail) at or below the recorded
# baseline. R-002 migration to pinned versions is a documented TODO, so this check
# only FAILS if NEW occurrences appear beyond scripts/ci/.npx-baseline — the count
# can only go down.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
BASELINE_FILE="$ROOT/scripts/ci/.npx-baseline"

# Image-baked shipping surface (excludes node_modules, tests, docs).
SCAN="config scripts lib flake.nix"

baseline="$(tr -d '[:space:]' < "$BASELINE_FILE" 2>/dev/null || echo 0)"
case "$baseline" in ''|*[!0-9]*) baseline=0 ;; esac

# Exclude node_modules and the CI tooling itself (these check scripts contain
# the literal patterns 'npx -y' / '@latest' in their own source and would
# otherwise self-inflate the count).
matches="$(cd "$ROOT" && grep -rIn -E 'npx -y|@latest' $SCAN 2>/dev/null \
  | grep -vi node_modules \
  | grep -v '^scripts/ci/' || true)"

count="$(printf '%s' "$matches" | grep -c . || true)"
count="${count:-0}"

echo "----- npx/@latest shipping-surface occurrences (baseline=$baseline) -----"
if [ -n "$matches" ]; then
  printf '%s\n' "$matches"
fi
echo "------------------------------------------------------------------------"
echo "count=$count baseline=$baseline"

if [ "$count" -gt "$baseline" ]; then
  echo "FAIL (check-no-npx-latest): $count occurrences > baseline $baseline." >&2
  echo "  New unpinned npx/@latest invocations were added. Pin versions or, if" >&2
  echo "  intentional, lower the surface elsewhere — the count must not grow." >&2
  exit 1
fi

if [ "$count" -lt "$baseline" ]; then
  echo "WARN (check-no-npx-latest): count dropped to $count (baseline $baseline)." >&2
  echo "  Migration progressing — update scripts/ci/.npx-baseline to $count to" >&2
  echo "  ratchet the limit down." >&2
fi

echo "PASS (check-no-npx-latest): $count <= baseline $baseline (R-002 migration TODO)"
