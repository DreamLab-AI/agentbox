#!/usr/bin/env bash
# nip98-config-projection — ab_nip98_project (config/lib/nip98-config.sh), the
# boot step that decides whether the NIP-98 door has a config file (W3-05).
# A stub agentbox-manifest on PATH stands in for the Rust projector.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$HERE/../../config/lib/nip98-config.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok %d - %s\n' "$((PASS+FAIL))" "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok %d - %s\n' "$((PASS+FAIL))" "$1"; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"; : >"$T/manifest.toml"
OUT="$T/ws/.agentbox/nip98.json"
# shellcheck source=../../config/lib/nip98-config.sh
. "$LIB"
stub() { printf '#!/bin/sh\n%s\n' "$1" >"$T/bin/agentbox-manifest"; chmod +x "$T/bin/agentbox-manifest"; }
# Staging: flag on, root writes in a root-only dir under the secrets root and
# renames once into place; flag off, the whole projection runs AS devuser (setpriv)
# and root touches nothing in the workspace. Not root here, so chown/install/id/
# setpriv are stubs (FAKE_ROOT=1 makes `id -u` answer 0) and `stat -c %u` reads
# the table in $UIDS (path uid).
mkdir -p "$T/rb"
export REAL_STAT="$(command -v stat)" REAL_ID="$(command -v id)"
cat >"$T/rb/chown" <<'CEOF'
#!/bin/sh
for last; do :; done
m="$("$REAL_STAT" -c %a "$last" 2>/dev/null)"; echo "$m $*" >>"$CHOWN_LOG"
CEOF
cat >"$T/rb/install" <<'CEOF'
#!/bin/sh
echo "install $*" >>"$CHOWN_LOG"; for last; do :; done; mkdir -p "$last"; chmod 750 "$last"; echo "$last 0" >>"$UIDS"
CEOF
cat >"$T/rb/stat" <<'CEOF'
#!/bin/sh
if [ "$1" = -c ] && [ "$2" = %u ]; then
  v="$(awk -v p="$3" '$1==p{print $2}' "$UIDS")"; [ -n "$v" ] && { echo "$v"; exit 0; }
fi
exec "$REAL_STAT" "$@"
CEOF
# (`env -i` strips the environment, so the stub bakes in its log path)
cat >"$T/rb/setpriv" <<SPEOF
#!/bin/sh
echo "setpriv \$*" >>"$T/setpriv.log"
echo "env: \$(env | sort | tr '\\n' ' ')" >>"$T/setpriv.env"
while [ "\$1" != -- ]; do shift; done; shift
exec "\$@"
SPEOF
cat >"$T/rb/id" <<'IDEOF'
#!/bin/sh
if [ "$#" = 1 ] && [ "$1" = -u ]; then [ "${FAKE_ROOT:-0}" = 1 ] && { echo 0; exit 0; }; exec "$REAL_ID" -u; fi
[ "$2" = ab-ingress ] || exit 1
case "$1" in -u) echo 962 ;; -g) echo 963 ;; esac
IDEOF
chmod +x "$T/rb/"*
export UIDS="$T/uids" CHOWN_LOG="$T/chown.log" SETPRIV_LOG="$T/setpriv.log"
: >"$T/uids"; : >"$T/chown.log"; : >"$SETPRIV_LOG"
run() { PATH="$T/rb:$T/bin:$PATH" ab_nip98_project "$T/manifest.toml" "$OUT" >/dev/null 2>&1; echo $?; }

# 1. projector writes the file -> kept as projected
rm -rf "$T/ws"; stub 'mkdir -p "$(dirname "$5")"; printf "{\"routes\":[],\"allowedPubkeys\":[\"aa\"]}" >"$5"'
[ "$(run)" = 0 ] && grep -q '"aa"' "$OUT" && ok "projected file is kept" || bad "projected file is kept"
# 2. section absent: projector rc 0, no file -> explicit empty config
rm -rf "$T/ws"; stub 'exit 0'
[ "$(run)" = 0 ] && [ "$(cat "$OUT")" = '{"routes":[],"allowedPubkeys":[]}' ] && ok "absent section -> explicit empty config" || bad "absent section -> explicit empty config"
# 3. projector fails, no prior file -> no file (door stays closed), boot rc 0
rm -rf "$T/ws"; stub 'echo boom >&2; exit 3'
[ "$(run)" = 0 ] && [ ! -e "$OUT" ] && ok "projector failure leaves NO file, rc 0" || bad "projector failure leaves NO file, rc 0"
# 4. projector fails, last-good file present -> untouched
mkdir -p "$T/ws/.agentbox"; printf '{"routes":[],"allowedPubkeys":["bb"]}' >"$OUT"; stub 'exit 3'
[ "$(run)" = 0 ] && grep -q '"bb"' "$OUT" && ok "projector failure keeps the last-good file" || bad "projector failure keeps the last-good file"
# 5. agentbox-manifest not on PATH -> no file, rc 0
rm -rf "$T/ws" "$T/bin/agentbox-manifest"
[ "$(PATH="/usr/bin:/bin" ab_nip98_project "$T/manifest.toml" "$OUT" >/dev/null 2>&1; echo $?)" = 0 ] && [ ! -e "$OUT" ] && ok "missing projector binary: no file, rc 0" || bad "missing projector binary: no file, rc 0"
# 6. manifest missing -> no file, rc 0
stub 'exit 0'
[ "$(PATH="$T/bin:$PATH" ab_nip98_project "$T/nope.toml" "$OUT" >/dev/null 2>&1; echo $?)" = 0 ] && [ ! -e "$OUT" ] && ok "missing manifest: no file, rc 0" || bad "missing manifest: no file, rc 0"
# 7. empty args never abort a set -u boot
( set -u; ab_nip98_project ) >/dev/null 2>&1 && ok "no-arg call is rc 0" || bad "no-arg call is rc 0"
# ── AB-36.1: where the projected file lives, and who owns it ───────────────────
# Flag off: unchanged (the given path, 1000:1000, 0600). Flag on (ADR-2122): the
# proxy is the ab-ingress role (uid 962) and the workspace directory is devuser-
# writable, so the file goes into the role's secrets directory,
# $AB_SECRETS_ROOT/ab-ingress (default /run/secrets/ab-ingress), as root:ab-ingress
# 0440. The secrets root must be a real root-owned directory, the role directory
# must not be a symlink and must be owned by root or the role: anything else is
# refused (no file, door stays closed). Not root here, so chown/id/install are
# stubs and `stat -c %u` reads the ownership table in $T/uids (path uid);
# symlinks and modes are REAL. chmod runs BEFORE chown, and chown uses -h.
SR="$T/run/secrets"; RD="$SR/ab-ingress"; RF="$RD/nip98-proxy-config.json"
export OUTARG="$T/out.arg"
own_run() { # own_run <role_isolation> [uid-table-lines]; flag 0/"" runs as a fake root
  rm -rf "$T/ws" "$T/run" "$T/victim"; mkdir -p "$SR"; : >"$T/chown.log"; : >"$SETPRIV_LOG"; rm -f "$OUTARG"
  printf '%s 0\n' "$SR" >"$T/uids"; [ -n "${2:-}" ] && printf '%b\n' "$2" >>"$T/uids"
  [ -n "${PRE:-}" ] && eval "$PRE"
  stub "${STUB:-echo \"\$5\" >\"$OUTARG\"; mkdir -p \"\$(dirname \"\$5\")\"; printf '{\"routes\":[],\"allowedPubkeys\":[\"new\"]}' >\"\$5\"}"
  FAKE_ROOT=1 AB_SECRETS_ROOT="$SR" AGENTBOX_ROLE_ISOLATION="$1" PATH="$T/rb:$T/bin:$PATH" ab_nip98_project "$T/manifest.toml" "$OUT" >/dev/null 2>&1
}
CL() { tr '\n' ';' <"$T/chown.log"; }
NO_FINAL() { ! grep -qF -- " $1" "$T/chown.log"; }
# --- flag off, as root, NO AB_STAGE_ROOT override: the default boot (re-review 4) ---
unset AB_STAGE_ROOT
own_run 0
[ -f "$OUT" ] && [ ! -L "$OUT" ] && grep -q '"new"' "$OUT" && [ "$(stat -c %a "$OUT")" = 600 ] && ok "flag off, root, default environment: the projection HAPPENS (0600)" || bad "flag off projection did not happen"
[ -z "$(CL)" ] && ok "flag off: root runs no chown/chmod on the workspace path" || bad "flag off: root chown log '$(CL)'"
grep -q -- "--reuid=1000 --regid=1000 --init-groups" "$SETPRIV_LOG" && grep -q "agentbox-manifest" "$SETPRIV_LOG" && grep -q "mv" "$SETPRIV_LOG" \
  && ok "flag off: projector and file operations run as devuser via setpriv" || bad "flag off: not run via setpriv ($(cat "$SETPRIV_LOG"))"
[ "$(basename "$(dirname "$(cat "$OUTARG")")")" != .agentbox ] && [ "$(dirname "$(dirname "$(cat "$OUTARG")")")" = "$(dirname "$OUT")" ] && ok "flag off: the projector writes into a devuser staging dir beside the final file" || bad "flag off: projector --out '$(cat "$OUTARG")'"
[ "$(ls -A "$(dirname "$OUT")")" = "$(basename "$OUT")" ] && ok "flag off: staging dir removed afterwards" || bad "flag off leftovers: $(ls -A "$(dirname "$OUT")")"
own_run ""; [ -f "$OUT" ] && [ -z "$(CL)" ] && ok "flag unset: same as flag off" || bad "flag unset"
# --- role isolation on ---
own_run 1
[ -f "$RF" ] && [ ! -L "$RF" ] && [ ! -e "$OUT" ] && [ "$(stat -c %a "$RF")" = 440 ] \
  && ok "role isolation on: file in the role secrets dir (0440); workspace copy not written" || bad "role isolation layout (log '$(CL)')"
case "$(CL)" in "install -d -o 0 -g 963 -m 0750 $RD;440 -h 0:963 $SR/.nip98-stage."*) ok "role isolation on: dir via install -d; file chmod-then-chown -h root:ab-ingress while STAGED" ;; *) bad "role isolation ownership (log '$(CL)')" ;; esac
NO_FINAL "$RF" && case "$(cat "$OUTARG")" in "$SR/.nip98-stage."*) true ;; *) false ;; esac && ok "role isolation on: the projector writes into the staging dir, never the role dir" || bad "role isolation: projector --out '$(cat "$OUTARG")'"
[ -z "$(cat "$SETPRIV_LOG")" ] && ok "role isolation on: root-side projection, no setpriv" || bad "role isolation used setpriv"
[ -z "$(ls -A "$SR" | grep -v '^ab-ingress$')" ] && [ "$(ls -A "$RD")" = nip98-proxy-config.json ] && ok "staging dir removed; role dir holds only the final file" || bad "leftovers: $(ls -A "$SR") / $(ls -A "$RD")"
PRE='mkdir -p "$RD"'; own_run 1 "$RD 962"; PRE=''
[ -f "$RF" ] && ok "role dir already role-owned (capture's 0500 layout): accepted, not re-owned" || bad "role-owned dir refused"
case "$(CL)" in *install*) bad "existing role dir must not be re-created" ;; *) ok "existing role dir left untouched (no install)" ;; esac
# --- refusals: nothing is written anywhere ---
own_run 1 "$SR 1000"; [ ! -e "$RF" ] && [ ! -e "$OUT" ] && ok "secrets root owned by devuser: refused" || bad "devuser-owned secrets root accepted"
PRE='mkdir -p "$T/elsewhere" "$SR"; ln -s "$T/elsewhere" "$RD"'; own_run 1
[ -z "$(ls -A "$T/elsewhere")" ] && [ ! -e "$OUT" ] && ok "role dir is a symlink: refused, nothing written through it" || bad "symlinked role dir was followed"
PRE='mkdir -p "$RD"'; own_run 1 "$RD 1000"; PRE=''; [ ! -e "$RF" ] && ok "role dir owned by devuser: refused" || bad "devuser-owned role dir accepted"
rm -rf "$T/run" "$T/realroot"; mkdir -p "$T/run" "$T/realroot"; ln -s "$T/realroot" "$SR"; : >"$T/chown.log"; printf '%s 0\n' "$SR" >"$T/uids"
stub 'mkdir -p "$(dirname "$5")"; printf "{}" >"$5"'
FAKE_ROOT=1 AB_SECRETS_ROOT="$SR" AGENTBOX_ROLE_ISOLATION=1 PATH="$T/rb:$T/bin:$PATH" ab_nip98_project "$T/manifest.toml" "$OUT" >/dev/null 2>&1
[ -z "$(ls -A "$T/realroot")" ] && ok "secrets root is a symlink: refused" || bad "symlinked secrets root was followed"
# --- a symlink planted at the FINAL path is never followed, chmod'd or chown'd ---
for mode in 0 1; do
  PRE='mkdir -p "$RD" "$(dirname "$OUT")"; printf victim >"$T/victim"; chmod 644 "$T/victim"; ln -s "$T/victim" "$RF"; ln -s "$T/victim" "$OUT"'
  own_run "$mode" "$RD 962"; PRE=''
  F="$OUT"; [ "$mode" = 1 ] && F="$RF"
  [ "$(cat "$T/victim")" = victim ] && [ "$(stat -c %a "$T/victim")" = 644 ] && [ -f "$F" ] && [ ! -L "$F" ] && NO_FINAL "$T/victim" \
    && ok "flag=$mode: planted symlink at the final path replaced by rename; victim content and mode untouched" || bad "flag=$mode: victim touched (content '$(cat "$T/victim")' mode $(stat -c %a "$T/victim"))"
done
# --- item 3: a symlink to a DIRECTORY at the final path is replaced, not entered (mv -fT) ---
for mode in 0 1; do
  PRE='mkdir -p "$RD" "$(dirname "$OUT")" "$T/dirtarget"; ln -s "$T/dirtarget" "$RF"; ln -s "$T/dirtarget" "$OUT"'
  own_run "$mode" "$RD 962"; PRE=''
  F="$OUT"; [ "$mode" = 1 ] && F="$RF"
  [ -z "$(ls -A "$T/dirtarget")" ] && [ -f "$F" ] && [ ! -L "$F" ] && ok "flag=$mode: symlink-to-directory at the destination replaced (mv -fT), nothing moved into the target dir" || bad "flag=$mode: moved into the symlinked directory ($(ls -A "$T/dirtarget"))"
done
# --- item 2: section removed -> the stale config must not survive (both modes) ---
for mode in 0 1; do
  F="$OUT"; [ "$mode" = 1 ] && F="$RF"
  PRE='mkdir -p "$RD" "$(dirname "$OUT")"; printf "{\"routes\":[{\"prefix\":\"/old/\"}],\"allowedPubkeys\":[\"stale\"]}" >"$RF"; cp "$RF" "$OUT"'
  STUB='rm -f "$5"; exit 0' own_run "$mode" "$RD 962"; PRE=''
  [ "$(cat "$F" 2>/dev/null)" = '{"routes":[],"allowedPubkeys":[]}' ] && ok "flag=$mode: removed section replaces the stale config with the explicit empty one" || bad "flag=$mode: stale config survived ($(cat "$F" 2>/dev/null))"
done
# projector FAILS -> last-good file untouched
PRE='mkdir -p "$(dirname "$OUT")"; printf "{\"routes\":[],\"allowedPubkeys\":[\"lastgood\"]}" >"$OUT"'
STUB='echo boom >&2; exit 3' own_run 0; PRE=''
grep -q lastgood "$OUT" && ok "flag off: projector failure keeps the last-good file" || bad "last-good lost"
# flag on but the role account is missing -> legacy path, as devuser, 0600
printf '#!/bin/sh\nexit 1\n' >"$T/rb/id.noacct"
cat >"$T/rb/id" <<'IDEOF'
#!/bin/sh
if [ "$#" = 1 ] && [ "$1" = -u ]; then [ "${FAKE_ROOT:-0}" = 1 ] && { echo 0; exit 0; }; exec "$REAL_ID" -u; fi
exit 1
IDEOF
own_run 1; [ -f "$OUT" ] && [ ! -e "$RF" ] && [ "$(stat -c %a "$OUT")" = 600 ] && ok "role isolation on, no ab-ingress account: legacy path, projected as devuser, 0600" || bad "no-account fallback"
# --- re-review 5.1: an older root-owned workspace .agentbox dir is handed back to devuser ---
D="$(dirname "$OUT")"
PRE='mkdir -p "$(dirname "$OUT")"'; own_run 0 "$D 0"; PRE=''
grep -qF -- "-h 1000:1000 $D" "$T/chown.log" && [ -f "$OUT" ] && ok "flag off: root-owned .agentbox is chowned -h to 1000:1000 before projecting" || bad "root-owned .agentbox not repaired (log '$(CL)')"
PRE='mkdir -p "$(dirname "$OUT")"'; own_run 0 "$D 1000"; PRE=''
[ -z "$(CL)" ] && ok "flag off: devuser-owned .agentbox is left alone" || bad "needless chown: $(CL)"
PRE='mkdir -p "$T/real" "$T/ws"; ln -s "$T/real" "$D"'; own_run 0 "$D 0"; PRE=''
! grep -qF -- "$D" "$T/chown.log" && ok "flag off: a symlinked .agentbox is never chowned" || bad "chowned a symlink ($(CL))"
# --- re-review 5.2: devuser commands run with a scrubbed environment and no inherited fds ---
: >"$T/setpriv.env"; exec 9>"$T/leak"
FAKE_ROOT=1 SECRET_TOKEN=hunter2 AGENTBOX_X=1 PATH="$T/rb:$PATH" ab_nip98_as_devuser sh -c 'ls /proc/self/fd | tr "\n" " " >"$1"; env >"$2"' _ "$T/fds.out" "$T/env.out"
exec 9>&-
! grep -qE "SECRET_TOKEN|AGENTBOX_X|hunter2" "$T/env.out" "$T/setpriv.env" && grep -q '^HOME=/home/devuser$' "$T/env.out" && grep -q '^PATH=' "$T/env.out" && grep -q '^LANG=C.UTF-8$' "$T/env.out" \
  && ok "devuser commands: environment scrubbed to PATH, HOME=/home/devuser, LANG" || bad "environment leaked: $(cat "$T/env.out")"
case " $(cat "$T/fds.out") " in *" 9 "*) bad "fd 9 leaked to the devuser command ($(cat "$T/fds.out"))" ;; *) ok "devuser commands: inherited fd 9 is closed" ;; esac
printf '1..%d\n# nip98-config-projection: %d passed, %d failed\n' "$((PASS+FAIL))" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
