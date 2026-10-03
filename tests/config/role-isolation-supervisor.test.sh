#!/usr/bin/env bash
# role-isolation-supervisor — the two supervisor configs cannot drift (ADR-2122,
# custody X-1 step 1, W1).
#
# /etc/supervisord.roles.conf is derived from today's rendered
# /etc/supervisord.conf by `agentbox-manifest role-accounts isolate` with
# config/role-accounts.json. Against a fixture that is a real rendered config
# (the running image's, plus the per-chain and docker-read-proxy blocks it
# predates, rendered by hand from flake.nix), this asserts:
#   1. the transform accepts the fixture and writes both outputs
#   2. with user= and environment= lines removed, the two configs are identical
#   3. every changed program is in the table, runs as its role, and every other
#      program section is byte-identical
#   4. path rule: a program line names /run/secrets/<role>/ only for its own
#      role, and no at-rest secret source survives in the isolated config
#   5. value rule: no secret value reaches either config
#   6. an unmapped secret-bearing program fails the build and writes nothing
#   7. the table keeps every compose group_add gid (the host docker group) out
#      of the role range, and no role group has members
#   8. flake.nix bakes both configs, the plan and the accounts from the table
# No Nix needed. Secret values here are random test strings, never printed.
# shellcheck disable=SC2015
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TABLE="$ROOT/config/role-accounts.json"
FIX="$HERE/fixtures/role-isolation/supervisord.conf"
PASS=0; FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$((PASS + FAIL))" "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'not ok %d - %s\n' "$((PASS + FAIL))" "$1"; [ -n "${2:-}" ] && printf '#   %s\n' "$2"; }
_done() { printf '1..%d\n# role-isolation-supervisor: %d passed, %d failed\n' "$((PASS + FAIL))" "$PASS" "$FAIL"; [ "$FAIL" -eq 0 ]; exit $?; }

T="$(mktemp -d "${TMPDIR:-/tmp}/role-iso-sup.XXXXXX")"; trap 'rm -rf "$T"' EXIT

# The binary: $AGENTBOX_MANIFEST_BIN, else an existing build, else cargo.
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
command -v jq >/dev/null 2>&1 || { echo "SKIP: jq is required"; exit 77; }

ISO="$T/supervisord.roles.conf"; PLAN="$T/role-secrets.tsv"
_same() { [ "$(sha256sum <"$1")" = "$(sha256sum <"$2")" ]; }   # no diffutils needed

# ── 1. the transform runs ────────────────────────────────────────────────────
if "$BIN" role-accounts isolate --table "$TABLE" --conf "$FIX" --out "$ISO" --plan "$PLAN" >"$T/isolate.log" 2>&1 \
   && [ -s "$ISO" ] && [ -s "$PLAN" ]; then
  _ok "role-accounts isolate renders the isolated config and the plan from the fixture"
else
  _bad "role-accounts isolate must succeed on the fixture" "$(head -5 "$T/isolate.log")"; _done
fi

# ── 2. only user= and environment= differ ────────────────────────────────────
_strip() { grep -Ev '^(user|environment)[[:space:]]*=' "$1"; }
if [ "$(_strip "$FIX" | sha256sum)" = "$(_strip "$ISO" | sha256sum)" ]; then
  _ok "with user= and environment= removed, the two configs are byte-identical"
else
  _bad "the configs differ outside user=/environment=" "$(comm -3 <(_strip "$FIX") <(_strip "$ISO") | head -3)"
fi
changed="$(comm -13 <(sort "$FIX") <(sort "$ISO") | grep -cEv '^(user|environment)[[:space:]]*=')"
[ "$changed" = 0 ] && _ok "every added or changed line is a user= or environment= line" \
  || _bad "lines other than user=/environment= were added" "$changed"

# ── 3. per-program: roles where the table says, byte-identical elsewhere ─────
# Section text keyed by program name, from a config file.
_sections() { awk '/^\[/{name=""} /^\[program:/{name=substr($0,10); sub(/\]$/,"",name)} name!=""{print name "\t" $0}' "$1"; }
_section() { _sections "$1" | awk -F'\t' -v n="$2" '$1==n{sub(/^[^\t]*\t/,""); print}'; }
_user_of() { _section "$1" "$2" | sed -n 's/^user=//p' | head -1; }
mapfile -t programs < <(_sections "$FIX" | cut -f1 | uniq)
role_of() { jq -r --arg p "$1" '.roles[] | select(.programs | index($p)) | .name' "$TABLE"; }
bad3=""; n_role=0; n_same=0
for p in "${programs[@]}"; do
  r="$(role_of "$p")"
  if [ -n "$r" ]; then
    n_role=$((n_role + 1))
    [ "$(_user_of "$FIX" "$p")" = devuser ] || bad3="${bad3} ${p}:today-not-devuser"
    [ "$(_user_of "$ISO" "$p")" = "$r" ] || bad3="${bad3} ${p}:user=$(_user_of "$ISO" "$p")!=${r}"
  else
    [ "$(_section "$FIX" "$p" | sha256sum)" = "$(_section "$ISO" "$p" | sha256sum)" ] || bad3="${bad3} ${p}:changed"
    n_same=$((n_same + 1))
  fi
done
[ -z "$bad3" ] && [ "$n_role" -ge 7 ] && _ok "${n_role} role programs run as their table role; ${n_same} other programs are byte-identical" \
  || _bad "role mapping wrong or a non-role program changed" "role=${n_role}${bad3}"
bad3r=""
for p in bootstrap docker-read-proxy tailscale-up; do
  [ -n "$(_section "$ISO" "$p")" ] && [ -z "$(_user_of "$ISO" "$p")" ] || bad3r="${bad3r} ${p}"
done
[ -z "$bad3r" ] && _ok "root programs (bootstrap, docker-read-proxy, tailscale-up) keep no user= in the isolated config" \
  || _bad "root programs must be unchanged and keep no user=" "$bad3r"

# ── 4. path rule ─────────────────────────────────────────────────────────────
bad4=""
for p in "${programs[@]}"; do
  r="$(role_of "$p")"
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    [ "$ref" = "/run/secrets/${r:-<none>}/" ] || bad4="${bad4} ${p}->${ref}"
  done < <(_section "$ISO" "$p" | grep -oE '/run/secrets/[^/"]+/' | sort -u)
  # The bare role dir (AGENTBOX_SECRETS_DIR) must be the program's own too.
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    [ "$ref" = "/run/secrets/${r:-<none>}\"" ] || bad4="${bad4} ${p}->${ref}"
  done < <(_section "$ISO" "$p" | grep -oE '/run/secrets/ab-[^/"]+"' | sort -u)
done
[ -z "$bad4" ] && _ok "no program names another role's /run/secrets/<role>/ path; non-role programs name none" \
  || _bad "a program names a secret path that is not its own" "$bad4"
leaked=""
while IFS=$'\t' read -r kind role file src; do
  [ "$kind" = file ] || continue
  grep -qF -- "$src" "$ISO" && leaked="${leaked} ${role}:${src}"
done <"$PLAN"
[ -z "$leaked" ] && _ok "no at-rest secret source path survives in the isolated config" \
  || _bad "an at-rest secret path is still named in the isolated config" "$leaked"
expected_env="$(jq -r '.roles[] | .name as $r | .secrets[] | select(.env != null) | "\($r) \(.env)=\"/run/secrets/\($r)/\(.file)\""' "$TABLE")"
bad4b=""
while read -r r pair; do
  progs="$(jq -r --arg r "$r" '.roles[] | select(.name==$r) | .programs[]' "$TABLE")"
  for p in $progs; do
    [ -n "$(_section "$FIX" "$p")" ] || continue
    _section "$ISO" "$p" | grep -E '^environment=' | grep -qF -- "$pair" || bad4b="${bad4b} ${p}:${pair}"
  done
done <<<"$expected_env"
[ -z "$bad4b" ] && _ok "each rendered role program reads every secret path from its own role dir" \
  || _bad "a role program misses a secret path" "$bad4b"

# ── 5. value rule ────────────────────────────────────────────────────────────
# Fake values for every classified variable and every file source: the
# transform reads neither, and this pins that a future change cannot start to.
mapfile -t envvars < <(awk -F'\t' '$1=="env"{print $4}' "$PLAN")
vals=()
for v in "${envvars[@]}"; do
  val="test-secret-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  export "$v=$val"; vals+=("$val")
done
"$BIN" role-accounts isolate --table "$TABLE" --conf "$FIX" --out "$T/iso2" --plan "$T/plan2" >"$T/iso2.log" 2>&1
hits=0
for val in "${vals[@]}"; do
  for f in "$FIX" "$ISO" "$T/iso2" "$T/plan2" "$T/iso2.log"; do grep -qF -- "$val" "$f" && hits=$((hits + 1)); done
done
[ "$hits" = 0 ] && [ "${#vals[@]}" -ge 5 ] && _ok "no classified secret value appears in either config, the plan or the log (${#vals[@]} values planted)" \
  || _bad "a secret value leaked into a config" "hits=${hits}"
_same "$ISO" "$T/iso2" && _same "$PLAN" "$T/plan2" && _ok "the transform is deterministic and ignores the environment" \
  || _bad "the transform output changed with the environment"
for v in "${envvars[@]}"; do unset "$v"; done
assigned=""
for v in "${envvars[@]}"; do
  grep -qE "^environment=(.*,)?${v}=" "$FIX" "$ISO" && assigned="${assigned} ${v}"
done
[ -z "$assigned" ] && _ok "no environment= line in either config assigns a classified variable (they travel as *_FILE paths)" \
  || _bad "a classified variable is assigned in an environment= line" "$assigned"

# ── 6. unmapped secret-bearing program ───────────────────────────────────────
{ cat "$FIX"; printf '\n[program:sidestr-producer-newchain]\ncommand=/bin/true\nuser=devuser\n'; } >"$T/unmapped.conf"
rm -f "$T/o3" "$T/p3"
if "$BIN" role-accounts isolate --table "$TABLE" --conf "$T/unmapped.conf" --out "$T/o3" --plan "$T/p3" >"$T/o3.log" 2>&1; then
  _bad "a secret-bearing program with no role must fail the transform"
else
  grep -q 'sidestr-producer-newchain\] is secret-bearing but no role' "$T/o3.log" && [ ! -e "$T/o3" ] && [ ! -e "$T/p3" ] \
    && _ok "an unmapped secret-bearing program fails the build, names the fix, writes nothing" \
    || _bad "the failure must name the program and write no output" "$(head -3 "$T/o3.log")"
fi

# ── 7. ids: the docker gid, the range, no members ────────────────────────────
mapfile -t gids < <(awk '/group_add:/{f=1;next} f && /^[[:space:]]*-/{gsub(/[^0-9]/,""); print; next} f{f=0}' "$ROOT/docker-compose.override.yml" "$ROOT/docker-compose.yml" 2>/dev/null | sort -u)
bad7=""
for g in "${gids[@]}"; do
  [ -n "$g" ] || continue
  jq -e --arg g "$g" '.reserved_ids | has($g)' "$TABLE" >/dev/null || bad7="${bad7} ${g}:not-reserved"
  jq -e --argjson g "$g" '[.roles[].uid] | index($g) == null' "$TABLE" >/dev/null || bad7="${bad7} ${g}:taken-by-a-role"
done
[ "${#gids[@]}" -ge 1 ] && [ -z "$bad7" ] && _ok "compose group_add gid(s) ${gids[*]} are reserved and held by no role" \
  || _bad "a compose group_add gid collides with the role table" "gids=${gids[*]:-none}${bad7}"
"$BIN" role-accounts group --table "$TABLE" >"$T/group" 2>&1 && "$BIN" role-accounts passwd --table "$TABLE" >"$T/passwd" 2>&1
if [ "$(grep -c '' "$T/group")" = "$(jq '.roles | length' "$TABLE")" ] && ! grep -qvE '^ab-[a-z0-9-]+:x:9[67][0-9]:$' "$T/group"; then
  _ok "every role has its own primary group with no members (devuser joins none)"
else
  _bad "group lines must be ab-<role>:x:<960-979>: with no members" "$(head -3 "$T/group")"
fi
if ! grep -qvE '^ab-[a-z0-9-]+:x:(9[67][0-9]):\1:agentbox role ab-[a-z0-9-]+:/run/secrets/ab-[a-z0-9-]+/home:/sbin/nologin$' "$T/passwd"; then
  _ok "passwd lines: uid = gid in 960-979, home under the role's own secrets dir, nologin"
else
  _bad "passwd line shape" "$(head -3 "$T/passwd")"
fi
grep -qE ':0:|:1000:|devuser' "$T/group" "$T/passwd" && _bad "a role line references root's or devuser's ids" \
  || _ok "no role line names gid 0, gid 1000 or devuser"

# ── 8. flake wiring (static: Nix cannot be evaluated here) ───────────────────
F="$ROOT/flake.nix"
grep -q 'role-accounts isolate --table \${./config/role-accounts.json} --conf \$out/etc/supervisord.conf --out \$out/etc/supervisord.roles.conf --plan \$out/etc/agentbox/role-secrets.tsv' "$F" \
  && _ok "flake.nix derives supervisord.roles.conf and the plan from the baked supervisord.conf" \
  || _bad "flake.nix must run role-accounts isolate on \$out/etc/supervisord.conf"
grep -q 'role-accounts passwd --table \${./config/role-accounts.json} >> \$out/etc/passwd' "$F" \
  && grep -q 'role-accounts group --table \${./config/role-accounts.json} >> \$out/etc/group' "$F" \
  && _ok "flake.nix appends the role passwd and group lines from the table" \
  || _bad "flake.nix must append role passwd/group lines from config/role-accounts.json"
grep -q 'cp \${./config/role-accounts.json} \$out/etc/agentbox/role-accounts.json' "$F" \
  && _ok "flake.nix ships the table at /etc/agentbox/role-accounts.json (the rehearsal reads it)" \
  || _bad "flake.nix must ship config/role-accounts.json at /etc/agentbox/role-accounts.json"
grep -qE '"/run/secrets:mode=711,size=[0-9]+[mM],uid=0,gid=0' "$F" && grep -qE -- '- /run/secrets:mode=711,size=[0-9]+[mM],uid=0,gid=0' "$ROOT/docker-compose.yml" \
  && _ok "/run/secrets is its own root-owned tmpfs in flake.nix and the generated docker-compose.yml" \
  || _bad "/run/secrets must be a root-owned tmpfs mount in flake.nix and docker-compose.yml"

_done
