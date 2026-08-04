#!/usr/bin/env bash
# Claude Code SessionStart hook for the fleet control plane. Three jobs, all
# fail-open (always exit 0 — never blocks Claude starting):
#   1. Name this tmux window by its project (fleet-tab-name.sh).
#   2. Ensure the Nostr control gateway daemon is running.
#   3. Ensure the tab0-bridge (voice/nostr meta-controller) is deployed
#      from config/tab0-bridge/ and running.
#
# Job 2 is belt-and-braces: once flake.nix ships [program:nostr-gateway] the
# supervisor owns the daemon and this becomes a no-op (the gateway's own flock
# means a second launch just exits). Before that rebuild lands, this is what
# keeps the gateway alive. Off switch: AGENTBOX_NOSTR_GATEWAY=0.
set -u
DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || exit 0   # …/config/hooks
AB="$(cd "$DIR/../.." 2>/dev/null && pwd)" || exit 0          # agentbox root

bash "$DIR/fleet-tab-name.sh" 2>/dev/null || true

if [ "${AGENTBOX_NOSTR_GATEWAY:-1}" != "0" ] && command -v node >/dev/null 2>&1; then
  if ! pgrep -f 'nostr-gateway/gateway\.cjs' >/dev/null 2>&1; then
    inbox="$HOME/.claude/nostr-inbox"
    mkdir -p "$inbox" 2>/dev/null || true
    nohup node "$AB/config/nostr-gateway/gateway.cjs" >>"$inbox/gateway.log" 2>&1 &
    disown 2>/dev/null || true
  fi
fi

# Job 3 — belt-and-braces reconciliation for the tab0-bridge. deploy.sh copies
# the workspace copy from the canonical source and installs deps; it then defers
# the PROCESS lifecycle to supervisor's [program:tab0-bridge] when it owns the
# bridge (AGENTBOX_TAB0_BRIDGE_SUPERVISED=1, set in imageEnv on the same gate),
# so there is never a rival launch. On a non-supervised deployment it also
# (re)starts the bridge. Idempotent and cheap. Off switch: AGENTBOX_TAB0_BRIDGE=0.
if [ "${AGENTBOX_TAB0_BRIDGE:-1}" != "0" ] && [ -f "$AB/config/tab0-bridge/deploy.sh" ]; then
  nohup bash "$AB/config/tab0-bridge/deploy.sh" >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi
exit 0
