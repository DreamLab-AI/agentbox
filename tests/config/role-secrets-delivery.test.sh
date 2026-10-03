#!/usr/bin/env bash
# role-secrets-delivery — the /run/secrets tree the entrypoint builds under
# [security].role_isolation (ADR-2122, custody X-1 step 1, W1).
#
# Runs ab_role_secrets_deliver from config/lib/role-custody.sh (the function the
# entrypoint sources) against the REAL plan: `agentbox-manifest role-accounts
# isolate` on the fixture config, with its at-rest source paths rewritten into a
# scratch dir. No root, no fakeroot, no user namespace: chown is the one call
# that needs root, so AB_RC_CHOWN points at a stub that records each owner in a
# ledger, and every assertion about ownership reads the ledger. Modes, contents
# and layout are real.
#
# Asserts:
#   1. every role gets <root>/<role> 0500 and <role>/home 0700, owned uid:gid = role
#   2. every planned secret lands 0400, owned by its role, byte-equal to its source
#   3. classified variables are written and then UNSET (absent ones unset too)
#   4. no secret value reaches stdout/stderr; no temp files are left behind
#   5. a second run is idempotent (same tree, same modes, same owners)
#   6. symlinked, non-regular, oversized and absent sources are refused and
#      counted; the boot carries on (rc 0, fail-open)
#   7. a missing plan, a hostile plan row and a missing root row are survived
#   8. the guard and mount helpers: a plain dir is not a mount; the Stage-B guard
#      stays in /tmp unless the flag is on AND the mount is good
#   9. static: values only ever pass through the printf builtin, never argv
# shellcheck disable=SC2015
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LIB="$ROOT/config/lib/role-custody.sh"
TABLE="$ROOT/config/role-accounts.json"
FIX="$HERE/fixtures/role-isolation/supervisord.conf"
PASS=0; FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$((PASS + FAIL))" "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'not ok %d - %s\n' "$((PASS + FAIL))" "$1"; [ -n "${2:-}" ] && printf '#   %s\n' "$2"; }
_done() { printf '1..%d\n# role-secrets-delivery: %d passed, %d failed\n' "$((PASS + FAIL))" "$PASS" "$FAIL"; [ "$FAIL" -eq 0 ]; exit $?; }
_same() { [ "$(sha256sum <"$1")" = "$(sha256sum <"$2")" ]; }

T="$(mktemp -d "${TMPDIR:-/tmp}/role-secrets.XXXXXX")"; trap 'chmod -R u+rwx "$T" 2>/dev/null; rm -rf "$T"' EXIT

_manifest_bin() {
  local crate="$ROOT/services/agentbox-manifest" tgt b
  if [ -n "${AGENTBOX_MANIFEST_BIN:-}" ] && [ -x "$AGENTBOX_MANIFEST_BIN" ]; then echo "$AGENTBOX_MANIFEST_BIN"; return 0; fi
  tgt="${CARGO_TARGET_DIR:-$crate/target}"
  for b in "$tgt/release/agentbox-manifest" "$tgt/debug/agentbox-manifest"; do
    [ -x "$b" ] && [ "$b" -nt "$crate/src/role_accounts.rs" ] && { echo "$b"; return 0; }
  done
  command -v cargo >/dev/null 2>&1 || return 1
  (cd "$crate" && CARGO_TARGET_DIR="$tgt" cargo build --quiet --offline >&2 2>/dev/null \
    || CARGO_TARGET_DIR="$tgt" cargo build --quiet >&2) || return 1
  echo "$tgt/debug/agentbox-manifest"
}
BIN="$(_manifest_bin)" || { echo "SKIP: agentbox-manifest is not built and cargo is unavailable"; exit 77; }

# shellcheck source=../../config/lib/role-custody.sh
. "$LIB" || { _bad "config/lib/role-custody.sh sources cleanly"; _done; }
_ok "config/lib/role-custody.sh sources cleanly (definitions only)"

# ── the chown stub: a ledger of "owner<TAB>path", latest entry wins ──────────
LEDGER="$T/chown.ledger"; : >"$LEDGER"
# A function, not a script: it works on a noexec TMPDIR, and "$AB_RC_CHOWN" calls it.
_test_chown() { # stands in for root's chown: records the owner, changes nothing
  [ "$#" -eq 2 ] || return 2
  printf '%s\t%s\n' "$1" "$(realpath -m -- "$2")" >>"$LEDGER"
}
export AB_RC_CHOWN=_test_chown
# A file is chowned as <dir>/.<name>.tmp.<pid> and then renamed over <dir>/<name>
# (rename keeps the owner), so the ledger entry for the temp name is the file's.
_owner() {
  local p; p="$(realpath -m -- "$1")"
  awk -F'\t' -v p="$p" -v t="$(dirname "$p")/.$(basename "$p").tmp." \
    '$2==p || index($2,t)==1 {o=$1} END{print o}' "$LEDGER"
}

# ── the real plan, sources moved into scratch ────────────────────────────────
"$BIN" role-accounts isolate --table "$TABLE" --conf "$FIX" --out "$T/iso.conf" --plan "$T/plan.real" >/dev/null \
  || { _bad "the transform renders the plan"; _done; }
VOL="$T/vol"; WS="$T/ws"; SEC="$T/run-secrets"
mkdir -p "$VOL" "$WS/sidestr/agents"
# Workspace prefix first: the scratch dir itself may live under /home/devuser/workspace.
# `dir` rows name real paths outside the secrets root: point them into scratch too.
VARLIB="$T/varlib"; mkdir -p "$VARLIB/events"
sed -e "s#\t/home/devuser/workspace/#\t${WS}/#" -e "s#\t/var/lib/agentbox/secrets/#\t${VOL}/#" \
  -e "s#^dir\t/var/lib/agentbox/#dir\t${VARLIB}/#" "$T/plan.real" >"$T/plan"
[ -z "$(awk -F'\t' -v t="$T/" '$1=="dir" && index($2,t)!=1' "$T/plan")" ] \
  && _ok "the real plan's dir rows are rewritten into the scratch dir" || _bad "dir rows escape the scratch dir" "$(grep $'^dir' "$T/plan")"
grep -q $'^file\t' "$T/plan" && [ -z "$(awk -F'\t' -v t="$T/" '$1=="file" && index($4,t)!=1' "$T/plan")" ] \
  && _ok "the real plan's file sources are rewritten into the scratch dir" || _bad "plan rewrite" "$(grep $'^file' "$T/plan" | head -2)"

_rand() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
declare -A WANT=()   # "<role>/<file>" -> path of a file holding the expected bytes
while IFS=$'\t' read -r kind role file src; do
  case "$kind" in
    file) _rand >"$src"; chmod 0600 "$src"; WANT["$role/$file"]="$src" ;;
    env)  v="$(_rand)"; export "$src=$v"; printf '%s' "$v" >"$T/want.$src"; WANT["$role/$file"]="$T/want.$src" ;;
  esac
done <"$T/plan"
mapfile -t ENVVARS < <(awk -F'\t' '$1=="env"{print $4}' "$T/plan")
mapfile -t ROLES < <(awk -F'\t' '$1=="role"{print $2 "\t" $3 "\t" $4}' "$T/plan")
# One classified variable is deliberately absent: it must still be unset, with no file.
unset NIP98_PROXY_SESSION_SECRET; rm -f "$T/want.NIP98_PROXY_SESSION_SECRET"; unset 'WANT[ab-ingress/NIP98_PROXY_SESSION_SECRET]'

# ── run 1 ────────────────────────────────────────────────────────────────────
mkdir -p "$SEC"
ab_role_secrets_deliver "$T/plan" "$SEC" >"$T/run1.out" 2>"$T/run1.err"; rc=$?
[ "$rc" = 0 ] && [ "${AB_RC_FAILURES}" = 0 ] && [ "${AB_RC_DELIVERED}" = "${#WANT[@]}" ] \
  && _ok "delivery succeeds: ${AB_RC_DELIVERED} secret(s), 0 problems (rc 0)" \
  || _bad "delivery must succeed cleanly" "rc=$rc delivered=${AB_RC_DELIVERED:-?}/${#WANT[@]} failures=${AB_RC_FAILURES:-?}; $(head -3 "$T/run1.err")"

# 1. role dirs
bad=""
for row in "${ROLES[@]}"; do
  IFS=$'\t' read -r role uid gid <<<"$row"
  [ "$(stat -c %a "$SEC/$role" 2>/dev/null)" = 500 ] || bad="${bad} ${role}:mode=$(stat -c %a "$SEC/$role" 2>/dev/null)"
  [ "$(_owner "$SEC/$role")" = "$uid:$gid" ] || bad="${bad} ${role}:owner=$(_owner "$SEC/$role")"
  [ "$(stat -c %a "$SEC/$role/home" 2>/dev/null)" = 700 ] || bad="${bad} ${role}/home:mode"
  [ "$(_owner "$SEC/$role/home")" = "$uid:$gid" ] || bad="${bad} ${role}/home:owner"
done
[ -z "$bad" ] && _ok "${#ROLES[@]} role dirs are 0500 role:role, each with a 0700 role-owned home" || _bad "role dir modes/owners" "$bad"

# 2. secret files
bad=""
for key in "${!WANT[@]}"; do
  role="${key%%/*}"; f="$SEC/$key"
  uid="$(awk -F'\t' -v r="$role" '$1=="role" && $2==r {print $3 ":" $4}' "$T/plan")"
  [ -f "$f" ] && [ ! -L "$f" ] || { bad="${bad} ${key}:missing"; continue; }
  [ "$(stat -c %a "$f")" = 400 ] || bad="${bad} ${key}:mode=$(stat -c %a "$f")"
  [ "$(_owner "$f")" = "$uid" ] || bad="${bad} ${key}:owner=$(_owner "$f")"
  _same "$f" "${WANT[$key]}" || bad="${bad} ${key}:content"
done
[ -z "$bad" ] && _ok "${#WANT[@]} secrets are 0400, owned by their role, byte-equal to their source" || _bad "secret files" "$bad"
extra="$(find "$SEC" -mindepth 2 -type f | wc -l)"
[ "$extra" = "${#WANT[@]}" ] && _ok "nothing else was written (no temp files, no stray copies)" || _bad "unexpected files under the root" "$(find "$SEC" -type f | head)"
[ ! -e "$SEC/ab-ingress/NIP98_PROXY_SESSION_SECRET" ] && _ok "an absent classified variable produces no file" || _bad "absent variable produced a file"

# 2b. the identity port's socket dir and the receipts dir
sd="$SEC/ab-identity-port"
[ -d "$sd" ] && [ "$(stat -c %a "$sd")" = 750 ] && [ "$(_owner "$sd")" = "960:969" ] \
  && _ok "sockdir: <root>/ab-identity-port is 0750, ab-identity:ab-identity-port (960:969)" \
  || _bad "sockdir" "exists=$([ -d "$sd" ] && echo y) mode=$(stat -c %a "$sd" 2>/dev/null) owner=$(_owner "$sd")"
rd="$VARLIB/events/sign"
[ -d "$rd" ] && [ "$(stat -c %a "$rd")" = 2750 ] && [ "$(_owner "$rd")" = "960:1000" ] \
  && _ok "dir: the sign-receipt dir is 2750, ab-identity:devuser" \
  || _bad "receipt dir" "mode=$(stat -c %a "$rd" 2>/dev/null) owner=$(_owner "$rd")"
printf 'root\t%s\ndir\t%s/nope/sign\t960:1000\t2750\ndir\t%s/l\t960:1000\t0777\n' "$T/r5" "$T" "$T" >"$T/plan5"
ab_role_secrets_deliver "$T/plan5" "" >/dev/null 2>&1
[ "$AB_RC_FAILURES" = 2 ] && [ ! -e "$T/nope" ] && [ ! -e "$T/l" ] \
  && _ok "dir rows: an absent parent is not created, a world-writable mode is refused" \
  || _bad "dir row refusals" "failures=$AB_RC_FAILURES"

# 3. environment scrub
still=""; for v in "${ENVVARS[@]}"; do [ -n "${!v+x}" ] && still="${still} ${v}"; done
[ -z "$still" ] && _ok "all ${#ENVVARS[@]} classified variables are unset after delivery (present or not)" || _bad "classified variables survived" "$still"
leftenv="$(env | grep -cE "^($(IFS='|'; echo "${ENVVARS[*]}"))=" || true)"
[ "$leftenv" = 0 ] && _ok "none of them remain in the exported environment a child would inherit" || _bad "exported env still carries ${leftenv}"

# 4. no value in the logs
hits=0; for w in "${WANT[@]}"; do grep -qF -- "$(cat "$w")" "$T/run1.out" "$T/run1.err" && hits=$((hits + 1)); done
[ "$hits" = 0 ] && grep -q 'delivered [0-9]* secret(s)' "$T/run1.out" && _ok "logs carry counts and names only; no secret value" || _bad "a value reached the log" "hits=$hits"

# 5. idempotence
_tree() { (cd "$SEC" && find . -printf '%p %y %m %s\n' | sort; awk -F'\t' '{o[$2]=$1} END{for (p in o) print p, o[p]}' "$LEDGER" | sed "s#${SEC}#.#" | sort) | sha256sum; }
h1="$(_tree)"
while IFS=$'\t' read -r kind role file src; do [ "$kind" = env ] && [ -f "$T/want.$src" ] && export "$src=$(cat "$T/want.$src")"; done <"$T/plan"
ab_role_secrets_deliver "$T/plan" "$SEC" >/dev/null 2>&1
h2="$(_tree)"
[ "$h1" = "$h2" ] && [ "$AB_RC_FAILURES" = 0 ] && _ok "a second delivery leaves the same tree, modes and owners" || _bad "second run changed the tree" "failures=$AB_RC_FAILURES"

# 6. hostile and broken sources
S2="$T/sec2"; mkdir -p "$S2"; V2="$T/vol2"; mkdir -p "$V2"
printf 'outside' >"$T/not-a-secret"; ln -s "$T/not-a-secret" "$V2/link"
mkdir "$V2/dir"; head -c 70000 /dev/zero >"$V2/big"; printf 'k' >"$V2/good"
printf 'root\t%s\nrole\tab-x\t970\t970\nfile\tab-x\tlink\t%s\nfile\tab-x\tdir\t%s\nfile\tab-x\tbig\t%s\nfile\tab-x\tgone\t%s\nfile\tab-x\tgood\t%s\n' \
  "/nonexistent" "$V2/link" "$V2/dir" "$V2/big" "$V2/absent" "$V2/good" >"$T/plan2"
ab_role_secrets_deliver "$T/plan2" "$S2" >/dev/null 2>"$T/run2.err"; rc=$?
if [ "$rc" = 0 ] && [ "$AB_RC_FAILURES" = 4 ] && [ "$AB_RC_DELIVERED" = 1 ] && [ -f "$S2/ab-x/good" ] \
   && [ ! -e "$S2/ab-x/link" ] && [ ! -e "$S2/ab-x/dir" ] && [ ! -e "$S2/ab-x/big" ] && [ ! -e "$S2/ab-x/gone" ]; then
  _ok "symlinked, directory, oversized and absent sources are refused and counted; the good one still lands; rc 0"
else
  _bad "hostile sources" "rc=$rc failures=$AB_RC_FAILURES delivered=$AB_RC_DELIVERED; $(head -4 "$T/run2.err")"
fi
grep -q 'symlink or not a regular file' "$T/run2.err" && grep -q 'is absent' "$T/run2.err" && grep -q 'bytes (> 65536)' "$T/run2.err" \
  && _ok "each refusal is logged with a grep-able reason" || _bad "refusal reasons" "$(cat "$T/run2.err")"
[ ! -e /nonexistent/ab-x ] && _ok "the override root wins over the plan's root row (tests never touch /run)" || _bad "wrote outside the override"

# 7. broken plans
ab_role_secrets_deliver "$T/absent-plan" "$S2" >/dev/null 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$AB_RC_FAILURES" = 1 ] && _ok "a missing plan is one counted failure, rc 0 (fail-open)" || _bad "missing plan" "rc=$rc"
printf 'root\t%s\nrole\t../escape\t1\t1\nrole\troot\t0\t0\nrole\tab-y\tx\t1\nenv\tab-z\tf\tPATH\n' "$S2" >"$T/plan3"
ab_role_secrets_deliver "$T/plan3" "$S2" >/dev/null 2>&1
[ "$AB_RC_FAILURES" = 4 ] && [ ! -e "$T/escape" ] && [ ! -e "$S2/root" ] && [ ! -e "$S2/ab-y" ] && [ -n "${PATH:-}" ] \
  && _ok "rows naming a non-role, a path escape, a non-numeric uid or an undeclared role are skipped" \
  || _bad "hostile plan rows" "failures=$AB_RC_FAILURES"
printf 'role\tab-q\t971\t971\n' >"$T/plan4"
ab_role_secrets_deliver "$T/plan4" "" >/dev/null 2>&1
[ "$AB_RC_FAILURES" = 1 ] && [ ! -e "ab-q" ] && _ok "a plan with no root row is refused before any write" || _bad "rootless plan"

# 8. guard and mount helpers
mkdir -p "$T/plain"
ab_secrets_mount_ok "$T/plain" "$(id -u)" && _bad "a plain directory must not pass as a mount" || _ok "a plain directory is not taken for the /run/secrets mount"
ln -s "$T/plain" "$T/plainlink"
ab_secrets_mount_ok "$T/plainlink" "$(id -u)" && _bad "a symlink must not pass" || _ok "a symlink is not taken for the mount"
[ "$(ab_root_state_dir_pick 0 "$T/plain")" = /tmp/.agentbox-root ] && [ "$(ab_root_state_dir_pick '' "$T/plain")" = /tmp/.agentbox-root ] \
  && [ "$(ab_root_state_dir_pick 1 "$T/plain")" = /tmp/.agentbox-root ] \
  && _ok "the Stage-B guard stays /tmp/.agentbox-root with the flag off, and with it on but no real mount" \
  || _bad "guard pick without a mount"
( ab_secrets_mount_ok() { return 0; }; [ "$(ab_root_state_dir_pick 1 /run/secrets)" = /run/secrets/.root-guard ] ) \
  && _ok "flag on and a good mount: the guard moves to /run/secrets/.root-guard" || _bad "guard pick with a mount"
( ab_secrets_mount_ok() { return 0; }; [ "$(ab_root_state_dir_pick 0 /run/secrets)" = /tmp/.agentbox-root ] ) \
  && _ok "flag off keeps /tmp even when the mount is good (flag-off hands /run/secrets to devuser)" || _bad "guard pick flag off"
out="$(ab_secrets_root_prepare "$T/plain" 2>&1)"; rc=$?
[ "$rc" = 1 ] && printf '%s' "$out" | grep -q 'ROLE-ISOLATION-DEGRADED secrets-mount' && [ "$(stat -c %a "$T/plain")" = 711 ] \
  && _ok "prepare makes the root 0711 and reports a non-mount as degraded (rc 1, not fatal)" || _bad "prepare on a non-mount" "rc=$rc $out"

# 9. static: values only through the printf builtin
[ "$(type -t printf)" = builtin ] && _ok "printf is a shell builtin here (no exec, no argv)" || _bad "printf is not a builtin"
indirect="$(grep -nE '\$\{![a-z_]+\}' "$LIB" | grep -vE "printf '%s' \"\\\$\{!b\}\"" || true)"
[ -z "$indirect" ] && _ok "the only expansion of a classified value is printf '%s' \"\${!b}\"" || _bad "a value is expanded elsewhere" "$indirect"
grep -nE '^\s*(echo|printf)[^#]*\$\{!b' "$LIB" | grep -v "printf '%s' \"\${!b}\" >\"\$tmp\"" | grep -q . \
  && _bad "a value may be logged" || _ok "no log line expands a value"

_done
