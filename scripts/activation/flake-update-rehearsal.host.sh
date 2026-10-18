#!/usr/bin/env bash
# X-4 flake-update rehearsal, HOST side (estate TODO register X-4; ADR-2071 consumer).
#
# The weekly .github/workflows/nix-flake-update.yml force-pushes `deps/nix-flake-update`. Nothing
# used to boot it, and two flake updates merged unrehearsed. This script does, on the host:
#
#   1. fetch the branch into a THROWAWAY git worktree (never the live checkout); refuse if absent
#   2. build the image from that worktree with the repo's own entry point (`nix build .#runtime`,
#      as `./agentbox.sh up --build` does) and load it under a distinct tag
#      agentbox:rehearsal-<sha12>. It deliberately does NOT use `.#runtime.copyToDockerDaemon`,
#      which writes agentbox:runtime-<system>, the tag the live compose service runs
#   3. boot it as a throwaway container (name agentbox-rehearsal-<sha12>) on its own --internal
#      network: no published port, no live workspace, no secrets volume, a random management-api
#      key. Only the branch's own agentbox.toml is bound (read-only), plus tmpfs for the paths the
#      image expects (see BOOT INPUTS below)
#   4. wait for management-api, then collect per-gate pass/fail:
#        build, boot             did the image build and the container stay up
#        ready                   GET /ready (bootstrap, adapters, paths)
#        unit:<catalogue-id>     declared-vs-running, as scripts/ci/check-declared-vs-running.js
#                                judges it, from GET /v1/system and `supervisorctl status` run
#                                inside the container. A unit this box cannot read (a compose
#                                sidecar) is `not_evaluable`, never a pass
#      and write docs/estate-closeout/x4-rehearsal-<UTC>.json (schema/x4-rehearsal.schema.json)
#   5. with --journal, and when the LIVE management-api answers, POST one /v1/exec/record
#      (harness flake-rehearsal, type tool.completed, key <session>:<gate>) per gate. The live
#      journal is the only chain-safe writer (ADR-2071); a failed post is counted, never fatal
#   6. tear down the container, network and image unless --keep; the worktree always goes
#
# Verdict and exit code:  0 PASS (every gate passes)   1 FAIL (a build, boot or gate failed)
#                         2 STAGED (built and booted, some gates not evaluable)
#                         3 could not run (branch absent, no docker/nix, container, bad inputs)
#
# BOOT INPUTS (read from entrypoint-unified.sh and docker-compose.yml): the image bakes everything
# but /etc/agentbox.toml (compose binds it), so the branch's agentbox.toml is bound read-only;
# MANAGEMENT_API_KEY is mandatory (management-api exits without it); /home/devuser/workspace,
# /var/lib/ruvector, /var/lib/solid, /var/lib/agentbox and /var/lib/nostr-relay are tmpfs so
# /ready's path checks can pass without touching a live volume. No ruvector-postgres, GPU or
# sidecar is started, so gates that need them are not_evaluable or fail honestly.
#
#   --branch NAME      default deps/nix-flake-update
#   --remote NAME      default origin
#   --boot-timeout S   default 600
#   --keep             keep container, network and image for inspection
#   --journal          POST per-gate entries to the LIVE management-api
#   --live-url URL     default http://127.0.0.1:9090 (the live box; key from $MANAGEMENT_API_KEY)
#   --receipt-dir DIR  default docs/estate-closeout of this checkout
#   --allow-dirty      run although scripts/activation differs from HEAD
#
# Test seams (tests/config/flake-update-rehearsal.test.sh): XR_DOCKER, XR_GIT, XR_CURL, XR_NIX,
# XR_TEST_ROOT (skips the in-container and docker/nix presence guards; only for fakes),
# XR_ASSUME_CONTAINER=1 (adds the in-container refusal), XR_POLL (poll seconds, default 5).

# jq programs are jq's, not the shell's.
# shellcheck disable=SC2016

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DOCKER="${XR_DOCKER:-docker}"
GIT="${XR_GIT:-git}"
CURL="${XR_CURL:-curl}"
NIX="${XR_NIX:-nix}"
POLL="${XR_POLL:-5}"
BRANCH=deps/nix-flake-update
REMOTE=origin
BOOT_TIMEOUT=600
KEEP=0; JOURNAL=0; ALLOW_DIRTY=0
LIVE_URL=http://127.0.0.1:9090
RECEIPT_DIR="$REPO/docs/estate-closeout"

# Mirrors scripts/ci/check-declared-vs-running.js (tests assert the sets are equal).
ONESHOT="tmux-autostart setup bootstrap bootstrap-seal tailscale-up"
LIVE_STATES="RUNNING STARTING BACKOFF"
ON_DEMAND="setup-wizard"

die() { echo "flake-update-rehearsal.host: $*" >&2; exit 3; }

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:?--branch needs a name}"; shift ;;
    --remote) REMOTE="${2:?--remote needs a name}"; shift ;;
    --boot-timeout) BOOT_TIMEOUT="${2:?--boot-timeout needs seconds}"; shift ;;
    --live-url) LIVE_URL="${2:?--live-url needs a URL}"; shift ;;
    --receipt-dir) RECEIPT_DIR="${2:?--receipt-dir needs a directory}"; shift ;;
    --keep) KEEP=1 ;;
    --journal) JOURNAL=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help) sed -n '2,/^set -uo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument '$1'" ;;
  esac
  shift
done
case "$BOOT_TIMEOUT" in ''|*[!0-9]*) die "--boot-timeout must be whole seconds" ;; esac

in_container() {
  [ "${XR_ASSUME_CONTAINER:-}" = 1 ] && return 0
  [ -e /.dockerenv ] || [ -e /run/.containerenv ] && return 0
  grep -qE '(docker|containerd|kubepods|libpod)' /proc/1/cgroup 2>/dev/null
}
if [ -z "${XR_TEST_ROOT:-}" ]; then
  in_container && die "this is a host script: run it from the host shell, never from inside the container (a build there bakes stale code)"
  command -v "$NIX" >/dev/null 2>&1 || die "nix is not on PATH"
  command -v jq >/dev/null 2>&1 || die "jq is not on PATH"
  "$DOCKER" info >/dev/null 2>&1 || die "cannot reach the docker daemon"
  if [ "$ALLOW_DIRTY" = 0 ] && ! "$GIT" -C "$REPO" diff --quiet HEAD -- scripts/activation 2>/dev/null; then
    die "scripts/activation differs from HEAD; review 'git -C $REPO diff HEAD -- scripts/activation', then pass --allow-dirty"
  fi
fi
[ "${XR_ASSUME_CONTAINER:-}" = 1 ] && die "this is a host script: run it from the host shell, never from inside the container"
mkdir -p "$RECEIPT_DIR" || die "cannot create $RECEIPT_DIR"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/x4-rehearsal.XXXXXX")" || die "mktemp failed"
WT="$WORK/worktree"
ROWS="$WORK/rows.jsonl"; : >"$ROWS"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SHA=unknown; SHA12=unknown; TAG=""; CNAME=""; NET=""; WT_ADDED=0; IMAGE_LOADED=0; NET_MADE=0; CTR_MADE=0
LIVE_TAG_BEFORE=""; LIVE_TAG_AFTER=""; NOTE=""
API_KEY="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

row() { # row <gate> <pass|fail|not_evaluable> <detail> [evidence-json]
  jq -nc --arg g "$1" --arg v "$2" --arg d "$3" --argjson e "${4:-null}" '{gate:$g,verdict:$v,detail:$d,evidence:($e // {})}' >>"$ROWS"
}
log() { echo "x4: $*"; }
redact() { sed "s/$API_KEY/<rehearsal-key>/g"; }

teardown() {
  # The worktree always goes; container, network and image go unless --keep.
  if [ "$KEEP" = 0 ]; then
    [ "$CTR_MADE" = 1 ] && "$DOCKER" rm -fv "$CNAME" >/dev/null 2>&1
    [ "$NET_MADE" = 1 ] && "$DOCKER" network rm "$NET" >/dev/null 2>&1
    [ "$IMAGE_LOADED" = 1 ] && "$DOCKER" rmi -f "$TAG" >/dev/null 2>&1
  elif [ "$CTR_MADE$IMAGE_LOADED" != 00 ]; then
    log "--keep: container $CNAME, network $NET, image $TAG left in place; remove with: $DOCKER rm -fv $CNAME; $DOCKER network rm $NET; $DOCKER rmi -f $TAG"
  fi
  if [ "$WT_ADDED" = 1 ]; then
    "$GIT" -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1
    "$GIT" -C "$REPO" worktree prune >/dev/null 2>&1
  fi
  rm -rf "$WORK"
}
trap teardown EXIT

journal_post() { # journal_post <session> -> sets JOURNAL_JSON
  local session="$1" key="${MANAGEMENT_API_KEY:-}" posted=0 failed=0 consec=0 status=posted reason="" code body
  if [ "$JOURNAL" = 0 ]; then JOURNAL_JSON='{"requested":false,"status":"not_requested","posted":0,"failed":0}'; return; fi
  if [ -z "$key" ]; then
    status=skipped; reason="MANAGEMENT_API_KEY is not set in the environment of this script"
  elif ! "$CURL" -fsS --max-time 3 -o /dev/null "$LIVE_URL/health" 2>/dev/null; then
    status=unreachable; reason="live management-api did not answer $LIVE_URL/health"
  else
    while IFS= read -r r; do
      [ "$consec" -ge 3 ] && { failed=$((failed + 1)); continue; }
      body="$(jq -nc --arg s "$session" --arg b "$BRANCH" --arg sha "$SHA" --arg tag "$TAG" --argjson r "$r" \
        '{session:$s, harness:"flake-rehearsal", type:"tool.completed", turn:0, key:($s + ":" + $r.gate),
          privacy_class:"internal", payload:{gate:$r.gate, verdict:$r.verdict, detail:$r.detail, branch:$b, sha:$sha, image_tag:$tag}}')"
      code="$("$CURL" -sS --max-time 5 -o /dev/null -w '%{http_code}' -X POST "$LIVE_URL/v1/exec/record" \
        -H "Authorization: Bearer $key" -H 'Content-Type: application/json' --data-binary "$body" 2>/dev/null)"
      if [ "$code" = 201 ]; then posted=$((posted + 1)); consec=0; else failed=$((failed + 1)); consec=$((consec + 1)); reason="last status ${code:-none}"; fi
    done < <(jq -c '.[]' <<<"$ROWS_JSON")
    [ "$failed" -gt 0 ] && status=partial
    [ "$posted" = 0 ] && [ "$failed" -gt 0 ] && status=failed
  fi
  JOURNAL_JSON="$(jq -nc --arg st "$status" --arg r "$reason" --argjson p "$posted" --argjson f "$failed" --arg u "$LIVE_URL" --arg s "$session" \
    '{requested:true, status:$st, posted:$p, failed:$f, live_url:$u, session:$s} + (if $r == "" then {} else {reason:$r} end)')"
}

finish() { # finish <VERDICT> <code> [reason]
  local verdict="$1" code="$2" reason="${3:-}" finished session receipt
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  session="x4-$(date -u -d "$finished" +%Y%m%dT%H%M%SZ)-$SHA12"
  ROWS_JSON="$(jq -sc '.' "$ROWS")"
  journal_post "$session"
  LIVE_TAG_AFTER="$("$DOCKER" image inspect "agentbox:runtime-${SYSTEM_TAG:-x86_64-linux}" --format '{{.Id}}' 2>/dev/null || true)"
  LIVE_UNTOUCHED=true
  [ -n "$LIVE_TAG_BEFORE" ] && [ "$LIVE_TAG_BEFORE" != "$LIVE_TAG_AFTER" ] && LIVE_UNTOUCHED=false
  receipt="$RECEIPT_DIR/x4-rehearsal-$(date -u -d "$finished" +%Y%m%dT%H%M%SZ).json"
  jq -n --arg verdict "$verdict" --argjson code "$code" --arg reason "$reason" --arg branch "$BRANCH" --arg sha "$SHA" \
    --arg tag "$TAG" --arg cname "$CNAME" --arg s "$STARTED" --arg f "$finished" --argjson keep "$([ "$KEEP" = 1 ] && echo true || echo false)" \
    --arg commit "$("$GIT" -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)" --argjson rows "$ROWS_JSON" --argjson journal "$JOURNAL_JSON" \
    --argjson untouched "$LIVE_UNTOUCHED" --arg op "$(id -un 2>/dev/null || echo unknown)" --argjson timeout "$BOOT_TIMEOUT" '{
      schema: "agentbox/x4-rehearsal@1",
      verdict: $verdict, exit_code: $code,
      branch: $branch, branch_sha: $sha,
      image_tag: $tag, container: $cname, kept: $keep,
      live_image_untouched: $untouched,
      rehearsal_commit: $commit, boot_timeout_s: $timeout,
      started_at: $s, finished_at: $f, operator: $op,
      gates: $rows,
      summary: {
        pass: ([$rows[] | select(.verdict == "pass")] | length),
        fail: ([$rows[] | select(.verdict == "fail")] | length),
        not_evaluable: ([$rows[] | select(.verdict == "not_evaluable")] | length),
        failed_gates: [$rows[] | select(.verdict == "fail") | .gate],
        unevaluated_gates: [$rows[] | select(.verdict == "not_evaluable") | .gate]
      },
      journal: $journal
    } + (if $reason == "" then {} else {reason: $reason} end)' >"$receipt" || { echo "cannot write $receipt" >&2; exit 3; }
  jq -r '.gates[] | "  \(if .verdict == "pass" then "ok  " elif .verdict == "fail" then "FAIL" else "n/e " end) \(.gate) — \(.detail)"' "$receipt"
  echo
  jq -r '"verdict \(.verdict) (exit \(.exit_code)): \(.summary.pass) pass, \(.summary.fail) fail, \(.summary.not_evaluable) not evaluable; journal \(.journal.status)"' "$receipt"
  echo "receipt ${receipt#"$REPO"/}"
  teardown_and_exit "$code"
}
teardown_and_exit() { teardown; trap - EXIT; exit "$1"; }

# ── 1. the branch, in a throwaway worktree ─────────────────────────────────────────────────
log "checking $REMOTE/$BRANCH"
if ! "$GIT" -C "$REPO" ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
  row branch fail "branch $BRANCH is absent on $REMOTE (the weekly workflow has not pushed one, or there were no changes)"
  finish COULD_NOT_RUN 3 "branch $BRANCH absent on $REMOTE"
fi
"$GIT" -C "$REPO" fetch --quiet "$REMOTE" "$BRANCH" >/dev/null 2>&1 || { row branch fail "git fetch $REMOTE $BRANCH failed"; finish COULD_NOT_RUN 3 "fetch failed"; }
SHA="$("$GIT" -C "$REPO" rev-parse FETCH_HEAD 2>/dev/null)"
case "$SHA" in [0-9a-f]*) ;; *) row branch fail "could not resolve the fetched commit"; finish COULD_NOT_RUN 3 "unresolved sha" ;; esac
SHA12="${SHA:0:12}"; TAG="agentbox:rehearsal-$SHA12"; CNAME="agentbox-rehearsal-$SHA12"; NET="agentbox-rehearsal-$SHA12"
if ! "$GIT" -C "$REPO" worktree add --detach "$WT" "$SHA" >/dev/null 2>&1; then
  row branch fail "could not create the throwaway worktree"; finish COULD_NOT_RUN 3 "worktree add failed"
fi
WT_ADDED=1
row branch pass "fetched $BRANCH at $SHA12 into a throwaway worktree"

# Guard evidence: the live image tag must be byte-identical before and after.
SYSTEM_TAG="$("$DOCKER" version --format '{{.Server.Os}}/{{.Server.Arch}}' 2>/dev/null | sed 's|linux/amd64|x86_64-linux|;s|linux/arm64|aarch64-linux|')"
LIVE_TAG_BEFORE="$("$DOCKER" image inspect "agentbox:runtime-${SYSTEM_TAG:-x86_64-linux}" --format '{{.Id}}' 2>/dev/null || true)"

# ── 2. build and load under the throwaway tag ──────────────────────────────────────────────
log "building $TAG from the worktree (nix build .#runtime)"
if ! "$NIX" build "$WT#runtime" --out-link "$WORK/result" >"$WORK/build.log" 2>&1; then
  row build fail "nix build .#runtime failed" "$(jq -nc --arg t "$(tail -n 15 "$WORK/build.log" | redact)" '{log_tail:$t}')"
  finish FAIL 1 "build failed"
fi
if ! "$NIX" run "$WT#runtime.copyTo" -- "docker-daemon:$TAG" >>"$WORK/build.log" 2>&1 \
   || ! "$DOCKER" image inspect "$TAG" >/dev/null 2>&1; then
  row build fail "built, but loading as $TAG failed" "$(jq -nc --arg t "$(tail -n 15 "$WORK/build.log" | redact)" '{log_tail:$t}')"
  finish FAIL 1 "image load failed"
fi
IMAGE_LOADED=1
row build pass "nix build .#runtime and load as $TAG succeeded"

# ── 3. boot, isolated ──────────────────────────────────────────────────────────────────────
[ -r "$WT/agentbox.toml" ] || { row boot fail "worktree has no agentbox.toml"; finish FAIL 1 "no manifest"; }
"$DOCKER" network create --internal "$NET" >/dev/null 2>&1 && NET_MADE=1
RUN=(run -d --name "$CNAME" --network "$NET" --hostname agentbox-rehearsal
  --read-only --cap-drop ALL
  --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE --cap-add AUDIT_WRITE --cap-add KILL --cap-add SETUID --cap-add SETGID --cap-add NET_ADMIN
  --security-opt no-new-privileges:true --security-opt "seccomp=$WT/config/seccomp-agentbox.json"
  -v "$WT/agentbox.toml:/etc/agentbox.toml:ro"
  -e "MANAGEMENT_API_KEY=$API_KEY" -e MANAGEMENT_API_AUTH_MODE=hybrid -e AGENTBOX_AGENT_ID=agentbox-rehearsal
  -e NOSTR_RELAYS= -e AGENTBOX_OTLP_ENDPOINT=
  --tmpfs /tmp:mode=1777,size=2G --tmpfs /run:mode=755,size=256M,uid=1000,gid=1000
  --tmpfs /run/secrets:mode=711,size=8M,uid=0,gid=0,noexec,nosuid,nodev
  --tmpfs /var/run:mode=755,size=16M,uid=1000,gid=1000 --tmpfs /var/log:mode=755,size=128M,uid=1000,gid=1000
  --tmpfs /var/log/supervisor:mode=755,size=64M,uid=1000,gid=1000 --tmpfs /var/lib/https-bridge:mode=755,size=8M,uid=1000,gid=1000
  --tmpfs /var/cache:mode=755,size=512M,uid=1000,gid=1000 --tmpfs /usr/local/bin:mode=755,size=8M,exec,suid
  --tmpfs /app/mcp-logs:mode=755,size=100M,uid=1000,gid=1000 --tmpfs /run/user/1000:mode=700,uid=1000,gid=1000
  --tmpfs /home/devuser/workspace:mode=755,size=1G,uid=1000,gid=1000 --tmpfs /home/devuser/.cache:mode=755,size=2G,uid=1000,gid=1000
  --tmpfs /home/devuser/.npm:mode=755,size=1G,uid=1000,gid=1000 --tmpfs /home/devuser/.local:mode=755,size=128M,uid=1000,gid=1000
  --tmpfs /home/devuser/.config:mode=755,size=64M,uid=1000,gid=1000 --tmpfs /home/devuser/.claude-flow:mode=755,size=64M,uid=1000,gid=1000
  --tmpfs /home/devuser/.codex:mode=755,size=512M,uid=1000,gid=1000 --tmpfs /home/devuser/.gemini:mode=755,size=256M,uid=1000,gid=1000
  --tmpfs /var/lib/ruvector:mode=755,size=256M,uid=1000,gid=1000 --tmpfs /var/lib/solid:mode=755,size=256M,uid=1000,gid=1000
  --tmpfs /var/lib/agentbox:mode=755,size=256M,uid=1000,gid=1000 --tmpfs /var/lib/nostr-relay:mode=755,size=64M,uid=1000,gid=1000
  --shm-size 1g --pids-limit 4096 --memory 16g "$TAG")
if ! "$DOCKER" "${RUN[@]}" >"$WORK/run.log" 2>&1; then
  row boot fail "docker run failed" "$(jq -nc --arg t "$(tail -n 10 "$WORK/run.log" | redact)" '{log_tail:$t}')"
  finish FAIL 1 "container did not start"
fi
CTR_MADE=1

dx() { "$DOCKER" exec "$CNAME" "$@"; }
log "booting $CNAME; waiting up to ${BOOT_TIMEOUT}s for management-api"
deadline=$(( $(date +%s) + BOOT_TIMEOUT )); READY_CODE=""; ANSWERED=0
while :; do
  if [ "$("$DOCKER" inspect -f '{{.State.Running}}' "$CNAME" 2>/dev/null)" != true ]; then
    row boot fail "container exited during boot" "$(jq -nc --arg t "$("$DOCKER" logs --tail 40 "$CNAME" 2>&1 | redact)" '{log_tail:$t}')"
    finish FAIL 1 "container exited during boot"
  fi
  READY_CODE="$(dx curl -s -o "/tmp/x4-ready.json" -w '%{http_code}' http://127.0.0.1:9090/ready 2>/dev/null || true)"
  case "$READY_CODE" in 200) ANSWERED=1; break ;; 503) ANSWERED=1 ;; esac
  [ "$(date +%s)" -ge "$deadline" ] && break
  sleep "$POLL"
done
if [ "$ANSWERED" = 0 ]; then
  row boot fail "management-api did not answer within ${BOOT_TIMEOUT}s" "$(jq -nc --arg t "$("$DOCKER" logs --tail 40 "$CNAME" 2>&1 | redact)" '{log_tail:$t}')"
  finish FAIL 1 "boot timeout"
fi
row boot pass "container up; management-api answers (/ready $READY_CODE)"

# ── 4. gates ───────────────────────────────────────────────────────────────────────────────
READY_BODY="$(dx cat /tmp/x4-ready.json 2>/dev/null || echo '{}')"; jq -e . >/dev/null 2>&1 <<<"$READY_BODY" || READY_BODY='{}'
if [ "$READY_CODE" = 200 ]; then
  row ready pass "GET /ready 200" "$(jq -c '{degraded:(.degraded // [])}' <<<"$READY_BODY")"
else
  row ready fail "GET /ready $READY_CODE: $(jq -r '(.missing // []) | join("; ")' <<<"$READY_BODY")" "$(jq -c '{missing:(.missing // []),degraded:(.degraded // [])}' <<<"$READY_BODY")"
fi

SYS="$(dx curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:9090/v1/system 2>/dev/null)"
SUP="$(dx supervisorctl status 2>/dev/null || true)"   # exits 3 whenever any program is not RUNNING
if ! jq -e '.modules' >/dev/null 2>&1 <<<"$SYS" || [ -z "$SUP" ]; then
  row units not_evaluable "could not read /v1/system or supervisorctl status inside the container; no unit was judged"
else
  SUPJ="$(awk 'NF >= 2 && $2 ~ /^[A-Z]+$/ {print $1, $2}' <<<"$SUP" | jq -Rn '[inputs | split(" ") | {(.[0]): .[1]}] | add // {}')"
  jq -c --argjson sup "$SUPJ" --arg oneshot "$ONESHOT" --arg live "$LIVE_STATES" --arg ondemand "$ON_DEMAND" '
    ($oneshot | split(" ")) as $os | ($live | split(" ")) as $lv | ($ondemand | split(" ")) as $od
    | (.surfaces + .modules)[]
    | select(.service != null and (.state == "on" or .state == "off"))
    | . as $e | ($sup[$e.service] // null) as $st
    | {gate: ("unit:" + $e.id), evidence: {service: $e.service, declared: $e.state, supervisor: $st}} + (
        if ($od | index($e.id)) then {verdict: "not_evaluable", detail: "on-demand unit, never supervised"}
        elif $st != null then
          (($lv | index($st)) != null or (($os | index($e.service)) != null and $st == "EXITED")) as $up
          | if $e.state == "on" and $up then {verdict: "pass", detail: "declared on, supervisor \($st)"}
            elif $e.state == "on" then {verdict: "fail", detail: "declared on, supervisor \($st)"}
            elif $up then {verdict: "fail", detail: "declared off, running (\($st))"}
            else {verdict: "pass", detail: "declared off, supervisor \($st)"} end
        elif $e.state == "off" then {verdict: "pass", detail: "declared off, no supervisor program (no sidecar can run in this box)"}
        else {verdict: "not_evaluable", detail: "declared on, not a supervisor program here (compose sidecar or missing); this box cannot read docker"} end)' <<<"$SYS" >>"$ROWS"
fi

# ── 5. verdict ─────────────────────────────────────────────────────────────────────────────
FAILS="$(jq -s '[.[] | select(.verdict == "fail")] | length' "$ROWS")"
NEV="$(jq -s '[.[] | select(.verdict == "not_evaluable")] | length' "$ROWS")"
if [ "$FAILS" -gt 0 ]; then finish FAIL 1 "$FAILS gate(s) failed"
elif [ "$NEV" -gt 0 ]; then finish STAGED 2 "$NEV gate(s) not evaluable in an isolated box"
else finish PASS 0; fi
