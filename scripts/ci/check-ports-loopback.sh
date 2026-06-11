#!/bin/sh
# check-ports-loopback.sh — Invariant: every published port in docker-compose.yml
# binds to 127.0.0.1: (loopback-only, SSH-tunnel model — R-003). Fails on any bare
# host-all publish like "9090:9090" or "0.0.0.0:...".
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
FILE="$ROOT/docker-compose.yml"

fail() { echo "FAIL (check-ports-loopback): $1" >&2; exit 1; }

[ -f "$FILE" ] || fail "missing $FILE"

# Extract YAML list-item port publishes, ignoring comments. A publish line looks
# like:   - "127.0.0.1:9090:9090"   or   - 9090:9090   or   - "9090:9090"
# We only inspect quoted/unquoted "<...>:<...>" port mappings under a list item.
bad=""
# Remove comments, then find list items whose value contains a host:container map.
publishes="$(sed -e 's/[[:space:]]*#.*$//' "$FILE" \
  | grep -E '^[[:space:]]*-[[:space:]]*"?[0-9.:]+:[0-9]+"?[[:space:]]*$' || true)"

while IFS= read -r line; do
  [ -n "$line" ] || continue
  # Normalise: strip leading dash/space and surrounding quotes.
  val="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*-[[:space:]]*//' -e 's/"//g' -e 's/[[:space:]]*$//')"
  [ -n "$val" ] || continue
  case "$val" in
    127.0.0.1:*) : ;;                # loopback — OK
    *) bad="$bad$val\n" ;;           # anything else (bare or 0.0.0.0) — violation
  esac
done <<EOF
$publishes
EOF

if [ -n "$bad" ]; then
  echo "FAIL (check-ports-loopback): non-loopback port publish(es) found:" >&2
  printf '%b' "$bad" >&2
  echo "  All published ports must bind to 127.0.0.1: (R-003 SSH-tunnel model)." >&2
  exit 1
fi

echo "PASS (check-ports-loopback): all published ports bind to 127.0.0.1:"
