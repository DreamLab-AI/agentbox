#!/bin/sh
# check-db-password.sh — Invariant: the RuVector Postgres password has no literal
# default and appears in no conninfo string anywhere the image ships.
#
# 1. docker-compose.yml / docker-compose.override.yml have no ":-ruvector"
#    password default; the password is the required form
#    (${RUVECTOR_PG_PASSWORD:?...}) and no compose file injects a conninfo.
# 2. No shipped source (config/, management-api/, mcp/, scripts/, skills/, the
#    dream-engine, flake.nix, agentbox.sh) carries a default password literal
#    ("password=ruvector", "ruvector:ruvector@", "${RUVECTOR_PG_PASSWORD:-…}",
#    "${RUVECTOR_PG_PASSWORD:=…}") or a `RUVECTOR_PG_CONNINFO` other than the
#    entrypoint's one credential-scrub pass. The password has one source: the
#    0600 file named by RUVECTOR_PG_PASSWORD_FILE (management-api/lib/pg-config.js).
#    tests/sovereign/pg-credential-custody.test.js pins the same rules per pattern.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

fail() { echo "FAIL (check-db-password): $1" >&2; exit 1; }

for f in docker-compose.yml docker-compose.override.yml; do
  FILE="$ROOT/$f"
  [ -f "$FILE" ] || continue
  # Comments stripped to avoid false positives.
  if sed -e 's/[[:space:]]*#.*$//' "$FILE" | grep -nE ':-ruvector\b'; then
    echo "FAIL (check-db-password): literal ':-ruvector' password default found in" >&2
    echo "  $f. Use a required var (\${RUVECTOR_PG_PASSWORD:?...})." >&2
    exit 1
  fi
  if sed -e 's/[[:space:]]*#.*$//' "$FILE" | grep -n 'RUVECTOR_PG_CONNINFO'; then
    fail "$f injects a RUVECTOR_PG_CONNINFO; pass only the required RUVECTOR_PG_PASSWORD"
  fi
done

cd "$ROOT"
PATTERN='password=ruvector([^A-Za-z0-9_-]|$)|ruvector:ruvector@|RUVECTOR_PG_PASSWORD:[-=][^}]'
HITS="$(grep -rnE "$PATTERN" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=target \
          --exclude=check-db-password.sh \
          config management-api mcp scripts skills services/dream-engine/src flake.nix agentbox.sh \
          docker-compose.yml docker-compose.override.yml 2>/dev/null || true)"
if [ -n "$HITS" ]; then
  echo "$HITS" >&2
  fail "a default password literal is back in shipped source (see above)"
fi

echo "PASS (check-db-password): no default password literal or compose conninfo"
