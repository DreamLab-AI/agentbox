#!/bin/sh
# check-secret-not-in-env.sh — Invariant: config/entrypoint-unified.sh writes the
# Nostr bridge key to a tmpfs file (/run/secrets/nostr.key) AND unsets
# AGENTBOX_BRIDGE_SK from the launcher env BEFORE exec'ing supervisord, so the
# raw secret never inherits into PID 1 or any supervised child.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
FILE="$ROOT/config/entrypoint-unified.sh"

fail() { echo "FAIL (check-secret-not-in-env): $1" >&2; exit 1; }

[ -f "$FILE" ] || fail "missing $FILE"

# Strip comments to assert on live code only.
code="$(sed -e 's/[[:space:]]*#.*$//' "$FILE")"

# 1. The key file write to /run/secrets/nostr.key must exist.
if ! printf '%s\n' "$code" | grep -Eq '/run/secrets/nostr\.key'; then
  fail "no write of the bridge key to /run/secrets/nostr.key found"
fi

# 2. AGENTBOX_BRIDGE_SK must be explicitly unset.
if ! printf '%s\n' "$code" | grep -Eq '^[[:space:]]*unset[[:space:]]+AGENTBOX_BRIDGE_SK([[:space:]]|$)'; then
  fail "AGENTBOX_BRIDGE_SK is never 'unset' in the entrypoint"
fi

# 3. The unset must occur BEFORE the exec of supervisord (line ordering).
unset_line="$(grep -nE '^[[:space:]]*unset[[:space:]]+AGENTBOX_BRIDGE_SK([[:space:]]|$)' "$FILE" | head -1 | cut -d: -f1)"
exec_line="$(grep -nE '^[[:space:]]*exec[[:space:]]+supervisord' "$FILE" | head -1 | cut -d: -f1)"

[ -n "$exec_line" ] || fail "no 'exec supervisord' line found in the entrypoint"

if [ -z "$unset_line" ] || [ "$unset_line" -ge "$exec_line" ]; then
  fail "unset AGENTBOX_BRIDGE_SK (line ${unset_line:-none}) must precede exec supervisord (line $exec_line)"
fi

echo "PASS (check-secret-not-in-env): nostr.key written to /run/secrets; AGENTBOX_BRIDGE_SK unset (line $unset_line) before exec supervisord (line $exec_line)"
