#!/usr/bin/env bash
# ============================================================================
# notes-launcher.test.sh — ADR-2029 acceptance test
# ----------------------------------------------------------------------------
# Exercises the tmux window-9 "Notes" decision logic in config/tmux-autostart.sh
# with NO tmux server and NO Rune: `tmux` is a recording stub first on PATH, and
# `rune` is an inert executable fixture. The script is driven through its
# documented dry-run hook (AGENTBOX_TMUX_AUTOSTART_DRY_RUN=notes), which runs
# only _notes_window and exits.
#
# A launch is proven by a recorded `send-keys … rune -w <dir>` line; a refusal by
# the absence of that line plus the presence of the message naming the gate.
#
# Usage:  bash tests/tui/notes-launcher.test.sh
# Exit:   0 = every case passed, 1 = at least one failed.
# ============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../.." && pwd)"
AUTOSTART="${REPO}/config/tmux-autostart.sh"

PASS=0
FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'FAIL  %s\n' "$1"; [ -n "${2:-}" ] && printf '        %s\n' "$2"; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/notes-launcher.XXXXXX")"
trap 'chmod -R u+rwX "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT

# --- a PATH with no real `rune` on it ---------------------------------------
# This container may genuinely have rune (baked package and/or the ADR-2029 D4
# cargo build). The test must decide on ITS fixtures, not the host's binaries,
# so every PATH entry carrying a rune executable is dropped. The fixture binary
# then reaches the launcher only through the cargo-bin fallback the ADR defines.
SAFE_PATH=""
_old_ifs="$IFS"; IFS=':'
for _d in $PATH; do
  [ -n "$_d" ] || continue
  [ -x "${_d}/rune" ] && continue
  SAFE_PATH="${SAFE_PATH:+${SAFE_PATH}:}${_d}"
done
IFS="$_old_ifs"

# --- recording tmux stub ----------------------------------------------------
STUB_BIN="${TMP}/bin"
mkdir -p "$STUB_BIN"
cat >"${STUB_BIN}/tmux" <<'STUB'
#!/usr/bin/env bash
# Records every invocation, one per line, and succeeds.
printf 'tmux'
for a in "$@"; do printf ' %s' "$a"; done
printf '\n'
printf 'tmux' >>"$TMUX_STUB_LOG"
for a in "$@"; do printf ' %s' "$a" >>"$TMUX_STUB_LOG"; done
printf '\n' >>"$TMUX_STUB_LOG"
exit 0
STUB
chmod 0755 "${STUB_BIN}/tmux"

# --- run one scenario -------------------------------------------------------
# _scenario <name> <workspace-dir> [ENV=VAL ...]
_scenario() {
  local name="$1" ws="$2"; shift 2
  LOG="${TMP}/log-${name}"
  : >"$LOG"
  env -i \
    PATH="${STUB_BIN}:${SAFE_PATH}" \
    HOME="$ws" \
    TMUX_STUB_LOG="$LOG" \
    WORKSPACE="$ws" \
    AGENTBOX_TMUX_AUTOSTART_DRY_RUN=notes \
    "$@" \
    bash "$AUTOSTART" >/dev/null 2>"${TMP}/err-${name}"
  RC=$?
}

# NB: no space is required before `rune` — the recorded command carries an
# absolute path (…/bin/rune), so the pattern must tolerate a leading slash.
_launched() { grep -q 'send-keys .*rune -w ' "$LOG"; }
_said()     { grep -qF "$1" "$LOG"; }

# --- workspace fixtures -----------------------------------------------------
# ws_full : vault present, rune present in the cargo-bin fallback, writable home
# ws_novault : same but the vault root is missing
mk_ws() { # mk_ws <name> <with-vault:1|0>
  local ws="${TMP}/$1"
  mkdir -p "${ws}/.cargo/bin"
  cat >"${ws}/.cargo/bin/rune" <<'RUNE'
#!/bin/sh
exit 0
RUNE
  chmod 0755 "${ws}/.cargo/bin/rune"
  [ "$2" = "1" ] && mkdir -p "${ws}/vault"
  printf '%s' "$ws"
}

WS_FULL="$(mk_ws ws-full 1)"
WS_NOVAULT="$(mk_ws ws-novault 0)"
WS_NORUNE="${TMP}/ws-norune"; mkdir -p "${WS_NORUNE}/vault"
WS_UNWRITABLE="$(mk_ws ws-unwritable 1)"

echo "── ADR-2029 Notes-window gates ──"

# 1 — tui=none with the binary present: the execution off-switch must win.
_scenario tui-none "$WS_FULL" VAULT_ROOT="${WS_FULL}/vault" VAULT_TUI=none AGENTBOX_VAULT_ENABLED=1
if ! _launched && _said 'Refused by the manifest key [vault].tui' && _said 'EXECUTION off-switch'; then
  _ok "tui=none + binary present → NOT launched; message names [vault].tui as an execution off-switch"
else
  _bad "tui=none must refuse even with a binary present" "rc=${RC} log:$(tr '\n' '|' <"$LOG")"
fi

# 1b — the message must also state the package-selection distinction.
if _said 'SEPARATE gate from package selection'; then
  _ok "tui=none → message distinguishes execution off-switch from package selection"
else
  _bad "tui=none message must distinguish the build-time package gate" "$(cat "$LOG")"
fi

# 1c — unset VAULT_TUI is treated as none.
_scenario tui-unset "$WS_FULL" VAULT_ROOT="${WS_FULL}/vault" AGENTBOX_VAULT_ENABLED=1
if ! _launched && _said 'Refused by the manifest key [vault].tui'; then
  _ok "VAULT_TUI unset → treated as none, NOT launched"
else
  _bad "unset VAULT_TUI must be treated as none" "rc=${RC} log:$(tr '\n' '|' <"$LOG")"
fi

# 2 — tui=rune, binary present, vault present: launch at the vault root.
_scenario launch "$WS_FULL" VAULT_ROOT="${WS_FULL}/vault" VAULT_TUI=rune AGENTBOX_VAULT_ENABLED=1
if _launched && _said "rune -w '${WS_FULL}/vault'" && _said "HOME='${WS_FULL}/.rune-home'"; then
  _ok "tui=rune + binary + vault → launched at the vault root with the recovery HOME"
else
  _bad "tui=rune with everything present must launch" "rc=${RC} log:$(tr '\n' '|' <"$LOG")"
fi

# 2b — the recovery home was actually created on the bind mount.
if [ -d "${WS_FULL}/.rune-home" ]; then
  _ok "launch → recovery home created at \$WORKSPACE/.rune-home"
else
  _bad "launch must create the recovery home" "missing ${WS_FULL}/.rune-home"
fi

# 3 — tui=rune, binary present, vault MISSING: workspace fallback + warning.
_scenario vault-missing "$WS_NOVAULT" VAULT_ROOT="${WS_NOVAULT}/vault" VAULT_TUI=rune AGENTBOX_VAULT_ENABLED=1
if _launched && _said "does not exist yet" && _said "rune -w '${WS_NOVAULT}'"; then
  _ok "tui=rune + vault missing → workspace fallback, launched, warning printed"
else
  _bad "missing vault must fall back to the workspace with a warning" "rc=${RC} log:$(tr '\n' '|' <"$LOG")"
fi

# 4 — AGENTBOX_VAULT_ENABLED=0: the vault gate wins over everything else.
_scenario vault-disabled "$WS_FULL" VAULT_ROOT="${WS_FULL}/vault" VAULT_TUI=rune AGENTBOX_VAULT_ENABLED=0
if ! _launched && _said 'Refused by the VAULT gate: AGENTBOX_VAULT_ENABLED=0'; then
  _ok "AGENTBOX_VAULT_ENABLED=0 + tui=rune + binary → NOT launched; message names the vault gate"
else
  _bad "the vault gate must refuse the launch" "rc=${RC} log:$(tr '\n' '|' <"$LOG")"
fi

# 5 — unwritable recovery home: no degraded launch, actionable error instead.
mkdir -p "${WS_UNWRITABLE}/.rune-home"
chmod 0500 "${WS_UNWRITABLE}/.rune-home"
_scenario unwritable-home "$WS_UNWRITABLE" VAULT_ROOT="${WS_UNWRITABLE}/vault" VAULT_TUI=rune AGENTBOX_VAULT_ENABLED=1
if [ "$(id -u)" = "0" ]; then
  _ok "SKIP  unwritable recovery home — running as root, where mode 0500 is not a barrier"
elif ! _launched \
   && _said 'Rune needs a WRITABLE recovery home' \
   && _said "path:   ${WS_UNWRITABLE}/.rune-home" \
   && _said 'fix:    mkdir -p' \
   && _said 'Not launching degraded on purpose'; then
  _ok "unwritable recovery home → NOT launched; pane gets path, reason and fix"
else
  _bad "an unwritable recovery home must block the launch with an actionable error" "rc=${RC} log:$(tr '\n' '|' <"$LOG")"
fi
chmod 0700 "${WS_UNWRITABLE}/.rune-home"

# 6 — no binary at all: the pre-existing rebuild notice still applies.
_scenario no-binary "$WS_NORUNE" VAULT_ROOT="${WS_NORUNE}/vault" VAULT_TUI=rune AGENTBOX_VAULT_ENABLED=1
if ! _launched && _said 'The rune binary is not present in this image'; then
  _ok "tui=rune + no binary → NOT launched; rebuild notice printed"
else
  _bad "a missing binary must print the rebuild notice" "rc=${RC} log:$(tr '\n' '|' <"$LOG")"
fi

# 7 — the window itself always exists, refusal or not (operators keep a shell).
MISSING=0
for n in tui-none vault-disabled unwritable-home no-binary launch; do
  grep -q 'new-window -t agentbox:9 -n Notes' "${TMP}/log-${n}" || MISSING=1
done
if [ "$MISSING" = 0 ]; then
  _ok "window 9 is created in every case, so a refusal still leaves a usable shell"
else
  _bad "window 9 must be created even when the TUI is refused"
fi

# 8 — the dry-run hook is inert: it touches no other window.
if ! grep -qE 'new-window -t agentbox:[0-8] ' "${TMP}/log-launch" && ! grep -q 'new-session' "${TMP}/log-launch"; then
  _ok "dry-run hook creates no session and no window other than 9"
else
  _bad "the dry-run hook must not touch other windows" "$(cat "${TMP}/log-launch")"
fi

echo
echo "=================================================="
printf 'notes-launcher: %d passed, %d failed\n' "$PASS" "$FAIL"
echo "=================================================="
[ "$FAIL" -eq 0 ] || exit 1
exit 0
