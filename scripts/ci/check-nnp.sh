#!/bin/sh
# check-nnp.sh — Invariant: docker-compose.yml keeps no-new-privileges:true and
# does NOT add SETUID/SETGID capabilities.
#
# no-new-privileges:true neuters setuid bits, so SETUID/SETGID in cap_add would
# be both useless and a misleading attack surface. The sprint deliberately kept
# them out. This check fails if no-new-privileges is removed, or if SETUID/SETGID
# appear as live (non-comment) cap_add entries.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
FILE="$ROOT/docker-compose.yml"

fail() { echo "FAIL (check-nnp): $1" >&2; exit 1; }

[ -f "$FILE" ] || fail "missing $FILE"

# Strip comments (everything from an unquoted '#' to EOL) and blank lines so we
# only inspect live YAML.
strip() { sed -e 's/[[:space:]]*#.*$//' "$FILE"; }

# 1. no-new-privileges:true must be present as a live entry.
if ! strip | grep -Eq 'no-new-privileges[[:space:]]*:[[:space:]]*true'; then
  fail "no-new-privileges:true not found as a live entry in docker-compose.yml"
fi

# 2. SETUID / SETGID must NOT appear as live cap_add list entries.
#    cap_add entries are YAML list items like "  - SETUID".
if strip | grep -Eq '^[[:space:]]*-[[:space:]]*(SETUID|SETGID)[[:space:]]*$'; then
  bad="$(strip | grep -nE '^[[:space:]]*-[[:space:]]*(SETUID|SETGID)[[:space:]]*$')"
  echo "FAIL (check-nnp): SETUID/SETGID found as live cap_add entry:" >&2
  echo "$bad" >&2
  exit 1
fi

echo "PASS (check-nnp): no-new-privileges:true present; no live SETUID/SETGID cap_add"
