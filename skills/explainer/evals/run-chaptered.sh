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
# --item-timeout is the fallback for an item that declares no timeout of its own; it defaults
# to 150 minutes because a budget that cuts off honest work teaches nothing. See the budget
# table in references/gates.md for what steps actually cost.
#
# The plan is a JSON array of items:
#   [{ "id": "ch1", "prompt": "…", "needs": ["ch0"], "timeout": 1800,
#      "attach": ["glob", …], "produces": ["glob", …] }, …]
#
# `produces` is what the item is for. A prerequisite is satisfied when the work exists, not
# when the step exited tidily: an item that spends its budget polishing has still produced
# what the next step needs, and treating that as failure skips the steps that would have
# judged it (measured 2026-09-11, where a diagram that passed every gate was followed by two
# skipped items). With `produces`, the runner looks for the artefact; without it, the exit
# status is all there is to go on.
#
# `attach` is how an item SEES something. A model inside a session cannot open an image it
# wrote: the session carries text, and the picture is just a path. Files listed here are
# attached to the item's opening message with opencode's --file flag, so a review item is launched
# already looking at the
# frames it must judge. An item that captures and an item that inspects are therefore always
# two items, never one (measured 2026-09-11: a capture item took seven screenshots, was told
# to look at each, and could not).
# Each item runs in its own `opencode run`, in the target, with the shared production record
# on disk as its only inheritance. An item whose prerequisite failed is skipped, not guessed.
set -euo pipefail
workspace= plan= target= root= profile=loom-agent/current item_timeout=9000 from=1 only=
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

# An agent harness writes a session store, and a long plan writes a lot of it. Here that
# store lives on a 128 MB tmpfs, and a day of runs filled it: the next session died on a
# database checkpoint with "database or disk is full", which looks nothing like the cause
# (2026-09-11). Runs that last hours must check their own headroom and prune, because the
# failure arrives long after the growth and blames the wrong thing.
# Better than pruning a small filesystem is not using one. OpenCode honours XDG_DATA_HOME,
# so the run keeps its session store beside its own output on real disk, where a long plan
# can grow without starving anything else. The home default here is a 128 MB memory
# filesystem shared with other tools, and a day of runs filled it (2026-09-11).
export XDG_DATA_HOME="${XDG_DATA_HOME_OVERRIDE:-$workspace/.store}"
mkdir -p "$XDG_DATA_HOME"
store="$XDG_DATA_HOME/opencode"
mkdir -p "$store"
prune_store() {
  local free_mb
  free_mb=$(df -Pm "$store" 2>/dev/null | awk 'NR==2{print $4}')
  [ -z "$free_mb" ] && return 0
  echo "[$(date -u +%H:%M:%S)] session store: ${free_mb} MB free"
  [ "$free_mb" -ge "${MIN_STORE_MB:-40}" ] && return 0
  echo "[$(date -u +%H:%M:%S)] session store below ${MIN_STORE_MB:-40} MB; pruning"
  find "$store/log" -type f -mtime +0 -delete 2>/dev/null || true
  # The session database is a cache of past conversations, not a deliverable: nothing in a
  # plan reads it. Removing it costs the resume history and buys the run its disk back.
  rm -f "$store"/*.db "$store"/*.db-wal "$store"/*.db-shm 2>/dev/null || true
  echo "[$(date -u +%H:%M:%S)] session store now $(df -Pm "$store" 2>/dev/null | awk 'NR==2{print $4}') MB free"
}


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
trap 'restore; release_lock 2>/dev/null' EXIT
trap 'restore; release_lock 2>/dev/null; exit 143' TERM INT HUP

cfg="$workspace/opencode.json"
cat > "$cfg" <<JSON
{ "\$schema": "https://opencode.ai/config.json",
  "skills": { "paths": ["$root"] },
  "permission": { "edit": "allow", "bash": { "*": "allow", "git push*": "deny", "rm -rf /*": "deny" },
                  "webfetch": "allow",
                  "external_directory": { "*": "allow", "$HOME/.ssh/**": "deny", "$HOME/.aws/**": "deny" } } }
JSON

# One model, one plan at a time. Two plans chained to the same trigger both woke at 02:21
# and shared a single model slot: each managed a third of its usual tool calls, neither
# produced its artefact, and both skipped everything downstream (2026-09-12). Contention
# does not announce itself — it looks exactly like a slow model — so the runner takes a lock
# rather than trusting whoever queued the work to have sequenced it.
lockdir=${PLAN_LOCK:-${TMPDIR:-/tmp}/explainer-plan.lock}
lock_wait=${PLAN_LOCK_WAIT:-14400}
waited=0
until mkdir "$lockdir" 2>/dev/null; do
  holder=$(cat "$lockdir/owner" 2>/dev/null || echo unknown)
  if [ ! -d /proc/"$(cat "$lockdir/pid" 2>/dev/null || echo 0)" ]; then
    echo "[$(date -u +%H:%M:%S)] clearing a lock left by a dead run ($holder)" >&2
    rm -rf "$lockdir"; continue
  fi
  [ "$waited" = 0 ] && echo "[$(date -u +%H:%M:%S)] another plan holds the model ($holder); waiting"
  sleep 30; waited=$((waited+30))
  if [ "$waited" -ge "$lock_wait" ]; then
    echo "[$(date -u +%H:%M:%S)] waited ${lock_wait}s for the model and gave up; $holder still holds it" >&2
    exit 75
  fi
done
printf '%s\n' "$(basename "$plan") in $workspace" > "$lockdir/owner"
printf '%s\n' "$$" > "$lockdir/pid"
release_lock() { rm -rf "$lockdir"; }
[ "$waited" -gt 0 ] && echo "[$(date -u +%H:%M:%S)] model free after ${waited}s; starting"

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
  prune_store
  echo "[$(date -u +%H:%M:%S)] item $n/$count: $id (budget ${budget}s)"
  attach_globs=$(python3 -c "import json,sys; print('\n'.join(json.load(open(sys.argv[1]))[int(sys.argv[2])-1].get('attach',[])))" "$plan" "$n")
  attach_args=()
  # --file is an array option and swallows the following positional, so the prompt goes after --
  if [ -n "$attach_globs" ]; then
    # An attachment has to fit in a request. Nine console captures at 3840px filled the body
    # limit and the server refused the whole thing, leaving the item running blind with no
    # sign in its own output that it could not see (measured 2026-09-12). So images are
    # downscaled into the item's directory first and the batch is capped; anything over the
    # cap is left for a second review item rather than silently dropped from this one.
    mkdir -p "$dir/attached"
    raw=()
    while IFS= read -r g; do
      [ -z "$g" ] && continue
      for f in $g; do [ -f "$f" ] && raw+=("$f"); done
    done <<< "$attach_globs"
    max_attach=${MAX_ATTACH:-8}
    kept=0
    for f in "${raw[@]}"; do
      [ "$kept" -ge "$max_attach" ] && break
      case "$f" in
        *.png|*.jpg|*.jpeg|*.webp)
          small="$dir/attached/$(printf '%02d' $((kept+1)))-$(basename "${f%.*}").jpg"
          if ffmpeg -v error -i "$f" -vf "scale='min(1100,iw)':-2" -q:v 4 "$small" -y 2>/dev/null && [ -s "$small" ]; then
            attach_args+=(-f "$small")
          else
            attach_args+=(-f "$f")
          fi;;
        *) attach_args+=(-f "$f");;
      esac
      kept=$((kept+1))
    done
    echo "[$(date -u +%H:%M:%S)]   $id: attaching $kept of ${#raw[@]} file(s), downscaled for the request body"
    [ "${#raw[@]}" -gt "$max_attach" ] && echo "[$(date -u +%H:%M:%S)]   $id: $(( ${#raw[@]} - max_attach )) file(s) beyond the cap of $max_attach were not attached; give them their own review item"
    printf '%s\n' "${attach_args[@]}" > "$dir/attached.txt"
  fi
  t0=$(date -u +%s); set +e
  ( cd "$target" && OPENCODE_CONFIG="$cfg" timeout "$budget" opencode run -m "$profile" --format json "${attach_args[@]}" -- "$prompt" ) > "$dir/transcript.jsonl" 2> "$dir/stderr.log"
  st=$?; set -e
  # A seeing item with nothing attached is the most dangerous item in a plan: it extracts
  # frames, never sees one, and writes "4 of 4 pass" in the register of someone who looked
  # (measured 2026-09-12, seven clips passed sight unseen). A session cannot fetch an image
  # into its own context, so if the plan did not attach one, the item did not look.
  case "$id" in
    see*|*-see|review*|*-review|vision*)
      if [ "${#attach_args[@]}" = 0 ]; then
        echo "[$(date -u +%H:%M:%S)]   $id: a seeing item with no attachments cannot see; declare them in the plan's attach list" >&2
        set_status "$id" "failed"; continue
      fi;;
  esac
  if [ -s "$dir/transcript.jsonl" ] && grep -q '"ContextOverflowError"\|Payload Too Large' "$dir/transcript.jsonl" 2>/dev/null; then
    echo "[$(date -u +%H:%M:%S)]   $id: the attachments were refused as too large; this item judged nothing it could see" >&2
    st=65
  fi
  if [ "$st" = 124 ]; then
    mkdir -p "$record/handup"
    python3 "$(dirname "$0")/handup-budget.py" "$record/handup/$id-budget.json" "$id" "$budget" "$dir"
    echo "[$(date -u +%H:%M:%S)]   $id: budget spent without its artefact; hand-up packet written"
  fi
  secs=$(( $(date -u +%s) - t0 ))
  tools=$( { grep -c '"type":"tool_use"' "$dir/transcript.jsonl" || true; } | tail -1 )
  printf '{ "id": "%s", "exit": %s, "wall_seconds": %s, "tool_calls": %s, "profile": "%s", "skills_root": "%s" }\n' \
    "$id" "$st" "$secs" "${tools:-0}" "$profile" "$root" > "$dir/timing.json"
  produced_globs=$(python3 -c "import json,sys; print('\n'.join(json.load(open(sys.argv[1]))[int(sys.argv[2])-1].get('produces',[])))" "$plan" "$n")
  produced=0
  if [ -n "$produced_globs" ]; then
    produced=1
    while IFS= read -r g; do
      [ -z "$g" ] && continue
      found=0
      for f in $g; do [ -s "$f" ] && found=1; done
      [ "$found" = 0 ] && produced=0
    done <<< "$produced_globs"
  fi
  if [ "$st" = 0 ]; then
    set_status "$id" "done"
  elif [ "$produced" = 1 ]; then
    set_status "$id" "done"
    echo "[$(date -u +%H:%M:%S)]   $id: exited $st but produced what it was for; counting it done"
  else
    set_status "$id" "failed"
  fi
  echo "[$(date -u +%H:%M:%S)]   $id: exit $st, ${secs}s, ${tools:-0} tool calls"
done
echo "[$(date -u +%H:%M:%S)] [plan done]"
python3 -c "import json;print(json.dumps(json.load(open('$workspace/items/status.json')),indent=2))" 2>/dev/null || true
