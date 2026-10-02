#!/usr/bin/env bash
# ADR-2121: the entrypoint projects [features.jev_compaction] into factrail's
# userConfig through _jc_project, which must (1) skip an empty value so the
# plugin's default holds, (2) skip and log a key the baked plugin does not
# declare (an unknown --config key fails the whole install), and (3) pass a
# declared pair through as one `--config KEY=VALUE` word.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
entry="$root/config/entrypoint-unified.sh"

fn="$(awk '/^  _jc_project\(\) \{/{f=1} f{print} f&&/^  \}$/{exit}' "$entry")"
[[ -n "$fn" ]] || { echo "FAIL: _jc_project not found in $entry"; exit 1; }
eval "$fn"

pass=0; fail=0
check() { if [[ "$2" == "$3" ]]; then pass=$((pass+1)); echo "  ok   $1"; else fail=$((fail+1)); echo "  FAIL $1: got [$2] want [$3]"; fi; }

_JC_DECLARED="binary egress fallback baseUrl backendLocal"
_JC_ARGS=""
_jc_project "egress=metadata"
check "declared pair is projected" "$_JC_ARGS" " --config egress=metadata"

_JC_ARGS=""
_jc_project "fallback="
check "empty value is not projected" "$_JC_ARGS" ""

_JC_ARGS=""
log="$(_jc_project "minReductionRatio=0.55")"
check "undeclared key is not projected" "$_JC_ARGS" ""
check "undeclared key is logged" "$log" "  [factrail] plugin declares no userConfig key 'minReductionRatio' — not projecting it"

_JC_ARGS=""
_jc_project "baseUrl=http://systemone:8097/v1/systemone"
_jc_project "backendLocal=true"
check "façade pairs keep their order and values" "$_JC_ARGS" " --config baseUrl=http://systemone:8097/v1/systemone --config backendLocal=true"

_JC_ARGS=""
_jc_project "binaryPath=/x"
check "a key is matched whole, not by prefix" "$_JC_ARGS" ""

# Every key the entrypoint projects must be one factrail's plugin declares at
# the pinned commit (lib/factrail.nix); the list below is that manifest's.
declared="binary apiKey enabledByDefault backend baseUrl backendLocal model egress fallback taintTools taintSkills keepThreshold preserveRecentMessages maxStateTokens maxRequestTokens truncateHeadChars compactAtPercent compactAtTokens rearmTokens cacheWarm cacheWarmFloorTokens cacheTtlSeconds cacheTtlMarginSeconds compactionTimeoutMs saveFullOutputs recordDecisions"
projected="$(awk '/^# ── ADR-2093\/ADR-2121: Jev compaction with fact rails/{f=1} /^# ── MCP registry projection/{f=0} f' "$entry" \
  | grep -oE '"[a-zA-Z]+=\$\(' | tr -d '"=$(' | sort -u)"
projected="$projected binary"
# Guard against a vacuous pass: the section pattern must find the projection loop.
check "the projection block was found" "$(echo $projected | wc -w | tr -d " ")" "18"
missing=""
for k in $projected; do case " $declared " in *" $k "*) ;; *) missing="$missing $k" ;; esac; done
check "every projected key is declared by the pinned plugin" "$missing" ""

echo "factrail projection: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
