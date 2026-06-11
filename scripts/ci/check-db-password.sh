#!/bin/sh
# check-db-password.sh — Invariant: docker-compose.yml has no literal ":-ruvector"
# password default. The sprint replaced the insecure default-password fallback
# with a required env var (${RUVECTOR_PG_PASSWORD:?...}). A ":-ruvector" default
# would silently ship a known DB password — fail if it reappears.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
FILE="$ROOT/docker-compose.yml"

fail() { echo "FAIL (check-db-password): $1" >&2; exit 1; }

[ -f "$FILE" ] || fail "missing $FILE"

# Look for the default-substitution pattern ":-ruvector" anywhere (e.g.
# ${RUVECTOR_PG_PASSWORD:-ruvector}). Comments stripped to avoid false positives.
if sed -e 's/[[:space:]]*#.*$//' "$FILE" | grep -nE ':-ruvector\b'; then
  echo "FAIL (check-db-password): literal ':-ruvector' password default found in" >&2
  echo "  docker-compose.yml. Use a required var (\${RUVECTOR_PG_PASSWORD:?...})." >&2
  exit 1
fi

echo "PASS (check-db-password): no ':-ruvector' password default in docker-compose.yml"
