#!/usr/bin/env bash
# ROLE: Container bootstrap + runtime dependency installer.
#
# Runs in two stages:
#   Stage A (phases 1-5): one-shot container bootstrap — directories, management
#                         key, sovereign identity, workspace defaults, supervisord.
#   Stage B (phases 6-8): supervisord [program:bootstrap] — Node/npm skill deps,
#                         optional CLI toolchains, profile.d env hints.
#
# Stage selection: supervisord's [program:bootstrap] block sets
#   environment=AGENTBOX_BOOTSTRAP_STAGE="B"
# so when the script is re-invoked as that supervised program, we skip phases
# 1-5 (already done) and execute phases 6-8 directly.
#
# Do NOT source this file; it must be exec'd.

set -euo pipefail

# Stage dispatch — when running as the supervisord bootstrap program, skip to B.
if [ "${AGENTBOX_BOOTSTRAP_STAGE:-A}" = "B" ]; then
  echo "[bootstrap] Stage B — installing runtime dependencies"
  # Jump to Stage B by sourcing the Stage B function block below; we achieve
  # this by defining stage_b() and running it, then exiting cleanly so
  # supervisord records a successful one-shot.
  STAGE_B_MODE=1
else
  STAGE_B_MODE=0
  echo "========================================"
  echo "  AGENTBOX"
  echo "  Modular Sovereign Agent Environment"
  echo "========================================"
  echo "  Date: $(date -Iseconds)"
  echo ""
fi

if [ "$STAGE_B_MODE" = "0" ]; then

# ---------------------------------------------------------------------------
# Bootstrap observability — BootstrapStarted (PRD-002 §5.6)
# ---------------------------------------------------------------------------
printf '{"level":"info","time":"%s","agentbox.stage":"bootstrap","event":"BootstrapStarted"}\n' \
  "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# ---------------------------------------------------------------------------
# Legal-write assertion — defence in depth (PRD-002 §9 Phase 3, item 4)
# If /opt/agentbox is unexpectedly writable:
#   - default: warn and continue (operator may rely on tolerant behaviour)
#   - AGENTBOX_STRICT_IMMUTABLE=true: emit the warning AND exit 1 (closes
#     the PRD-002 §6 AC-A4 semantic gap for deployments that want the
#     invariant enforced hard).
# ---------------------------------------------------------------------------
if touch /opt/agentbox/.write-probe 2>/dev/null; then
  rm -f /opt/agentbox/.write-probe
  printf '{"level":"warn","time":"%s","agentbox.stage":"bootstrap","event":"ImmutableRootWritable","message":"/opt/agentbox is mounted writable — operator config violates immutable root invariant (ADR-006)"}\n' \
    "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  if [ "${AGENTBOX_STRICT_IMMUTABLE:-false}" = "true" ]; then
    printf '{"level":"error","time":"%s","agentbox.stage":"bootstrap","event":"BootstrapFailed","reason":"ImmutableRootWritable with AGENTBOX_STRICT_IMMUTABLE=true"}\n' \
      "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Phase 1 — Environment defaults + runtime directory creation
# ---------------------------------------------------------------------------
export WORKSPACE="${WORKSPACE:-/workspace}"
export AGENTBOX_CONFIG="${AGENTBOX_CONFIG:-/etc/agentbox.toml}"
export RUVECTOR_DATA_DIR="${RUVECTOR_DATA_DIR:-/var/lib/ruvector}"
export SOLID_POD_ROOT="${SOLID_POD_ROOT:-/var/lib/solid}"
export MANAGEMENT_API_PORT="${MANAGEMENT_API_PORT:-9090}"
export RUVECTOR_PORT="${RUVECTOR_PORT:-9700}"
export SOLID_POD_PORT="${SOLID_POD_PORT:-8484}"
export SHARED_PROJECTS_ROOT="${SHARED_PROJECTS_ROOT:-/projects}"

echo "[1/8] Preparing runtime directories..."
mkdir -p \
  "$WORKSPACE" \
  "$SHARED_PROJECTS_ROOT" \
  "$RUVECTOR_DATA_DIR" \
  "$SOLID_POD_ROOT" \
  /var/lib/agentbox/identities \
  /var/log/supervisor \
  /var/run \
  /tmp/screenshots \
  "$WORKSPACE/.cache/ms-playwright"

chmod 755 "$RUVECTOR_DATA_DIR"

# Non-root user: chown writable directories to devuser (uid 1000, gid 1000).
# Supervisord (PID 1) stays root; interactive shells and tmux run as devuser.
chown -R 1000:1000 \
  "$WORKSPACE" \
  "$SHARED_PROJECTS_ROOT" \
  "$RUVECTOR_DATA_DIR" \
  "$SOLID_POD_ROOT" \
  /var/lib/agentbox \
  /var/lib/nostr-relay \
  /var/lib/https-bridge \
  /var/log \
  /tmp \
  /etc \
  /home/devuser \
  2>/dev/null || true

# Claude-flow data directory (hooks write here as devuser)
mkdir -p /home/devuser/.claude-flow/data 2>/dev/null || true
chown -R 1000:1000 /home/devuser/.claude-flow 2>/dev/null || true

# ---------------------------------------------------------------------------
# Phase 2 — Management API key auto-generation
# ---------------------------------------------------------------------------
MGMT_KEY_FILE="$WORKSPACE/profiles/default/mgmt-key"
_legacy_sentinel="change-this-secret-key"
if [ -z "${MANAGEMENT_API_KEY:-}" ] || [ "${MANAGEMENT_API_KEY:-}" = "$_legacy_sentinel" ]; then
  if [ -f "$MGMT_KEY_FILE" ]; then
    MANAGEMENT_API_KEY="$(cat "$MGMT_KEY_FILE")"
  else
    mkdir -p "$(dirname "$MGMT_KEY_FILE")"
    if command -v openssl >/dev/null 2>&1; then
      MANAGEMENT_API_KEY="$(openssl rand -hex 32)"
    else
      MANAGEMENT_API_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    fi
    printf '%s' "$MANAGEMENT_API_KEY" > "$MGMT_KEY_FILE"
    chmod 0600 "$MGMT_KEY_FILE"
    echo "[bootstrap] Generated management API key -> $MGMT_KEY_FILE"
  fi
  export MANAGEMENT_API_KEY
fi
unset _legacy_sentinel

if [ "${ENABLE_DESKTOP:-false}" = "true" ]; then
  mkdir -p /tmp/.X11-unix
  chmod 1777 /tmp/.X11-unix
fi

# ---------------------------------------------------------------------------
# Phase 3 — Sovereign mesh identity bootstrap
# ---------------------------------------------------------------------------
echo "[2/8] Bootstrapping sovereign mesh identity..."
python3 /opt/agentbox/scripts/sovereign-bootstrap.py

# ---------------------------------------------------------------------------
# Phase 4 — Workspace defaults (agents dir, tmux config, README)
# ---------------------------------------------------------------------------
echo "[3/8] Ensuring workspace defaults..."
if [ ! -d "$WORKSPACE/agents" ]; then
  mkdir -p "$WORKSPACE/agents"
fi

# Shell profile seeding — create /etc/bash.bashrc if it doesn't exist
# (nix2container images have no FHS paths by default)
touch /etc/bash.bashrc 2>/dev/null || true
if ! grep -q "source.*agentbox-aliases" /etc/bash.bashrc 2>/dev/null; then
  echo "source /opt/agentbox/config/agentbox-aliases.sh" >> /etc/bash.bashrc
fi
if ! grep -q "source.*bashrc.agentbox" /etc/bash.bashrc 2>/dev/null; then
  echo "source /opt/agentbox/config/bashrc.agentbox" >> /etc/bash.bashrc
fi
# Also seed /etc/profile for login shells
touch /etc/profile 2>/dev/null || true
if ! grep -q "source.*bashrc.agentbox" /etc/profile 2>/dev/null; then
  echo "source /opt/agentbox/config/bashrc.agentbox" >> /etc/profile
fi
# Fish shell config
mkdir -p /etc/fish 2>/dev/null || true
if [ -f /opt/agentbox/config/config.fish ] && ! grep -q "config.fish" /etc/fish/config.fish 2>/dev/null; then
  echo "source /opt/agentbox/config/config.fish" >> /etc/fish/config.fish
fi

# Claude Code config — bridge host mount to HOME
# The host .claude/ is mounted at /home/devuser/.claude but HOME=/workspace
# Create a symlink so Claude Code finds its OAuth tokens and settings
if [ -d /home/devuser/.claude ] && [ ! -e "$WORKSPACE/.claude" ]; then
  ln -sf /home/devuser/.claude "$WORKSPACE/.claude"
fi

# i3 window manager config
mkdir -p "$WORKSPACE/.config/i3" 2>/dev/null || true
if [ -f /opt/agentbox/config/i3/config ] && [ ! -f "$WORKSPACE/.config/i3/config" ]; then
  cp /opt/agentbox/config/i3/config "$WORKSPACE/.config/i3/config"
fi

# tmux config — fish shell + dark theme status bar
# Replaces Zellij (see config/tmux.conf, config/tmux-autostart.sh)
cp /opt/agentbox/config/tmux.conf "$HOME/.tmux.conf" 2>/dev/null || \
  cp /opt/agentbox/config/tmux.conf "$WORKSPACE/.tmux.conf" 2>/dev/null || true

if [ ! -f "$WORKSPACE/README.agentbox.md" ]; then
  cat > "$WORKSPACE/README.agentbox.md" <<'EOF'
# Agentbox Workspace

Runtime state is mounted under:
- `/workspace`
- `/var/lib/ruvector`
- `/var/lib/solid`
- `/var/lib/agentbox/identities`
EOF
fi

# ---------------------------------------------------------------------------
# Phase 5 — Agent stack provisioning, then hand off to supervisord
# ---------------------------------------------------------------------------
echo "[4/8] Provisioning agent stacks..."
python3 /opt/agentbox/scripts/provision-agent-stacks.py

# ---------------------------------------------------------------------------
# Phase 5a — Artifact validation (must pass before supervisord starts)
# Reads config/artifact-probes.json; exits 1 on any required-probe failure.
# ---------------------------------------------------------------------------
echo "[5/8] Validating runtime closure..."
if ! bash /opt/agentbox/config/validate-artifacts.sh; then
  printf '{"level":"fatal","time":"%s","agentbox.stage":"bootstrap","event":"BootstrapFailed","reason":"artifact validation failed — see MissingArtifactDetected events above"}\n' \
    "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  exit 1
fi

# ---------------------------------------------------------------------------
# Phase 5b — Ensure /run/agentbox sentinel directory exists on tmpfs.
# The sentinel itself is written by [program:bootstrap-seal] after supervisord
# has confirmed required programs are RUNNING (Option A from PRD-002 §9).
# ---------------------------------------------------------------------------
mkdir -p /run/agentbox

echo "[5/8] Starting supervisord..."
exec supervisord -c /etc/supervisord.conf -n

fi  # end STAGE_B_MODE=0 block — Stage A exits via exec above

# ---------------------------------------------------------------------------
# Stage B — supervisord [program:bootstrap] enters here (AGENTBOX_BOOTSTRAP_STAGE=B)
# Re-exports critical env that Phase-1 would have set (since Stage A lives in
# the PID-1 supervisord process and its env is inherited by children).
# ---------------------------------------------------------------------------
export WORKSPACE="${WORKSPACE:-/workspace}"
export RUVECTOR_DATA_DIR="${RUVECTOR_DATA_DIR:-/var/lib/ruvector}"
export SOLID_POD_ROOT="${SOLID_POD_ROOT:-/var/lib/solid}"
export RUVECTOR_PORT="${RUVECTOR_PORT:-9700}"
export AGENTBOX_CONFIG="${AGENTBOX_CONFIG:-/etc/agentbox.toml}"
export SHARED_PROJECTS_ROOT="${SHARED_PROJECTS_ROOT:-/projects}"

# ---------------------------------------------------------------------------
# Phase 6 — Service closure probes (PRD-002 §9 Phase 1)
#
# Node dependency installation has been removed.  node_modules are baked into
# the image by the Nix build derivations in lib/npm-services.nix.  This phase
# now validates that those closures are present before services start.
#
# A missing node_modules path here is a packaging defect, not a runtime issue;
# the failure is fatal so the operator sees it immediately rather than after a
# service crash.
# ---------------------------------------------------------------------------
echo "[6/8] Validating pre-packaged service closures..."

_probe_closure() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    printf '{"level":"fatal","time":"%s","agentbox.stage":"bootstrap","event":"MissingArtifactDetected","path":"%s","reason":"node_modules not present — rerun nix build and push the image"}\n' \
      "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$dir" >&2
    exit 1
  fi
}

_probe_closure /opt/agentbox/management-api
_probe_closure /opt/agentbox/mcp
if [ "${ENABLE_CODEX:-false}" = "true" ]; then
  _probe_closure /opt/agentbox/skills/openai-codex/mcp-server
fi
if [ "${ENABLE_RUFLO:-false}" = "true" ] || [ "${ENABLE_CLAUDE_FLOW:-false}" = "true" ]; then
  _probe_closure /opt/agentbox/skills/lazy-fetch/mcp-server
fi
if [ "${ENABLE_PLAYWRIGHT:-false}" = "true" ]; then
  _probe_closure /opt/agentbox/skills/playwright/mcp-server
fi
if [ "${ENABLE_COMFYUI_BUILTIN:-false}" = "true" ]; then
  _probe_closure /opt/agentbox/skills/comfyui/mcp-server
fi

echo "[6/8] Service closures OK."

# ---------------------------------------------------------------------------
# Phase 7 — REMOVED (PRD-002 §9 Phase 2)
# ---------------------------------------------------------------------------
# All npm global CLIs are now Nix derivations in flake.nix:
#   ruvector, @claude-flow/cli, ruflo, agentic-qe, nagual-qe,
#   codebase-memory-mcp, agent-browser, playwright, @mermaid-js/mermaid-cli
# They are present in PATH via the image closure. No runtime installs needed.
#
# Deferred first-run steps (run from agentbox.sh init, not here):
#   agentic-qe: aqe init --auto (writes $HOME/.claude/agents/ templates)
#   playwright: browsers are pre-built in PLAYWRIGHT_BROWSERS_PATH (Nix store)
echo "[7/8] npm CLI toolchains pre-packaged in image — skipping runtime install"

# ---------------------------------------------------------------------------
# Phase 8 — Publish environment hints to profile.d
# ---------------------------------------------------------------------------
echo "[8/8] Publishing environment hints..."
cat > /etc/profile.d/agentbox-runtime.sh <<EOF
export WORKSPACE="$WORKSPACE"
export RUVECTOR_DATA_DIR="$RUVECTOR_DATA_DIR"
export RUVECTOR_PORT="$RUVECTOR_PORT"
export SOLID_POD_ROOT="${SOLID_POD_ROOT:-/var/lib/solid}"
export AGENTBOX_CONFIG="${AGENTBOX_CONFIG:-/etc/agentbox.toml}"
export SKILLS_TREE="${SKILLS_TREE:-/opt/agentbox/skills}"
export SHARED_PROJECTS_ROOT="${SHARED_PROJECTS_ROOT:-/projects}"
EOF

# ---------------------------------------------------------------------------
# Phase 8a — Start tmux session in background (MAD-style multi-tab workspace)
# ---------------------------------------------------------------------------
if [ -x /opt/agentbox/config/tmux-autostart.sh ]; then
  /opt/agentbox/config/tmux-autostart.sh &
fi

echo "[AGENTBOX] Runtime bootstrap complete"
