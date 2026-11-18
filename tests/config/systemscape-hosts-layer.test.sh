#!/usr/bin/env bash
# ADR-2203 — the SystemScape hosts layer: public example, private local/.
#
# config/systemscape/ is mounted read-only at /etc/agentbox/systemscape and its
# local/hosts.toml is linked to SystemScape's default path at boot. This gate
# fails when local/ stops being ignored or has tracked files, when a tracked
# file carries estate specifics, when the flake and the generated compose stop
# agreeing on the mount, or when the System pane starts naming the file (the
# pinned binary rejects flags it does not know).
# Run: bash tests/config/systemscape-hosts-layer.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DIR="$REPO/config/systemscape"
MOUNT='./config/systemscape:/etc/agentbox/systemscape:ro'

pass=0
fail=0
ok()  { pass=$((pass+1)); echo "  ok   $1"; }
bad() { fail=$((fail+1)); echo "  FAIL $1"; }

LEAK='(^|[^0-9.])(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]{1,3}\.[0-9]{1,3}|/mnt/|/home/(john|machinelearn)|jjohare|machinelearn|workers\.dev|nsec1[0-9a-z]{20,}'
for f in README.md hosts.example.toml; do
  if [ ! -f "$DIR/$f" ]; then bad "$f missing"; continue; fi
  if hits=$(grep -nE "$LEAK" "$DIR/$f"); then
    bad "$f carries estate specifics (they belong in local/hosts.toml):"
    echo "$hits" | sed 's/^/         /'
  else
    ok "$f is free of estate specifics"
  fi
done

if git -C "$REPO" check-ignore -q config/systemscape/local/hosts.toml; then
  ok "config/systemscape/local/ is gitignored"
else
  bad "config/systemscape/local/ is NOT gitignored — host addresses would be committed"
fi
if [ -z "$(git -C "$REPO" ls-files config/systemscape/local)" ]; then
  ok "nothing under config/systemscape/local/ is tracked"
else
  bad "config/systemscape/local/ has tracked files"
fi

if grep -qF "\"$MOUNT\"" "$REPO/flake.nix"; then ok "flake mounts config/systemscape read-only"; else bad "flake.nix lacks $MOUNT"; fi
if grep -qF -- "- $MOUNT" "$REPO/docker-compose.yml"; then ok "generated compose carries the same mount"; else bad "docker-compose.yml lacks $MOUNT (regenerate: nix build .#compose)"; fi

if grep -q '/etc/agentbox/systemscape/local/hosts.toml' "$REPO/config/entrypoint-unified.sh" \
   && grep -q '\.config/systemscape/hosts.toml' "$REPO/config/entrypoint-unified.sh"; then
  ok "entrypoint links the hosts file to SystemScape's default path"
else
  bad "entrypoint no longer links local/hosts.toml to ~/.config/systemscape/hosts.toml"
fi
if grep -nE 'systemscape[^;"]*--hosts' "$REPO/config/tmux-autostart.sh"; then
  bad "the System pane names the hosts file; an older pinned binary would exit on the unknown flag"
else
  ok "the System pane relies on the default path, not a flag"
fi

echo "systemscape-hosts-layer: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
