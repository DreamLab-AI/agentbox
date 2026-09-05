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
#
# GATES (ADR-2029 closeout, 2026-09-05). Binary discovery is NOT the decision.
# Three checks run before anything is launched, and each refusal leaves the
# window in place on a normal shell with a message naming the cause:
#
#   1. AGENTBOX_VAULT_ENABLED=0 — the VAULT gate (ADR-2028). No [vault] in the
#      manifest means there is no authored corpus to open at all. Unset is
#      treated as enabled, so a standalone launch with a real vault behaves as
#      before.
#
#   2. VAULT_TUI (manifest key [vault].tui) — an EXECUTION off-switch.
#      `tui = "none"`, and equally an empty or unset value, means this window
#      does NOT run the TUI even when a rune binary is present — including the
#      interim ~/workspace/.cargo/bin fallback, which is precisely the case
#      where "the binary exists" and "the operator asked for it" diverge.
#
#      This is deliberately distinct from PACKAGE SELECTION. The Nix package set
#      bakes rune into the image only when [vault].tui = "rune" at BUILD time
#      (ADR-2029 D1), and that gate is evaluated in flake.nix, not here. The two
#      answer different questions — "is the binary in the image?" (build-time,
#      rebuild-class) and "may this window run it?" (runtime, restart-class) —
#      and they can legitimately disagree, so the pane message says which gate
#      refused and names the manifest key. The operator distinction the ADR
#      closeout asked for is therefore explicit at the point of refusal.
#
#   3. Recovery home — Rune keeps its crash journal, persistent undo and 3-way
#      merge bookkeeping in ONE global SQLite database at
#      "$HOME/Library/Application Support/rune/rune-v2.db" (macOS-shaped on
#      every OS, not XDG, not per-vault). /home/devuser is a read-only layer
#      here, so the process HOME is redirected to $WORKSPACE/.rune-home on the
#      bind mount; the pane shell keeps the real HOME. If that directory cannot
#      be created, is not a directory, or is not writable, the window does NOT
#      launch degraded: a degraded Rune ("history disabled — storage
#      unavailable") silently loses exactly the external-change bookkeeping that
#      makes concurrent agent/operator edits to the same page safe. The pane gets
#      the path, the reason and the fix instead.
# ============================================================================
_notes_say() { tmux send-keys -t "${SESSION}:9" "echo '$1'" C-m; }

_notes_window() {
  local cargo_bin="${WORKSPACE}/.cargo/bin"
  local tui="${VAULT_TUI:-none}"
  tui="${tui,,}"
  local vault_enabled="${AGENTBOX_VAULT_ENABLED:-1}"

  # tmux refuses -c on a missing directory. The vault may not be materialised
  # yet on a fresh checkout, so fall back to the workspace root instead of
  # losing the window entirely, and say so.
  local cwd="$VAULT_ROOT" vault_missing=""
  if [ ! -d "$cwd" ]; then
    cwd="$WORKSPACE_DIR"
    vault_missing="1"
  fi

  local args=()
  if [ -d "$cargo_bin" ]; then
    args+=( -e "PATH=${cargo_bin}:${PATH}" )
  fi
  tmux new-window -t "${SESSION}:9" -n "Notes" -c "$cwd" "${args[@]}"

  # --- gate 1: the vault itself (ADR-2028) --------------------------------
  if [ "$vault_enabled" = "0" ]; then
    _notes_say "  Notes — Rune markdown TUI (not started)"
    _notes_say ""
    _notes_say "  Refused by the VAULT gate: AGENTBOX_VAULT_ENABLED=0."
    _notes_say "  agentbox.toml declares no [vault] section, so there is no authored"
    _notes_say "  corpus for the TUI to open. This is not a Rune problem."
    _notes_say "  Fix: set [vault].root (and [vault].tui = \"rune\") in agentbox.toml,"
    _notes_say "       then restart the container so the entrypoint re-resolves it."
    return 0
  fi

  # --- gate 2: [vault].tui — the EXECUTION off-switch ----------------------
  if [ "$tui" != "rune" ]; then
    _notes_say "  Notes — Rune markdown TUI (not started)"
    _notes_say ""
    _notes_say "  Refused by the manifest key [vault].tui = \"${tui}\" (VAULT_TUI)."
    _notes_say "  That key is an EXECUTION off-switch: this window will not run the TUI"
    _notes_say "  even when a rune binary is present, including the interim source build"
    _notes_say "  in ${cargo_bin}."
    _notes_say ""
    _notes_say "  It is a SEPARATE gate from package selection: the image bakes rune only"
    _notes_say "  when [vault].tui = \"rune\" at build time (flake.nix, rebuild-class), so"
    _notes_say "  a binary can exist while execution is switched off, and vice versa."
    _notes_say "  Fix: set [vault].tui = \"rune\" in agentbox.toml and restart the"
    _notes_say "       container (no rebuild needed if the binary is already present)."
    return 0
  fi

  if [ -n "$vault_missing" ]; then
    _notes_say "  Vault ${VAULT_ROOT} does not exist yet — opening ${cwd} instead."
  fi

  # --- binary discovery ----------------------------------------------------
  # Resolved in this (bash) script rather than the pane's shell: panes run fish,
  # whose PATH syntax differs, and send-keys would race the shell startup.
  local rune_bin
  rune_bin="$(command -v rune 2>/dev/null || true)"
  if [ -z "$rune_bin" ] && [ -x "${cargo_bin}/rune" ]; then
    rune_bin="${cargo_bin}/rune"
  fi

  if [ -z "$rune_bin" ]; then
    _notes_say "  Notes — Rune markdown TUI over the vault"
    _notes_say ""
    _notes_say "  The rune binary is not present in this image."
    _notes_say "  The Notes editor needs the rebuilt image:"
    _notes_say "    [vault].tui = \"rune\" is already set in agentbox.toml,"
    _notes_say "    so rebuild on the host (./agentbox.sh rebuild) to bake rune."
    _notes_say ""
    _notes_say "  Until then, a source build satisfies this window:"
    _notes_say "    cargo install --git https://github.com/aka-rider/rune --tag v1.4.0 rune-cli"
    _notes_say "  It installs to ${cargo_bin}; reopen this window afterwards to pick it up."
    return 0
  fi

  # --- gate 3: a writable recovery home, or no launch ----------------------
  local rune_home="${WORKSPACE}/.rune-home" reason=""
  if ! mkdir -p "$rune_home" 2>/dev/null; then
    reason="mkdir -p failed (permission denied, a read-only mount, or a non-directory in the path)"
  elif [ ! -d "$rune_home" ]; then
    reason="the path exists but is not a directory"
  elif ! { : >"${rune_home}/.rune-write-probe"; } 2>/dev/null; then
    reason="the directory is not writable by $(id -un 2>/dev/null || echo "$USER")"
  else
    rm -f "${rune_home}/.rune-write-probe" 2>/dev/null || true
  fi

  if [ -n "$reason" ]; then
    _notes_say "  Notes — Rune markdown TUI (not started)"
    _notes_say ""
    _notes_say "  Rune needs a WRITABLE recovery home for its crash journal, persistent"
    _notes_say "  undo and 3-way-merge bookkeeping (SQLite at"
    _notes_say "  <home>/Library/Application Support/rune/rune-v2.db)."
    _notes_say "    path:   ${rune_home}"
    _notes_say "    reason: ${reason}"
    _notes_say "    fix:    mkdir -p ${rune_home} && chmod u+rwx ${rune_home}"
    _notes_say "            (the ${WORKSPACE} bind mount must be writable by this user),"
    _notes_say "            then reopen this window."
    _notes_say ""
    _notes_say "  Not launching degraded on purpose: without that store Rune runs with"
    _notes_say "  history disabled and loses the external-change bookkeeping that makes"
    _notes_say "  concurrent agent and operator edits to the same page safe (ADR-2029)."
    return 0
  fi

  _notes_say "  Notes — Rune markdown TUI over ${cwd} (ADR-2029; ^C quits, F1 help)"
  tmux send-keys -t "${SESSION}:9" "env HOME='${rune_home}' ${rune_bin} -w '${cwd}'" C-m
  return 0
}

# ----------------------------------------------------------------------------
# Dry-run test hook (ADR-2029 closeout). With AGENTBOX_TMUX_AUTOSTART_DRY_RUN=notes
# this script evaluates ONLY the Notes-window decision above — against whatever
# `tmux` is on PATH, which tests/tui/notes-launcher.test.sh replaces with a
# recording stub — and exits. No session is created and no other window is
# touched. It is inert unless that exact value is set, and is never set in
# production (nothing in flake.nix, supervisord or the compose env sets it).
# ----------------------------------------------------------------------------
if [ "${AGENTBOX_TMUX_AUTOSTART_DRY_RUN:-}" = "notes" ]; then
  _notes_window
  exit 0
fi


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
# Window 9: Notes — Rune, the vault's markdown TUI (ADR-2029).
# The whole decision (gates, binary discovery, recovery home, launch) lives in
# _notes_window(), defined near the top of this script so the dry-run test hook
# can exercise it without creating a session.
# ============================================================================
_notes_window

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
