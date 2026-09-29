#!/usr/bin/env bash
# ADR-2118 — the tracked instruction layers are public; the estate layer is not.
#
# config/instructions/*.md ship in a public repository and are projected into
# every deployment's instruction tiers. Estate specifics — private addresses,
# host paths, the operator's handles, relay endpoints, key material — belong in
# the gitignored config/instructions/local/. This gate fails when one leaks
# into a tracked layer, when local/ stops being ignored, and when the tracked
# layers stop composing (every tier needs its layer; the Claude notes need the
# `@AGENTS.md` line the workspace tier is embedded at).
# Run: bash tests/config/instructions-layers.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
LAYERS="$REPO/config/instructions"

pass=0
fail=0
ok()  { pass=$((pass+1)); echo "  ok   $1"; }
bad() { fail=$((fail+1)); echo "  FAIL $1"; }

# Estate markers: private IPv4 ranges, host-side mount roots, operator handles
# and host names, deployed relay/worker hosts, raw key material.
LEAK='(^|[^0-9.])(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]{1,3}\.[0-9]{1,3}|/mnt/|/home/machinelearn|jjohare|machinelearn|workers\.dev|wss://|nsec1[0-9a-z]{20,}|ssh [a-z]+@'

for tier in global workspace workspace.claude; do
  f="$LAYERS/$tier.md"
  if [ -f "$f" ]; then ok "$tier.md present"; else bad "$tier.md missing"; continue; fi
  if hits=$(grep -nE "$LEAK" "$f"); then
    bad "$tier.md carries estate specifics (move them to local/$tier.md):"
    echo "$hits" | sed 's/^/         /'
  else
    ok "$tier.md is free of estate specifics"
  fi
done

if grep -qx '@AGENTS.md' "$LAYERS/workspace.claude.md" 2>/dev/null; then
  ok "workspace.claude.md keeps the @AGENTS.md embed point"
else
  bad "workspace.claude.md lost its @AGENTS.md line (the workspace tier would be inserted after the title instead)"
fi

probe="config/instructions/local/workspace.md"
if git -C "$REPO" check-ignore -q "$probe"; then
  ok "config/instructions/local/ is gitignored"
else
  bad "config/instructions/local/ is NOT gitignored — estate facts would be committed"
fi
if [ -z "$(git -C "$REPO" ls-files config/instructions/local)" ]; then
  ok "nothing under local/ is tracked"
else
  bad "files under config/instructions/local/ are tracked: $(git -C "$REPO" ls-files config/instructions/local | tr '\n' ' ')"
fi

echo "instructions-layers: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
