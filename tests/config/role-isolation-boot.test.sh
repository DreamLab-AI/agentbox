#!/usr/bin/env bash
# role-isolation-boot — with [security].role_isolation off the boot is today's
# (ADR-2122, custody X-1 step 1, W1).
#
# Extracts the W1 blocks from config/entrypoint-unified.sh by their anchors and
# executes them with stubs in a scratch dir (no root, no container), then
# checks the static wiring around them:
#   1. exec block, flag off: supervisord gets /etc/supervisord.conf, nothing is
#      delivered, no state is written (the chosen config IS today's)
#   2. exec block, flag on: delivery runs first, then the isolated config is
#      chosen; a delivery problem is recorded and the boot carries on
#   3. Stage A flag block: an image that cannot honour the flag falls back to
#      off (loud); a ready image prepares /run/secrets and moves the guard
#   4. Phase 1 and Phase 5c keep today's statements verbatim for flag off
#   5. Stage B picks the same guard dir Stage A armed
#   6. the lib is sourced once, before both stages, definitions only
#   7. the exec line keeps the form scripts/ci/check-secret-not-in-env.sh needs
# shellcheck disable=SC2015,SC2016
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ENTRY="$ROOT/config/entrypoint-unified.sh"
LIB="$ROOT/config/lib/role-custody.sh"
PASS=0; FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$((PASS + FAIL))" "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'not ok %d - %s\n' "$((PASS + FAIL))" "$1"; [ -n "${2:-}" ] && printf '#   %s\n' "$2"; }
_done() { printf '1..%d\n# role-isolation-boot: %d passed, %d failed\n' "$((PASS + FAIL))" "$PASS" "$FAIL"; [ "$FAIL" -eq 0 ]; exit $?; }

T="$(mktemp -d "${TMPDIR:-/tmp}/role-iso-boot.XXXXXX")"; trap 'rm -rf "$T"' EXIT

# _block <first-line-prefix> <last-line-prefix>: entrypoint lines from the first
# line starting with the first literal to the next one starting with the second.
_block() { A="$1" B="$2" awk '!f && index($0, ENVIRON["A"])==1 {f=1; print; next} f {print} f && index($0, ENVIRON["B"])==1 {exit}' "$ENTRY"; }

# ── 1/2. the exec block ──────────────────────────────────────────────────────
EXEC_BLK="$(_block '_AB_SUPERVISORD_CONF=/etc/supervisord.conf' 'exec supervisord ')"
[ -n "$EXEC_BLK" ] && [ "$(printf '%s\n' "$EXEC_BLK" | tail -1)" = 'exec supervisord -c "$_AB_SUPERVISORD_CONF" -n' ] \
  && _ok "the exec block ends in exec supervisord -c \"\$_AB_SUPERVISORD_CONF\" -n" \
  || _bad "exec block not found or its exec line changed" "$(printf '%s\n' "$EXEC_BLK" | tail -1)"
# Run it with the exec replaced by a print, the state file moved into scratch,
# and the lib's delivery stubbed (the real pick is used).
SIM="$(printf '%s\n' "$EXEC_BLK" \
  | sed -e 's#^exec supervisord -c "\$_AB_SUPERVISORD_CONF" -n$#printf "CONF=%s\\n" "$_AB_SUPERVISORD_CONF"#' \
        -e "s#/run/secrets/role-isolation.state#${T}/state#g")"
_run_exec() { # <flag> <deliver-failures> → stdout of the simulated block
  ( set -euo pipefail
    # shellcheck source=../../config/lib/role-custody.sh
    . "$LIB"
    ab_role_secrets_deliver() { echo "DELIVER $1" >>"$T/calls"; AB_RC_FAILURES="$DELIVER_FAILS"; return 0; }
    ab_supervisord_conf_pick() { echo "PICK $1" >>"$T/calls"; echo /etc/supervisord.roles.conf; }
    AGENTBOX_ROLE_ISOLATION="$1"; DELIVER_FAILS="$2"; _AB_SECRETS_MOUNT_STATE="${3:-ok}"
    eval "$SIM" )
}
rm -f "$T/calls" "$T/state"
out="$(_run_exec 0 0 | tail -1)"
[ "$out" = "CONF=/etc/supervisord.conf" ] && [ ! -e "$T/calls" ] && [ ! -e "$T/state" ] \
  && _ok "flag off: supervisord gets /etc/supervisord.conf; no delivery, no pick, no state write" \
  || _bad "flag off must choose today's config and do nothing else" "out=$out calls=$(cat "$T/calls" 2>/dev/null)"
badj=""
for junk in '' true yes 01 ' 1'; do
  rm -f "$T/calls"; out="$(_run_exec "$junk" 0 | tail -1)"
  [ "$out" = "CONF=/etc/supervisord.conf" ] && [ ! -e "$T/calls" ] || badj="${badj} '${junk}'"
done
[ -z "$badj" ] && _ok "only the exact effective value 1 (from _ab_toml_bool) turns the block on" || _bad "flag values must count as off" "$badj"
rm -f "$T/calls" "$T/state"
out="$(_run_exec 1 0 2>"$T/err")"
if [ "$(printf '%s\n' "$out" | tail -1)" = "CONF=/etc/supervisord.roles.conf" ] \
   && [ "$(cat "$T/calls")" = "$(printf 'DELIVER /etc/agentbox/role-secrets.tsv\nPICK 1')" ] \
   && [ "$(cat "$T/state")" = "ok:secrets-delivery" ]; then
  _ok "flag on: deliver from /etc/agentbox/role-secrets.tsv, then the isolated config; state ok:secrets-delivery"
else
  _bad "flag on must deliver, then pick the isolated config" "out=$out calls=$(tr '\n' ';' <"$T/calls") state=$(cat "$T/state" 2>/dev/null)"
fi
rm -f "$T/calls" "$T/state"
out="$(_run_exec 1 3 degraded 2>"$T/err")"
[ "$(printf '%s\n' "$out" | tail -1)" = "CONF=/etc/supervisord.roles.conf" ] \
  && [ "$(cat "$T/state")" = "$(printf 'degraded:secrets-mount\ndegraded:secrets-delivery')" ] \
  && _ok "delivery problems and a bad mount are recorded degraded; the boot still reaches exec (fail loud, not fatal)" \
  || _bad "degraded path" "state=$(cat "$T/state" 2>/dev/null)"
# The real pick, flag off and on, against scratch configs.
. "$LIB"
: >"$T/today"; : >"$T/iso"
[ "$(ab_supervisord_conf_pick 0 "$T/today" "$T/iso")" = "$T/today" ] && [ "$(ab_supervisord_conf_pick 1 "$T/today" "$T/iso")" = "$T/iso" ] \
  && [ "$(ab_supervisord_conf_pick 1 "$T/today" "$T/absent")" = "$T/today" ] \
  && [ "$(ab_supervisord_conf_pick 0)" = /etc/supervisord.conf ] \
  && _ok "ab_supervisord_conf_pick: off → today's; on → isolated; on without an isolated file → today's" \
  || _bad "ab_supervisord_conf_pick"
ln -s "$T/iso" "$T/isolink"
[ "$(ab_supervisord_conf_pick 1 "$T/today" "$T/isolink")" = "$T/today" ] && _ok "a symlinked isolated config is not followed" || _bad "symlinked isolated config"

# ── 3. Stage A flag block ────────────────────────────────────────────────────
FLAG_BLK="$(_block '_AB_SECRETS_MOUNT_STATE=ok' 'export AGENTBOX_ROLE_ISOLATION')"
[ -n "$FLAG_BLK" ] && _ok "the Stage A flag block is present" || { _bad "Stage A flag block not found"; _done; }
_run_flag() { # <flag> <ready 0|1> → "flag guard mount" plus calls
  ( set -euo pipefail
    . "$LIB"
    ab_role_isolation_ready() { [ "$READY" = 1 ]; }
    ab_secrets_root_prepare() { echo "PREPARE $1" >>"$T/calls"; return "${PREP_RC:-0}"; }
    ab_root_state_dir_pick() { echo "/run/secrets/.root-guard"; }
    _AB_ROLE_CUSTODY_LIB=/opt/agentbox/config/lib/role-custody.sh
    AB_ROOT_STATE_DIR=/tmp/.agentbox-root; AGENTBOX_ROLE_ISOLATION="$1"; READY="$2"
    eval "$FLAG_BLK"
    echo "$AGENTBOX_ROLE_ISOLATION $AB_ROOT_STATE_DIR $_AB_SECRETS_MOUNT_STATE" )
}
rm -f "$T/calls"
[ "$(_run_flag 0 1)" = "0 /tmp/.agentbox-root ok" ] && [ ! -e "$T/calls" ] \
  && _ok "flag off: nothing prepared, guard stays /tmp/.agentbox-root" || _bad "flag off Stage A block"
rm -f "$T/calls"
out="$(_run_flag 1 0 2>"$T/err")"
[ "$out" = "0 /tmp/.agentbox-root ok" ] && grep -q 'ROLE-ISOLATION-UNAVAILABLE' "$T/err" && [ ! -e "$T/calls" ] \
  && _ok "flag on but the image cannot honour it: booted as off, with a ROLE-ISOLATION-UNAVAILABLE marker" \
  || _bad "unavailable fallback" "$out"
rm -f "$T/calls"
[ "$(_run_flag 1 1)" = "1 /run/secrets/.root-guard ok" ] && [ "$(cat "$T/calls")" = "PREPARE /run/secrets" ] \
  && _ok "flag on and ready: /run/secrets prepared, guard moved into it" || _bad "ready Stage A block"
rm -f "$T/calls"
[ "$(PREP_RC=1 _run_flag 1 1)" = "1 /run/secrets/.root-guard degraded" ] \
  && _ok "a non-mount /run/secrets is carried as degraded, not fatal" || _bad "degraded mount in Stage A"
flag_line="$(grep -n '^AGENTBOX_ROLE_ISOLATION="\$(_ab_toml_bool security role_isolation)"$' "$ENTRY" | cut -d: -f1)"
blk_line="$(grep -n '^_AB_SECRETS_MOUNT_STATE=ok$' "$ENTRY" | cut -d: -f1)"
prep_line="$(grep -n '^_ab_root_state_dir_prepare "\$AB_ROOT_STATE_DIR"' "$ENTRY" | cut -d: -f1)"
[ -n "$flag_line" ] && [ -n "$blk_line" ] && [ -n "$prep_line" ] && [ "$flag_line" -lt "$blk_line" ] && [ "$blk_line" -lt "$prep_line" ] \
  && _ok "order: read flag (${flag_line}) → effective flag and guard pick (${blk_line}) → arm the guard (${prep_line})" \
  || _bad "Stage A ordering" "flag=${flag_line:-?} block=${blk_line:-?} prepare=${prep_line:-?}"

# ── 4. Phase 1 and Phase 5c, flag off verbatim ───────────────────────────────
P1="$(_block 'if [ "$AGENTBOX_ROLE_ISOLATION" != 1 ]; then' 'fi' | head -4)"
[ "$P1" = "$(printf '%s\n' 'if [ "$AGENTBOX_ROLE_ISOLATION" != 1 ]; then' '  chmod 0700 /run/secrets 2>/dev/null || true' '  chown 1000:1000 /run/secrets 2>/dev/null || true' 'fi')" ] \
  && _ok "Phase 1: flag off still chmods /run/secrets 0700 and chowns it to devuser, verbatim" || _bad "Phase 1 /run/secrets block" "$P1"
grep -qE '^chown 1000:1000 /run/secrets' "$ENTRY" && _bad "an ungated chown of /run/secrets to devuser remains" || _ok "no ungated chown of /run/secrets remains"
grep -q '^if \[ -n "\${AGENTBOX_BRIDGE_SK:-}" \] && \[ "\$AGENTBOX_ROLE_ISOLATION" != 1 \]; then$' "$ENTRY" \
  && _ok "Phase 5c: the devuser nostr.key copy is written only with the flag off" || _bad "Phase 5c gate"

# ── 5. Stage B ───────────────────────────────────────────────────────────────
B="$(_block 'if [ "${AGENTBOX_ROLE_ISOLATION:-0}" = 1 ] && declare -F ab_root_state_dir_pick' 'fi')"
claim_line="$(grep -n '^_ab_stage_b_claim "\$AB_ROOT_STATE_DIR"' "$ENTRY" | cut -d: -f1)"
b_line="$(grep -n '^if \[ "\${AGENTBOX_ROLE_ISOLATION:-0}" = 1 \] && declare -F ab_root_state_dir_pick' "$ENTRY" | cut -d: -f1)"
[ -n "$B" ] && [ -n "$b_line" ] && [ -n "$claim_line" ] && [ "$b_line" -lt "$claim_line" ] && [ $((claim_line - b_line)) -lt 6 ] \
  && _ok "Stage B re-picks the guard dir from PID 1's effective flag just before claiming" || _bad "Stage B guard pick" "b=${b_line:-?} claim=${claim_line:-?}"
out="$( . "$LIB"; ab_secrets_mount_ok() { return 0; }; AB_ROOT_STATE_DIR=/tmp/.agentbox-root; AGENTBOX_ROLE_ISOLATION=0; eval "$B"; echo "$AB_ROOT_STATE_DIR")"
out1="$( . "$LIB"; ab_secrets_mount_ok() { return 0; }; AB_ROOT_STATE_DIR=/tmp/.agentbox-root; AGENTBOX_ROLE_ISOLATION=1; eval "$B"; echo "$AB_ROOT_STATE_DIR")"
[ "$out" = /tmp/.agentbox-root ] && [ "$out1" = /run/secrets/.root-guard ] \
  && _ok "Stage B: off → /tmp/.agentbox-root; on with a good mount → /run/secrets/.root-guard (same as Stage A)" || _bad "Stage B pick" "$out / $out1"

# ── 6. the lib is sourced once, before the stage split ───────────────────────
src_line="$(grep -n '^  \. "\$_AB_ROLE_CUSTODY_LIB"$' "$ENTRY" | cut -d: -f1)"
dispatch_line="$(grep -n '^if \[ "\${AGENTBOX_BOOTSTRAP_STAGE:-A}" = "B" \]; then$' "$ENTRY" | cut -d: -f1)"
[ "$(grep -c '\. "\$_AB_ROLE_CUSTODY_LIB"' "$ENTRY")" = 1 ] && [ -n "$src_line" ] && [ -n "$dispatch_line" ] && [ "$src_line" -lt "$dispatch_line" ] \
  && _ok "role-custody.sh is sourced once (line ${src_line}), before the stage dispatch (line ${dispatch_line})" || _bad "lib sourcing" "src=${src_line:-?}"
grep -q '^_AB_ROLE_CUSTODY_LIB=/opt/agentbox/config/lib/role-custody.sh$' "$ENTRY" && _ok "the lib path is the baked /opt/agentbox copy (a literal, not inherited)" || _bad "lib path"
side="$(bash -c 'set -euo pipefail; before="$(declare -p | md5sum)"; . "$1" >/dev/null 2>&1; set | grep -cE "^(AB_RC_FAILURES|AB_RC_DELIVERED)=" || true' _ "$LIB")"
[ "$side" = 0 ] && _ok "sourcing the lib runs nothing (no delivery state set)" || _bad "sourcing the lib has side effects"

# ── 7. the exec line keeps the CI gate's form ────────────────────────────────
if out="$(sh "$ROOT/scripts/ci/check-secret-not-in-env.sh" 2>&1)"; then _ok "check-secret-not-in-env still passes"; else _bad "check-secret-not-in-env" "$out"; fi

_done
