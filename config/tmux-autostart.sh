#!/usr/bin/env bash
# tmux Workspace Auto-Start for Agentbox
# Creates the operator windows (0-7), the AoE "Sessions" window (8) and the
# vault "Notes" window (9) — the interaction plane is now Agent of Empires
# (PRD-021/ADR-042), which supersedes the MAD-style per-provider harness tabs
# 8-14 (ADR-025, superseded in place); Notes is the Rune markdown TUI over the
# Obsidian vault (ADR-2029).
#
#   0:Claude  1:Agent  2:Services  3:Build  4:Logs
#   5:System  6:VNC    7:Git       8:Sessions(AoE)  9:Notes(Rune)
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
# Obsidian vault root — the Notes window's working directory (ADR-2029).
VAULT_ROOT="${VAULT_ROOT:-${WORKSPACE}/vault}"
FISH="$(which fish 2>/dev/null || echo fish)"

# Agentbox install root (dir containing config/ + scripts/). Resolved relative to
# this script so it works whether launched from the baked image (/opt/agentbox)
# or the repo bind mount. Used to locate the AoE seed reconciler and wrappers.
AGENTBOX_ROOT="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd || echo /opt/agentbox)"
AOE_SEED="${AGENTBOX_ROOT}/scripts/aoe-seed-sessions.mjs"
[ -f "$AOE_SEED" ] || AOE_SEED="/opt/agentbox/scripts/aoe-seed-sessions.mjs"

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
# Window 0: Claude — primary development shell (interaction-plane coordinator)
# CLAUDE_CONFIG_DIR is no longer baked into the image env (it defeated profile
# isolation for the routed harnesses). Set it here for the primary session so
# Claude Code reads /home/devuser/.claude as before.
# ============================================================================
tmux $TMUX_ARGS new-session -d -s "$SESSION" -n "Claude" -c "$PROJECT"
tmux send-keys -t "${SESSION}:0" "export CLAUDE_CONFIG_DIR=/home/devuser/.claude" C-m

# Welcome dashboard — gum renders a styled panel, falls back to plain text
if command -v gum >/dev/null 2>&1; then
  WELCOME_CMD="clear; gum style --border rounded --border-foreground '#7aa2f7' --padding '1 2' --margin '1 0' --bold --foreground '#a9b1d6' \"\$(printf '  AGENTBOX\\n\\n  Project: $PROJECT\\n  Shell:   fish + starship\\n  Tabs:    Claude · Agent · Services · Build · Logs · System · VNC · Git · Sessions (AoE) · Notes\\n\\n  Interactive agent sessions live in the Sessions tab (Agent of Empires).\\n  Vault pages open in the Notes tab (Rune markdown TUI).\\n  agentbox-help    quick reference\\n  svc-status       service health\\n  cf-doctor        system diagnostics')\""
  tmux send-keys -t "${SESSION}:0" "$WELCOME_CMD" C-m
else
  tmux send-keys -t "${SESSION}:0" "echo ''" C-m
  tmux send-keys -t "${SESSION}:0" "echo '  ┌─────────────────────────────────────────────┐'" C-m
  tmux send-keys -t "${SESSION}:0" "echo '  │  AGENTBOX                                   │'" C-m
  tmux send-keys -t "${SESSION}:0" "echo '  │                                             │'" C-m
  tmux send-keys -t "${SESSION}:0" "echo '  │  Project: $PROJECT'" C-m
  tmux send-keys -t "${SESSION}:0" "echo '  │  Sessions tab   Agent of Empires plane       │'" C-m
  tmux send-keys -t "${SESSION}:0" "echo '  │  Notes tab      Rune markdown TUI (vault)    │'" C-m
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
# LEGACY (ADR-042 D1/F6-2): the AoE dashboard's live feed absorbs this later;
# the window is retained for now so operators keep a plain log view.
# ============================================================================
tmux new-window -t "${SESSION}:4" -n "Logs" -c "$WORKSPACE_DIR"
tmux send-keys -t "${SESSION}:4" "supervisorctl tail -f management-api" C-m
tmux split-window -v -t "${SESSION}:4" -c "$WORKSPACE_DIR"

# ============================================================================
# Window 5: System — SystemScape history + detailed live process telemetry
# ============================================================================
tmux new-window -t "${SESSION}:5" -n "System" -c "$WORKSPACE_DIR"
# SystemScape provides the correlation view: rotating peak-hold history for
# thermal, GPU, power, CPU, memory, disk IO, and network. Restart after an unexpected
# exit so a transient sensor/terminal problem does not leave a dead dashboard.
tmux send-keys -t "${SESSION}:5" "while true; systemscape; printf '\\nSystemScape exited (%s); restarting in 2s — Ctrl-C for shell\\n' \"\$status\"; sleep 2; end" C-m
# Retain bottom's strengths (process tree, per-core load, disk/network rates)
# in a narrower companion pane. Focus either pane and press Ctrl-Space z to zoom.
tmux split-window -h -p 38 -t "${SESSION}:5" -c "$WORKSPACE_DIR"
tmux send-keys -t "${SESSION}:5.1" "command -v btm >/dev/null && btm --basic || htop" C-m
tmux select-pane -t "${SESSION}:5.0"

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
# LEGACY (ADR-042 D1/F6-2): the AoE dashboard's per-session diff view absorbs
# this later; retained for now as a plain merge-coordinator view.
# ============================================================================
tmux new-window -t "${SESSION}:7" -n "Git" -c "$PROJECT"
tmux send-keys -t "${SESSION}:7" "git status" C-m

# ============================================================================
# Window 8: Sessions — the Agent of Empires interaction plane
# ----------------------------------------------------------------------------
# Supersedes the MAD harness tabs 8-14 (OpenRouter/ZAI/Antigravity/DeepSeek/
# Perplexity/Ollama/Codex) and the bespoke harness/<name> worktree block. AoE
# owns session lifecycle, per-session git worktrees, live terminals/diffs, and
# a status FSM. The seven consoles are declared as [interaction_plane].
# session_seeds in agentbox.toml and reconciled by scripts/aoe-seed-sessions.mjs
# (custom_agents + wrappers + AGENTBOX_PROFILE binding). The Perplexity tab is
# RETIRED (F2-6): research now rides mcp__perplexity + /perplexity-research.
#
# AoE coexists with this `agentbox` session on the shared default tmux socket
# (F2-9); its own sessions are namespaced under the `aoe_` prefix, so there is
# no collision. This window runs the `aoe` TUI when the (rebuilt-image) binary
# is present; otherwise it prints a notice that the plane needs the rebuild.
# ============================================================================
tmux new-window -t "${SESSION}:8" -n "Sessions" -c "$PROJECT"
if command -v aoe >/dev/null 2>&1; then
  tmux send-keys -t "${SESSION}:8" "echo '  Agent of Empires — interaction plane (PRD-021/ADR-042)'" C-m
  # Reconcile profiles + AoE config + declared session seeds (fail-open). Runs
  # every session start; it skips existing sessions and never kills any.
  if [ -f "$AOE_SEED" ] && command -v node >/dev/null 2>&1; then
    tmux send-keys -t "${SESSION}:8" "node ${AOE_SEED} || true" C-m
  fi
  tmux send-keys -t "${SESSION}:8" "echo '  Launching the AoE TUI — press ? for help, n for a new session.'" C-m
  tmux send-keys -t "${SESSION}:8" "aoe" C-m
else
  tmux send-keys -t "${SESSION}:8" "echo '  Sessions (Agent of Empires) — interaction plane'" C-m
  tmux send-keys -t "${SESSION}:8" "echo ''" C-m
  tmux send-keys -t "${SESSION}:8" "echo '  The aoe binary is not present in this image.'" C-m
  tmux send-keys -t "${SESSION}:8" "echo '  The interaction plane needs the rebuilt image:'" C-m
  tmux send-keys -t "${SESSION}:8" "echo '    set [interaction_plane].enabled = true in agentbox.toml,'" C-m
  tmux send-keys -t "${SESSION}:8" "echo '    then rebuild on the host (./agentbox.sh rebuild) to bake aoe-with-web.'" C-m
  tmux send-keys -t "${SESSION}:8" "echo ''" C-m
  tmux send-keys -t "${SESSION}:8" "echo '  Until then, interactive agents remain available via the consultant'" C-m
  tmux send-keys -t "${SESSION}:8" "echo '  MCP tier and Claude Code (tab 0).'" C-m
fi

# ============================================================================
# Window 9: Notes — Rune, the vault's markdown TUI (ADR-2029)
# ----------------------------------------------------------------------------
# Opens at the Obsidian vault root so [[wikilinks]], frontmatter, tables and
# embeds resolve. Rune also climbs to the nearest .obsidian/.git marker on its
# own, but -w is passed explicitly so the window does not depend on that.
#
# Presence-detect mirrors the Sessions window (ADR-042): run the binary when it
# exists, otherwise print the rebuild notice. Two sources satisfy the check —
# the baked Nix package (gated on [vault].tui = "rune") and, until the image is
# rebuilt, the interim source build in ~/workspace/.cargo/bin (ADR-2029 D4).
# The entrypoint adds that directory to PATH globally; the window re-adds it via
# `new-window -e` so this script also works when launched standalone.
# ============================================================================
NOTES_CARGO_BIN="${WORKSPACE}/.cargo/bin"
# Resolve the binary in this (bash) script rather than relying on the pane's
# shell: panes run fish, whose PATH syntax differs, and send-keys would race the
# shell's own startup.
RUNE_BIN="$(command -v rune 2>/dev/null || true)"
if [ -z "$RUNE_BIN" ] && [ -x "${NOTES_CARGO_BIN}/rune" ]; then
  RUNE_BIN="${NOTES_CARGO_BIN}/rune"
fi

# tmux refuses -c on a missing directory. The vault may not be materialised yet
# on a fresh checkout, so fall back to the workspace root instead of losing the
# window entirely, and say so.
NOTES_CWD="$VAULT_ROOT"
NOTES_VAULT_MISSING=""
if [ ! -d "$NOTES_CWD" ]; then
  NOTES_CWD="$WORKSPACE_DIR"
  NOTES_VAULT_MISSING="1"
fi

NOTES_ARGS=()
if [ -d "$NOTES_CARGO_BIN" ]; then
  NOTES_ARGS+=( -e "PATH=${NOTES_CARGO_BIN}:${PATH}" )
fi

tmux new-window -t "${SESSION}:9" -n "Notes" -c "$NOTES_CWD" "${NOTES_ARGS[@]}"

if [ -n "$NOTES_VAULT_MISSING" ]; then
  tmux send-keys -t "${SESSION}:9" "echo '  Vault ${VAULT_ROOT} does not exist yet — opening ${NOTES_CWD} instead.'" C-m
fi

if [ -n "$RUNE_BIN" ]; then
  # Rune keeps its crash journal, persistent undo and 3-way-merge bookkeeping in
  # ONE global SQLite database at "$HOME/Library/Application Support/rune/
  # rune-v2.db" — macOS-shaped on every OS, not XDG, not per-vault. Here
  # /home/devuser is a read-only layer, so under the real HOME that database
  # cannot be created and Rune starts degraded, banner "history disabled —
  # storage unavailable": no undo across restarts and no external-change merge
  # bookkeeping, which is exactly what makes it safe for an agent and the
  # operator to edit the same page. Point HOME at a writable directory for the
  # rune process only — the pane's shell keeps the real HOME. The workspace bind
  # mount is the durable choice; ~/.local is a tmpfs and would not survive a
  # container restart. Fail-open: if the directory cannot be made, launch
  # unmodified and let Rune degrade as before.
  NOTES_RUNE_HOME="${WORKSPACE}/.rune-home"
  NOTES_LAUNCH="${RUNE_BIN}"
  if mkdir -p "$NOTES_RUNE_HOME" 2>/dev/null; then
    NOTES_LAUNCH="env HOME='${NOTES_RUNE_HOME}' ${RUNE_BIN}"
  fi
  tmux send-keys -t "${SESSION}:9" "echo '  Notes — Rune markdown TUI over ${NOTES_CWD} (ADR-2029; ^C quits, F1 help)'" C-m
  tmux send-keys -t "${SESSION}:9" "${NOTES_LAUNCH} -w '${NOTES_CWD}'" C-m
else
  tmux send-keys -t "${SESSION}:9" "echo '  Notes — Rune markdown TUI over the vault'" C-m
  tmux send-keys -t "${SESSION}:9" "echo ''" C-m
  tmux send-keys -t "${SESSION}:9" "echo '  The rune binary is not present in this image.'" C-m
  tmux send-keys -t "${SESSION}:9" "echo '  The Notes editor needs the rebuilt image:'" C-m
  tmux send-keys -t "${SESSION}:9" "echo '    set [vault].tui = \"rune\" in agentbox.toml,'" C-m
  tmux send-keys -t "${SESSION}:9" "echo '    then rebuild on the host (./agentbox.sh rebuild) to bake rune.'" C-m
  tmux send-keys -t "${SESSION}:9" "echo ''" C-m
  tmux send-keys -t "${SESSION}:9" "echo '  Until then, a source build satisfies this window:'" C-m
  tmux send-keys -t "${SESSION}:9" "echo '    cargo install --git https://github.com/aka-rider/rune --tag v1.4.0 rune-cli'" C-m
  tmux send-keys -t "${SESSION}:9" "echo '  It installs to ${NOTES_CARGO_BIN}; reopen this window afterwards to pick it up.'" C-m
fi

# ============================================================================
# Harness-merge helper — reworked for the AoE per-session worktree model.
# Under ADR-042, AoE owns per-session git worktrees; a worktree session's branch
# is derived from its title slug (docs/guides/worktrees.md). This helper merges
# such a branch back into the current branch from tab 0.
#   Usage (from tab 0): harness-merge <session-title>   e.g. harness-merge codex
# It asks AoE for the session's actual worktree branch (falling back to the
# title as the branch name), then git-merges it.
# ============================================================================
_HARNESS_MERGE_SH="$(cat <<'MERGE_EOF'
harness-merge() {
  local _title="${1:?Usage: harness-merge <aoe-session-title>}"
  local _branch=""
  # Resolve the session's worktree branch from AoE when possible.
  if command -v aoe >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    _branch="$(aoe session show "$_title" --json 2>/dev/null \
      | jq -r '.worktree_info.branch // .branch // empty' 2>/dev/null)"
  fi
  # Fall back to the title slug as the branch name (AoE derives branches from
  # the title, slashes → hyphens).
  [ -n "$_branch" ] || _branch="$(printf '%s' "$_title" | tr '/ ' '--')"
  if ! git rev-parse --verify "$_branch" >/dev/null 2>&1; then
    echo "harness-merge: branch not found for session '${_title}' (tried '${_branch}')" >&2
    echo "  list AoE sessions with: aoe list" >&2
    return 1
  fi
  echo "Merging AoE session '${_title}' (branch ${_branch}) into $(git branch --show-current)..."
  git merge --no-ff "${_branch}" -m "merge: AoE session ${_title} (${_branch}) into primary"
}
export -f harness-merge 2>/dev/null || true
MERGE_EOF
)"

# Inject the helper as an environment variable; tab 0 can source it via:
#   eval "$HARNESS_MERGE_FN"
# R-028: this eval is benign — HARNESS_MERGE_FN is set (above, via
# `tmux set-environment`) to the fixed `_HARNESS_MERGE_SH` heredoc literal
# defined in this script. Its contents are not attacker-influenced (no external
# input is interpolated), so `eval` here is the intended function-injection
# mechanism and is left as-is.
tmux set-environment -t "${SESSION}" HARNESS_MERGE_FN "${_HARNESS_MERGE_SH}"
tmux send-keys -t "${SESSION}:0" "eval \"\$HARNESS_MERGE_FN\" 2>/dev/null || true" C-m

# ============================================================================
# Landing window: the AoE session plane is THE interaction surface (PRD-021);
# attach lands on Sessions when the plane is baked in. Window 0 stays the
# tab0-bridge injection target either way — landing is a view choice only.
# ============================================================================
if command -v aoe >/dev/null 2>&1; then
  tmux select-window -t "${SESSION}:8"
else
  tmux select-window -t "${SESSION}:0"
fi

echo "[tmux-autostart] Session '$SESSION' created with 10 windows"
echo "  0:Claude  1:Agent  2:Services  3:Build  4:Logs  5:System  6:VNC  7:Git  8:Sessions(AoE)  9:Notes(Rune)"

# ============================================================================
# Dream-engine nightly loop — FALLBACK ONLY. Since the 2026-08 image rebuild
# supervisord owns [program:dream-engine]; starting a tmux copy alongside it
# double-runs the night and races dispatch/cleanup on the HP annexe (observed
# 2026-08-20/21: tarball vanished mid-scp, checkout rm'd mid-evaluation).
# Only start here when supervisord does NOT manage it.
# ============================================================================
DREAM_BIN="$PROJECT/project/agentbox/services/dream-engine/target/release/dream-engine"
[ -x "$DREAM_BIN" ] || DREAM_BIN="/home/devuser/workspace/project/agentbox/services/dream-engine/target/release/dream-engine"
if supervisorctl status dream-engine 2>/dev/null | grep -qE '^dream-engine[[:space:]]'; then
  DREAM_BIN=""  # supervisord owns the loop; never start a duplicate
fi
if [ -n "$DREAM_BIN" ] && [ -x "$DREAM_BIN" ] && ! tmux $TMUX_ARGS has-session -t dream-engine 2>/dev/null; then
  tmux $TMUX_ARGS new-session -d -s dream-engine \
    "RUST_LOG=info $DREAM_BIN --loop 2>&1 | tee -a /home/devuser/workspace/.tmp/dream-annexe-artefacts/loop.log"
  echo "[tmux-autostart] dream-engine nightly loop started"
fi
