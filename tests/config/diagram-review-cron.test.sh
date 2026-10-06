#!/usr/bin/env bash
# ADR-2131 — [program:diagram-review-cron] is gated off by default and renders its crontab from the manifest.
#
# No Nix evaluator is assumed, so the "block absent when disabled" property is checked on the
# source that decides it, plus the manifest default and the real wrapper:
#   1. flake.nix: the enable flag defaults to false and reads [diagram_review].enabled
#   2. flake.nix: the program text sits only inside lib.optionalString diagramReviewEnabled
#   3. agentbox.toml and the default manifest ship enabled = false
#   4. the schema accepts [diagram_review] and is closed to unknown keys
#   5. the system-manifest catalogue lists it with apply_class 'rebuild' and the same gate
#   6. run-cron.sh renders the manifest schedules, adds the audit after triage only when
#      weekly_window = false, falls back on a malformed expression, and execs supercronic
#   7. the rendered crontab names no /nix/store path
# Run: bash tests/config/diagram-review-cron.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
FLAKE="$REPO/flake.nix"
WRAP="$REPO/skills/sealmap-review/run-cron.sh"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n    %s\n' "$1" "${2:-}"; }

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/diagram-review-cron.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

# 1, 2: the gate in flake.nix.
if grep -Eq '^[[:space:]]*diagramReviewEnabled = \(agentboxConfig\.diagram_review or \{\}\)\.enabled or false;' "$FLAKE"; then
  ok "flag defaults to false from [diagram_review].enabled"
else bad "flag defaults to false from [diagram_review].enabled"; fi

total="$(grep -c '^\[program:diagram-review-cron\]' "$FLAKE")"
if [ "$total" = 1 ]; then ok "exactly one program block"; else bad "exactly one program block" "found $total"; fi

# The block must be the body of the optionalString opened by the last guard line above it, and
# that guard must close before any other guarded block opens.
opener="$(awk '/^\$\{lib\.optionalString /{o=$0} /^\[program:diagram-review-cron\]/{print o; exit}' "$FLAKE")"
if [ "$opener" = "\${lib.optionalString diagramReviewEnabled ''" ]; then
  ok "program block sits inside lib.optionalString diagramReviewEnabled"
else bad "program block sits inside lib.optionalString diagramReviewEnabled" "opener was: $opener"; fi

closer="$(awk '/^\[program:diagram-review-cron\]/{f=1;next} f&&/^'"''"'}$/{print "closed"; exit} f&&/^\$\{lib\.optionalString /{print "reopened"; exit}' "$FLAKE")"
if [ "$closer" = closed ]; then ok "the guard closes before any other guarded block opens"
else bad "the guard closes before any other guarded block opens" "got: $closer"; fi

# 3: manifests.
for f in agentbox.toml setup/agentbox.default.toml; do
  v="$(awk '/^\[diagram_review\]/{s=1;next} /^\[/{s=0} s&&/^enabled[[:space:]]*=/{print $3}' "$REPO/$f")"
  if [ "$v" = false ]; then ok "$f ships enabled = false"; else bad "$f ships enabled = false" "got: $v"; fi
done

# 4: schema.
schema_out="$(cd "$REPO" && node -e '
const s = require("./schema/agentbox.toml.schema.json");
const d = s.properties.diagram_review;
if (!d || d.additionalProperties !== false) { console.log("missing or open"); process.exit(0); }
const need = ["enabled","repos","glm_triage_cron","glm_review_cron","gemini_min_interval_days","gemini_min_changed_topics","gemini_monthly_usd","weekly_window"];
console.log(need.every((k) => d.properties[k]) ? "ok" : "keys missing");
' 2>&1)"
if [ "$schema_out" = ok ]; then ok "schema declares every [diagram_review] key and is closed"
else bad "schema declares every [diagram_review] key and is closed" "$schema_out"; fi

# 5: catalogue.
cat_out="$(cd "$REPO" && node -e '
const m = require("./management-api/lib/system-manifest.js");
const all = [].concat(...Object.values(m).filter(Array.isArray));
const e = all.find((x) => x && x.id === "diagram-review");
console.log(e ? e.apply_class + " " + e.gate + " " + e.service : "absent");
' 2>&1)"
if [ "$cat_out" = "rebuild diagram_review.enabled diagram-review-cron" ]; then ok "catalogue entry: rebuild class, same gate and service"
else bad "catalogue entry: rebuild class, same gate and service" "$cat_out"; fi

# 6, 7: the wrapper, against a stub supercronic that records the crontab it is given.
mkdir -p "$ROOT/bin"
cat >"$ROOT/bin/supercronic" <<'STUB'
#!/usr/bin/env bash
cp "${!#}" "$STUB_CRONTAB_OUT"
STUB
chmod +x "$ROOT/bin/supercronic"

render() { # <manifest body>: the job lines of the rendered crontab on stdout
  printf '%s\n' "$1" >"$ROOT/m.toml"
  rm -f "$ROOT/out.crontab"
  AGENTBOX_CONFIG="$ROOT/m.toml" DIAGRAM_REVIEW_CRONTAB_DIR="$ROOT/run" STUB_CRONTAB_OUT="$ROOT/out.crontab" \
    bash "$WRAP" "$ROOT/bin/supercronic" 2>"$ROOT/err"
  grep -v '^[[:space:]]*#' "$ROOT/out.crontab" 2>/dev/null | grep -v '^[[:space:]]*$'
}
has() { printf '%s\n' "$out" | grep -Eq -- "$1"; }

if ! command -v agentbox-manifest >/dev/null 2>&1; then
  bad "agentbox-manifest on PATH for the wrapper test" "not found"
else
  out="$(render '[diagram_review]
enabled = true
glm_triage_cron = "5 4 * * 2"
glm_review_cron = "30 3 * * 6"
weekly_window = true')"
  if has '^5 4 \* \* 2 node .*review-cadence.cjs triage' && has '^30 3 \* \* 6 node .*review-cadence.cjs review-glm'; then
    ok "triage and review take the manifest schedules"; else bad "triage and review take the manifest schedules" "$out"; fi
  if [ "$(printf '%s\n' "$out" | grep -c audit-gemini)" = 1 ] && has '^30 3.*audit-gemini'; then
    ok "weekly_window = true: the audit runs only on the review line"; else bad "weekly_window = true: the audit runs only on the review line" "$out"; fi
  if ! has '@[A-Z_]+@'; then ok "no placeholder left unfilled"; else bad "no placeholder left unfilled" "$out"; fi
  if ! grep -q '/nix/store' "$ROOT/out.crontab"; then ok "no /nix/store path in the rendered crontab"
  else bad "no /nix/store path in the rendered crontab"; fi

  out="$(render '[diagram_review]
weekly_window = false')"
  if has 'triage 2>&1 ; node .*audit-gemini'; then ok "weekly_window = false: the audit is also considered after triage"
  else bad "weekly_window = false: the audit is also considered after triage" "$out"; fi
  if has '^17 5 \* \* 1-6 node' && has '^47 5 \* \* 0 node'; then ok "unset schedules take the shipped defaults"
  else bad "unset schedules take the shipped defaults" "$out"; fi

  out="$(render '[diagram_review]
glm_triage_cron = "every day; touch /tmp/injected"')"
  if has '^17 5 \* \* 1-6 node' && ! has 'injected' && grep -q 'not a five-field' "$ROOT/err"; then
    ok "a malformed expression is refused and the default used"
  else bad "a malformed expression is refused and the default used" "$out"; fi
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
