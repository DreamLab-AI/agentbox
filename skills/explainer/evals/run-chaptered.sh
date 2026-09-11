#!/usr/bin/env bash
# Drive a long explainer as a sequence of bounded sessions, one per work item, instead of
# one session that must hold the whole job in context.
#
# Three runs of a single-session harness on a local model ended the same way: an hour of
# research, one or two chapters, then a context that had grown past the point where the run
# could still act, and no media at all. Nothing was failing; the session simply could not
# hold the job. A work item that starts fresh, reads what previous items wrote from disk,
# does one thing and exits keeps every session small, and a failed item costs one item.
#
#   run-chaptered.sh --workspace DIR --plan FILE --target DIR --skills-root DIR
#                    [--profile provider/model] [--item-timeout SECONDS] [--from N] [--only N]
#
# The plan is a JSON array of items:
#   [{ "id": "ch1", "prompt": "…", "needs": ["ch0"], "timeout": 1800, "attach": ["glob", …] }, …]
#
# `attach` is how an item SEES something. A model inside a session cannot open an image it
# wrote: the session carries text, and the picture is just a path. Files listed here are
# attached to the item's opening message, so a review item is launched already looking at the
# frames it must judge. An item that captures and an item that inspects are therefore always
# two items, never one (measured 2026-09-11: a capture item took seven screenshots, was told
# to look at each, and could not).
# Each item runs in its own `opencode run`, in the target, with the shared production record
# on disk as its only inheritance. An item whose prerequisite failed is skipped, not guessed.
set -euo pipefail
workspace= plan= target= root= profile=loom-agent/current item_timeout=5400 from=1 only=
while [ $# -gt 0 ]; do
  case "$1" in
    --workspace) workspace=$2; shift 2;; --plan) plan=$2; shift 2;; --target) target=$2; shift 2;;
    --skills-root) root=$2; shift 2;; --profile) profile=$2; shift 2;;
    --item-timeout) item_timeout=$2; shift 2;; --from) from=$2; shift 2;; --only) only=$2; shift 2;;
    *) echo "unknown option $1" >&2; exit 2;;
  esac
done
for v in workspace plan target root; do [ -n "${!v}" ] || { echo "--$v is required" >&2; exit 2; }; done
[ -f "$plan" ] || { echo "plan not found: $plan" >&2; exit 2; }
command -v opencode >/dev/null || { echo "opencode not on PATH" >&2; exit 2; }
mkdir -p "$workspace"; workspace=$(cd "$workspace" && pwd); root=$(cd "$root" && pwd); target=$(cd "$target" && pwd)
record="$workspace/record"; mkdir -p "$record" "$workspace/items"

# Pin the skill root the way run-case.sh does: OpenCode keeps the first copy of a skill name
# and reads ~/.claude/skills first, so the hot links point at this root for the whole plan.
hot="$HOME/.claude/skills"; mkdir -p "$hot"
declare -A prev
restore() { for s in "${!prev[@]}"; do if [ -n "${prev[$s]}" ]; then ln -sfn "${prev[$s]}" "$hot/$s"; else rm -f "$hot/$s"; fi; done; }
for s in explainer codebase-video; do
  [ -d "$root/$s" ] || continue
  if [ -L "$hot/$s" ]; then prev[$s]=$(readlink "$hot/$s"); elif [ -e "$hot/$s" ]; then echo "$hot/$s is a real directory; refusing" >&2; exit 1; else prev[$s]=""; fi
  ln -sfn "$root/$s" "$hot/$s"
done
trap restore EXIT
trap 'restore; exit 143' TERM INT HUP

cfg="$workspace/opencode.json"
cat > "$cfg" <<JSON
{ "\$schema": "https://opencode.ai/config.json",
  "skills": { "paths": ["$root"] },
  "permission": { "edit": "allow", "bash": { "*": "allow", "git push*": "deny", "rm -rf /*": "deny" },
                  "webfetch": "allow",
                  "external_directory": { "*": "allow", "$HOME/.ssh/**": "deny", "$HOME/.aws/**": "deny" } } }
JSON

count=$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))))" "$plan")
echo "plan: $count item(s); record $record"
status_of() { python3 - "$workspace/items/status.json" "$1" <<'PY'
import json,os,sys
p,i=sys.argv[1],sys.argv[2]
d=json.load(open(p)) if os.path.exists(p) else {}
print(d.get(i,"pending"))
PY
}
set_status() { python3 - "$workspace/items/status.json" "$1" "$2" <<'PY'
import json,os,sys
p,i,v=sys.argv[1],sys.argv[2],sys.argv[3]
d=json.load(open(p)) if os.path.exists(p) else {}
d[i]=v; json.dump(d,open(p,"w"),indent=2)
PY
}

for n in $(seq 1 "$count"); do
  [ -n "$only" ] && [ "$n" != "$only" ] && continue
  [ "$n" -lt "$from" ] && continue
  id=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[int(sys.argv[2])-1]['id'])" "$plan" "$n")
  needs=$(python3 -c "import json,sys; print(' '.join(json.load(open(sys.argv[1]))[int(sys.argv[2])-1].get('needs',[])))" "$plan" "$n")
  blocked=
  for d in $needs; do [ "$(status_of "$d")" = "done" ] || blocked="$blocked $d"; done
  if [ -n "$blocked" ]; then
    echo "[$(date -u +%H:%M:%S)] skip $id — prerequisite not done:$blocked"
    set_status "$id" "skipped"; continue
  fi
  dir="$workspace/items/$id"; mkdir -p "$dir"
  prompt=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[int(sys.argv[2])-1]['prompt'])" "$plan" "$n")
  prompt="$prompt

You are one step of a larger job. Everything earlier steps produced is on disk; read what you need from the production record at $record and the target at $target, and do not try to reproduce their work. Write what you produce to the target, and write your own receipts and any hand-up packets to $record. Do one thing: the step above, and nothing beyond it. When it is done, stop."
  # A per-item deadline is the only clock the run actually has. An instruction to hand up
  # after twenty minutes cannot work: a model inside a session has no wall clock, and one
  # deep in a rabbit hole is the last thing able to notice it is in one (measured
  # 2026-09-11: an item spent forty minutes debugging its own protocol client instead of
  # taking the screenshot it was asked for). The harness enforces the budget and writes the
  # packet, so the plan moves on and a person sees what was missing.
  budget=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[int(sys.argv[2])-1].get('timeout', $item_timeout))" "$plan" "$n")
  echo "[$(date -u +%H:%M:%S)] item $n/$count: $id (budget ${budget}s)"
  attach_globs=$(python3 -c "import json,sys; print('\n'.join(json.load(open(sys.argv[1]))[int(sys.argv[2])-1].get('attach',[])))" "$plan" "$n")
  attach_args=()
  if [ -n "$attach_globs" ]; then
    while IFS= read -r g; do
      [ -z "$g" ] && continue
      for f in $g; do [ -f "$f" ] && attach_args+=(-f "$f"); done
    done <<< "$attach_globs"
    echo "[$(date -u +%H:%M:%S)]   $id: attaching ${#attach_args[@]} file argument(s)"
    printf '%s\n' "${attach_args[@]}" > "$dir/attached.txt"
  fi
  t0=$(date -u +%s); set +e
  ( cd "$target" && OPENCODE_CONFIG="$cfg" timeout "$budget" opencode run -m "$profile" --format json "${attach_args[@]}" "$prompt" ) > "$dir/transcript.jsonl" 2> "$dir/stderr.log"
  st=$?; set -e
  if [ "$st" = 124 ]; then
    mkdir -p "$record/handup"
    python3 "$(dirname "$0")/handup-budget.py" "$record/handup/$id-budget.json" "$id" "$budget" "$dir"
    echo "[$(date -u +%H:%M:%S)]   $id: budget spent without its artefact; hand-up packet written"
  fi
  secs=$(( $(date -u +%s) - t0 ))
  tools=$( { grep -c '"type":"tool_use"' "$dir/transcript.jsonl" || true; } | tail -1 )
  printf '{ "id": "%s", "exit": %s, "wall_seconds": %s, "tool_calls": %s, "profile": "%s", "skills_root": "%s" }\n' \
    "$id" "$st" "$secs" "${tools:-0}" "$profile" "$root" > "$dir/timing.json"
  if [ "$st" = 0 ]; then set_status "$id" "done"; else set_status "$id" "failed"; fi
  echo "[$(date -u +%H:%M:%S)]   $id: exit $st, ${secs}s, ${tools:-0} tool calls"
done
echo "[$(date -u +%H:%M:%S)] [plan done]"
python3 -c "import json;print(json.dumps(json.load(open('$workspace/items/status.json')),indent=2))" 2>/dev/null || true
