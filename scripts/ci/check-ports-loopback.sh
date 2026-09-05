#!/bin/sh
# check-ports-loopback.sh — stable CI entry point for the compose port
# invariant (R-003). The gate itself lives in the sibling
# check-ports-loopback.mjs: ADR-2013 replaced the previous awk line-walker with
# a real YAML reader after the estate review reproduced a structural bypass
# (a public port written as a nested service-flow or JSON-flow mapping passed
# a gate that only armed on a line beginning with `ports:`).
#
# This wrapper exists so `sh scripts/ci/check-ports-loopback.sh` keeps working
# in .github/workflows/invariants.yml and in any operator habit. It resolves the
# gate relative to itself and FAILS LOUDLY if the gate is missing — a copy of
# this file on its own must never look like a pass.
#
# Args are forwarded: an optional root directory to audit (default: repo root).
set -eu

DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
GATE="${DIR}/check-ports-loopback.mjs"

if [ ! -f "$GATE" ]; then
  echo "FAIL (check-ports-loopback): gate implementation missing at ${GATE}." >&2
  echo "  This wrapper cannot audit anything on its own. Run it from a complete" >&2
  echo "  checkout, or invoke scripts/ci/check-ports-loopback.mjs directly." >&2
  exit 3
fi

if ! command -v node >/dev/null 2>&1; then
  echo "FAIL (check-ports-loopback): node is required to parse the compose files." >&2
  echo "  The gate parses YAML rather than pattern-matching lines (ADR-2013); a" >&2
  echo "  missing interpreter is a failure, never a skip." >&2
  exit 3
fi

exec node "$GATE" "$@"
