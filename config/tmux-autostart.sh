#!/usr/bin/env bash
# tmux Workspace Auto-Start for Agentbox
# Creates 14 windows with fish shell — MAD-style tab layout
#
# Replaces Zellij layouts; fish shell configs (config.fish,
# bashrc.agentbox) are sourced automatically by fish in each window.

SESSION="agentbox"
# R-012: WORKSPACE is set authoritatively by the entrypoint (=/home/devuser/workspace,
# the compose bind mount). Honour it if present; otherwise fall back to the same
# canonical path — never the legacy /workspace, which is no longer a mount target.
WORKSPACE="${WORKSPACE:-/home/devuser/workspace}"
PROJECT="${WORKSPACE}/project"
[ -d "$PROJECT" ] || PROJECT="${WORKSPACE}"
WORKSPACE_DIR="${WORKSPACE}"
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
# CLAUDE_CONFIG_DIR is no longer baked into the image env (it defeated profile
# isolation for tabs 8/9). Set it here for the primary session so Claude Code
# reads /home/devuser/.claude as before.
# ============================================================================
tmux $TMUX_ARGS new-session -d -s "$SESSION" -n "Claude" -c "$PROJECT"
tmux send-keys -t "${SESSION}:0" "export CLAUDE_CONFIG_DIR=/home/devuser/.claude" C-m

# Welcome dashboard — gum renders a styled panel, falls back to plain text
if command -v gum >/dev/null 2>&1; then
  WELCOME_CMD="clear; gum style --border rounded --border-foreground '#7aa2f7' --padding '1 2' --margin '1 0' --bold --foreground '#a9b1d6' \"\$(printf '  AGENTBOX\\n\\n  Project: $PROJECT\\n  Shell:   fish + starship\\n  Tabs:    Claude · Agent · Services · Build · Logs · System · VNC · Git · OpenRouter · ZAI · Antigravity · DeepSeek · Perplexity · Ollama\\n\\n  agentbox-help    quick reference\\n  svc-status       service health\\n  cf-doctor        system diagnostics')\""
  tmux send-keys -t "${SESSION}:0" "$WELCOME_CMD" C-m
else
  tmux send-keys -t "${SESSION}:0" "echo ''" C-m
  tmux send-keys -t "${SESSION}:0" "echo '  ┌─────────────────────────────────────────────┐'" C-m
  tmux send-keys -t "${SESSION}:0" "echo '  │  AGENTBOX                                   │'" C-m
  tmux send-keys -t "${SESSION}:0" "echo '  │                                             │'" C-m
  tmux send-keys -t "${SESSION}:0" "echo '  │  Project: $PROJECT'" C-m
  tmux send-keys -t "${SESSION}:0" "echo '  │  agentbox-help   quick reference             │'" C-m
  tmux send-keys -t "${SESSION}:0" "echo '  │  svc-status      service health              │'" C-m
  tmux send-keys -t "${SESSION}:0" "echo '  └─────────────────────────────────────────────┘'" C-m
  tmux send-keys -t "${SESSION}:0" "echo ''" C-m
fi

# ============================================================================
# Window 1: Agent — agent work (shares primary Claude config with tab 0)
# ============================================================================
tmux new-window -t "${SESSION}:1" -n "Agent" -c "$WORKSPACE_DIR"
tmux send-keys -t "${SESSION}:1" "export CLAUDE_CONFIG_DIR=/home/devuser/.claude" C-m
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
OR_WORKSPACE="${WORKSPACE}"
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
# R-005: profile dir ownership is fixed by the entrypoint (root, pre-supervisord)
# via `chown -R 1000:1000 $WORKSPACE/profiles`. Runtime `sudo chown` here was
# dead — no-new-privileges:true neuters the setuid sudo path — so it is removed.

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
tmux send-keys -t "${SESSION}:8" "echo '  Run: claude  (profile-isolated, model: ${OR_MODEL})'" C-m
tmux send-keys -t "${SESSION}:8" "echo ''" C-m
# Profile isolation: HOME + CLAUDE_CONFIG_DIR must BOTH point at the profile
# so claude reads this profile's settings.json/settings.local.json, not the
# global /home/devuser/.claude which carries the primary Anthropic API key.
tmux send-keys -t "${SESSION}:8" "export HOME=${OR_PROFILE}" C-m
tmux send-keys -t "${SESSION}:8" "export CLAUDE_CONFIG_DIR=${OR_CLAUDE_DIR}" C-m
tmux send-keys -t "${SESSION}:8" "export ANTHROPIC_BASE_URL=https://openrouter.ai/api" C-m
if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  tmux send-keys -t "${SESSION}:8" "export ANTHROPIC_AUTH_TOKEN=${OPENROUTER_API_KEY}" C-m
  tmux send-keys -t "${SESSION}:8" "export ANTHROPIC_API_KEY=" C-m
fi

# ============================================================================
# Window 9: ZAI — Claude Code via Z.AI GLM (profile-isolated, no env bleed)
# Z.AI supports TWO endpoints:
#   API (per-token):    ZAI_URL=https://api.z.ai/api/anthropic
#   Subscription ($9+/mo, GLM Coding Plan): https://api.z.ai/api/coding/paas/v4
# Set ZAI_URL in .env to choose the endpoint. Default: per-token relay.
# Profile isolation prevents ANTHROPIC_BASE_URL from leaking to the main
# Claude Code session in Window 0.
# ============================================================================
ZAI_WORKSPACE="${WORKSPACE}"
ZAI_PROFILE="${ZAI_WORKSPACE}/profiles/zai"
ZAI_CLAUDE_DIR="${ZAI_PROFILE}/.claude"
# Endpoint: subscription path if ZAI_URL ends in /coding/paas/v4, else per-token relay
_ZAI_ENDPOINT="${ZAI_URL:-https://api.z.ai/api/anthropic}"
_ZAI_AUTH="${ZAI_ANTHROPIC_API_KEY:-${ZAI_API_KEY:-}}"

mkdir -p "${ZAI_CLAUDE_DIR}"
# R-005: profile dir ownership fixed by entrypoint root phase; runtime sudo removed.

if [ -n "${_ZAI_AUTH:-}" ]; then
  cat > "${ZAI_CLAUDE_DIR}/settings.local.json" <<ZAIJSON
{
  "env": {
    "ANTHROPIC_BASE_URL": "${_ZAI_ENDPOINT}",
    "ANTHROPIC_AUTH_TOKEN": "${_ZAI_AUTH}",
    "ANTHROPIC_API_KEY": ""
  }
}
ZAIJSON
  _zai_status="ZAI key set — endpoint: ${_ZAI_ENDPOINT}"
else
  _zai_status="WARNING: ZAI_API_KEY not set — add it to your .env file"
fi

[ -L "${ZAI_PROFILE}/workspace" ] || ln -sfn "${ZAI_WORKSPACE}" "${ZAI_PROFILE}/workspace" 2>/dev/null || true
[ -L "${ZAI_PROFILE}/projects" ] || ln -sfn "${SHARED_PROJECTS_ROOT:-/projects}" "${ZAI_PROFILE}/projects" 2>/dev/null || true

tmux new-window -t "${SESSION}:9" -n "ZAI" -c "${ZAI_PROFILE}"
tmux send-keys -t "${SESSION}:9" "echo '  ZAI Profile — Claude Code via Z.AI subscription relay'" C-m
tmux send-keys -t "${SESSION}:9" "echo '  ${_zai_status}'" C-m
tmux send-keys -t "${SESSION}:9" "echo '  Subscription tier: z.ai/subscribe (Lite \$9/mo | Pro \$27/mo | Max \$72/mo)'" C-m
tmux send-keys -t "${SESSION}:9" "echo '  Set ZAI_URL=https://api.z.ai/api/coding/paas/v4 for flat-rate billing'" C-m
tmux send-keys -t "${SESSION}:9" "echo '  Run: dsp  (profile-isolated — bills to ZAI, not direct Anthropic)'" C-m
tmux send-keys -t "${SESSION}:9" "echo ''" C-m
# Profile isolation: HOME + CLAUDE_CONFIG_DIR must BOTH point at the ZAI
# profile so Claude Code reads the ZAI settings.local.json (which sets
# ANTHROPIC_BASE_URL → z.ai and ANTHROPIC_AUTH_TOKEN → ZAI key) instead of
# the global /home/devuser/.claude which carries the direct Anthropic API key.
# Without CLAUDE_CONFIG_DIR override, Claude ignores HOME for config discovery.
tmux send-keys -t "${SESSION}:9" "export HOME=${ZAI_PROFILE}" C-m
tmux send-keys -t "${SESSION}:9" "export CLAUDE_CONFIG_DIR=${ZAI_CLAUDE_DIR}" C-m
tmux send-keys -t "${SESSION}:9" "export ANTHROPIC_BASE_URL=${_ZAI_ENDPOINT}" C-m
if [ -n "${_ZAI_AUTH:-}" ]; then
  tmux send-keys -t "${SESSION}:9" "export ANTHROPIC_AUTH_TOKEN=${_ZAI_AUTH}" C-m
  tmux send-keys -t "${SESSION}:9" "export ANTHROPIC_API_KEY=" C-m
fi

# WORKTREE_BASE is referenced by windows 10, 11, 13 (-c flag) so it must be
# defined before those windows are created. The full git worktree initialisation
# block runs after window 13 (all profile setup complete) for clarity, but the
# variable itself is set here unconditionally.
WORKTREE_BASE="${WORKSPACE}/worktrees"
mkdir -p "${WORKTREE_BASE}/antigravity" "${WORKTREE_BASE}/deepseek" "${WORKTREE_BASE}/ollama"

# ============================================================================
# Window 10: Antigravity — Google Gemini CLI (profile-isolated)
# Auth: GOOGLE_GEMINI_API_KEY or GOOGLE_API_KEY from env
# CLI: gemini (@google/gemini-cli) — uses its own config dir, no settings.local.json
# ============================================================================
AG_WORKSPACE="${WORKSPACE}"
AG_PROFILE="${AG_WORKSPACE}/profiles/antigravity"
AG_GEMINI_DIR="${AG_PROFILE}/.gemini"

mkdir -p "${AG_GEMINI_DIR}" "${AG_PROFILE}/.cache/starship"
# R-005: profile dir ownership fixed by entrypoint root phase; runtime sudo removed.

_AG_KEY="${GOOGLE_GEMINI_API_KEY:-${GOOGLE_API_KEY:-}}"
if [ -n "${_AG_KEY:-}" ]; then
  _ag_status="Gemini key set — model: gemini-2.5-flash"
else
  _ag_status="WARNING: GOOGLE_GEMINI_API_KEY not set — add it to your .env file"
fi

[ -L "${AG_PROFILE}/workspace" ] || ln -sfn "${AG_WORKSPACE}" "${AG_PROFILE}/workspace" 2>/dev/null || true
[ -L "${AG_PROFILE}/projects" ] || ln -sfn "${SHARED_PROJECTS_ROOT:-/projects}" "${AG_PROFILE}/projects" 2>/dev/null || true

tmux new-window -t "${SESSION}:10" -n "Antigravity" -c "${WORKTREE_BASE}/antigravity"
tmux send-keys -t "${SESSION}:10" "echo '  Antigravity Profile — Google Gemini CLI'" C-m
tmux send-keys -t "${SESSION}:10" "echo '  ${_ag_status}'" C-m
tmux send-keys -t "${SESSION}:10" "echo '  Run: gemini  (gemini-2.5-flash, 1M ctx, multimodal)'" C-m
tmux send-keys -t "${SESSION}:10" "echo ''" C-m
tmux send-keys -t "${SESSION}:10" "export HOME=${AG_PROFILE}" C-m
# Prevent accidental Claude invocations from reading the global Anthropic key
tmux send-keys -t "${SESSION}:10" "export CLAUDE_CONFIG_DIR=${AG_PROFILE}/.claude" C-m
if [ -n "${_AG_KEY:-}" ]; then
  tmux send-keys -t "${SESSION}:10" "export GOOGLE_GEMINI_API_KEY=${_AG_KEY}" C-m
  tmux send-keys -t "${SESSION}:10" "export GOOGLE_API_KEY=${_AG_KEY}" C-m
fi

# ============================================================================
# Window 11: DeepSeek — CodeWhale CLI (profile-isolated)
# Auth: DEEPSEEK_API_KEY from env
# CLI: codewhale — model: deepseek-v4-0324
# ============================================================================
DS_WORKSPACE="${WORKSPACE}"
DS_PROFILE="${DS_WORKSPACE}/profiles/deepseek"
DS_CODEWHALE_DIR="${DS_PROFILE}/.codewhale"

mkdir -p "${DS_CODEWHALE_DIR}" "${DS_PROFILE}/.cache/starship"
# R-005: profile dir ownership fixed by entrypoint root phase; runtime sudo removed.

if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  _ds_status="DEEPSEEK_API_KEY set — model: deepseek-v4-0324"
else
  _ds_status="WARNING: DEEPSEEK_API_KEY not set — add it to your .env file"
fi

[ -L "${DS_PROFILE}/workspace" ] || ln -sfn "${DS_WORKSPACE}" "${DS_PROFILE}/workspace" 2>/dev/null || true
[ -L "${DS_PROFILE}/projects" ] || ln -sfn "${SHARED_PROJECTS_ROOT:-/projects}" "${DS_PROFILE}/projects" 2>/dev/null || true

tmux new-window -t "${SESSION}:11" -n "DeepSeek" -c "${WORKTREE_BASE}/deepseek"
tmux send-keys -t "${SESSION}:11" "echo '  DeepSeek Profile — CodeWhale CLI'" C-m
tmux send-keys -t "${SESSION}:11" "echo '  ${_ds_status}'" C-m
tmux send-keys -t "${SESSION}:11" "echo '  Run: codewhale  (deepseek-v4-0324, 64k ctx, strong reasoning)'" C-m
tmux send-keys -t "${SESSION}:11" "echo ''" C-m
tmux send-keys -t "${SESSION}:11" "export HOME=${DS_PROFILE}" C-m
tmux send-keys -t "${SESSION}:11" "export CLAUDE_CONFIG_DIR=${DS_PROFILE}/.claude" C-m
if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  tmux send-keys -t "${SESSION}:11" "export DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}" C-m
fi

# ============================================================================
# Window 12: Perplexity — Research shell (profile-isolated)
# Auth: PERPLEXITY_API_KEY from env
# This is a research shell, not a coding agent.
# The official Perplexity MCP server is also available in Claude Code tab 0
# via the mcp__perplexity-research integration.
# ============================================================================
PX_WORKSPACE="${WORKSPACE}"
PX_PROFILE="${PX_WORKSPACE}/profiles/perplexity"

mkdir -p "${PX_PROFILE}" "${PX_PROFILE}/.cache/starship"
# R-005: profile dir ownership fixed by entrypoint root phase; runtime sudo removed.

if [ -n "${PERPLEXITY_API_KEY:-}" ]; then
  _px_status="PERPLEXITY_API_KEY set"
else
  _px_status="WARNING: PERPLEXITY_API_KEY not set — add it to your .env file"
fi

[ -L "${PX_PROFILE}/workspace" ] || ln -sfn "${PX_WORKSPACE}" "${PX_PROFILE}/workspace" 2>/dev/null || true
[ -L "${PX_PROFILE}/projects" ] || ln -sfn "${SHARED_PROJECTS_ROOT:-/projects}" "${PX_PROFILE}/projects" 2>/dev/null || true

tmux new-window -t "${SESSION}:12" -n "Perplexity" -c "${PX_PROFILE}"
tmux send-keys -t "${SESSION}:12" "echo '  Perplexity Research Shell'" C-m
tmux send-keys -t "${SESSION}:12" "echo '  ${_px_status}'" C-m
tmux send-keys -t "${SESSION}:12" "echo ''" C-m
tmux send-keys -t "${SESSION}:12" "echo '  Available tools:'" C-m
tmux send-keys -t "${SESSION}:12" "echo '    curl https://api.perplexity.ai/chat/completions  (direct API)'" C-m
tmux send-keys -t "${SESSION}:12" "echo '    MCP: mcp__perplexity-research in Claude Code tab 0'" C-m
tmux send-keys -t "${SESSION}:12" "echo '    skill: /perplexity-research  (runs inside tab 0)'" C-m
tmux send-keys -t "${SESSION}:12" "echo ''" C-m
tmux send-keys -t "${SESSION}:12" "export CLAUDE_CONFIG_DIR=${PX_PROFILE}/.claude" C-m
if [ -n "${PERPLEXITY_API_KEY:-}" ]; then
  tmux send-keys -t "${SESSION}:12" "export PERPLEXITY_API_KEY=${PERPLEXITY_API_KEY}" C-m
fi

# ============================================================================
# Window 13: Ollama — Local/LAN LLM harness (profile-isolated)
# Auth: none (network-local). Points at the operator's LAN model server.
# Default: DiffusionGemma at 192.168.2.48:8084 (OpenAI-compatible /v1).
# Override: set OLLAMA_BASE_URL and OLLAMA_MODEL in .env to use a different
# endpoint (e.g. host ollama at :11434, or any OpenAI-compatible server).
# CLI: nanocoder --provider ollama --model <model>
# ============================================================================
OL_WORKSPACE="${WORKSPACE}"
OL_PROFILE="${OL_WORKSPACE}/profiles/ollama"
# Default to DiffusionGemma on the LAN; operator overrides via env.
_OL_MODEL="${OLLAMA_MODEL:-diffusiongemma-26B-A4B-it-Q8_0}"
_OL_BASE_URL="${OLLAMA_BASE_URL:-http://192.168.2.48:8084/v1}"

mkdir -p "${OL_PROFILE}" "${OL_PROFILE}/.cache/starship"
# R-005: profile dir ownership fixed by entrypoint root phase; runtime sudo removed.

[ -L "${OL_PROFILE}/workspace" ] || ln -sfn "${OL_WORKSPACE}" "${OL_PROFILE}/workspace" 2>/dev/null || true
[ -L "${OL_PROFILE}/projects" ] || ln -sfn "${SHARED_PROJECTS_ROOT:-/projects}" "${OL_PROFILE}/projects" 2>/dev/null || true

tmux new-window -t "${SESSION}:13" -n "Ollama" -c "${WORKTREE_BASE}/ollama"
tmux send-keys -t "${SESSION}:13" "echo '  Ollama Profile — LAN LLM Harness (DiffusionGemma)'" C-m
tmux send-keys -t "${SESSION}:13" "echo '  Endpoint: ${_OL_BASE_URL}'" C-m
tmux send-keys -t "${SESSION}:13" "echo '  Model:    ${_OL_MODEL}'" C-m
tmux send-keys -t "${SESSION}:13" "echo '  Run: nanocoder --provider ollama --model ${_OL_MODEL}'" C-m
tmux send-keys -t "${SESSION}:13" "echo ''" C-m
tmux send-keys -t "${SESSION}:13" "export HOME=${OL_PROFILE}" C-m
tmux send-keys -t "${SESSION}:13" "export CLAUDE_CONFIG_DIR=${OL_PROFILE}/.claude" C-m
tmux send-keys -t "${SESSION}:13" "export OLLAMA_BASE_URL=${_OL_BASE_URL}" C-m
tmux send-keys -t "${SESSION}:13" "export OLLAMA_MODEL=${_OL_MODEL}" C-m

# ============================================================================
# Git Worktree Setup — isolate harness tabs from the primary working tree
# Each harness that edits files gets its own named worktree and branch.
# Claude Code (tab 0) retains the primary worktree.
# Worktree creation is idempotent — safe across container restarts.
# (WORKTREE_BASE was already set and mkdir'd before window 10.)
# ============================================================================

# Detect whether PROJECT is a git repository before attempting worktree ops.
# This guard makes the block safe when the container boots without a git repo.
_git_ok=false
if git -C "${PROJECT}" rev-parse --git-dir >/dev/null 2>&1; then
  _git_ok=true
fi

if [ "${_git_ok}" = "true" ]; then
  # Create worktrees for file-editing harnesses (tabs 10, 11, 13).
  # Tab 12 (Perplexity) is research-only — no worktree needed.
  for _harness in antigravity deepseek ollama; do
    _wt_path="${WORKTREE_BASE}/${_harness}"
    _wt_branch="harness/${_harness}"
    if [ ! -d "${_wt_path}" ]; then
      # Create branch from HEAD if it doesn't already exist, then add worktree.
      git -C "${PROJECT}" branch "${_wt_branch}" HEAD 2>/dev/null || true
      git -C "${PROJECT}" worktree add "${_wt_path}" "${_wt_branch}" 2>/dev/null || true
    fi
  done
  echo "[tmux-autostart] Git worktrees ready under ${WORKTREE_BASE}"
else
  # No git repo — fall back to plain directories so the window -c paths still exist.
  for _harness in antigravity deepseek ollama; do
    mkdir -p "${WORKTREE_BASE}/${_harness}"
  done
  echo "[tmux-autostart] WARNING: ${PROJECT} is not a git repo — worktrees created as plain dirs"
fi

# ============================================================================
# Harness-merge helper — inject into the Claude (tab 0) tmux environment so it
# is available as a shell function in any fish/bash session started there.
# Usage (from tab 0): harness-merge antigravity
#                     harness-merge deepseek
#                     harness-merge ollama
# ============================================================================
_HARNESS_MERGE_SH="$(cat <<'MERGE_EOF'
harness-merge() {
  local _name="${1:?Usage: harness-merge <antigravity|deepseek|ollama>}"
  local _wt="${WORKTREE_BASE:-${HOME}/workspace/worktrees}/${_name}"
  local _branch="harness/${_name}"
  if [ ! -d "${_wt}" ]; then
    echo "harness-merge: worktree not found: ${_wt}" >&2
    return 1
  fi
  echo "Merging harness/${_name} into current branch..."
  git merge --no-ff "${_branch}" -m "merge: harness/${_name} work into primary"
}
export -f harness-merge 2>/dev/null || true
MERGE_EOF
)"

# Inject the helper as an environment variable; tab 0 can source it via:
#   eval "$HARNESS_MERGE_FN"
tmux set-environment -t "${SESSION}" HARNESS_MERGE_FN "${_HARNESS_MERGE_SH}"
tmux set-environment -t "${SESSION}" WORKTREE_BASE "${WORKTREE_BASE}"

# Auto-source the helper in tab 0 so it is immediately available.
# R-028: this eval is benign — HARNESS_MERGE_FN is set (above, via
# `tmux set-environment`) to the fixed `_HARNESS_MERGE_SH` heredoc literal
# defined in this script. Its contents are not attacker-influenced (no external
# input is interpolated), so `eval` here is the intended function-injection
# mechanism and is left as-is.
tmux send-keys -t "${SESSION}:0" "eval \"\$HARNESS_MERGE_FN\" 2>/dev/null || true" C-m

# ============================================================================
# Select window 0 (Claude)
# ============================================================================
tmux select-window -t "${SESSION}:0"

echo "[tmux-autostart] Session '$SESSION' created with 14 windows"
echo "  0:Claude  1:Agent  2:Services  3:Build  4:Logs  5:System  6:VNC  7:Git  8:OpenRouter  9:ZAI"
echo "  10:Antigravity  11:DeepSeek  12:Perplexity  13:Ollama"
