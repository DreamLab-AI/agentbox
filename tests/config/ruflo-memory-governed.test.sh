#!/usr/bin/env bash
# ADR-2123 — the image's `ruflo` / `claude-flow` bins are the governed wrappers:
# `memory` routes to mcp/servers/ruflo-memory-cli.cjs (the ruvector-postgres
# sidecar via lib/memory-tools.js), every other subcommand runs with no daemon
# autostart, no AgentDB bridge and the bookkeeping store outside the CWD.
# Static checks over the shipped sources, plus a live check of the wrapper's
# routing when `ruflo` on PATH is the governed one (inside the image).
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
fail=0
note() { echo "FAIL: $*"; fail=1; }

# 1. The wrapper derivation exists and is what the gated package list ships.
grep -q 'rufloGovernedPkg = pkgs.runCommand' "$root/flake.nix" || note 'flake.nix lost rufloGovernedPkg'
grep -q 'rufloConsoleOn) \[ rufloGovernedPkg \]' "$root/flake.nix" || note 'the ruflo gate must ship rufloGovernedPkg, not rufloPkg'
grep -q 'exec \${pkgs.nodejs_22}/bin/node /opt/agentbox/mcp/servers/ruflo-memory-cli.cjs' "$root/flake.nix" || note 'wrapper does not exec the governed memory CLI'
for v in RUFLO_DAEMON_AUTOSTART CLAUDE_FLOW_DISABLE_BRIDGE CLAUDE_FLOW_MEMORY_PATH; do
  grep -q "export $v=" "$root/flake.nix" || note "wrapper does not default $v"
  # The exports live in the runtime-env heredoc: a plain ${X:-…} resolves at boot,
  # an escaped \${X:-…} resolves in the sourcing shell (per-user $HOME). Either
  # form keeps the operator override; RC-X1-01 forbids a root-side literal
  # /home/devuser path, which is why CLAUDE_FLOW_MEMORY_PATH is the escaped one.
  grep -qE "^export $v=\"\\\\?\\\$\{$v:-" "$root/config/entrypoint-unified.sh" || note "entrypoint does not export $v with an operator-overridable default"
done

# 2. The CLI ships, is CommonJS, reuses the governed library and refuses the local-store verbs.
cli="$root/mcp/servers/ruflo-memory-cli.cjs"
[[ -f "$cli" ]] || note 'mcp/servers/ruflo-memory-cli.cjs missing'
grep -q "require(path.join(__dirname, 'lib', 'memory-tools.js'))" "$cli" || note 'CLI must reuse lib/memory-tools.js (single memory implementation)'
for verb in init configure backup export import purge distill migrate; do
  grep -qE "'$verb'" "$cli" || note "CLI no longer refuses '$verb'"
done
node -e "const c=require('$cli'); if (c.WRITE_SOURCE_TYPE!=='agentbox') process.exit(1)" || note 'CLI write source must match ruvector-mcp.cjs (agentbox) so entry ids coincide'

# 3. Nothing the image ships runs a local `memory init` (it would be refused anyway; keep the sources honest).
set +e
hits="$(grep -rnE '(ruflo|claude-flow)[[:space:]]+memory[[:space:]]+init' "$root/config" "$root/scripts" "$root/aisp" 2>/dev/null | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#')"
set -e
[[ -z "$hits" ]] || note "shipped source runs ruflo memory init: $hits"

# 4. Live, only inside the image: the governed wrapper routes `memory help` to the CLI
#    and `--help` on the real CLI spawns no daemon.
if command -v ruflo >/dev/null 2>&1 && grep -q 'ADR-2123' "$(command -v ruflo)" 2>/dev/null; then
  ruflo memory help 2>/dev/null | grep -q 'ADR-2123' || note 'live: `ruflo memory help` is not the governed CLI'
  tmp="$(mktemp -d)"; ( cd "$tmp" && ruflo --help >/dev/null 2>&1 || true )
  [[ -e "$tmp/.claude-flow/daemon.pid" ]] && note 'live: `ruflo --help` still autostarted a daemon'
  [[ -e "$tmp/ruvector.db" || -d "$tmp/.swarm" ]] && note 'live: `ruflo --help` still wrote a local store into the CWD'
  rm -rf "$tmp"
fi

[[ $fail -eq 0 ]] || exit 1
echo 'PASS: ruflo memory is governed (sidecar via the wrapper); the real CLI runs repo-safe'
