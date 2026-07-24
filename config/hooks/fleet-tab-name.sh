#!/usr/bin/env bash
# Rename THIS tmux window to its project identity and register it in the fleet
# registry. Invoked from the Claude Code SessionStart hook, so it only ever
# touches windows that are running a Claude session — curated utility/profile
# tab names (OpenRouter, ZAI, Perplexity, …) set by tmux-autostart are left
# untouched because those tabs never fire this hook.
#
# Project identity precedence: git remote basename → git toplevel basename →
# cwd basename. The remote gives the true repo name (e.g. a dir "project2"
# whose origin is …/dreamlab-ai-website is named "dreamlab-ai-website").
#
# Fail-open: no tmux, no git, anything — exit 0, never disturb the session.
set -u
[ -n "${TMUX:-}" ] || exit 0
command -v tmux >/dev/null 2>&1 || exit 0

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
name=""
if remote=$(git -C "$dir" remote get-url origin 2>/dev/null); then
  base=$(basename "${remote%.git}")
  [ -n "$base" ] && name="$base"
fi
if [ -z "$name" ]; then
  top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null || true)
  name=$(basename "${top:-$dir}")
fi
name=${name:-shell}

win=$(tmux display-message -p '#{window_id}' 2>/dev/null) || exit 0
idx=$(tmux display-message -p '#{window_index}' 2>/dev/null || echo '?')
# Pin the name: automatic-rename would otherwise reset it to the running command.
tmux set-window-option -t "$win" automatic-rename off 2>/dev/null || true
tmux set-window-option -t "$win" allow-rename off 2>/dev/null || true
tmux rename-window -t "$win" "$name" 2>/dev/null || true

# Fleet registry — one JSON per window, consumed by the gateway's /tabs & /report.
reg="$HOME/.claude/fleet"
mkdir -p "$reg" 2>/dev/null || true
printf '{"window_id":"%s","index":"%s","name":"%s","cwd":"%s","pid":%s,"role":"claude","updated":%s}\n' \
  "$win" "$idx" "$name" "$dir" "${PPID:-0}" "$(date +%s)" > "$reg/${win#@}.json" 2>/dev/null || true
exit 0
