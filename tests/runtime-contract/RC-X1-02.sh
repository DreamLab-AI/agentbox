#!/usr/bin/env bash
# RC-X1-02 — Stage B is one-shot per container start (custody X-1 step 1, W0, bypass 2).
#
# [program:bootstrap] runs the entrypoint's Stage B as root, and the supervisor
# socket lets devuser `supervisorctl start bootstrap` (flake.nix:2305-2307, kept
# by Q10). W0 makes a second Stage B run a no-op, guarded by a sentinel that only
# root can create or remove.
#
# Where the sentinel lives matters: /run, /var/run and /var/log are tmpfs mounts
# OWNED BY UID 1000 (flake.nix:3200-3203), so devuser can rename or delete any
# entry directly under them, root-owned or not. /tmp is root:root 1777 (sticky):
# devuser cannot rename or unlink root's entries there, and it is a fresh tmpfs
# per container start. The sentinel directory is /tmp/.agentbox-root (root 0700)
# until W1 gives /run/secrets its own root-owned mount.
#
# Asserts, against the real functions extracted from config/entrypoint-unified.sh:
#   1. Stage A's prepare creates the state dir 0700
#   2. the first Stage B claim succeeds, every later one is a no-op
#   3. a new container start (prepare again) re-arms exactly one claim
#   4. an untrusted state dir (wrong owner, loose mode, symlink) refuses the claim
#   5. prepare moves a squatted path aside rather than trusting or following it
#   6. the sentinel path is not under a devuser-owned tmpfs; /tmp is root 1777 here
#   7. the Stage B prologue claims before Phase 6 and exits 0 on a replay
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRY="${HERE}/../../config/entrypoint-unified.sh"
PASS=0; FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$((PASS + FAIL))" "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'not ok %d - %s\n' "$((PASS + FAIL))" "$1"; [ -n "${2:-}" ] && printf '#   %s\n' "$2"; }
_skip() { PASS=$((PASS + 1)); printf 'ok %d # SKIP %s\n' "$((PASS + FAIL))" "$1"; }
_done() { printf '1..%d\n# RC-X1-02: %d passed, %d failed\n' "$((PASS + FAIL))" "$PASS" "$FAIL"; [ "$FAIL" -eq 0 ]; exit $?; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/rc-x1-02.XXXXXX")"; trap 'chmod -R u+rwx "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
_extract() { awk -v n="$1" '$0 ~ "^"n"\\(\\) \\{" {f=1} f {print} f && /^}$/ {exit}' "$ENTRY"; }
for fn in _ab_root_state_dir_ok _ab_root_state_dir_prepare _ab_stage_b_claim; do
  body="$(_extract "$fn")"
  if [ -z "$body" ]; then _bad "${fn}() is defined in the entrypoint"; _done; fi
  eval "$body"
done
_ok "state-dir and claim functions are defined in the entrypoint"

ME="$(id -u)"   # stands in for uid 0: the functions take the expected owner uid
D="${TMP}/agentbox-root"
_claim() { local rc=0; _ab_stage_b_claim "$1" "${2:-$ME}" || rc=$?; echo "$rc"; }

# ── 1. prepare ───────────────────────────────────────────────────────────────
_ab_root_state_dir_prepare "$D" "$ME" >/dev/null 2>&1
[ -d "$D" ] && [ "$(stat -c '%u %a' "$D")" = "${ME} 700" ] && _ok "prepare creates the state dir owned by the boot uid, mode 0700" \
  || _bad "prepare must create the state dir 0700" "$(stat -c '%u %a' "$D" 2>&1)"

# ── 2. one-shot ──────────────────────────────────────────────────────────────
[ "$(_claim "$D")" = 0 ] && _ok "first Stage B claim succeeds" || _bad "first claim must succeed"
r2="$(_claim "$D")"; r3="$(_claim "$D")"
[ "$r2" = 1 ] && [ "$r3" = 1 ] && _ok "second and third claims are no-ops (rc 1)" || _bad "replays must be no-ops" "rc2=$r2 rc3=$r3"

# ── 3. re-arm on a new container start ───────────────────────────────────────
_ab_root_state_dir_prepare "$D" "$ME" >/dev/null 2>&1
r1="$(_claim "$D")"; r2="$(_claim "$D")"
[ "$r1" = 0 ] && [ "$r2" = 1 ] && _ok "a new Stage A re-arms exactly one claim" || _bad "Stage A must re-arm once" "rc1=$r1 rc2=$r2"

# ── 4. untrusted state dir refuses ───────────────────────────────────────────
if [ "$ME" != 0 ]; then
  [ "$(_claim "$D" 0)" = 2 ] && _ok "a state dir not owned by root refuses the claim (rc 2)" \
    || _bad "wrong-owner state dir must refuse"
else
  _skip "running as root: cannot fake a non-root owner"
fi
L="${TMP}/loose"; mkdir -p "$L"; chmod 0777 "$L"
[ "$(_claim "$L")" = 2 ] && _ok "a group/other-writable state dir refuses the claim" || _bad "loose-mode state dir must refuse"
T="${TMP}/target"; mkdir -p "$T"; chmod 0700 "$T"; ln -s "$T" "${TMP}/link"
[ "$(_claim "${TMP}/link")" = 2 ] && _ok "a symlinked state dir refuses the claim" || _bad "symlinked state dir must refuse"
[ "$(_claim "${TMP}/absent")" = 2 ] && _ok "a missing state dir refuses the claim (fail closed)" || _bad "missing state dir must refuse"

# ── 5. squatters are moved aside, never followed ─────────────────────────────
S="${TMP}/squat"; mkdir -p "$S"; chmod 0777 "$S"; : >"${S}/planted"
_ab_root_state_dir_prepare "$S" "$ME" >/dev/null 2>&1
if [ "$(stat -c '%a' "$S" 2>/dev/null)" = 700 ] && [ ! -e "${S}/planted" ] && ls -d "${S}".squatted.* >/dev/null 2>&1; then
  _ok "a loose pre-existing dir is moved aside and recreated 0700"
else
  _bad "squatted dir must be moved aside and recreated"
fi
SL="${TMP}/squatlink"; ln -s "$T" "$SL"; : >"${T}/keep"
_ab_root_state_dir_prepare "$SL" "$ME" >/dev/null 2>&1
if [ -d "$SL" ] && [ ! -L "$SL" ] && [ -e "${T}/keep" ] && [ "$(stat -c '%a' "$T")" = 700 ]; then
  _ok "a symlink at the state path is moved aside; its target is untouched"
else
  _bad "symlink squatter must be replaced without touching its target"
fi

# ── 6. location ──────────────────────────────────────────────────────────────
SDIR="$(grep -E '^AB_ROOT_STATE_DIR=' "$ENTRY" | head -1 | cut -d= -f2- | tr -d '"')"
case "$SDIR" in
  /tmp/?*) _ok "sentinel dir is ${SDIR} (sticky /tmp, not a devuser-owned tmpfs)" ;;
  "") _bad "AB_ROOT_STATE_DIR constant is defined" ;;
  *) _bad "sentinel dir must not live under /run, /var/run, /var/log or /home" "$SDIR" ;;
esac
grep -qE '^AB_ROOT_STATE_DIR="?\$' "$ENTRY" && _bad "AB_ROOT_STATE_DIR must be a literal, not inherited from the environment"
if [ -d /tmp ] && [ "$(stat -c '%u %a' /tmp)" = "0 1777" ]; then
  _ok "/tmp on this host is root-owned 1777 (the sticky-bit guarantee holds)"
else
  _skip "/tmp here is $(stat -c '%u %a' /tmp 2>/dev/null); the image's is root 1777"
fi

# ── 7. prologue wiring ───────────────────────────────────────────────────────
claim_line="$(grep -n '_ab_stage_b_claim "\$AB_ROOT_STATE_DIR"' "$ENTRY" | head -1 | cut -d: -f1)"
phase6_line="$(grep -n 'echo "\[6/8\]' "$ENTRY" | head -1 | cut -d: -f1)"
endA_line="$(grep -n '^fi  # end STAGE_B_MODE=0 block' "$ENTRY" | head -1 | cut -d: -f1)"
if [ -n "$claim_line" ] && [ -n "$phase6_line" ] && [ -n "$endA_line" ] \
   && [ "$claim_line" -gt "$endA_line" ] && [ "$claim_line" -lt "$phase6_line" ]; then
  _ok "Stage B claims at line ${claim_line}, before Phase 6 (line ${phase6_line})"
else
  _bad "Stage B must claim the sentinel before Phase 6" "claim=${claim_line:-none} endA=${endA_line:-none} phase6=${phase6_line:-none}"
fi
prep_line="$(grep -n '_ab_root_state_dir_prepare "\$AB_ROOT_STATE_DIR"' "$ENTRY" | head -1 | cut -d: -f1)"
[ -n "$prep_line" ] && [ -n "$endA_line" ] && [ "$prep_line" -lt "$endA_line" ] \
  && _ok "Stage A prepares the state dir (line ${prep_line})" || _bad "Stage A must prepare the state dir"
if [ -n "$claim_line" ]; then
  blk="$(sed -n "${claim_line},$((claim_line + 12))p" "$ENTRY")"
  printf '%s' "$blk" | grep -qE '1\)[^;]*exit 0' && printf '%s' "$blk" | grep -qE '2\)|\*\)' \
    && _ok "a replay exits 0 (supervisord records a clean one-shot); an untrusted dir exits non-zero" \
    || _bad "replay must exit 0 and refusal must exit non-zero" "$blk"
fi

_done
