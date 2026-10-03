#!/usr/bin/env bash
# RC-X1-07 — devuser holds no sudo route under role isolation (custody X-1, W10).
#
# flake.nix baked `wheel:x:998:devuser` and /etc/sudoers.d/devuser
# `devuser ALL=(ALL) NOPASSWD: ALL` into every image. no-new-privileges:true
# neuters the setuid bit today, but that is one compose line away from undone,
# and with it every role boundary falls to `sudo`. Under
# [security].role_isolation = true devuser is not in wheel and no sudoers line
# grants it NOPASSWD; off, the baked files are byte-identical to before.
#
# /etc is baked into a read-only rootfs, so the gate is in two places:
#   the bake  config/bake-devuser-privilege.sh <etc> <0|1>, called by flake.nix
#             with the BUILD-time flag;
#   the boot  _ab_devuser_privilege_check in config/entrypoint-unified.sh: flag
#             on at boot in an image baked with it off (a boot-class flip without
#             the rebuild) cannot be repaired, so it records
#             degraded:devuser-sudo and logs a grep-able marker naming the rebuild.
#
# Fake root: each case is a scratch <etc> seeded from the real /etc/group
# heredoc in flake.nix; the check reads only files, and its state file and
# stderr are the recorder. No root, no sudo, no Docker.
#   1. the flake passes the build-time flag to the bake; no other NOPASSWD bake
#   2. flag off: group, sudoers and the drop-in are today's, byte for byte
#   3. flag on: devuser in neither wheel nor root; no NOPASSWD line; no drop-in
#   4. flag on strips only devuser from a shared member list
#   5. a bad flag argument writes nothing
#   6. check, flag off: silent, no state
#   7. check, flag on, flag-on bake: ok:devuser-sudo
#   8. check, flag on, flag-off bake: degraded:devuser-sudo + marker naming the rebuild
#   9. check: a %wheel NOPASSWD grant counts; a commented-out line does not
#  10. the entrypoint runs the check with AGENTBOX_ROLE_ISOLATION
#  11. live (AGENTBOX_RC_LIVE=1, flag on, rebuilt image): devuser not in wheel, sudo -n refused
# shellcheck disable=SC2015,SC2016
# SC2015: _ok/_bad always return 0, so `cond && _ok || _bad` is a true if/else.
# SC2016: single-quoted $ is deliberate (literal strings matched in the flake).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../.." && pwd)"
FLAKE="${REPO}/flake.nix"
ENTRY="${REPO}/config/entrypoint-unified.sh"
BAKE="${REPO}/config/bake-devuser-privilege.sh"
PASS=0; FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$((PASS + FAIL))" "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'not ok %d - %s\n' "$((PASS + FAIL))" "$1"; [ -n "${2:-}" ] && printf '#   %s\n' "$2"; }
_skip() { PASS=$((PASS + 1)); printf 'ok %d # SKIP %s\n' "$((PASS + FAIL))" "$1"; }
_done() { printf '1..%d\n# RC-X1-07: %d passed, %d failed\n' "$((PASS + FAIL))" "$PASS" "$FAIL"; [ "$FAIL" -eq 0 ]; exit $?; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/rc-x1-07.XXXXXX")"; trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT

# The /etc/group heredoc exactly as flake.nix bakes it (same reader as RC-X1-03).
GROUP="$(awk "/cat > \\\$out\/etc\/group <<'GROUP'/{f=1;next} f && /^[[:space:]]*GROUP\$/{exit} f{gsub(/^[[:space:]]+/,\"\"); print}" "$FLAKE")"
[ -n "$GROUP" ] || { _bad "baked /etc/group heredoc found in flake.nix"; _done; }
seed() { mkdir -p "$1"; printf '%s\n' "$GROUP" >"$1/group"; }
bake() { bash "$BAKE" "$@"; }

# ── 1. the flake hands the build-time flag to the bake ──────────────────────
grep -qE '^[[:space:]]*roleIsolationBaked = securityCfg\.role_isolation or false;' "$FLAKE" \
  && _ok "flake reads [security].role_isolation at build time (roleIsolationBaked)" \
  || _bad "flake must bind roleIsolationBaked = securityCfg.role_isolation or false"
grep -qF 'bake-devuser-privilege.sh} $out/etc ${if roleIsolationBaked then "1" else "0"}' "$FLAKE" \
  && _ok "flake runs config/bake-devuser-privilege.sh on \$out/etc with that flag" \
  || _bad "flake must call the bake with the build-time flag"
n="$(grep -c 'NOPASSWD' "$FLAKE")"
[ "$n" = 0 ] && _ok "flake.nix writes no NOPASSWD line itself (the bake owns it)" \
  || _bad "flake.nix must not write NOPASSWD outside the bake" "$(grep -n NOPASSWD "$FLAKE" | head -3)"
[ -f "$BAKE" ] || { _bad "config/bake-devuser-privilege.sh exists"; _done; }

# ── 2. flag off: today's files, byte for byte ───────────────────────────────
E="$TMP/off"; seed "$E"; bake "$E" 0 >/dev/null 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$E/group")" = "$GROUP" ] \
  && _ok "flag off: /etc/group is the heredoc unchanged (wheel:x:998:devuser)" \
  || _bad "flag off must leave /etc/group as baked" "rc=$rc $(grep '^wheel' "$E/group")"
printf '%s\n' "$GROUP" | grep -qx 'wheel:x:998:devuser' \
  && _ok "the heredoc still lists devuser in wheel (flag-off default)" || _bad "heredoc wheel line changed"
[ "$(cat "$E/sudoers" 2>/dev/null)" = "$(printf 'root ALL=(ALL) ALL\n#includedir /etc/sudoers.d')" ] \
  && [ "$(stat -c %a "$E/sudoers")" = 440 ] && _ok "flag off: /etc/sudoers is today's, 0440" \
  || _bad "flag off: /etc/sudoers" "$(cat "$E/sudoers" 2>&1)"
[ "$(cat "$E/sudoers.d/devuser" 2>/dev/null)" = 'devuser ALL=(ALL) NOPASSWD: ALL' ] \
  && [ "$(stat -c %a "$E/sudoers.d/devuser")" = 440 ] && _ok "flag off: sudoers.d/devuser is today's NOPASSWD line, 0440" \
  || _bad "flag off: sudoers.d/devuser" "$(cat "$E/sudoers.d/devuser" 2>&1)"

# ── 3. flag on ───────────────────────────────────────────────────────────────
E="$TMP/on"; seed "$E"; bake "$E" 1 >/dev/null 2>&1; rc=$?
[ "$rc" = 0 ] && grep -qx 'wheel:x:998:' "$E/group" && grep -qx 'root:x:0:' "$E/group" && grep -qx 'devuser:x:1000:' "$E/group" \
  && _ok "flag on: wheel and root have no devuser; devuser keeps its own group" \
  || _bad "flag on: /etc/group" "rc=$rc $(tr '\n' ' ' <"$E/group")"
[ "$(grep -v '^wheel:' "$E/group")" = "$(printf '%s\n' "$GROUP" | grep -v '^wheel:')" ] \
  && _ok "flag on: every other group line is untouched" || _bad "flag on changed lines beyond wheel"
grep -qx 'root ALL=(ALL) ALL' "$E/sudoers" && grep -qx '#includedir /etc/sudoers.d' "$E/sudoers" \
  && _ok "flag on: /etc/sudoers keeps root and the includedir" || _bad "flag on: /etc/sudoers"
[ -d "$E/sudoers.d" ] && [ ! -e "$E/sudoers.d/devuser" ] && ! grep -rqs NOPASSWD "$E/sudoers" "$E/sudoers.d" \
  && _ok "flag on: no sudoers.d/devuser and no NOPASSWD line anywhere" \
  || _bad "flag on: a NOPASSWD route remains" "$(grep -rs NOPASSWD "$E/sudoers" "$E/sudoers.d")"

# ── 4. only devuser leaves a shared member list ─────────────────────────────
E="$TMP/shared"; mkdir -p "$E"; printf 'root:x:0:devuser\nwheel:x:998:alice,devuser,bob\ndevuser:x:1000:\nab-identity:x:960:\n' >"$E/group"
bake "$E" 1 >/dev/null 2>&1
[ "$(cat "$E/group")" = "$(printf 'root:x:0:\nwheel:x:998:alice,bob\ndevuser:x:1000:\nab-identity:x:960:')" ] \
  && _ok "flag on: devuser is removed from root and wheel member lists, others kept" \
  || _bad "flag on: member-list edit" "$(tr '\n' ' ' <"$E/group")"

# ── 5. bad argument ──────────────────────────────────────────────────────────
E="$TMP/bad"; seed "$E"; before="$(cat "$E/group")"
if bake "$E" yes >/dev/null 2>&1; then _bad "a bad flag argument must fail"
else [ "$(cat "$E/group")" = "$before" ] && [ ! -e "$E/sudoers" ] && _ok "a bad flag argument fails and writes nothing" \
  || _bad "a bad flag argument wrote files"; fi

# ── the boot-time check ──────────────────────────────────────────────────────
body="$(awk '$0 ~ "^_ab_devuser_privilege_check\\(\\) \\{" {f=1} f {print} f && /^}$/ {exit}' "$ENTRY")"
[ -n "$body" ] || { _bad "_ab_devuser_privilege_check() is defined in the entrypoint"; _done; }
eval "$body"
_ok "_ab_devuser_privilege_check() is defined in the entrypoint"
check() { # check <iso> <etc> -> sets $st (state) $err (stderr)
  local s="$TMP/state.$RANDOM"; err="$(_ab_devuser_privilege_check "$1" "$2" "$s" devuser 2>&1 >/dev/null)"; st="$(cat "$s" 2>/dev/null)"
}

# 6. flag off
check 0 "$TMP/off"
[ -z "$st" ] && [ -z "$err" ] && _ok "check, flag off: silent and no state (boot unchanged)" || _bad "check, flag off" "st=$st err=$err"
# 7. flag on, flag-on bake
check 1 "$TMP/on"
[ "$st" = ok:devuser-sudo ] && [ -z "$err" ] && _ok "check, flag on, image baked on: ok:devuser-sudo" || _bad "check on/on" "st=$st err=$err"
# 8. flag on, flag-off bake
check 1 "$TMP/off"
[ "$st" = degraded:devuser-sudo ] && grep -q 'ROLE-ISOLATION-DEGRADED devuser-sudo' <<<"$err" && grep -q 'rebuild' <<<"$err" \
  && _ok "check, flag on, image baked off: degraded:devuser-sudo, marker names the rebuild" || _bad "check on/off" "st=$st err=$err"
# 9. %wheel grant counts; a comment does not
E="$TMP/wheelgrant"; mkdir -p "$E/sudoers.d"; printf 'root:x:0:\nwheel:x:998:devuser\n' >"$E/group"
printf 'root ALL=(ALL) ALL\n%%wheel ALL=(ALL) NOPASSWD: ALL\n' >"$E/sudoers"
sed -i 's/^wheel:x:998:devuser$/wheel:x:998:/' "$E/group"; check 1 "$E"
[ "$st" = degraded:devuser-sudo ] && _ok "check: a %wheel NOPASSWD grant is flagged even with wheel emptied (conservative)" || _bad "check %wheel grant" "st=$st"
printf 'root ALL=(ALL) ALL\n# devuser ALL=(ALL) NOPASSWD: ALL\n' >"$E/sudoers"; check 1 "$E"
[ "$st" = ok:devuser-sudo ] && _ok "check: a commented-out NOPASSWD line is not a route" || _bad "check comment" "st=$st err=$err"

# 10. the entrypoint wires it
grep -qE '^_ab_devuser_privilege_check "\$AGENTBOX_ROLE_ISOLATION"$' "$ENTRY" \
  && _ok "the entrypoint runs the check with AGENTBOX_ROLE_ISOLATION" || _bad "the entrypoint must call the check"

# 11. live
if [ "${AGENTBOX_RC_LIVE:-0}" = 1 ] && [ "${AGENTBOX_ROLE_ISOLATION:-0}" = 1 ]; then
  case " $(id -Gn devuser 2>/dev/null) " in *" wheel "*) _bad "live: devuser is in wheel" ;; *) _ok "live: devuser is not in wheel" ;; esac
  if sudo -n true 2>/dev/null; then _bad "live: sudo -n succeeded for devuser"; else _ok "live: sudo -n refused"; fi
else
  _skip "live check needs a rebuilt image booted with the flag on (AGENTBOX_RC_LIVE=1)"
fi
_done
