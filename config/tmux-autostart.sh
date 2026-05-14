#!/usr/bin/env bash
# tmux Workspace Auto-Start for Agentbox
# Creates 8 windows with fish shell — MAD-style tab layout
#
# Replaces Zellij layouts; fish shell configs (config.fish,
# bashrc.agentbox) are sourced automatically by fish in each window.

SESSION="agentbox"
PROJECT="${HOME:-/workspace}/project"
[ -d "$PROJECT" ] || PROJECT="${HOME:-/workspace}"
WORKSPACE_DIR="${HOME:-/workspace}"
FISH="$(which fish 2>/dev/null || echo fish)"

# If session already exists, skip creation
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "[tmux-autostart] Session '$SESSION' already exists — skipping"
  exit 0
fi

echo "[tmux-autostart] Creating tmux session '$SESSION'..."

# Config
TMUX_CONF="/opt/agentbox/config/tmux.conf"
TMUX_ARGS=""
if [ -f "$TMUX_CONF" ]; then
  TMUX_ARGS="-f $TMUX_CONF"
fi

# Start tmux server first (needed for detached session creation)
tmux $TMUX_ARGS start-server 2>/dev/null || true

# ============================================================================
# Window 0: Claude — primary development shell
# ============================================================================
tmux $TMUX_ARGS new-session -d -s "$SESSION" -n "Claude" -c "$PROJECT"
tmux send-keys -t "${SESSION}:0" "echo '  Agentbox — Claude Code workspace'" C-m
tmux send-keys -t "${SESSION}:0" "echo '  Project: $PROJECT'" C-m
tmux send-keys -t "${SESSION}:0" "echo ''" C-m

# ============================================================================
# Window 1: Agent — agent work
# ============================================================================
tmux new-window -t "${SESSION}:1" -n "Agent" -c "$WORKSPACE_DIR"
tmux send-keys -t "${SESSION}:1" "echo '  Agent workspace — use for agent execution'" C-m

# ============================================================================
# Window 2: Services — supervisorctl status
# ============================================================================
tmux new-window -t "${SESSION}:2" -n "Services" -c "$WORKSPACE_DIR"
tmux send-keys -t "${SESSION}:2" "supervisorctl status" C-m

# ============================================================================
# Window 3: Build — build/compile workspace
# ============================================================================
tmux new-window -t "${SESSION}:3" -n "Build" -c "$WORKSPACE_DIR"
tmux send-keys -t "${SESSION}:3" "echo '  Build workspace'" C-m

# ============================================================================
# Window 4: Logs — split pane: management-api log + shell
# ============================================================================
tmux new-window -t "${SESSION}:4" -n "Logs" -c "$WORKSPACE_DIR"
tmux send-keys -t "${SESSION}:4" "supervisorctl tail -f management-api" C-m
tmux split-window -v -t "${SESSION}:4" -c "$WORKSPACE_DIR"

# ============================================================================
# Window 5: System — resource monitor
# ============================================================================
tmux new-window -t "${SESSION}:5" -n "System" -c "$WORKSPACE_DIR"
# Prefer btm (bottom) if available, fall back to htop
tmux send-keys -t "${SESSION}:5" "command -v btm >/dev/null && btm || htop" C-m

# ============================================================================
# Window 6: VNC — connection info
# ============================================================================
tmux new-window -t "${SESSION}:6" -n "VNC" -c "$WORKSPACE_DIR"
tmux send-keys -t "${SESSION}:6" "echo '  VNC Connection Info'" C-m
tmux send-keys -t "${SESSION}:6" "echo '  Display: :1    Port: 5901'" C-m
tmux send-keys -t "${SESSION}:6" "echo '  WM: i3 (if desktop.enabled = true)'" C-m
tmux send-keys -t "${SESSION}:6" "echo ''" C-m
tmux send-keys -t "${SESSION}:6" "echo '  Status:'" C-m
tmux send-keys -t "${SESSION}:6" "ps aux | grep -i '[Xx]vnc' || echo '  VNC not running (desktop.enabled = false?)'" C-m

# ============================================================================
# Window 7: Git — project git status
# ============================================================================
tmux new-window -t "${SESSION}:7" -n "Git" -c "$PROJECT"
tmux send-keys -t "${SESSION}:7" "git status" C-m

# ============================================================================
# Window 8: OpenRouter — Claude Code via OpenRouter (free NVIDIA / open models)
# Uses profile isolation: HOME=$OR_PROFILE so Claude reads settings.local.json
# from profiles/openrouter/.claude/ instead of the devuser home.
# OPENROUTER_API_KEY is injected at runtime from the dotenv credentials system.
# ============================================================================
OR_WORKSPACE="${WORKSPACE:-${HOME}/workspace}"
OR_PROFILE="${OR_WORKSPACE}/profiles/openrouter"
OR_CLAUDE_DIR="${OR_PROFILE}/.claude"
# Default free NVIDIA model — override in OR_MODEL env var if desired:
#   nvidia/nemotron-3-super-120b-a12b:free  (262k ctx, tools, coding)
#   nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free (reasoning + vision)
#   qwen/qwen3-coder:free (480B MoE, strong coder, 262k ctx)
#   deepseek/deepseek-v4-flash:free (1M ctx, fast)
#   inclusionai/ring-2.6-1t:free (1T param, 262k ctx, agent-optimised)
OR_MODEL="${OR_MODEL:-nvidia/nemotron-3-super-120b-a12b:free}"

mkdir -p "${OR_CLAUDE_DIR}"

if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  # Write settings.local.json at runtime — API keys never baked into image.
  # ANTHROPIC_BASE_URL redirect routes the Anthropic SDK to OpenRouter's
  # compatible API endpoint. ANTHROPIC_AUTH_TOKEN is the Bearer token.
  # ANTHROPIC_API_KEY is cleared so it doesn't shadow ANTHROPIC_AUTH_TOKEN.
  cat > "${OR_CLAUDE_DIR}/settings.local.json" <<ORJSON
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api",
    "ANTHROPIC_AUTH_TOKEN": "${OPENROUTER_API_KEY}",
    "ANTHROPIC_API_KEY": ""
  },
  "model": "${OR_MODEL}"
}
ORJSON
  _or_status="OPENROUTER_API_KEY set — model: ${OR_MODEL}"
else
  # Leave any existing settings.local.json intact; warn in the window.
  _or_status="WARNING: OPENROUTER_API_KEY not set — add it to your .env file"
fi

# Symlink shared workspace and projects into the profile (same as other stacks)
[ -L "${OR_PROFILE}/workspace" ] || ln -sfn "${OR_WORKSPACE}" "${OR_PROFILE}/workspace" 2>/dev/null || true
[ -L "${OR_PROFILE}/projects" ] || ln -sfn "${SHARED_PROJECTS_ROOT:-/projects}" "${OR_PROFILE}/projects" 2>/dev/null || true

tmux new-window -t "${SESSION}:8" -n "OpenRouter" -c "${OR_PROFILE}"
tmux send-keys -t "${SESSION}:8" "echo '  OpenRouter Profile — isolated Claude Code with free models'" C-m
tmux send-keys -t "${SESSION}:8" "echo '  ${_or_status}'" C-m
tmux send-keys -t "${SESSION}:8" "echo '  Run: HOME=${OR_PROFILE} claude'" C-m
tmux send-keys -t "${SESSION}:8" "echo ''" C-m
# Export HOME override so claude reads from this profile's .claude/ directory
tmux send-keys -t "${SESSION}:8" "export HOME=${OR_PROFILE}" C-m
tmux send-keys -t "${SESSION}:8" "export ANTHROPIC_BASE_URL=https://openrouter.ai/api" C-m
if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  tmux send-keys -t "${SESSION}:8" "export ANTHROPIC_AUTH_TOKEN=${OPENROUTER_API_KEY}" C-m
  tmux send-keys -t "${SESSION}:8" "export ANTHROPIC_API_KEY=" C-m
fi

# ============================================================================
# Select window 0 (Claude)
# ============================================================================
tmux select-window -t "${SESSION}:0"

echo "[tmux-autostart] Session '$SESSION' created with 9 windows"
echo "  0:Claude  1:Agent  2:Services  3:Build  4:Logs  5:System  6:VNC  7:Git  8:OpenRouter"
