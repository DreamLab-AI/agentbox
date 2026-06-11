#!/bin/sh
# check-nnp.sh — Invariant: docker-compose.yml keeps no-new-privileges:true and
# keeps SETUID+SETGID in cap_add.
#
# no-new-privileges:true blocks privilege *gaining* (setuid file bits at
# execve). It does NOT cover privilege *dropping*: supervisord (root PID 1)
# needs CAP_SETGID/CAP_SETUID to setgroups()/setuid() its children down to
# devuser. Removing them breaks every `user=devuser` program with exit 127
# ("couldn't setuid to 1000"). This check fails if no-new-privileges is
# removed, or if SETUID/SETGID disappear from the live cap_add entries.
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

# 2. SETUID and SETGID must BOTH be present as live cap_add list entries —
#    supervisord's privilege-drop path (root PID 1 -> user=devuser) requires them.
for cap in SETUID SETGID; do
  if ! strip | grep -Eq "^[[:space:]]*-[[:space:]]*${cap}[[:space:]]*\$"; then
    fail "${cap} missing from live cap_add entries; supervisord cannot drop to devuser without it"
  fi
done

echo "PASS (check-nnp): no-new-privileges:true present; SETUID/SETGID present for the supervisord privilege-drop path"
