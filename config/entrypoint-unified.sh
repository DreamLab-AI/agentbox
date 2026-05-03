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

# Pre-install the Anthropic skill-creator plugin so /skill-creator works on
# first boot. The plugin payload arrives via the host bind-mount of
# ~/.claude/plugins/marketplaces/claude-plugins-official; we just need to
# register it in installed_plugins.json. Idempotent — skips if already there.
SKILL_CREATOR_DIR="/home/devuser/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator"
INSTALLED_JSON="/home/devuser/.claude/plugins/installed_plugins.json"
if [ -d "$SKILL_CREATOR_DIR" ] && [ -f "$INSTALLED_JSON" ]; then
  if ! grep -q '"skill-creator@claude-plugins-official"' "$INSTALLED_JSON" 2>/dev/null; then
    python3 - <<PY 2>/dev/null || true
import json, datetime, sys
path = "$INSTALLED_JSON"
try:
    with open(path) as f:
        data = json.load(f)
except Exception:
    sys.exit(0)
data.setdefault("plugins", {})
key = "skill-creator@claude-plugins-official"
if key not in data["plugins"]:
    now = datetime.datetime.utcnow().isoformat() + "Z"
    data["plugins"][key] = [{
        "scope": "user",
        "installPath": "$SKILL_CREATOR_DIR",
        "version": "marketplace",
        "installedAt": now,
        "lastUpdated": now,
    }]
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print("[bootstrap] Pre-installed skill-creator from claude-plugins-official")
PY
  fi
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
# Phase 7 — Native ruflo plugin bootstrap
# ---------------------------------------------------------------------------
# Nix-packaged CLIs (claude-flow, ruflo, ruvector) are in PATH.
# Plugins are native .claude-plugin format from github.com/ruvnet/ruflo.
# Two install sources:
#   source = "ruflo-git" (default) — shallow-cloned from GitHub, symlinked
#   source = "registry"            — installed via `ruflo plugins install`
# Memory backend config propagated from [plugins.memory] to config.json.
echo "[7/8] Bootstrapping ruflo plugins..."

_PLUGIN_DIR="${HOME}/.claude-flow/plugins"
_RUFLO_PLUGINS_CACHE="/var/cache/ruflo-plugins"
_RUFLO_PLUGINS_REPO="https://github.com/ruvnet/ruflo.git"
mkdir -p "$_PLUGIN_DIR" "$_RUFLO_PLUGINS_CACHE" 2>/dev/null || true
chown -R 1000:1000 "$_PLUGIN_DIR" 2>/dev/null || true

# Write plugin memory config from agentbox.toml [plugins.memory] ->
# .claude-flow/config.json so the MCP server and plugins share the same
# ruvector-postgres connection.
_CF_CONFIG_DIR="${HOME}/.claude-flow"
if [ ! -f "$_CF_CONFIG_DIR/config.json" ] || ! grep -q "ruvector-postgres" "$_CF_CONFIG_DIR/config.json" 2>/dev/null; then
  cat > "$_CF_CONFIG_DIR/config.json" <<'CFEOF'
{
  "version": "3.0.0",
  "memory": {
    "backend": "postgres",
    "postgres": {
      "host": "ruvector-postgres",
      "port": 5432,
      "database": "ruvector",
      "user": "ruvector",
      "password": "ruvector_secure_pass"
    },
    "fallback": "sqlite",
    "enableHNSW": true
  },
  "plugins": {
    "autoUpdate": false,
    "directory": "/home/devuser/.claude-flow/plugins"
  }
}
CFEOF
  chown 1000:1000 "$_CF_CONFIG_DIR/config.json" 2>/dev/null || true
fi

if command -v ruflo >/dev/null 2>&1; then

  # --- Step 1: Clone/update ruflo plugins from GitHub (sparse checkout) ---
  if [ -d "$_RUFLO_PLUGINS_CACHE/.git" ]; then
    echo "  [plugin] Updating ruflo plugins cache..."
    git -C "$_RUFLO_PLUGINS_CACHE" pull --ff-only --depth 1 2>/dev/null || true
  else
    echo "  [plugin] Cloning ruflo plugins (sparse, depth 1)..."
    git clone --depth 1 --filter=blob:none --sparse \
      "$_RUFLO_PLUGINS_REPO" "$_RUFLO_PLUGINS_CACHE" 2>/dev/null || true
    git -C "$_RUFLO_PLUGINS_CACHE" sparse-checkout set plugins 2>/dev/null || true
  fi
  chown -R 1000:1000 "$_RUFLO_PLUGINS_CACHE" 2>/dev/null || true

  # --- Step 2: Install declared plugins from agentbox.toml ---
  # Reads [[plugins.packages]] blocks. Fields: name, enabled, source (optional).
  # source = "ruflo-git" (default): symlink from cache into plugin dir.
  # source = "registry": install via `ruflo plugins install -n`.
  if [ -f "$AGENTBOX_CONFIG" ]; then
    _in_plugin_block=0
    _plugin_name=""
    _plugin_source=""
    while IFS= read -r line; do
      case "$line" in
        *'[[plugins.packages]]'*)
          _in_plugin_block=1
          _plugin_name=""
          _plugin_source="ruflo-git"
          ;;
        *)
          if [ "$_in_plugin_block" = "1" ]; then
            case "$line" in
              *name*=*)
                _plugin_name="$(echo "$line" | sed 's/.*= *"\(.*\)"/\1/')"
                ;;
              *source*=*\"registry\"*)
                _plugin_source="registry"
                ;;
              *source*=*\"ruflo-git\"*)
                _plugin_source="ruflo-git"
                ;;
              *enabled*=*true*)
                if [ -n "$_plugin_name" ]; then
                  if [ "$_plugin_source" = "registry" ]; then
                    echo "  [plugin] Installing $_plugin_name from IPFS registry..."
                    su -s /bin/bash devuser -c "ruflo plugins install -n '$_plugin_name'" 2>&1 | tail -3 || true
                  else
                    _src="$_RUFLO_PLUGINS_CACHE/plugins/$_plugin_name"
                    _dst="$_PLUGIN_DIR/$_plugin_name"
                    if [ -d "$_src" ]; then
                      if [ ! -e "$_dst" ]; then
                        ln -sf "$_src" "$_dst"
                        echo "  [plugin] Linked $_plugin_name"
                      else
                        echo "  [plugin] $_plugin_name already present"
                      fi
                    else
                      echo "  [plugin] WARN: $_plugin_name not found in ruflo cache"
                    fi
                  fi
                fi
                _in_plugin_block=0
                ;;
              *enabled*=*false*)
                echo "  [plugin] $_plugin_name disabled — skipping"
                _in_plugin_block=0
                ;;
              *'['*)
                _in_plugin_block=0
                ;;
            esac
          fi
          ;;
      esac
    done < "$AGENTBOX_CONFIG"
  fi

  # --- Step 3: Write installed.json manifest for MCP server ---
  _manifest="$_PLUGIN_DIR/installed.json"
  {
    printf '{"version":"1.0.0","lastUpdated":"%s","plugins":{' "$(date -Iseconds)"
    _first=1
    for _pdir in "$_PLUGIN_DIR"/*/; do
      [ -d "$_pdir" ] || continue
      _pjson="$_pdir/.claude-plugin/plugin.json"
      if [ -f "$_pjson" ]; then
        _pname="$(grep '"name"' "$_pjson" | head -1 | sed 's/.*: *"\(.*\)".*/\1/')"
        _pver="$(grep '"version"' "$_pjson" | head -1 | sed 's/.*: *"\(.*\)".*/\1/')"
        [ "$_first" = "1" ] && _first=0 || printf ','
        printf '"%s":{"name":"%s","version":"%s","enabled":true,"source":"ruflo-git","path":"%s"}' \
          "$_pname" "$_pname" "${_pver:-0.1.0}" "$_pdir"
      fi
    done
    printf '}}\n'
  } > "$_manifest"
  chown 1000:1000 "$_manifest" 2>/dev/null || true

  echo "[7/8] Plugin bootstrap complete"
else
  echo "[7/8] ruflo not in PATH — plugin bootstrap skipped"
fi

# ---------------------------------------------------------------------------
# Phase 8 — Publish environment hints to profile.d
# ---------------------------------------------------------------------------
echo "[8/8] Publishing environment hints..."
cat > /etc/profile.d/agentbox-runtime.sh <<EOF
export WORKSPACE="$WORKSPACE"
export RUVECTOR_DATA_DIR="$RUVECTOR_DATA_DIR"
export RUVECTOR_PORT="$RUVECTOR_PORT"
export RUVECTOR_PG_CONNINFO="${RUVECTOR_PG_CONNINFO:-postgresql://ruvector:ruvector@ruvector-postgres:5432/ruvector}"
export SOLID_POD_ROOT="${SOLID_POD_ROOT:-/var/lib/solid}"
export AGENTBOX_CONFIG="${AGENTBOX_CONFIG:-/etc/agentbox.toml}"
export SKILLS_TREE="${SKILLS_TREE:-/opt/agentbox/skills}"
export SHARED_PROJECTS_ROOT="${SHARED_PROJECTS_ROOT:-/projects}"
export CLAUDE_FLOW_PLUGIN_DIR="${CLAUDE_FLOW_PLUGIN_DIR:-/home/devuser/.claude-flow/plugins}"
EOF

# ---------------------------------------------------------------------------
# Phase 8a — Start tmux session in background (MAD-style multi-tab workspace)
# ---------------------------------------------------------------------------
if [ -x /opt/agentbox/config/tmux-autostart.sh ]; then
  /opt/agentbox/config/tmux-autostart.sh &
fi

echo "[AGENTBOX] Runtime bootstrap complete"
