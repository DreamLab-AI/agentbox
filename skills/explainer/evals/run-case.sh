#!/usr/bin/env bash
# Run one eval case on the local production model with a pinned skill root.
#
#   run-case.sh --workspace DIR --iteration N --eval ID --variant old_skill|with_skill \
#               --skills-root DIR --prompt-file FILE [--target DIR] [--profile provider/model]
#               [--timeout SECONDS] [--startup-timeout SECONDS] [--startup-attempts N] [--allow DIR]...
#               [--target-seed DIR --target-subdir REL]
#
# Writes <workspace>/iteration-N/eval-ID/<variant>/{outputs,transcript.jsonl,timing.json,opencode.json}.
# Set RUN_CASE_DEBUG=1 to keep OpenCode's debug log in stderr.log.
# Resume a run's session with: opencode run --session <id> -m <profile> ... (same HOME).
# The production record for the run is outputs/; the prompt should tell the model to work there.
set -euo pipefail
workspace= iteration= evalid= variant= root= promptfile= target=$PWD profile=loom-agent/current timeout=14400; allow_dirs=(); target_seed= target_subdir=
while [ $# -gt 0 ]; do
  case "$1" in
    --workspace) workspace=$2; shift 2;; --iteration) iteration=$2; shift 2;; --eval) evalid=$2; shift 2;;
    --variant) variant=$2; shift 2;; --skills-root) root=$2; shift 2;; --prompt-file) promptfile=$2; shift 2;;
    --target) target=$2; shift 2;; --profile) profile=$2; shift 2;; --timeout) timeout=$2; shift 2;;
    --startup-timeout) startup_timeout=$2; shift 2;; --startup-attempts) startup_attempts=$2; shift 2;;
    --allow) allow_dirs+=("$2"); shift 2;;
    --target-seed) target_seed=$2; shift 2;; --target-subdir) target_subdir=$2; shift 2;;
    *) echo "unknown option $1" >&2; exit 1;;
  esac
done
for v in workspace iteration evalid variant root promptfile; do [ -n "${!v}" ] || { echo "--${v//evalid/eval} is required" >&2; exit 1; }; done
case "$variant" in old_skill|with_skill) ;; *) echo "variant must be old_skill or with_skill" >&2; exit 1;; esac
[ -d "$root/explainer" ] || { echo "skills root $root has no explainer/" >&2; exit 1; }
command -v opencode >/dev/null || { echo "opencode not on PATH" >&2; exit 1; }
workspace=$(mkdir -p "$workspace" && cd "$workspace" && pwd)
run="$workspace/iteration-$iteration/eval-$evalid/$variant"
mkdir -p "$run/outputs"
root=$(cd "$root" && pwd)
# OpenCode discovers skills from $HOME/.claude/skills before the project walk-up, the
# Codex skills dir and skills.paths, and the first copy of a name wins. A sandbox HOME
# stalls in OpenCode's embedded package manager (measured 2026-09-10), so pinning is done
# in place: the hot-copy symlinks in ~/.claude/skills point at the run root for the
# duration of the run and are restored afterwards. Runs are serialised anyway.
hot="$HOME/.claude/skills"; mkdir -p "$hot"
declare -A prev
restore() { for s in "${!prev[@]}"; do if [ -n "${prev[$s]}" ]; then ln -sfn "${prev[$s]}" "$hot/$s"; else rm -f "$hot/$s"; fi; done; }
for s in explainer codebase-video; do
  [ -d "$root/$s" ] || continue
  if [ -L "$hot/$s" ]; then prev[$s]=$(readlink "$hot/$s"); elif [ -e "$hot/$s" ]; then echo "$hot/$s is a real directory, not a symlink; refusing to replace it" >&2; exit 1; else prev[$s]=""; fi
  ln -sfn "$root/$s" "$hot/$s"
done
trap restore EXIT
# Non-interactive `opencode run` auto-rejects every permission it would normally ask for,
# and the model then stops after its first step (measured 2026-09-10: the fact sheet outside
# the target was refused as an external directory). An unattended production run needs edit,
# bash and reads of the engagement workspace allowed; pushing and recursive deletes stay denied.
allow_json=""
for d in "$workspace" "$(cd "$(dirname "$promptfile")" && pwd)" "$root" "${allow_dirs[@]}"; do allow_json="$allow_json, \"$d/**\": \"allow\""; done
allow_json=${allow_json#, }
cat > "$run/opencode.json" <<JSON
{ "\$schema": "https://opencode.ai/config.json",
  "skills": { "paths": ["$root"] },
  "permission": {
    "edit": "allow",
    "bash": { "*": "allow", "git push*": "deny", "rm -rf *": "deny" },
    "webfetch": "allow",
    "external_directory": { $allow_json }
  } }
JSON
roothash=$(cd "$root" && find explainer codebase-video -type f 2>/dev/null | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-16)
prompt=$(cat "$promptfile")
prompt="$prompt

Production record for this run: $run/outputs (write every artefact, receipt and hand-up packet there). Target repository: $target."
# OpenCode 1.17.18 in this container intermittently stalls before creating a session
# (no event for minutes, in ~10-minute windows; cause not yet identified, 2026-09-10). A
# stall before the first event has cost nothing, so watch for the first transcript line
# and relaunch after --startup-timeout seconds, up to --startup-attempts times.
startup_timeout=${startup_timeout:-90}; startup_attempts=${startup_attempts:-8}
# A run that writes its deliverable into the target mutates shared state, and the next
# variant would start from the previous one's chapters. When a seed is given, the deliverable
# directory is reset to it before the run and archived to target-after/ afterwards, so every
# variant starts from identical inputs and the target is left as it was found.
if [ -n "$target_seed" ] && [ -n "$target_subdir" ]; then
  [ -d "$target_seed" ] || { echo "--target-seed $target_seed not found" >&2; exit 1; }
  case "$target_subdir" in /*|*..*|"") echo "--target-subdir must be a relative path inside the target" >&2; exit 1;; esac
  [ "$(tr -cd / <<<"$target_subdir" | wc -c)" -ge 1 ] || { echo "--target-subdir must be at least two segments deep (got $target_subdir)" >&2; exit 1; }
  seed_dest="$target/$target_subdir"
  rm -rf "$seed_dest"; mkdir -p "$seed_dest"; cp -r "$target_seed/." "$seed_dest/"
  archive_target() {
    mkdir -p "$run/target-after"; cp -r "$seed_dest/." "$run/target-after/" 2>/dev/null || true
    rm -rf "$seed_dest"; mkdir -p "$seed_dest"; cp -r "$target_seed/." "$seed_dest/"
  }
  trap 'restore; archive_target' EXIT
fi

start=$(date -u +%s)
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
attempt=0; status=124; launches=()
while [ $attempt -lt "$startup_attempts" ]; do
  attempt=$((attempt+1)); t0=$(date -u +%s); : > "$run/transcript.jsonl"
  ( cd "$target" && OPENCODE_CONFIG="$run/opencode.json" exec timeout "$timeout" opencode run -m "$profile" --format json ${RUN_CASE_DEBUG:+--print-logs --log-level DEBUG} "$prompt" ) > "$run/transcript.jsonl" 2>> "$run/stderr.log" &
  child=$!
  while kill -0 $child 2>/dev/null; do
    if [ -s "$run/transcript.jsonl" ]; then break; fi
    if [ $(( $(date -u +%s) - t0 )) -ge "$startup_timeout" ]; then
      echo "attempt $attempt: no event after ${startup_timeout}s; relaunching" >&2
      kill -TERM $child 2>/dev/null; sleep 2; kill -KILL $child 2>/dev/null; break
    fi
    sleep 2
  done
  if [ -s "$run/transcript.jsonl" ] || ! kill -0 $child 2>/dev/null; then
    set +e; wait $child; status=$?; set -e
    launches+=("{\"attempt\":$attempt,\"seconds\":$(( $(date -u +%s) - t0 )),\"stalled\":false,\"exit\":$status}")
    break
  fi
  set +e; wait $child 2>/dev/null; set -e
  launches+=("{\"attempt\":$attempt,\"seconds\":$(( $(date -u +%s) - t0 )),\"stalled\":true}")
  sleep 30
done
end=$(date -u +%s)
session=$( { grep -o '"sessionID":"[^"]*"' "$run/transcript.jsonl" || true; } | head -1 | cut -d'"' -f4)
tools=$( { grep -c '"type":"tool_use"' "$run/transcript.jsonl" || true; } | tail -1)
tools=${tools:-0}
cat > "$run/timing.json" <<JSON
{ "eval": "$evalid", "variant": "$variant", "iteration": $iteration, "profile": "$profile", "skills_root": "$root",
  "skills_root_hash": "$roothash", "pinned_via": "$hot/{explainer,codebase-video}", "target_seed": "${target_seed:-none}", "session": "${session:-null}", "started": "$started", "wall_seconds": $((end-start)),
  "exit_status": $status, "tool_calls": $tools, "launches": [$(IFS=,; echo "${launches[*]}")], "cache": "unrecorded" }
JSON
echo "eval-$evalid $variant: exit $status, $((end-start))s, $tools tool calls, session ${session:-none} → $run"
exit $status
