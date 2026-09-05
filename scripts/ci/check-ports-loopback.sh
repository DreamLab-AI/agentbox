#!/bin/sh
# check-ports-loopback.sh — stable CI entry point for the container EXPOSURE
# invariants. The gate itself lives in the sibling check-ports-loopback.mjs and
# now applies TWO rules in one run:
#
#   publish  (R-003 / ADR-2013) — every published port in every
#            docker-compose*.yml binds 127.0.0.1 unless sanctioned. ADR-2013
#            replaced the previous awk line-walker with a real YAML reader after
#            the estate review reproduced a structural bypass (a public port
#            written as a nested service-flow or JSON-flow mapping passed a gate
#            that only armed on a line beginning with `ports:`).
#   listener (ADR-2062) — every supervised program's bind address, read from the
#            generated supervisord `command=` / `environment=` lines in
#            flake.nix, is container-loopback or is sanctioned with a reason. A
#            loopback publish constrains host->container only; a 0.0.0.0 bind
#            inside the container is reachable by every sibling container on the
#            shared docker network and is invisible to the publish rule.
#
# The script name is unchanged deliberately: .github/workflows/invariants.yml
# and ADR-2013 both cite this path, and the publish rule's output format is
# byte-for-byte what it was, because other tooling parses it.
#
# Exit: 0 pass, 1 violation (either rule), 2 unauditable input (unparseable
#       compose, or a bind address whose Nix interpolation cannot be resolved),
#       3 usage / missing gate / missing node.
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
