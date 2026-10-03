#!/usr/bin/env bash
# role-custody-migrate — the at-rest custody migrate/revert (custody design 3.2-3.4, W2b;
# ADR-2122).
#
# Runs ab_custody_migrate and ab_custody_revert from config/lib/role-custody.sh against the REAL
# registry: the atrest/atrestdir rows `agentbox-manifest role-accounts isolate` derives from
# config/role-accounts.json for the fixture supervisord.conf. Every registry path is placed under
# a scratch root (AB_RC_ROOT). No root: chown is a stub that records "uid:gid<TAB>path" in a
# ledger, and AB_RC_STAT reports the ledger's owner for a path it has seen (real mode, links,
# size and type otherwise). Modes, contents, copies and renames are real.
#
# Asserts:
#   1. the registry is derived: one atrest row per resolved file secret plus each role's at_rest,
#      and the identity JSON is ab-identity's
#   2. flag off on a never-migrated volume: revert changes nothing (stat set byte-identical,
#      ctime included; no chown; no modes record)
#   3. migrate: each absent canonical copy with a legacy twin is copied byte-equal; legacy copies
#      untouched (bytes and stat); each copy goes to its role 0400 and agentbox-core.json to
#      ab-identity (960) 0400; secrets/ root 0700, identities/ root 0711
#   4. the migrated record lists paths and statuses only: no secret byte, mode 0644
#   5. no secret value on stdout/stderr
#   6. migrate is idempotent: a second run copies nothing, chowns nothing, and the stat set
#      (owner, mode, size, mtime, ctime) hashes the same
#   7. revert restores exactly the pre-flag owner and mode of every pre-existing path, gives the
#      copies to devuser at the legacy mode, and is idempotent; migrate then works again
#   8. tampered canonical copies are refused, not re-owned and not delivered: a symlink, a
#      hard-linked file, an empty file, and a first-sighting copy that differs from its legacy twin
#   9. a forged (devuser-owned) modes record: revert changes nothing; migrate sets it aside
#  11. W4: seed rows copy a chain's state and a faucet ledger once into the role's events-volume
#      dir (never over newer state, source untouched); the scripts use it under the flag and,
#      with the flag off, refuse to fork from a workspace copy the custody copy has outgrown
#  10. entrypoint wiring: the call sits after the /run/secrets prep and the volume-root chown and
#      before `nostr-pod-bridge bootstrap`; flag on -> migrate, otherwise revert; the volume loop
#      leaves secrets/ alone under the flag; the identity file goes to ab-identity 0400 under it
# shellcheck disable=SC2015
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LIB="$ROOT/config/lib/role-custody.sh"
ENTRY="$ROOT/config/entrypoint-unified.sh"
TABLE="$ROOT/config/role-accounts.json"
FIX="$HERE/fixtures/role-isolation/supervisord.conf"
PASS=0; FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$((PASS + FAIL))" "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'not ok %d - %s\n' "$((PASS + FAIL))" "$1"; [ -n "${2:-}" ] && printf '#   %s\n' "$2"; }
_done() { printf '1..%d\n# role-custody-migrate: %d passed, %d failed\n' "$((PASS + FAIL))" "$PASS" "$FAIL"; [ "$FAIL" -eq 0 ]; exit $?; }

[ "$(id -u)" != 0 ] || { echo "role-custody-migrate.test: run unprivileged (the chown ledger stands in for root)" >&2; exit 1; }
T="$(mktemp -d "${TMPDIR:-/tmp}/role-custody.XXXXXX")"; trap 'chmod -R u+rwX "$T" 2>/dev/null; rm -rf "$T"' EXIT

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
PLAN="$T/plan.tsv"
"$BIN" role-accounts isolate --table "$TABLE" --conf "$FIX" --out "$T/iso.conf" --plan "$PLAN" >/dev/null \
  || { _bad "the transform renders the plan"; _done; }

# ── stubs ─────────────────────────────────────────────────────────────────────
LEDGER="$T/chown.ledger"; : >"$LEDGER"
_test_chown() { [ "$#" -eq 2 ] || return 2; printf '%s\t%s\n' "$1" "$2" >>"$LEDGER"; }
_test_stat() { # stat -c FMT -- PATH; uid and gid from the ledger when it has the path
  local o out; out="$(command stat -c "$2" -- "$4" 2>/dev/null)" || return 1
  o="$(awk -F'\t' -v p="$4" '$2 == p {o=$1} END {print o}' "$LEDGER")"
  [ -n "$o" ] && out="${o%%:*} ${o##*:} ${out#* * }"
  printf '%s\n' "$out"
}
export AB_RC_CHOWN=_test_chown AB_RC_STAT=_test_stat
R="$T/root"; export AB_RC_ROOT="$R"
owner() { awk -F'\t' -v p="$R$1" '$2 == p {o=$1} END {print o}' "$LEDGER"; }
mode() { stat -c %a -- "$R$1"; }
# The registry's paths, from the plan.
mapfile -t AT < <(awk -F'\t' '$1 == "atrest" {print $3}' "$PLAN")
mapfile -t DIRS < <(awk -F'\t' '$1 == "atrestdir" {print $2}' "$PLAN")
# statset: owner (ledger or real), mode, size, mtime and ctime of every registry path and legacy
# copy, plus the dirs; what design 3.3 hashes before and after a second boot.
statset() {
  local p o
  for p in "${DIRS[@]}" "${AT[@]}" $(awk -F'\t' '$1 == "atrest" && $4 != "-" {print $4}' "$PLAN"); do
    if [ -e "$R$p" ] || [ -L "$R$p" ]; then
      o="$(owner "$p")"; [ -n "$o" ] || o="$(stat -c '%u:%g' -- "$R$p")"
      printf '%s %s %s\n' "$p" "$o" "$(stat -c '%a %s %Y %Z %h' -- "$R$p")"
    else printf '%s absent\n' "$p"; fi
  done
}
SECRET_TAG="w2b-fixture-secret-9c1e"

# ── 1. the registry is derived ───────────────────────────────────────────────
n_file="$(grep -c '^file	' "$PLAN")"
n_extra="$(jq '[.roles[].at_rest // [] | length] | add' "$TABLE")"
n_at="${#AT[@]}"
if [ "$n_at" = $((n_file + n_extra)) ] && [ "${#DIRS[@]}" = "$(jq '.at_rest_dirs | length' "$TABLE")" ] \
   && grep -q $'^atrest\tab-identity\t/var/lib/agentbox/identities/agentbox-core.json\t-$' "$PLAN" \
   && grep -q $'^atrest\tab-faucet-dreamlab\t/var/lib/agentbox/secrets/sidestr-faucet-dreamlab.key\t/home/devuser/workspace/sidestr/agents/treasury.key$' "$PLAN"; then
  _ok "the registry is derived: ${n_at} atrest rows = ${n_file} file secrets + ${n_extra} at_rest; identity JSON is ab-identity's; treasury carries its legacy twin"
else _bad "registry derivation" "atrest=$n_at file=$n_file extra=$n_extra dirs=${#DIRS[@]}"; fi

# ── the flag-off volume ──────────────────────────────────────────────────────
mkdir -p "$R/var/lib/agentbox/secrets" "$R/var/lib/agentbox/identities" "$R/run/secrets" \
  "$R/home/devuser/workspace/sidestr/agents" "$R/home/devuser/workspace/.agentbox"
chmod 0755 "$R/var/lib/agentbox/secrets"; chmod 0750 "$R/var/lib/agentbox/identities"
put() { printf '%s-%s' "$SECRET_TAG" "$2" >"$R$1"; chmod "$3" "$R$1"; }
put /var/lib/agentbox/secrets/sidestr-dreamlab.key signer 0400
put /var/lib/agentbox/secrets/sidestr-tbtc4.cookie cookie 0600
put /var/lib/agentbox/secrets/knots-txbt4.rpc rpc 0640
put /var/lib/agentbox/identities/agentbox-core.json identity 0600
put /home/devuser/workspace/sidestr/agents/treasury.key treasury 0600
put /home/devuser/workspace/sidestr/agents/treasury-dreamlab-txbt4.key treasury-txbt4 0400
put /home/devuser/workspace/.agentbox/zone-keys.json zones 0600
# identities/ is root's before the flag (mkdir by the root entrypoint).
printf '0:0\t%s\n' "$R/var/lib/agentbox/identities" >>"$LEDGER"
LEGACY_BEFORE="$(for p in treasury.key treasury-dreamlab-txbt4.key; do stat -c '%n %a %s %Y %Z' "$R/home/devuser/workspace/sidestr/agents/$p"; sha256sum <"$R/home/devuser/workspace/sidestr/agents/$p"; done; stat -c '%n %a %s %Y %Z' "$R/home/devuser/workspace/.agentbox/zone-keys.json")"
sleep 1  # so a ctime change would show

# ── 2. revert on a never-migrated volume ─────────────────────────────────────
before="$(statset)"; led0="$(wc -l <"$LEDGER")"
ab_custody_revert "$PLAN" >"$T/run.out" 2>&1; out="$(cat "$T/run.out")"
if [ "$(statset)" = "$before" ] && [ "$(wc -l <"$LEDGER")" = "$led0" ] && [ ! -e "$R/var/lib/agentbox/secrets/.role-custody.modes" ] && [ "${AB_RC_REVERTED:-x}" = 0 ]; then
  _ok "flag off, never migrated: revert changes nothing (stat set incl. ctime byte-identical, no chown, no record)"
else _bad "revert on a never-migrated volume" "before=$(echo "$before" | head -3) after=$(statset | head -3) $out"; fi
PRE="$before"

# ── 3. migrate ───────────────────────────────────────────────────────────────
ab_custody_migrate "$PLAN" /run/secrets/role-isolation.migrated >"$T/run.out" 2>&1; out="$(cat "$T/run.out")"
ok=1; why=""
for pair in sidestr-faucet-dreamlab.key:/home/devuser/workspace/sidestr/agents/treasury.key \
            sidestr-faucet-dreamlab-txbt4.key:/home/devuser/workspace/sidestr/agents/treasury-dreamlab-txbt4.key \
            zone-keys.json:/home/devuser/workspace/.agentbox/zone-keys.json; do
  c="$R/var/lib/agentbox/secrets/${pair%%:*}"; l="$R${pair#*:}"
  [ -f "$c" ] && [ "$(sha256sum <"$c")" = "$(sha256sum <"$l")" ] || { ok=0; why+=" ${pair%%:*} not byte-equal"; }
done
[ "$AB_RC_MIGRATED" = 3 ] || { ok=0; why+=" migrated=$AB_RC_MIGRATED"; }
[ "$ok" = 1 ] && _ok "migrate copies each absent canonical copy from its legacy twin, byte-equal (3 copies)" || _bad "migrate copies" "$why $out"
LEGACY_AFTER="$(for p in treasury.key treasury-dreamlab-txbt4.key; do stat -c '%n %a %s %Y %Z' "$R/home/devuser/workspace/sidestr/agents/$p"; sha256sum <"$R/home/devuser/workspace/sidestr/agents/$p"; done; stat -c '%n %a %s %Y %Z' "$R/home/devuser/workspace/.agentbox/zone-keys.json")"
[ "$LEGACY_AFTER" = "$LEGACY_BEFORE" ] && _ok "legacy copies untouched: bytes, mode, mtime and ctime unchanged, none deleted" || _bad "legacy copies changed" "before=$LEGACY_BEFORE after=$LEGACY_AFTER"
ok=1; why=""
while IFS=$'\t' read -r _ role path _; do
  uid="$(awk -F'\t' -v r="$role" '$1 == "role" && $2 == r {print $3}' "$PLAN")"
  [ -e "$R$path" ] || continue
  [ "$(owner "$path")" = "$uid:$uid" ] && [ "$(mode "$path")" = 400 ] || { ok=0; why+=" $path=$(owner "$path")/$(mode "$path")"; }
done < <(grep $'^atrest\t' "$PLAN")
[ "$ok" = 1 ] && _ok "every present registry copy is its role's, 0400" || _bad "role ownership" "$why"
[ "$(owner /var/lib/agentbox/identities/agentbox-core.json)" = 960:960 ] && [ "$(mode /var/lib/agentbox/identities/agentbox-core.json)" = 400 ] \
  && _ok "agentbox-core.json -> ab-identity (960) 0400: no longer devuser's" || _bad "identity JSON owner" "$(owner /var/lib/agentbox/identities/agentbox-core.json) $(mode /var/lib/agentbox/identities/agentbox-core.json)"
[ "$(owner /var/lib/agentbox/secrets)" = 0:0 ] && [ "$(mode /var/lib/agentbox/secrets)" = 700 ] \
  && [ "$(owner /var/lib/agentbox/identities)" = 0:0 ] && [ "$(mode /var/lib/agentbox/identities)" = 711 ] \
  && _ok "secrets/ -> root 0700; identities/ -> root 0711" || _bad "dir ownership" "$(owner /var/lib/agentbox/secrets) $(mode /var/lib/agentbox/secrets) $(owner /var/lib/agentbox/identities) $(mode /var/lib/agentbox/identities)"
[ "$(owner /var/lib/agentbox/secrets/.role-custody.modes)" = 0:0 ] && [ "$(mode /var/lib/agentbox/secrets/.role-custody.modes)" = 600 ] \
  && _ok "the pre-flag modes record is root 0600" || _bad "modes record owner/mode"

# ── 4/5. names only ──────────────────────────────────────────────────────────
REC="$R/run/secrets/role-isolation.migrated"
if [ -f "$REC" ] && [ "$(mode /run/secrets/role-isolation.migrated)" = 644 ] && ! grep -q "$SECRET_TAG" "$REC" \
   && ! grep -q "$SECRET_TAG" "$R/var/lib/agentbox/secrets/.role-custody.modes" \
   && grep -q $'^copied\t/var/lib/agentbox/secrets/sidestr-faucet-dreamlab.key\t/home/devuser/workspace/sidestr/agents/treasury.key$' "$REC" \
   && grep -q $'^present\t/var/lib/agentbox/identities/agentbox-core.json\t-$' "$REC" \
   && [ "$(grep -v '^#' "$REC" | awk -F'\t' 'NF != 3' | wc -l)" = 0 ]; then
  _ok "the migrated record and the modes record hold paths and statuses only (no secret byte); record 0644"
else _bad "migrated record contents" "$(cat "$REC" 2>/dev/null | head -5)"; fi
! grep -q "$SECRET_TAG" <<<"$out" && _ok "migrate prints no secret value" || _bad "migrate printed a secret"

# ── 6. idempotent ────────────────────────────────────────────────────────────
s1="$(statset | sha256sum)"; led1="$(wc -l <"$LEDGER")"; sleep 1
ab_custody_migrate "$PLAN" /run/secrets/role-isolation.migrated >"$T/run.out" 2>&1; out2="$(cat "$T/run.out")"
s2="$(statset | sha256sum)"
[ "$s1" = "$s2" ] && [ "$(wc -l <"$LEDGER")" = "$led1" ] && [ "$AB_RC_MIGRATED" = 0 ] && [ "$AB_RC_MIG_FAILURES" = 0 ] \
  && _ok "a second migrate changes nothing: no copy, no chown, stat-set hash equal (owner, mode, size, mtime, ctime)" \
  || _bad "migrate is not idempotent" "migrated=$AB_RC_MIGRATED failures=$AB_RC_MIG_FAILURES chowns=$(( $(wc -l <"$LEDGER") - led1 )) $out2"

# ── 7. revert restores exactly ───────────────────────────────────────────────
ab_custody_revert "$PLAN" >"$T/run.out" 2>&1; out="$(cat "$T/run.out")"
post="$(statset)"
ok=1; why=""
while read -r p o m _; do
  [ "$o" = absent ] && continue
  case "$p" in /var/lib/agentbox/secrets/sidestr-faucet-dreamlab.key|/var/lib/agentbox/secrets/sidestr-faucet-dreamlab-txbt4.key|/var/lib/agentbox/secrets/zone-keys.json) continue ;; esac
  q="$(awk -v p="$p" '$1 == p {print $2, $3}' <<<"$post")"
  [ "$q" = "$o $m" ] || { ok=0; why+=" $p: pre '$o $m' now '$q'"; }
done <<<"$PRE"
[ "$ok" = 1 ] && _ok "revert restores the pre-flag owner and mode of every pre-existing registry path (identities/ back to root 0750)" || _bad "revert exactness" "$why"
[ "$(owner /var/lib/agentbox/secrets/sidestr-faucet-dreamlab.key)" = 1000:1000 ] && [ "$(mode /var/lib/agentbox/secrets/sidestr-faucet-dreamlab.key)" = 600 ] \
  && [ "$(mode /var/lib/agentbox/secrets/sidestr-faucet-dreamlab-txbt4.key)" = 400 ] && [ -f "$R/var/lib/agentbox/secrets/sidestr-faucet-dreamlab.key" ] \
  && _ok "copies made by migrate go to devuser at their legacy mode and are kept (never deleted)" || _bad "revert of migrated copies"
p1="$(statset | sha256sum)"; led2="$(wc -l <"$LEDGER")"
ab_custody_revert "$PLAN" >/dev/null 2>&1
[ "$(statset | sha256sum)" = "$p1" ] && [ "$(wc -l <"$LEDGER")" = "$led2" ] && _ok "a second revert changes nothing" || _bad "revert is not idempotent"
ab_custody_migrate "$PLAN" /run/secrets/role-isolation.migrated >/dev/null 2>&1
[ "$(owner /var/lib/agentbox/secrets/sidestr-faucet-dreamlab.key)" = 966:966 ] && [ "$AB_RC_MIGRATED" = 0 ] && [ "$AB_RC_MIG_FAILURES" = 0 ] \
  && _ok "flag on again: migrate re-owns without re-copying (the copy is recorded, not a stranger)" || _bad "re-migrate after revert" "migrated=$AB_RC_MIGRATED failures=$AB_RC_MIG_FAILURES"

# ── 8. tampered canonical copies ─────────────────────────────────────────────
tamper_case() { # <label> <setup-fn>: fresh root, the setup plants the canonical treasury copy
  local label="$1" setup="$2" RT="$T/tamper-$3" target=/var/lib/agentbox/secrets/sidestr-faucet-dreamlab.key
  mkdir -p "$RT/var/lib/agentbox/secrets" "$RT/var/lib/agentbox/identities" "$RT/run/secrets" "$RT/home/devuser/workspace/sidestr/agents" "$RT/elsewhere"
  printf '%s-treasury' "$SECRET_TAG" >"$RT/home/devuser/workspace/sidestr/agents/treasury.key"
  "$setup" "$RT$target" "$RT"
  local lsum; lsum="$(sha256sum <"$RT/home/devuser/workspace/sidestr/agents/treasury.key")"
  local o; AB_RC_ROOT="$RT" ab_custody_migrate "$PLAN" /run/secrets/role-isolation.migrated >"$T/run.out" 2>&1; o="$(cat "$T/run.out")"
  local chowned; chowned="$(awk -F'\t' -v p="$RT$target" '$2 == p' "$LEDGER" | wc -l)"
  local delivered=no
  ( AB_RC_DELIVERED=0; sed "s#\t/var/lib/agentbox/#\t$RT/var/lib/agentbox/#" "$PLAN" >"$RT/plan.d"
    declare -A refused=(); for k in "${!AB_RC_REFUSED[@]}"; do refused["$RT$k"]="${AB_RC_REFUSED[$k]}"; done
    AB_RC_REFUSED=(); for k in "${!refused[@]}"; do AB_RC_REFUSED[$k]="${refused[$k]}"; done
    ab_role_secrets_deliver "$RT/plan.d" "$RT/run/secrets" >/dev/null 2>&1
    [ -e "$RT/run/secrets/ab-faucet-dreamlab/treasury.key" ] && exit 1 || exit 0 ) || delivered=yes
  if [ -n "${AB_RC_REFUSED[$target]:-}" ] && [ "$chowned" = 0 ] && [ "$delivered" = no ] \
     && grep -q $'^refused\t'"$target"$'\t' "$RT/run/secrets/role-isolation.migrated" \
     && [ "$(sha256sum <"$RT/home/devuser/workspace/sidestr/agents/treasury.key")" = "$lsum" ] && ! grep -q "$SECRET_TAG" <<<"$o"; then
    _ok "tampered canonical copy refused (${AB_RC_REFUSED[$target]}): not re-owned, not delivered, recorded by name; legacy intact — $label"
  else _bad "tampered canonical copy — $label" "refused=${AB_RC_REFUSED[$target]:-none} chowned=$chowned delivered=$delivered $(grep refused "$RT/run/secrets/role-isolation.migrated" 2>/dev/null | head -2)"; fi
}
_t_symlink() { printf 'x' >"$2/elsewhere/target"; ln -s "$2/elsewhere/target" "$1"; }
_t_hardlink() { printf '%s-other' "$SECRET_TAG" >"$2/elsewhere/other"; ln "$2/elsewhere/other" "$1"; }
_t_empty() { : >"$1"; }
_t_differs() { printf '%s-planted' "$SECRET_TAG" >"$1"; }
tamper_case "a symlink" _t_symlink 1
tamper_case "a hard link" _t_hardlink 2
tamper_case "an empty file" _t_empty 3
tamper_case "first sighting differs from the legacy twin" _t_differs 4

# ── 9. a forged modes record ─────────────────────────────────────────────────
RF="$T/forged"; mkdir -p "$RF/var/lib/agentbox/secrets" "$RF/var/lib/agentbox/identities" "$RF/run/secrets"
printf '%s' "$SECRET_TAG" >"$RF/var/lib/agentbox/secrets/sidestr-dreamlab.key"; chmod 0400 "$RF/var/lib/agentbox/secrets/sidestr-dreamlab.key"
printf 'f\t/var/lib/agentbox/secrets/sidestr-dreamlab.key\t1000:1000\t666\n' >"$RF/var/lib/agentbox/secrets/.role-custody.modes"
chmod 0600 "$RF/var/lib/agentbox/secrets/.role-custody.modes"   # devuser-owned: the ledger has no root entry
ledf="$(wc -l <"$LEDGER")"; m0="$(stat -c %a "$RF/var/lib/agentbox/secrets/sidestr-dreamlab.key")"
AB_RC_ROOT="$RF" ab_custody_revert "$PLAN" >"$T/run.out" 2>&1; o="$(cat "$T/run.out")"
[ "$(stat -c %a "$RF/var/lib/agentbox/secrets/sidestr-dreamlab.key")" = "$m0" ] && [ "$(wc -l <"$LEDGER")" = "$ledf" ] && grep -q 'not a root-owned' <<<"$o" \
  && _ok "a devuser-owned (forgeable) modes record: revert refuses it and changes nothing" || _bad "forged record honoured by revert" "$o"
AB_RC_ROOT="$RF" ab_custody_migrate "$PLAN" /run/secrets/role-isolation.migrated >"$T/run.out" 2>&1; o="$(cat "$T/run.out")"
ls "$RF/var/lib/agentbox/secrets/".role-custody.modes.untrusted.* >/dev/null 2>&1 && ! grep -q $'\t666$' "$RF/var/lib/agentbox/secrets/.role-custody.modes" \
  && _ok "migrate sets a forged record aside (not deleted) and records afresh" || _bad "migrate with a forged record" "$o"

# ── 10. entrypoint wiring ────────────────────────────────────────────────────
ln_of() { grep -n -F -- "$1" "$ENTRY" | head -1 | cut -d: -f1; }
prep="$(ln_of 'chown 1000:1000 /run/secrets 2>/dev/null || true')"
vol="$(ln_of 'chown 1000:1000 "$_vol_root" 2>/dev/null || true')"
mig="$(ln_of 'ab_custody_migrate /etc/agentbox/role-secrets.tsv /run/secrets/role-isolation.migrated')"
rev="$(ln_of 'ab_custody_revert /etc/agentbox/role-secrets.tsv')"
boot="$(grep -n '^nostr-pod-bridge bootstrap$' "$ENTRY" | cut -d: -f1)"
blk="$(awk -v a="$mig" 'NR >= a - 3 && NR <= a + 3' "$ENTRY")"
if [ -n "$prep" ] && [ -n "$vol" ] && [ -n "$mig" ] && [ -n "$rev" ] && [ -n "$boot" ] && [ "$prep" -lt "$mig" ] && [ "$vol" -lt "$mig" ] && [ "$mig" -lt "$boot" ] && [ "$rev" -lt "$boot" ] \
   && grep -q 'if \[ "\$AGENTBOX_ROLE_ISOLATION" = 1 \]; then' <<<"$blk" && grep -q '^  else$' <<<"$blk"; then
  _ok "entrypoint: migrate (flag on) / revert (otherwise) at lines ${mig}/${rev}, after the /run/secrets prep (${prep}) and volume chown (${vol}), before the identity bootstrap (${boot})"
else _bad "entrypoint placement" "prep=$prep vol=$vol mig=$mig rev=$rev boot=$boot"; fi
grep -q -F '[ "$AGENTBOX_ROLE_ISOLATION" = 1 ] && [ "$_vol_root" = /var/lib/agentbox/secrets ] && continue' "$ENTRY" \
  && _ok "the volume-root loop leaves secrets/ to the migrate step under the flag (flag off: unchanged)" || _bad "volume loop skip"
grep -q -F '_ab_role_key_file_own 1 "$_SOVEREIGN_ID_FILE" ab-identity' "$ENTRY" && grep -q -F 'chown devuser:devuser "$_SOVEREIGN_ID_FILE"' "$ENTRY" \
  && _ok "after the bootstrap the identity file is ab-identity 0400 under the flag, devuser 0600 without it" || _bad "identity file ownership split"
# Flag-off execution of the block: revert is called, migrate is not.
BLK="$(awk '/^if declare -F ab_custody_migrate >\/dev\/null/ {f=1} f {print} f && /^fi$/ {exit}' "$ENTRY")"
calls="$( ab_custody_migrate() { echo migrate; }; ab_custody_revert() { echo revert; }
  AGENTBOX_ROLE_ISOLATION=0; eval "${BLK//\/etc\/agentbox\/role-secrets.tsv/$PLAN}"
  AGENTBOX_ROLE_ISOLATION=1; eval "${BLK//\/etc\/agentbox\/role-secrets.tsv/$PLAN}" )"
[ "$calls" = $'revert\nmigrate' ] && _ok "the block runs revert with the flag off and migrate with it on" || _bad "block dispatch" "$calls"


# ── 11. W4: role program state leaves the workspace bind (seed rows) ─────────
SD="$T/seed"; mkdir -p "$SD/var/lib/agentbox/events/sign" "$SD/ws/sidestr/dreamlab" "$SD/ws/sidestr/agents" "$SD/run-secrets"
printf 'block-bytes-%s' "$RANDOM" >"$SD/ws/sidestr/dreamlab/blocks.dat"; printf '{"tip":1}' >"$SD/ws/sidestr/dreamlab/blocks.json"
ln -s /etc/hostname "$SD/ws/sidestr/dreamlab/planted-link"
printf '{"grants":[]}' >"$SD/ws/sidestr/agents/faucet.json"
printf '%s-treasury' "$SECRET_TAG" >"$SD/ws/sidestr/agents/treasury.key"
src_before="$(stat -c '%n %a %s %Y %Z' "$SD/ws/sidestr/dreamlab"/* "$SD/ws/sidestr/agents"/* | sha256sum)"
# The real plan, every path moved into scratch (workspace first: scratch may sit under it).
sed -e "s#/home/devuser/workspace/#$SD/ws/#g" -e "s#\t/var/lib/agentbox/#\t$SD/var/lib/agentbox/#g" "$PLAN" >"$SD/plan"
( unset AB_RC_ROOT; ab_role_secrets_deliver "$SD/plan" "$SD/run-secrets" >"$SD/out" 2>&1 )
st="$SD/var/lib/agentbox/events/sidestr"
ok=1; why=""
[ "$(sha256sum <"$st/dreamlab/blocks.dat")" = "$(sha256sum <"$SD/ws/sidestr/dreamlab/blocks.dat")" ] || { ok=0; why+=" blocks.dat"; }
[ -f "$st/dreamlab/blocks.json" ] && [ ! -e "$st/dreamlab/planted-link" ] || { ok=0; why+=" link-or-json"; }
[ "$(stat -c %a "$st/dreamlab/blocks.dat")" = 640 ] && [ "$(awk -F'\t' -v p="$st/dreamlab/.blocks.dat.seed." 'index($2,p)==1 {o=$1} END {print o}' "$LEDGER")" = 964:1000 ] || { ok=0; why+=" owner/mode $(stat -c %a "$st/dreamlab/blocks.dat")"; }
[ "$(sha256sum <"$st/faucet-dreamlab/faucet.json")" = "$(sha256sum <"$SD/ws/sidestr/agents/faucet.json")" ] && [ ! -e "$st/faucet-dreamlab/treasury.key" ] || { ok=0; why+=" faucet ledger"; }
grep -q $'^964:1000\t'"$st/dreamlab"'$' "$LEDGER" && grep -q $'^0:0\t'"$st"'$' "$LEDGER" || { ok=0; why+=" dir owners"; }
[ "$ok" = 1 ] && _ok "W4 seed: chain state copied once into the role's events-volume dir (964:devuser, files 0640, symlink skipped); faucet ledger alone seeded, no key beside it" \
  || _bad "W4 seed" "$why $(grep -i error "$SD/out" | head -3)"
[ "$(stat -c '%n %a %s %Y %Z' "$SD/ws/sidestr/dreamlab"/* "$SD/ws/sidestr/agents"/* | sha256sum)" = "$src_before" ] \
  && _ok "W4 seed: the workspace state is left exactly as it was" || _bad "W4 seed touched the source"
printf 'more-blocks' >>"$st/dreamlab/blocks.dat"; after="$(sha256sum <"$st/dreamlab/blocks.dat")"
( unset AB_RC_ROOT; ab_role_secrets_deliver "$SD/plan" "$SD/run-secrets" >/dev/null 2>&1 )
[ "$(sha256sum <"$st/dreamlab/blocks.dat")" = "$after" ] && _ok "W4 seed: a dir that already holds state is never re-seeded (the role's newer blocks survive a reboot)" || _bad "W4 re-seeded over newer state"
! grep -q "$SECRET_TAG" "$SD/out" && _ok "W4 seed prints no value" || _bad "W4 seed printed a value"
# The scripts pick the custody path under the flag, and refuse to fork from a stale workspace copy without it.
SC="$ROOT/config/sidechain"
grep -q 'STATE="${SIDESTR_STATE:-$CUSTODY_STATE}"' "$SC/run-producer.sh" && grep -q '^  umask 027$' "$SC/run-producer.sh" \
  && grep -q 'STATE="${SIDESTR_STATE:-${SIDESTR_CUSTODY_ROOT:-/var/lib/agentbox/events/sidestr}/$NAME}"' "$SC/mirror-sync.sh" \
  && grep -q '\[ -n "${SIDESTR_FAUCET_STATE:-}" \] || STATE="$CUSTODY_LEDGER"' "$SC/run-faucet.sh" \
  && _ok "W4 scripts: producer, mirror and faucet default to the events-volume state under the flag" || _bad "W4 script paths"
o="$(env -i HOME="$SD/h" PATH="$PATH" WORKSPACE="$SD/ws" AGENTBOX_ROLE_ISOLATION=0 SIDESTR_CUSTODY_ROOT="$st" bash "$SC/run-producer.sh" 2>&1)"; rc=$?
o2="$(env -i HOME="$SD/h" PATH="$PATH" WORKSPACE="$SD/ws" AGENTBOX_ROLE_ISOLATION=0 SIDESTR_CUSTODY_ROOT="$st" SIDESTR_FAUCET_KEY=/nonexistent bash "$SC/run-faucet.sh" 2>&1)"; rc2=$?
printf '{"grants":[1,2,3]}' >"$st/faucet-dreamlab/faucet.json"
o3="$(env -i HOME="$SD/h" PATH="$PATH" WORKSPACE="$SD/ws" AGENTBOX_ROLE_ISOLATION=0 SIDESTR_CUSTODY_ROOT="$st" SIDESTR_FAUCET_KEY=/nonexistent bash "$SC/run-faucet.sh" 2>&1)"; rc3=$?
if [ "$rc" = 1 ] && grep -q CUSTODY-STATE-AHEAD <<<"$o" && ! grep -q CUSTODY-STATE-AHEAD <<<"$o2" && [ "$rc3" = 1 ] && grep -q CUSTODY-STATE-AHEAD <<<"$o3"; then
  _ok "W4 rollback guard: flag off with custody state ahead of the workspace copy, producer and faucet refuse (no fork, no re-grant); an equal ledger passes the guard"
else _bad "W4 rollback guard" "producer rc=$rc $(tail -1 <<<"$o") | faucet-equal rc=$rc2 $(tail -1 <<<"$o2") | faucet-ahead rc=$rc3 $(tail -1 <<<"$o3")"; fi

_done
