#!/usr/bin/env bash
# ADR-2138 — [program:target-gc] is gated off by default and reads [resources.target_gc].
#
# No Nix evaluator is assumed, so "block absent when disabled" is checked on the source that
# decides it, plus the manifest, schema, catalogue and validator:
#   1. flake.nix: the flag defaults to false and reads [resources.target_gc].enabled
#   2. flake.nix: exactly one program block, inside lib.optionalString targetGcEnabled, that
#      deletes, loops, reads the baked manifest, runs at idle I/O class, names no store path
#   3. agentbox.toml ships the section enabled, with absolute roots, `project` excluded by
#      default, and a non-zero age
#   4. the schema declares every key and is closed to unknown ones
#   5. the system-manifest catalogue lists it with apply_class 'rebuild' and the same gate
#   6. the validator raises E080 for a relative path and W077 when every root is excluded,
#      and is silent for the shipped manifest
#   7. the Cargo manifest builds a `target-gc` binary
# Run: bash tests/config/target-gc.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
FLAKE="$REPO/flake.nix"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n    %s\n' "$1" "${2:-}"; }

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/target-gc.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

# 1, 2: the gate and the block in flake.nix.
if grep -Eq '^[[:space:]]*targetGcEnabled[[:space:]]*= \(resourcesCfg\.target_gc or \{\}\)\.enabled or false;' "$FLAKE"; then
  ok "flag defaults to false from [resources.target_gc].enabled"
else bad "flag defaults to false from [resources.target_gc].enabled"; fi

total="$(grep -c '^\[program:target-gc\]' "$FLAKE")"
if [ "$total" = 1 ]; then ok "exactly one program block"; else bad "exactly one program block" "found $total"; fi

opener="$(awk '/^\$\{lib\.optionalString /{o=$0} /^\[program:target-gc\]/{print o; exit}' "$FLAKE")"
if [ "$opener" = "\${lib.optionalString targetGcEnabled ''" ]; then
  ok "program block sits inside lib.optionalString targetGcEnabled"
else bad "program block sits inside lib.optionalString targetGcEnabled" "opener was: $opener"; fi

closer="$(awk '/^\[program:target-gc\]/{f=1;next} f&&/^'"''"'}$/{print "closed"; exit} f&&/^\$\{lib\.optionalString /{print "reopened"; exit}' "$FLAKE")"
if [ "$closer" = closed ]; then ok "the guard closes before any other guarded block opens"
else bad "the guard closes before any other guarded block opens" "got: $closer"; fi

block="$(awk '/^\[program:target-gc\]/{f=1} f{print} f&&/^'"''"'}$/{exit}' "$FLAKE")"
cmd="$(printf '%s\n' "$block" | grep '^command=')"
for want in 'ionice -c3' 'target-gc --delete --loop' '--manifest /etc/agentbox.toml'; do
  if printf '%s' "$cmd" | grep -Fq -- "$want"; then ok "command carries '$want'"
  else bad "command carries '$want'" "$cmd"; fi
done
if printf '%s' "$cmd" | grep -Eq '/nix/store/'; then bad "command names no literal store path" "$cmd"
else ok "command names no literal store path"; fi
if printf '%s\n' "$block" | grep -q '^user=devuser$'; then ok "runs as devuser, which owns the worktrees"
else bad "runs as devuser, which owns the worktrees"; fi

# 3: shipped manifest.
section="$(awk '/^\[resources\.target_gc\]/{s=1;next} /^\[/{s=0} s' "$REPO/agentbox.toml" | grep -v '^[[:space:]]*#')"
if printf '%s\n' "$section" | grep -Eq '^enabled[[:space:]]*= true'; then ok "agentbox.toml ships enabled = true"
else bad "agentbox.toml ships enabled = true" "$section"; fi
if printf '%s\n' "$section" | grep -E '^exclude' | grep -q '/home/devuser/workspace/project"'; then
  ok "the host-bound project/ checkout is excluded by default"
else bad "the host-bound project/ checkout is excluded by default" "$section"; fi
age="$(printf '%s\n' "$section" | awk -F= '/^max_age_days/{gsub(/[ \t]/,"",$2); sub(/#.*/,"",$2); print $2}')"
if [ -n "$age" ] && [ "$age" -ge 1 ] 2>/dev/null; then ok "max_age_days is at least one ($age)"
else bad "max_age_days is at least one" "got: $age"; fi

# 4: schema.
schema_out="$(cd "$REPO" && node -e '
const s = require("./schema/agentbox.toml.schema.json");
const d = s.properties.resources.properties.target_gc;
if (!d || d.additionalProperties !== false) { console.log("missing or open"); process.exit(0); }
const need = ["enabled","roots","exclude","max_age_days","interval_secs"];
console.log(need.every((k) => d.properties[k]) ? "ok" : "keys missing");
' 2>&1)"
if [ "$schema_out" = ok ]; then ok "schema declares every [resources.target_gc] key and is closed"
else bad "schema declares every [resources.target_gc] key and is closed" "$schema_out"; fi

# 5: catalogue.
cat_out="$(cd "$REPO" && node -e '
const m = require("./management-api/lib/system-manifest.js");
const all = [].concat(...Object.values(m).filter(Array.isArray));
const e = all.find((x) => x && x.id === "target-gc");
console.log(e ? e.apply_class + " " + e.gate + " " + e.service : "absent");
' 2>&1)"
if [ "$cat_out" = "rebuild resources.target_gc.enabled target-gc" ]; then ok "catalogue entry: rebuild class, same gate and service"
else bad "catalogue entry: rebuild class, same gate and service" "$cat_out"; fi

# 6: validator, on a copy of the shipped manifest with the section replaced.
variant() { # <section body> -> manifest path
  local out="$ROOT/$1.toml"
  awk '/^\[resources\.target_gc\]/{skip=1; next} /^\[/{skip=0} !skip' "$REPO/agentbox.toml" >"$out"
  printf '\n[resources.target_gc]\n%s\n' "$2" >>"$out"
  printf '%s' "$out"
}
codes() { node "$REPO/scripts/agentbox-config-validate.js" "$1" 2>&1 | grep -oE '\b(E080|W077)\b' | sort -u | tr '\n' ' '; }

m="$(variant relative 'enabled = true
roots = ["relative/dir"]')"
got="$(codes "$m")"
if printf '%s' "$got" | grep -q E080; then ok "E080 for a relative root"; else bad "E080 for a relative root" "got: $got"; fi

m="$(variant shadowed 'enabled = true
roots = ["/w/a"]
exclude = ["/w"]')"
got="$(codes "$m")"
if printf '%s' "$got" | grep -q W077; then ok "W077 when every root is excluded"; else bad "W077 when every root is excluded" "got: $got"; fi

got="$(codes "$REPO/agentbox.toml")"
if [ -z "$got" ]; then ok "the shipped manifest raises neither code"; else bad "the shipped manifest raises neither code" "got: $got"; fi

# 7: the Cargo manifest.
if grep -Eq '^name = "target-gc"$' "$REPO/services/agentbox-ops/Cargo.toml" \
  && [ -f "$REPO/services/agentbox-ops/src/bin/target-gc.rs" ]; then ok "agentbox-ops builds a target-gc binary"
else bad "agentbox-ops builds a target-gc binary"; fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" = 0 ]
