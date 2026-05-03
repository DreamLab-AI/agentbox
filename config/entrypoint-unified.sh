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

# Best-effort chmod. The container has cap_drop: ALL plus a narrow cap_add
# (SYS_ADMIN, NET_ADMIN), neither of which grants CAP_FOWNER, so chmod
# against files not already owned by the bootstrap process fails. The
# named volumes are typically uid 1000 from initial creation, so the
# chmod is idempotent for them anyway. Silenced to avoid spurious noise.
chmod 755 "$RUVECTOR_DATA_DIR" 2>/dev/null || true

# Volume root-only chown to devuser. cap_drop: ALL is now lifted by the
# baseline cap_add list (CHOWN, FOWNER, DAC_OVERRIDE, ...), so this works
# on fresh volumes. Crucially, this is NOT recursive: the workspace mount
# can hold ~157 GB (MAD migration), and `chown -R` over millions of files
# blocks bootstrap for many minutes. The volume root is what services
# care about for permission to mkdir; existing files keep whatever uid
# was set when they were created. Long-running services run as devuser
# (per `user=devuser`), so they own anything they create.
for _vol_root in \
    "$RUVECTOR_DATA_DIR" \
    "$SOLID_POD_ROOT" \
    /var/lib/agentbox \
    /var/lib/agentbox/secrets \
    /var/lib/nostr-relay \
    /var/lib/https-bridge \
    /run/agentbox \
    "$SHARED_PROJECTS_ROOT" \
    /home/devuser/.local/share/code-server \
    /home/devuser/.config/claude-telegram-mirror \
    /home/devuser/.cache; do
  if [ -d "$_vol_root" ]; then
    # Only chown the root, not -R. If the dir is already uid 1000, this
    # is a no-op kernel call.
    chown 1000:1000 "$_vol_root" 2>/dev/null || true
  fi
done

# The workspace is special: if it's the legacy MAD volume, files inside
# are already uid 1000. If it's a fresh agentbox-workspace volume, only
# the root needs to be chowned (services creating new files will own
# them). The `find -not -uid 1000` is bounded to top-level shallow check
# to avoid the full 157 GB walk.
if [ -d "$WORKSPACE" ]; then
  chown 1000:1000 "$WORKSPACE" 2>/dev/null || true
fi

# Claude-flow data directory (hooks write here as devuser)
mkdir -p /home/devuser/.claude-flow/data 2>/dev/null || true
chown -R 1000:1000 /home/devuser/.claude-flow 2>/dev/null || true

# ---------------------------------------------------------------------------
# Phase 2 — Management API key auto-generation
# ---------------------------------------------------------------------------
# Q5: store the auto-generated mgmt key in a dedicated secrets volume
# (mounted as /var/lib/agentbox/secrets via agentbox-secrets named volume).
# Previous location ($WORKSPACE/profiles/default/mgmt-key) put the key in
# the shared workspace volume, exposing it to every process with workspace
# access — including the recycled MAD volume's history. The secrets volume
# has its own mount, mode, and lifecycle.
MGMT_KEY_FILE="${MGMT_KEY_FILE:-/var/lib/agentbox/secrets/mgmt-key}"
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
  # /tmp/.X11-unix is mounted as a Docker tmpfs (mode 1777 by default)
  # via the desktop security exception. mkdir/chmod are best-effort because
  # the container runs as uid 1000 and the tmpfs root is owned by uid 0.
  mkdir -p /tmp/.X11-unix 2>/dev/null || true
  chmod 1777 /tmp/.X11-unix 2>/dev/null || true
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

# Shell profile seeding (Q23): /etc/bash.bashrc, /etc/profile,
# /etc/fish/config.fish, and /etc/profile.d/agentbox-runtime.sh are now
# all baked into the image by the configFiles derivation in flake.nix
# (read_only:true rootfs would otherwise block any runtime mkdir/append).
# Nothing for the entrypoint to do here.

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

echo "[5b/8] Starting supervisord..."
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

# Q26 / Q6: claude-flow plugin config is generated at image-build time from
# agentbox.toml [plugins.memory] (see flake.nix `claudeFlowConfigJson`). The
# template lives at /opt/agentbox/config/claude-flow-config.template.json
# with a literal @@RUVECTOR_PG_PASSWORD@@ placeholder that we expand here
# from the env, so the password lives in exactly one place (the env var).
_CF_CONFIG_DIR="${HOME}/.claude-flow"
_CF_TEMPLATE="/opt/agentbox/config/claude-flow-config.template.json"
mkdir -p "$_CF_CONFIG_DIR" 2>/dev/null || true
if [ -f "$_CF_TEMPLATE" ] && { [ ! -f "$_CF_CONFIG_DIR/config.json" ] || ! grep -q "ruvector-postgres" "$_CF_CONFIG_DIR/config.json" 2>/dev/null; }; then
  : "${RUVECTOR_PG_PASSWORD:=ruvector}"
  # sed escape the password to handle any '/' or '&' (paranoid; ruvector ships safe defaults)
  _PG_PW_ESC=$(printf '%s\n' "$RUVECTOR_PG_PASSWORD" | sed -e 's/[\/&]/\\&/g')
  sed "s/@@RUVECTOR_PG_PASSWORD@@/$_PG_PW_ESC/g" "$_CF_TEMPLATE" > "$_CF_CONFIG_DIR/config.json"
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
  #
  # Q27: parse via Python's tomllib (3.11+) instead of a hand-rolled
  # case/sed loop. The previous implementation interpolated $_plugin_name
  # directly into a `su -c '...'` shell command — a latent shell-injection
  # vector if a plugin name ever contained a single quote. tomllib also
  # handles multi-line values, comment placements, and string escapes the
  # case/sed loop quietly mishandled.
  if [ -f "$AGENTBOX_CONFIG" ] && command -v python3 >/dev/null 2>&1; then
    # Parse [[plugins.packages]] via tomllib and emit `name<TAB>source\n`
    # lines for enabled, validated entries. The validation regex catches
    # any name that could break out of shell-quoting, which collapses the
    # injection vector documented in Q27.
    _PLUGIN_LIST=$(python3 - "$AGENTBOX_CONFIG" <<'PYEOF'
import re, sys, tomllib
with open(sys.argv[1], "rb") as f:
    cfg = tomllib.load(f)
pkgs = cfg.get("plugins", {}).get("packages", []) or []
name_re = re.compile(r"^[a-zA-Z0-9@/_.+-]+$")
for entry in pkgs:
    if not entry.get("enabled", False):
        continue
    name = entry.get("name", "")
    source = entry.get("source", "ruflo-git")
    if not name_re.match(name):
        sys.stderr.write(f"[plugin] skipping suspicious name: {name!r}\n")
        continue
    if source not in ("ruflo-git", "registry"):
        sys.stderr.write(f"[plugin] skipping unknown source: {source!r} for {name}\n")
        continue
    print(f"{name}\t{source}")
PYEOF
)
    while IFS=$'\t' read -r _plugin_name _plugin_source; do
      [ -z "$_plugin_name" ] && continue
      if [ "$_plugin_source" = "registry" ]; then
        echo "  [plugin] Installing $_plugin_name from IPFS registry..."
        # Pass the plugin name via env var; no shell interpolation.
        AGENTBOX_PLUGIN_NAME="$_plugin_name" su -s /bin/bash devuser \
          -c 'ruflo plugins install -n "$AGENTBOX_PLUGIN_NAME"' \
          2>&1 | tail -3 || true
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
    done <<EOF
$_PLUGIN_LIST
EOF
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
# /etc/profile.d/ is read-only on a hardened rootfs. Write to /run instead
# (uid-1000-owned tmpfs from baselineTmpfsMounts). Anything that needs these
# vars at shell-init time must source $AGENTBOX_RUNTIME_ENV (set below).
RUNTIME_ENV_FILE=/run/agentbox/runtime-env.sh
mkdir -p "$(dirname "$RUNTIME_ENV_FILE")" 2>/dev/null || true
cat > "$RUNTIME_ENV_FILE" <<EOF
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
export AGENTBOX_RUNTIME_ENV="$RUNTIME_ENV_FILE"
# Best-effort symlink for legacy consumers; ignored on read-only /etc.
ln -sf "$RUNTIME_ENV_FILE" /etc/profile.d/agentbox-runtime.sh 2>/dev/null || true

# ---------------------------------------------------------------------------
# Phase 8a — Start tmux session in background (MAD-style multi-tab workspace)
# ---------------------------------------------------------------------------
if [ -x /opt/agentbox/config/tmux-autostart.sh ]; then
  /opt/agentbox/config/tmux-autostart.sh &
fi

echo "[AGENTBOX] Runtime bootstrap complete"
