#!/usr/bin/env bash
# Website ADR-2010 — [program:seo-watch-cron] is gated off by default and runs the website crontab.
#
# No Nix evaluator is assumed, so the "block absent when disabled" property is checked on the
# source that decides it, plus the manifests, schema and catalogue:
#   1. flake.nix: the enable flag defaults to false and reads [seo_watch].enabled
#   2. flake.nix: the program text sits only inside lib.optionalString seoWatchEnabled
#   3. agentbox.toml and the default manifest ship enabled = true and no secret
#   4. the schema accepts [seo_watch] and is closed to unknown keys
#   5. the system-manifest catalogue lists it with apply_class 'rebuild' and the same gate
#   6. the stanza runs supercronic over the website repo crontab (no store path baked into
#      the job itself) and pins node, git, gh, flock and timeout into PATH
# Run: bash tests/config/seo-watch-cron.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
FLAKE="$REPO/flake.nix"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n    %s\n' "$1" "${2:-}"; }

# 1, 2: the gate in flake.nix.
if grep -Eq '^[[:space:]]*seoWatchEnabled = \(agentboxConfig\.seo_watch or \{\}\)\.enabled or false;' "$FLAKE"; then
  ok "flag defaults to false from [seo_watch].enabled"
else bad "flag defaults to false from [seo_watch].enabled"; fi

total="$(grep -c '^\[program:seo-watch-cron\]' "$FLAKE")"
if [ "$total" = 1 ]; then ok "exactly one program block"; else bad "exactly one program block" "found $total"; fi

opener="$(awk '/^\$\{lib\.optionalString /{o=$0} /^\[program:seo-watch-cron\]/{print o; exit}' "$FLAKE")"
if [ "$opener" = "\${lib.optionalString seoWatchEnabled ''" ]; then
  ok "program block sits inside lib.optionalString seoWatchEnabled"
else bad "program block sits inside lib.optionalString seoWatchEnabled" "opener was: $opener"; fi

closer="$(awk '/^\[program:seo-watch-cron\]/{f=1;next} f&&/^'"''"'}$/{print "closed"; exit} f&&/^\$\{lib\.optionalString /{print "reopened"; exit}' "$FLAKE")"
if [ "$closer" = closed ]; then ok "the guard closes before any other guarded block opens"
else bad "the guard closes before any other guarded block opens" "got: $closer"; fi

# 3: manifests.
for f in agentbox.toml setup/agentbox.default.toml; do
  v="$(awk '/^\[seo_watch\]/{s=1;next} /^\[/{s=0} s&&/^enabled[[:space:]]*=/{print $3}' "$REPO/$f")"
  if [ "$v" = true ]; then ok "$f ships enabled = true"; else bad "$f ships enabled = true" "got: $v"; fi
  if awk '/^\[seo_watch\]/{s=1;next} /^\[/{s=0} s' "$REPO/$f" | grep -v '^[[:space:]]*#' | grep -Eiq 'key[[:space:]]*=|token[[:space:]]*='; then
    bad "$f carries no key in [seo_watch]"; else ok "$f carries no key in [seo_watch]"; fi
done

if command -v agentbox-manifest >/dev/null 2>&1; then
  ROOT="$(mktemp -d "${TMPDIR:-/tmp}/seo-watch-cron.XXXXXX")"
  trap 'rm -rf "$ROOT"' EXIT
  printf '[seo_watch]\nenabled = false\n' >"$ROOT/off.toml"
  printf '[core]\norchestration = "x"\n' >"$ROOT/none.toml"
  printf '[seo_watch]\nenabled = true\n' >"$ROOT/on.toml"
  for pair in off:0 none:0 on:1; do
    n="${pair%%:*}"; want="${pair##*:}"
    got="$(agentbox-manifest toml-bool --manifest "$ROOT/$n.toml" --path seo_watch.enabled)"
    if [ "$got" = "$want" ]; then ok "fixture '$n' reads as enabled=$want"; else bad "fixture '$n' reads as enabled=$want" "got $got"; fi
  done
fi

# 4: schema.
schema_out="$(cd "$REPO" && node -e '
const s = require("./schema/agentbox.toml.schema.json");
const d = s.properties.seo_watch;
if (!d || d.additionalProperties !== false) { console.log("missing or open"); process.exit(0); }
console.log(d.properties.enabled && d.properties.enabled.type === "boolean" ? "ok" : "enabled missing");
' 2>&1)"
if [ "$schema_out" = ok ]; then ok "schema declares [seo_watch].enabled and is closed"
else bad "schema declares [seo_watch].enabled and is closed" "$schema_out"; fi

# 5: catalogue.
cat_out="$(cd "$REPO" && node -e '
const m = require("./management-api/lib/system-manifest.js");
const all = [].concat(...Object.values(m).filter(Array.isArray));
const e = all.find((x) => x && x.id === "seo-watch");
console.log(e ? e.apply_class + " " + e.gate + " " + e.service : "absent");
' 2>&1)"
if [ "$cat_out" = "rebuild seo_watch.enabled seo-watch-cron" ]; then ok "catalogue entry: rebuild class, same gate and service"
else bad "catalogue entry: rebuild class, same gate and service" "$cat_out"; fi

# 6: the stanza.
block="$(awk '/^\[program:seo-watch-cron\]/{f=1} f{print} f&&/^stderr_logfile_maxbytes/{exit}' "$FLAKE")"
if printf '%s\n' "$block" | grep -q 'supercronic -inotify -split-logs /home/devuser/workspace/dreamlab-ai-website/scripts/seo-watch/crontab'; then
  ok "supercronic reads the website repo crontab"; else bad "supercronic reads the website repo crontab" "$block"; fi
for pkg in pkgs.nodejs_22 pkgs.git pkgs.gh pkgs.util-linux pkgs.coreutils; do
  if printf '%s\n' "$block" | grep -q "$pkg"; then ok "PATH pins $pkg"; else bad "PATH pins $pkg"; fi
done
if printf '%s\n' "$block" | grep -q '^user=devuser$'; then ok "runs as devuser"; else bad "runs as devuser"; fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" = 0 ]
