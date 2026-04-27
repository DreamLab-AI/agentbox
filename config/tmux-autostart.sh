#!/usr/bin/env bash
# tmux Workspace Auto-Start for Agentbox
# Creates 8 windows with fish shell — MAD-style tab layout
#
# Replaces Zellij layouts; fish shell configs (config.fish,
# bashrc.agentbox) are sourced automatically by fish in each window.

set -e

SESSION="agentbox"
PROJECT="${WORKSPACE:-/workspace}/project"
WORKSPACE_DIR="${WORKSPACE:-/workspace}"

# If session already exists, skip creation
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "[tmux-autostart] Session '$SESSION' already exists — skipping"
  exit 0
fi

echo "[tmux-autostart] Creating tmux session '$SESSION'..."

# Source the config explicitly (entrypoint copies it to ~/.tmux.conf
# but the tmux server may start before that completes)
TMUX_CONF="/opt/agentbox/config/tmux.conf"
TMUX_ARGS=""
if [ -f "$TMUX_CONF" ]; then
  TMUX_ARGS="-f $TMUX_CONF"
fi

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
# Select window 0 (Claude)
# ============================================================================
tmux select-window -t "${SESSION}:0"

echo "[tmux-autostart] Session '$SESSION' created with 8 windows"
echo "  0:Claude  1:Agent  2:Services  3:Build  4:Logs  5:System  6:VNC  7:Git"
