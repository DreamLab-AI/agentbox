#!/usr/bin/env bash
# ruflo >= 3.51 `init` enables the ruflo mods by default: it writes project
# enabledPlugins, extraKnownMarketplaces.ruflo and
# env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS, then runs `claude plugin install`.
# Function hooks are gated by the manifest (factrail block in the entrypoint),
# so every `init` the image ships must pass --no-mods. Static check over the
# shipped shell sources, plus a live check when RUFLO_CLI points at a
# @claude-flow/cli bin/cli.js (or `claude-flow` is on PATH).
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
fail=0
# grep exits 1 for "no match" (fine) and >1 for an error (never a pass).
set +e
hits="$(grep -nE '(^|[^#[:alnum:]_-])(ruflo|claude-flow)[[:space:]]+init([[:space:]]|"|$)' \
  "$root/config/agentbox-aliases.sh" "$root/config/entrypoint-unified.sh" "$root"/scripts/*.sh)"
rc=$?
set -e
if (( rc > 1 )); then echo "FAIL: grep error ($rc)"; exit 1; fi
while IFS= read -r hit; do
  [[ -z "$hit" || "$hit" == *--no-mods* ]] && continue
  [[ "$hit" =~ ^[^:]+:[0-9]+:[[:space:]]*# ]] && continue   # comment line
  [[ "$hit" == *'`ruflo init`'* ]] && continue               # prose in a string
  echo "FAIL: init without --no-mods: $hit"; fail=1
done <<< "$hits"
if ! grep -q -- 'claude-flow init --force --no-mods' "$root/config/agentbox-aliases.sh"; then
  echo 'FAIL: agentbox-aliases.sh lost its init call (the scan would pass vacuously)'; fail=1
fi
[[ $fail -eq 0 ]] || exit 1
echo 'PASS: every shipped ruflo/claude-flow init passes --no-mods'

cli=()
if [[ -n "${RUFLO_CLI:-}" ]]; then cli=(node "$RUFLO_CLI")
elif command -v claude-flow >/dev/null 2>&1; then cli=(claude-flow)
else echo 'SKIP: live check (no RUFLO_CLI and no claude-flow on PATH)'; exit 0; fi
if ! "${cli[@]}" init --help 2>/dev/null | grep -q -- '--mods'; then
  echo 'SKIP: live check (this ruflo has no --mods flag)'; exit 0
fi
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/home" "$work/proj"
( cd "$work/proj" && HOME="$work/home" "${cli[@]}" init --force --no-mods >/dev/null 2>&1 )
node -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const bad = [];
if (s.enabledPlugins && Object.keys(s.enabledPlugins).some((k) => k.endsWith("@ruflo"))) bad.push("enabledPlugins");
if (s.extraKnownMarketplaces && s.extraKnownMarketplaces.ruflo) bad.push("extraKnownMarketplaces.ruflo");
if (s.env && "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS" in s.env) bad.push("env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS");
if (bad.length) { console.error("FAIL: init --no-mods still wrote " + bad.join(", ")); process.exit(1); }
' "$work/proj/.claude/settings.json"
echo 'PASS: init --force --no-mods leaves mods, marketplace and function hooks unset'
