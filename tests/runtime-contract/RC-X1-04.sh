#!/usr/bin/env bash
# RC-X1-04 — the Docker socket is widened only while role isolation is off
# (custody X-1 step 1, W0, bypass 1).
#
# The entrypoint ran `chmod o+rw /var/run/docker.sock` on every boot, handing
# devuser the host's Docker daemon (root on the host). Under
# [security].role_isolation = true it must not; under false it must behave
# exactly as before.
#
# R2 (recorded in tests/runtime-contract/README.md, host-half contract): the
# socket is a bind of the HOST inode, already widened by earlier boots. Skipping
# the chmod does not narrow it; the boot reports `degraded:docker-socket` until
# the owner runs the host-side chmod (Q2). The entrypoint never narrows it itself.
#
# Asserts, against the real functions extracted from config/entrypoint-unified.sh:
#   1. flag off: a 0660 socket becomes 0666 (today's behaviour, same command)
#   2. flag on, socket 0660 that devuser neither owns nor shares a group with:
#      untouched; state ok:docker-socket
#   3. flag on, socket already o+rw (or owned by / grouped with devuser):
#      untouched (host inode); state degraded + loud marker
#   4. the state write never follows a planted symlink
#   5. no socket: no-op
#   6. [security].role_isolation is read with the manifest reader and exported
#   7. live (AGENTBOX_RC_LIVE=1 with the flag on): devuser cannot use the raw socket
# shellcheck disable=SC2015,SC2016
# SC2015: _ok/_bad always return 0, so `cond && _ok || _bad` is a true if/else.
# SC2016: single-quoted $ is deliberate (regexes and code run in a child bash).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRY="${HERE}/../../config/entrypoint-unified.sh"
PASS=0; FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$((PASS + FAIL))" "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'not ok %d - %s\n' "$((PASS + FAIL))" "$1"; [ -n "${2:-}" ] && printf '#   %s\n' "$2"; }
_skip() { PASS=$((PASS + 1)); printf 'ok %d # SKIP %s\n' "$((PASS + FAIL))" "$1"; }
_done() { printf '1..%d\n# RC-X1-04: %d passed, %d failed\n' "$((PASS + FAIL))" "$PASS" "$FAIL"; [ "$FAIL" -eq 0 ]; exit $?; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/rc-x1-04.XXXXXX")"; trap 'rm -rf "$TMP"' EXIT
_extract() { awk -v n="$1" '$0 ~ "^"n"\\(\\) \\{" {f=1} f {print} f && /^}$/ {exit}' "$ENTRY"; }
for fn in _ab_toml_val _ab_toml_bool _ab_docker_socket_access; do
  body="$(_extract "$fn")"
  if [ -z "$body" ]; then _bad "${fn}() is defined in the entrypoint"; _done; fi
  eval "$body"
done
_ok "_ab_docker_socket_access() and the manifest readers are defined"

_mksock() { # _mksock <path> <mode>
  python3 -c 'import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])' "$1" 2>/dev/null \
    || node -e 'const s=require("net").createServer().listen(process.argv[1],()=>{process.exit(0)})' "$1"
  chmod "$2" "$1"
}
_mode() { stat -c %a "$1"; }

# ── 1. flag off ──────────────────────────────────────────────────────────────
S="${TMP}/off.sock"; _mksock "$S" 0660; ST="${TMP}/off.state"
_ab_docker_socket_access "$S" 0 "$ST" >/dev/null 2>&1
[ "$(_mode "$S")" = 666 ] && _ok "flag off: socket widened o+rw exactly as before (0660 → 0666)" \
  || _bad "flag off must widen the socket" "mode $(_mode "$S")"
[ ! -e "$ST" ] && _ok "flag off: no role-isolation state is written" || _bad "flag off must write no state"
BODY="$(_extract _ab_docker_socket_access)"
printf '%s' "$BODY" | grep -qF 'chmod o+rw "$sock" 2>/dev/null || true' \
  && _ok "flag off runs the original command verbatim" || _bad "flag-off branch must keep the original chmod"

# ── 2. flag on, socket not widened ───────────────────────────────────────────
S="${TMP}/on.sock"; _mksock "$S" 0660; ST="${TMP}/on.state"
# The fixture socket is ours (uid/gid of this shell), so "devuser" is played by
# an account that does not exist: it neither owns the socket nor shares its group.
OUT="$(_ab_docker_socket_access "$S" 1 "$ST" rc-x1-no-such-user 2>&1)"
[ "$(_mode "$S")" = 660 ] && _ok "flag on: socket mode untouched (0660)" || _bad "flag on must not chmod" "mode $(_mode "$S")"
[ "$(cat "$ST" 2>/dev/null)" = "ok:docker-socket" ] && _ok "flag on, narrow socket: state ok:docker-socket" \
  || _bad "state must read ok:docker-socket" "$(cat "$ST" 2>&1)"

# ── 3. flag on, host inode already widened (R2) ──────────────────────────────
S="${TMP}/wide.sock"; _mksock "$S" 0666; ST="${TMP}/wide.state"
OUT="$(_ab_docker_socket_access "$S" 1 "$ST" rc-x1-no-such-user 2>&1)"
[ "$(_mode "$S")" = 666 ] && _ok "flag on, widened socket: left alone (never chmods the host inode either way)" \
  || _bad "flag on must not chmod a widened socket" "mode $(_mode "$S")"
[ "$(cat "$ST" 2>/dev/null)" = "degraded:docker-socket" ] && _ok "flag on, widened socket: state degraded:docker-socket" \
  || _bad "state must read degraded:docker-socket" "$(cat "$ST" 2>&1)"
printf '%s' "$OUT" | grep -q 'ROLE-ISOLATION-DEGRADED docker-socket' && _ok "a grep-able ROLE-ISOLATION-DEGRADED marker is logged" \
  || _bad "degraded marker must be logged" "$OUT"

S2="${TMP}/owned.sock"; _mksock "$S2" 0600; ST="${TMP}/owned.state"
_ab_docker_socket_access "$S2" 1 "$ST" "$(id -un)" >/dev/null 2>&1
[ "$(cat "$ST" 2>/dev/null)" = "degraded:docker-socket" ] && _ok "flag on, 0600 socket owned by the user: degraded (owner bits count)" \
  || _bad "an owned socket must read degraded" "$(cat "$ST" 2>&1)"

# ── 4. symlinked state path ──────────────────────────────────────────────────
VICTIM="${TMP}/victim"; printf 'precious\n' >"$VICTIM"; ln -s "$VICTIM" "${TMP}/link.state"
_ab_docker_socket_access "$S" 1 "${TMP}/link.state" >/dev/null 2>&1
[ "$(cat "$VICTIM")" = "precious" ] && _ok "the state write does not follow a planted symlink" \
  || _bad "state write followed a symlink" "$(cat "$VICTIM")"

# ── 5. no socket ─────────────────────────────────────────────────────────────
_ab_docker_socket_access "${TMP}/absent.sock" 1 "${TMP}/absent.state" >/dev/null 2>&1; rc=$?
[ "$rc" = 0 ] && [ ! -e "${TMP}/absent.state" ] && _ok "no socket: returns 0, writes nothing" || _bad "absent socket must be a no-op" "rc=$rc"

# ── 6. flag read + wiring ────────────────────────────────────────────────────
printf '[security]\naudit_acknowledged = true\nrole_isolation = true\n' >"${TMP}/on.toml"
printf '[security]\naudit_acknowledged = true\n' >"${TMP}/off.toml"
a="$(AGENTBOX_CONFIG="${TMP}/on.toml" _ab_toml_bool security role_isolation)"
b="$(AGENTBOX_CONFIG="${TMP}/off.toml" _ab_toml_bool security role_isolation)"
[ "$a" = 1 ] && [ "$b" = 0 ] && _ok "role_isolation reads 1 when true, 0 when absent (default false)" || _bad "flag read" "on=$a off=$b"
grep -qE '^AGENTBOX_ROLE_ISOLATION="\$\(_ab_toml_bool security role_isolation\)"' "$ENTRY" \
   && grep -qE '^export AGENTBOX_ROLE_ISOLATION$' "$ENTRY" \
  && _ok "Stage A exports AGENTBOX_ROLE_ISOLATION from the manifest" || _bad "Stage A must export AGENTBOX_ROLE_ISOLATION"
grep -qE '^_ab_docker_socket_access /var/run/docker\.sock "\$AGENTBOX_ROLE_ISOLATION"' "$ENTRY" \
  && _ok "Stage A gates the socket on the flag" || _bad "Stage A must call _ab_docker_socket_access with the flag"
grep -nE '^\s*chmod o\+rw /var/run/docker\.sock' "$ENTRY" >/dev/null \
  && _bad "an unconditional chmod o+rw of the docker socket remains" || _ok "no unconditional chmod o+rw remains"

# ── 7. live ──────────────────────────────────────────────────────────────────
if [ "${AGENTBOX_RC_LIVE:-0}" = 1 ] && [ "${AGENTBOX_ROLE_ISOLATION:-0}" = 1 ]; then
  if [ "$(id -un)" != devuser ]; then
    _bad "live check must run as devuser" "running as $(id -un)"
  elif DOCKER_HOST=unix:///var/run/docker.sock timeout 10 docker version >/dev/null 2>&1; then
    _bad "live: devuser can still drive the raw Docker socket" "see R2: host-side chmod 0660 needed"
  else
    _ok "live: devuser docker version on the raw socket fails"
  fi
else
  _skip "live check needs the flag on in a rebuilt image (AGENTBOX_RC_LIVE=1)"
fi

_done
