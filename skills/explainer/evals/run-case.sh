#!/usr/bin/env bash
# Run one eval case on the local production model with a pinned skill root.
#
#   run-case.sh --workspace DIR --iteration N --eval ID --variant old_skill|with_skill \
#               --skills-root DIR --prompt-file FILE [--target DIR] [--profile provider/model]
#               [--timeout SECONDS]
#
# Writes <workspace>/iteration-N/eval-ID/<variant>/{outputs,transcript.jsonl,timing.json,opencode.json}.
# The production record for the run is outputs/; the prompt should tell the model to work there.
set -euo pipefail
workspace= iteration= evalid= variant= root= promptfile= target=$PWD profile=loom-agent/current timeout=14400
while [ $# -gt 0 ]; do
  case "$1" in
    --workspace) workspace=$2; shift 2;; --iteration) iteration=$2; shift 2;; --eval) evalid=$2; shift 2;;
    --variant) variant=$2; shift 2;; --skills-root) root=$2; shift 2;; --prompt-file) promptfile=$2; shift 2;;
    --target) target=$2; shift 2;; --profile) profile=$2; shift 2;; --timeout) timeout=$2; shift 2;;
    *) echo "unknown option $1" >&2; exit 1;;
  esac
done
for v in workspace iteration evalid variant root promptfile; do [ -n "${!v}" ] || { echo "--${v//evalid/eval} is required" >&2; exit 1; }; done
case "$variant" in old_skill|with_skill) ;; *) echo "variant must be old_skill or with_skill" >&2; exit 1;; esac
[ -d "$root/explainer" ] || { echo "skills root $root has no explainer/" >&2; exit 1; }
command -v opencode >/dev/null || { echo "opencode not on PATH" >&2; exit 1; }
run="$workspace/iteration-$iteration/eval-$evalid/$variant"
mkdir -p "$run/outputs"
root=$(cd "$root" && pwd)
cat > "$run/opencode.json" <<JSON
{ "\$schema": "https://opencode.ai/config.json", "skills": { "paths": ["$root"] } }
JSON
roothash=$(cd "$root" && find explainer codebase-video -type f 2>/dev/null | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-16)
prompt=$(cat "$promptfile")
prompt="$prompt

Production record for this run: $run/outputs (write every artefact, receipt and hand-up packet there). Target repository: $target."
start=$(date -u +%s)
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
set +e
( cd "$target" && OPENCODE_CONFIG="$run/opencode.json" timeout "$timeout" opencode run -m "$profile" --format json --title "eval-$evalid-$variant-i$iteration" "$prompt" ) > "$run/transcript.jsonl" 2> "$run/stderr.log"
status=$?
set -e
end=$(date -u +%s)
session=$(grep -o '"sessionID":"[^"]*"' "$run/transcript.jsonl" | head -1 | cut -d'"' -f4)
tools=$(grep -c '"type":"tool_use"' "$run/transcript.jsonl" || true)
cat > "$run/timing.json" <<JSON
{ "eval": "$evalid", "variant": "$variant", "iteration": $iteration, "profile": "$profile", "skills_root": "$root",
  "skills_root_hash": "$roothash", "session": "${session:-null}", "started": "$started", "wall_seconds": $((end-start)),
  "exit_status": $status, "tool_calls": $tools, "cache": "unrecorded" }
JSON
echo "eval-$evalid $variant: exit $status, $((end-start))s, $tools tool calls, session ${session:-none} → $run"
exit $status
