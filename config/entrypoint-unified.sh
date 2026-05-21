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
  printf '\033[1;34m'
  echo "  ╔══════════════════════════════════════╗"
  echo "  ║         A G E N T B O X              ║"
  echo "  ║  Modular Sovereign Agent Environment ║"
  echo "  ╚══════════════════════════════════════╝"
  printf '\033[0;90m'
  echo "  $(date -Iseconds)"
  printf '\033[0m\n'
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
export CODEX_HOME="${CODEX_HOME:-/home/devuser/.codex}"
export GIT_CONFIG_GLOBAL="${GIT_CONFIG_GLOBAL:-/home/devuser/.config/git/config}"

echo "[1/8] Preparing runtime directories..."
mkdir -p \
  "$WORKSPACE" \
  "$SHARED_PROJECTS_ROOT" \
  "$RUVECTOR_DATA_DIR" \
  "$SOLID_POD_ROOT" \
  /var/lib/agentbox/identities \
  /var/log/supervisor \
  /var/run \
  /tmp/screenshots

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
    /home/devuser/.local \
    /home/devuser/.local/share \
    /home/devuser/.local/share/code-server \
    /home/devuser/.config \
    /home/devuser/.config/claude-telegram-mirror \
    /home/devuser/.cache \
    /home/devuser/.claude-flow \
    /home/devuser/.codex \
    /home/devuser/.gemini \
    /var/cache \
    /var/cache/ruflo-plugins; do
  if [ -d "$_vol_root" ]; then
    # Only chown the root, not -R. If the dir is already uid 1000, this
    # is a no-op kernel call. Crucially: Docker auto-creates the parent
    # paths of named-volume bind mounts (e.g. /home/devuser/.local/share
    # as parent of codeserver-config) as root-owned, even when the
    # parent itself is a uid-1000 tmpfs. Bootstrap-as-root fixes the
    # ownership before XDG-aware tools like zoxide/fzf/atuin try to
    # mkdir there.
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

# Git global config (home dir is read-only overlay; redirect to writable .config tmpfs)
mkdir -p /home/devuser/.config/git 2>/dev/null || true
if [ ! -f /home/devuser/.config/git/config ]; then
  cat > /home/devuser/.config/git/config <<'GITCFG'
[credential "https://github.com"]
	helper = !gh auth git-credential
[credential "https://gist.github.com"]
	helper = !gh auth git-credential
GITCFG
fi
chown -R 1000:1000 /home/devuser/.config/git 2>/dev/null || true

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
# The host .claude/ is mounted at /home/devuser/.claude but HOME=/home/devuser
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
chown 1000:1000 /run/agentbox 2>/dev/null || true

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
  # Accept node_modules at $dir/node_modules OR $dir/package/node_modules.
  # The latter occurs when the Nix build copies a derivation's /package dir
  # into a destination that already exists from the skills source tree copy
  # (cp puts the source dir *inside* the existing dest instead of replacing it).
  # flake.nix is fixed to rm -rf before overlay cp; this fallback handles
  # images built before that fix.
  if [ ! -d "$dir/node_modules" ] && [ ! -d "$dir/package/node_modules" ]; then
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
# playwright-mcp probe removed — browser automation via external sidecar
if [ "${ENABLE_COMFYUI_BUILTIN:-false}" = "true" ]; then
  _probe_closure /opt/agentbox/skills/comfyui/mcp-server
fi
if [ "${ENABLE_CODE_INTERPRETER:-false}" = "true" ]; then
  _probe_closure /opt/agentbox/mcp/code-interpreter
fi
if [ "${ENABLE_ACI_SHELL:-false}" = "true" ]; then
  _probe_closure /opt/agentbox/mcp/aci-shell
fi

echo "[6/8] Service closures OK."

# ── Code-as-Harness bootstrap (PRD-008) ──────────────────────────────────────
if [ "${ENABLE_CODE_INTERPRETER:-false}" = "true" ]; then
  # Wheelhouse must exist for kernel.install_pkg to work; baked at image
  # build time by the Nix derivation, but ensure the directory exists at
  # runtime so the MCP server's startup validation passes.
  WHEELHOUSE="${AGENTBOX_KERNEL_WHEELHOUSE:-/var/lib/agentbox/code-interpreter-wheelhouse}"
  if [ ! -d "$WHEELHOUSE" ] || [ ! -f "$WHEELHOUSE/.agentbox-wheelhouse-version" ]; then
    echo "[code-harness] WARN: wheelhouse at $WHEELHOUSE missing or unversioned"
    echo "[code-harness]   kernel.install_pkg will be disabled until Nix-baked wheelhouse is present"
  else
    echo "[code-harness] wheelhouse OK: $(cat "$WHEELHOUSE/.agentbox-wheelhouse-version")"
  fi
  # Audit + outbox dirs — devuser-owned so the MCP server can write JSONL
  mkdir -p \
    /var/lib/agentbox/code-harness \
    /var/lib/agentbox/code-harness/traces-outbox \
    /var/lib/agentbox/code-harness/aci-submissions
  chown -R devuser:devuser /var/lib/agentbox/code-harness 2>/dev/null || true
fi

# Propagate did:nostr identity into MCP env. The sovereign mesh sets these
# from the pod identity; in local-only dev mode they fall back to "local".
# Every MCP server that needs agent identity reads these vars at spawn time.
# Per ADR-013, URNs are minted only via management-api/lib/uris.js — the
# new MCPs do NOT mint raw format!() URNs; they call the URI minter instead.
export AGENTBOX_AGENT_DID="${AGENTBOX_AGENT_DID:-did:nostr:local}"
export AGENTBOX_AGENT_PUBKEY="${AGENTBOX_AGENT_PUBKEY:-local}"

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

# ── MCP server config: ensure .mcp.json always points to ruvector-mcp.cjs ──
# Claude Code resolves .mcp.json by walking up from cwd.  We write one at
# the workspace root so every project inherits ruvector-postgres by default.
# The pg npm module is installed to a workspace-persistent prefix on first boot.
_MCP_JSON="${WORKSPACE:-/home/devuser/workspace}/.mcp.json"
_RUVECTOR_MCP="/opt/agentbox/mcp/servers/ruvector-mcp.cjs"
_PG_PREFIX="${WORKSPACE:-/home/devuser/workspace}/.claude-pg"
: "${RUVECTOR_PG_PASSWORD:=ruvector}"
if [ -f "$_RUVECTOR_MCP" ]; then
  # Install pg npm module if missing (workspace-persistent, survives rebuilds)
  if [ ! -d "$_PG_PREFIX/node_modules/pg" ]; then
    echo "  [mcp] Installing pg module to $_PG_PREFIX ..."
    mkdir -p "$_PG_PREFIX" "${WORKSPACE:-/home/devuser/workspace}/.npm-cache" 2>/dev/null || true
    npm install --cache "${WORKSPACE:-/home/devuser/workspace}/.npm-cache" --prefix "$_PG_PREFIX" pg 2>/dev/null || true
    chown -R 1000:1000 "$_PG_PREFIX" 2>/dev/null || true
  fi
  # Write canonical .mcp.json (idempotent — only if it doesn't already point to ruvector-mcp)
  : "${XINFERENCE_ENDPOINT:=http://xinference:9997}"
  : "${EMBEDDING_MODEL:=bge-small-en-v1.5}"
  if [ ! -f "$_MCP_JSON" ] || ! grep -q "ruvector-mcp" "$_MCP_JSON" 2>/dev/null; then
    cat > "$_MCP_JSON" <<MCPEOF
{
  "mcpServers": {
    "claude-flow": {
      "command": "node",
      "args": ["$_RUVECTOR_MCP"],
      "type": "stdio",
      "env": {
        "RUVECTOR_PG_CONNINFO": "host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=$RUVECTOR_PG_PASSWORD",
        "NODE_PATH": "$_PG_PREFIX/node_modules",
        "XINFERENCE_ENDPOINT": "$XINFERENCE_ENDPOINT",
        "EMBEDDING_MODEL": "$EMBEDDING_MODEL"
      }
    }
  }
}
MCPEOF
    chown 1000:1000 "$_MCP_JSON" 2>/dev/null || true
    echo "  [mcp] Wrote $_MCP_JSON → ruvector-mcp.cjs (ruvector-postgres + xinference)"
  fi
fi

# ── Browser sidecar MCP: register browsercontainer if reachable ──
# The browsercontainer runs Chrome Beta 149+ with chrome-devtools-mcp over SSE.
# Only add if the sidecar is on the network and .mcp.json exists to patch.
_BROWSER_MCP_URL="http://browsercontainer:8931/sse"
if [ -f "$_MCP_JSON" ] && ! grep -q "browser-gpu" "$_MCP_JSON" 2>/dev/null; then
  if curl -fsS --max-time 3 "http://browsercontainer:8931/health" >/dev/null 2>&1; then
    # Patch browser-gpu SSE server into existing .mcp.json using python3 (always available)
    python3 -c "
import json, sys
with open('$_MCP_JSON') as f: cfg = json.load(f)
cfg.setdefault('mcpServers', {})['browser-gpu'] = {'url': '$_BROWSER_MCP_URL'}
with open('$_MCP_JSON', 'w') as f: json.dump(cfg, f, indent=2)
" 2>/dev/null && echo "  [mcp] Added browser-gpu → $_BROWSER_MCP_URL" || true
    chown 1000:1000 "$_MCP_JSON" 2>/dev/null || true
  else
    echo "  [mcp] browsercontainer not reachable — skipping browser-gpu MCP"
  fi
fi

# ── Xinference embedding sidecar: wait for readiness + ensure model loaded ──
# The ruvector-mcp.cjs server checks xinference exactly once at startup. If
# xinference isn't ready by then, semantic search degrades to ILIKE for the
# entire session. This gate ensures the model is loaded before any MCP server
# process can start.
: "${XINFERENCE_ENDPOINT:=http://xinference:9997}"
: "${EMBEDDING_MODEL:=bge-small-en-v1.5}"
: "${XINFERENCE_WAIT_SECS:=30}"

_xinference_ok=false
echo "  [xinference] Waiting for ${XINFERENCE_ENDPOINT} (up to ${XINFERENCE_WAIT_SECS}s)..."
_xwait=0
while [ "$_xwait" -lt "$XINFERENCE_WAIT_SECS" ]; do
  if curl -fsS --max-time 3 "${XINFERENCE_ENDPOINT}/v1/models" >/dev/null 2>&1; then
    _xinference_ok=true
    break
  fi
  sleep 2
  _xwait=$((_xwait + 2))
done

if [ "$_xinference_ok" = "true" ]; then
  echo "  [xinference] Reachable — checking for model ${EMBEDDING_MODEL}..."
  _models_json=$(curl -fsS --max-time 5 "${XINFERENCE_ENDPOINT}/v1/models" 2>/dev/null || echo '{}')
  if echo "$_models_json" | grep -q "\"${EMBEDDING_MODEL}\""; then
    echo "  [xinference] Model ${EMBEDDING_MODEL} already loaded"
  else
    echo "  [xinference] Model ${EMBEDDING_MODEL} not loaded — launching..."
    _launch_resp=$(curl -fsS --max-time 60 -X POST \
      "${XINFERENCE_ENDPOINT}/v1/models" \
      -H 'Content-Type: application/json' \
      -d "{\"model_name\":\"${EMBEDDING_MODEL}\",\"model_type\":\"embedding\"}" 2>&1) || true
    if echo "$_launch_resp" | grep -q "\"model_uid\""; then
      echo "  [xinference] Model launched successfully"
    else
      echo "  [xinference] WARN: model launch response: $_launch_resp"
    fi
  fi
  # Verify embeddings actually work end-to-end
  _emb_test=$(curl -fsS --max-time 10 -X POST \
    "${XINFERENCE_ENDPOINT}/v1/embeddings" \
    -H 'Content-Type: application/json' \
    -d "{\"model\":\"${EMBEDDING_MODEL}\",\"input\":\"startup probe\"}" 2>/dev/null || echo '{}')
  if echo "$_emb_test" | grep -q '"embedding"'; then
    _emb_dim=$(echo "$_emb_test" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['data'][0]['embedding']))" 2>/dev/null || echo "?")
    echo "  [xinference] Embedding verified (model=${EMBEDDING_MODEL}, dim=${_emb_dim})"
    export XINFERENCE_READY=true
  else
    echo "  [xinference] WARN: embedding probe failed — ruvector-mcp will fall back to ILIKE"
    export XINFERENCE_READY=false
  fi
else
  echo "  [xinference] WARN: not reachable after ${XINFERENCE_WAIT_SECS}s — semantic search will be degraded"
  export XINFERENCE_READY=false
fi

# ── Codex CLI MCP wiring: write ruvector-mcp into ~/.codex/config.toml ──
# Codex CLI reads MCP servers from [mcp_servers.<name>] tables in config.toml.
# We append the claude-flow server so Codex shares the same ruvector-postgres
# memory infrastructure that Claude Code uses via .mcp.json above.
_CODEX_CONFIG="$CODEX_HOME/config.toml"
if [ "${ENABLE_CODEX:-false}" = "true" ] && [ -f "$_RUVECTOR_MCP" ]; then
  mkdir -p "$CODEX_HOME" 2>/dev/null || true
  if [ ! -f "$_CODEX_CONFIG" ] || ! grep -q 'mcp_servers' "$_CODEX_CONFIG" 2>/dev/null; then
    # Seed config.toml with project trust + MCP servers if it doesn't exist yet.
    # If it exists but lacks mcp_servers, append the MCP block.
    if [ ! -f "$_CODEX_CONFIG" ]; then
      cat > "$_CODEX_CONFIG" <<CODEXCFG
[projects."/home/devuser/workspace"]
trust_level = "trusted"

[projects."/home/devuser/workspace/project"]
trust_level = "trusted"

CODEXCFG
    fi
    cat >> "$_CODEX_CONFIG" <<CODEXMCP
[mcp_servers.claude-flow]
command = "node"
args = ["$_RUVECTOR_MCP"]
startup_timeout_sec = 15
required = false

[mcp_servers.claude-flow.env]
RUVECTOR_PG_CONNINFO = "host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=$RUVECTOR_PG_PASSWORD"
NODE_PATH = "$_PG_PREFIX/node_modules"
XINFERENCE_ENDPOINT = "$XINFERENCE_ENDPOINT"
EMBEDDING_MODEL = "$EMBEDDING_MODEL"
CODEXMCP
    chown 1000:1000 "$_CODEX_CONFIG" 2>/dev/null || true
    echo "  [mcp] Wrote Codex MCP config → $_CODEX_CONFIG (claude-flow → ruvector-mcp.cjs)"
  fi
  # Global AGENTS.md: tells the Codex LLM about the available MCP tools
  _CODEX_AGENTS="$CODEX_HOME/AGENTS.md"
  if [ ! -f "$_CODEX_AGENTS" ]; then
    cat > "$_CODEX_AGENTS" <<'AGENTSEOF'
# Agentbox Global Instructions

## Shared Memory (MCP)

A `claude-flow` MCP server is connected to ruvector-postgres (pgvector).
Use `memory_search` before starting tasks and `memory_store` after success.

Tools: `memory_store`, `memory_retrieve`, `memory_list`, `memory_search`.
Namespaces: `patterns`, `project-state`, `tasks`, `default`.
AGENTSEOF
    chown 1000:1000 "$_CODEX_AGENTS" 2>/dev/null || true
  fi
fi

if command -v ruflo >/dev/null 2>&1; then

  # --- Step 1: Clone/update ruflo plugins from GitHub (sparse checkout) ---
  # GIT_SAFE: home dir may be read-only (Nix hardened rootfs); pass safe.directory
  # via -c to avoid needing to write to ~/.gitconfig.
  _GIT_SAFE="-c safe.directory=$_RUFLO_PLUGINS_CACHE"
  if [ -d "$_RUFLO_PLUGINS_CACHE/.git" ]; then
    echo "  [plugin] Updating ruflo plugins cache..."
    git $_GIT_SAFE -C "$_RUFLO_PLUGINS_CACHE" pull --ff-only --depth 1 2>/dev/null || true
  else
    echo "  [plugin] Cloning ruflo plugins (sparse, depth 1)..."
    git clone --depth 1 --filter=blob:none --sparse \
      "$_RUFLO_PLUGINS_REPO" "$_RUFLO_PLUGINS_CACHE" 2>/dev/null || true
    git $_GIT_SAFE -C "$_RUFLO_PLUGINS_CACHE" sparse-checkout set plugins 2>/dev/null || true
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
export CARGO_HOME="${CARGO_HOME:-/home/devuser/workspace/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-/home/devuser/workspace/.rustup}"
export TMPDIR="${TMPDIR:-/home/devuser/workspace/.tmp}"
export OPENSSL_DIR="${OPENSSL_DIR:-}"
export OPENSSL_LIB_DIR="${OPENSSL_LIB_DIR:-}"
export OPENSSL_INCLUDE_DIR="${OPENSSL_INCLUDE_DIR:-}"
export XINFERENCE_ENDPOINT="${XINFERENCE_ENDPOINT}"
export XINFERENCE_READY="${XINFERENCE_READY:-false}"
export EMBEDDING_MODEL="${EMBEDDING_MODEL}"
EOF
mkdir -p "/home/devuser/workspace/.cargo" "/home/devuser/workspace/.tmp" 2>/dev/null || true
chown devuser:devuser "/home/devuser/workspace/.cargo" "/home/devuser/workspace/.tmp" 2>/dev/null || true
# CUDA wrapper: Nix uses lib/ but Rust crates expect lib64/
if [ -n "${CUDA_PATH:-}" ] && [ -d "$CUDA_PATH/include" ] && [ ! -d "$CUDA_PATH/lib64" ]; then
  CUDA_WRAP="/home/devuser/workspace/.cuda"
  mkdir -p "$CUDA_WRAP"
  ln -sfn "$CUDA_PATH/include" "$CUDA_WRAP/include"
  ln -sfn "$CUDA_PATH/lib"     "$CUDA_WRAP/lib64"
  ln -sfn "$CUDA_PATH/bin"     "$CUDA_WRAP/bin"
  ln -sfn "$CUDA_PATH/nvvm"    "$CUDA_WRAP/nvvm" 2>/dev/null || true
  chown -h devuser:devuser "$CUDA_WRAP"/* 2>/dev/null || true
  cat >> "$RUNTIME_ENV_FILE" <<CUDAEOF
export CUDA_PATH="$CUDA_WRAP"
export CUDA_LIBRARY_PATH="$CUDA_WRAP"
export CPATH="$CUDA_WRAP/include:\${CPATH:-}"
export LIBRARY_PATH="$CUDA_WRAP/lib64:$CUDA_WRAP/lib64/stubs:\${LIBRARY_PATH:-}"
CUDAEOF
fi
export AGENTBOX_RUNTIME_ENV="$RUNTIME_ENV_FILE"
# Best-effort symlink for legacy consumers; ignored on read-only /etc.
ln -sf "$RUNTIME_ENV_FILE" /etc/profile.d/agentbox-runtime.sh 2>/dev/null || true

# Phase 8a — tmux session is started by [program:tmux-autostart] (supervisord,
# user=devuser) so fish/atuin/bottom config dirs are created with correct
# ownership. Nothing to do here.

echo "[AGENTBOX] Runtime bootstrap complete"
