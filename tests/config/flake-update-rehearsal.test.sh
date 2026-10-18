#!/usr/bin/env bash
# X-4: scripts/activation/flake-update-rehearsal.host.sh decides correctly and stays isolated.
#
# Everything external is faked (XR_DOCKER, XR_GIT, XR_NIX, XR_CURL, XR_TEST_ROOT): no image is
# built, no container started, no live service touched. The fakes record their argv so the cases
# can assert what the script asked for as well as what it concluded.
#
# Cases:
#   1  branch absent                         -> 3, COULD_NOT_RUN, nothing built or run
#   2  nix build fails                       -> 1, build gate fails, nothing run
#   3  boot timeout (API never answers)      -> 1, boot gate fails, teardown done
#   4  all gates pass                        -> 0, schema-valid receipt, full teardown
#   5  one gate fails (unit FATAL)           -> 1, only that unit in failed_gates
#   6  a sidecar unit this box cannot read   -> 2 STAGED
#   7  --journal, live box up                -> one POST per gate, body shape, key not in receipt
#   8  --journal, live box unreachable       -> still 0, journal.status unreachable (non-fatal)
#   9  --journal, every POST refused (401)   -> still 0, status failed, breaker stops at 3
#  10  --keep vs default teardown            -> container/network/image kept; worktree always gone
#  11  isolation of the docker run argv      -> no -p, no workspace/secrets bind, throwaway tag/name,
#                                               internal network; nix never sees copyToDockerDaemon
#  12  /ready 503                            -> 1, ready gate fails
#  13  refuses inside a container            -> 3
#  14  ONESHOT/LIVE sets match scripts/ci/check-declared-vs-running.js; POST body matches the
#      route's schema patterns
# Run: bash tests/config/flake-update-rehearsal.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SCRIPT="$REPO/scripts/activation/flake-update-rehearsal.host.sh"
SCHEMA="$REPO/docs/estate-closeout/schema/x4-rehearsal.schema.json"
AJV_DIR="$REPO/management-api/node_modules/ajv"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n    %s\n' "$1" "${2:-}"; }
for need in jq node; do command -v "$need" >/dev/null || { echo "needs $need" >&2; exit 1; }; done

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/x4-rehearsal-test.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
BIN="$ROOT/bin"; mkdir -p "$BIN"
SHA=0123456789abcdef0123456789abcdef01234567
SHA12=0123456789ab

# ── fakes ──────────────────────────────────────────────────────────────────────────────────
cat >"$BIN/git" <<'SH'
#!/usr/bin/env bash
S="$FAKE_STATE"; echo "git $*" >>"$S/git.log"
[ "$1" = -C ] && shift 2
case "$1" in
  ls-remote) [ -z "${FAKE_BRANCH_ABSENT:-}" ] ;;
  fetch) exit 0 ;;
  rev-parse) echo "$FAKE_SHA" ;;
  diff) exit 0 ;;
  worktree)
    case "$2" in
      add) wt="${@: -2:1}"; mkdir -p "$wt/config"; echo '[security]' >"$wt/agentbox.toml"; : >"$wt/config/seccomp-agentbox.json"; echo "$wt" >"$S/worktree" ;;
      remove) rm -rf "${@: -1}"; touch "$S/worktree-removed" ;;
      prune) touch "$S/worktree-pruned" ;;
    esac ;;
esac
SH
cat >"$BIN/nix" <<'SH'
#!/usr/bin/env bash
S="$FAKE_STATE"; echo "nix $*" >>"$S/nix.log"
case "$1" in
  build) [ -z "${FAKE_BUILD_FAIL:-}" ] ;;
  run) [ -z "${FAKE_LOAD_FAIL:-}" ] && touch "$S/loaded" ;;
esac
SH
cat >"$BIN/docker" <<'SH'
#!/usr/bin/env bash
S="$FAKE_STATE"; echo "docker $*" >>"$S/docker.log"
case "$1" in
  info) exit 0 ;;
  version) echo linux/amd64 ;;
  image) if [ "$2" = inspect ]; then
           case "$3" in
             agentbox:rehearsal-*) [ -e "$S/loaded" ] && [ ! -e "$S/rmi" ] && echo sha256:rehearsal || exit 1 ;;
             *) echo "sha256:live-${FAKE_LIVE_ID:-aaa}" ;;
           esac
         fi ;;
  network) touch "$S/net-$2" ;;
  run) touch "$S/ran"; echo cid ;;
  inspect) [ -z "${FAKE_EXITED:-}" ] && echo true || echo false ;;
  logs) echo "boot log line" ;;
  rm) touch "$S/rm" ;;
  rmi) touch "$S/rmi" ;;
  exec)
    shift 2
    case "$1" in
      curl)
        case "$*" in
          *"/ready"*) [ -n "${FAKE_READY_CODE:-}" ] && { cp "$FAKE_READY_BODY" "$S/ready.json"; printf '%s' "$FAKE_READY_CODE"; } ;;
          *"/v1/system"*) cat "$FAKE_SYSTEM" ;;
        esac ;;
      cat) cat "$S/ready.json" 2>/dev/null ;;
      supervisorctl) cat "$FAKE_SUP"; exit 3 ;;
    esac ;;
esac
exit 0
SH
cat >"$BIN/curl" <<'SH'
#!/usr/bin/env bash
S="$FAKE_STATE"; echo "curl $*" >>"$S/curl.log"
case "$*" in
  *"/health"*) [ -z "${FAKE_LIVE_DOWN:-}" ] || exit 7; exit 0 ;;
  *"/v1/exec/record"*)
    while [ $# -gt 0 ]; do [ "$1" = --data-binary ] && echo "$2" >>"$S/posts.jsonl"; shift; done
    printf '%s' "${FAKE_POST_CODE:-201}" ;;
esac
SH
chmod +x "$BIN"/*

# ── fixtures ───────────────────────────────────────────────────────────────────────────────
mod() { printf '{"id":"%s","state":"%s","service":"%s"}' "$1" "$2" "$3"; }
sys_json() { printf '{"surfaces":[],"modules":[%s]}' "$(IFS=,; echo "$*")"; }
SYS_PASS="$ROOT/sys-pass.json"; sys_json "$(mod a on svc-a)" "$(mod b off svc-b)" "$(mod e on setup)" >"$SYS_PASS"
SYS_FAIL="$ROOT/sys-fail.json"; sys_json "$(mod a on svc-a)" "$(mod c on svc-c)" >"$SYS_FAIL"
SYS_STAGED="$ROOT/sys-staged.json"; sys_json "$(mod a on svc-a)" "$(mod d on sidecar)" >"$SYS_STAGED"
SUP_PASS="$ROOT/sup-pass.txt"; printf 'svc-a        RUNNING   pid 10, uptime 0:01:00\nsetup        EXITED    Oct 18 10:00 AM\n' >"$SUP_PASS"
SUP_FAIL="$ROOT/sup-fail.txt"; printf 'svc-a        RUNNING   pid 10, uptime 0:01:00\nsvc-c        FATAL     Exited too quickly\n' >"$SUP_FAIL"
READY_OK="$ROOT/ready-ok.json"; echo '{"ready":true,"degraded":[]}' >"$READY_OK"
READY_BAD="$ROOT/ready-bad.json"; echo '{"ready":false,"missing":["adapter:memory not healthy (status=unknown)"],"degraded":[]}' >"$READY_BAD"

LIVE_KEY="live-key-sentinel-4c1d"
OUT=""; CODE=0; RECEIPT=""; STATE=""; RDIR=""
run() { # run <case> [env assignments...] -- [script args...]
  local name="$1"; shift
  STATE="$ROOT/$name.state"; RDIR="$ROOT/$name.receipts"; mkdir -p "$STATE" "$RDIR"
  local envs=()
  while [ $# -gt 0 ] && [ "$1" != -- ]; do envs+=("$1"); shift; done
  [ "${1:-}" = -- ] && shift
  OUT="$(env -u MANAGEMENT_API_KEY FAKE_STATE="$STATE" FAKE_SHA="$SHA" FAKE_SYSTEM="$SYS_PASS" FAKE_SUP="$SUP_PASS" FAKE_READY_CODE=200 FAKE_READY_BODY="$READY_OK" \
    XR_TEST_ROOT=1 XR_DOCKER="$BIN/docker" XR_GIT="$BIN/git" XR_NIX="$BIN/nix" XR_CURL="$BIN/curl" XR_POLL=0 \
    "${envs[@]}" bash "$SCRIPT" --receipt-dir "$RDIR" --boot-timeout 2 "$@" 2>&1)"; CODE=$?
  RECEIPT="$(ls "$RDIR"/x4-rehearsal-*.json 2>/dev/null | head -1)"
}
jqr() { jq -r "$1" "$RECEIPT"; }
valid() { # schema-validate the receipt
  [ -r "$AJV_DIR/package.json" ] || { echo "ajv absent: schema check skipped"; return 0; }
  node -e 'const Ajv=require(process.argv[1]+"/dist/2020").default;const fs=require("fs");const a=new Ajv({allErrors:true,strict:false,validateFormats:false});
const v=a.compile(JSON.parse(fs.readFileSync(process.argv[2],"utf8")));
if(!v(JSON.parse(fs.readFileSync(process.argv[3],"utf8")))){console.error(JSON.stringify(v.errors.slice(0,3)));process.exit(1)}' "$AJV_DIR" "$SCHEMA" "$RECEIPT"
}
expect() { # expect <label> <condition-exit> [detail]
  if [ "$2" = 0 ]; then ok "$1"; else bad "$1" "${3:-}"; fi
}
grep_q() { grep -q -- "$1" "$2" 2>/dev/null; }

# ── 1 branch absent ────────────────────────────────────────────────────────────────────────
run c1 FAKE_BRANCH_ABSENT=1 --
expect "1 branch absent -> exit 3" "$([ "$CODE" = 3 ]; echo $?)" "exit $CODE: $OUT"
expect "1 receipt COULD_NOT_RUN naming the branch" "$([ "$(jqr .verdict)" = COULD_NOT_RUN ] && jqr .reason | grep -q 'absent'; echo $?)"
expect "1 nothing built or run" "$([ ! -e "$STATE/nix.log" ] && [ ! -e "$STATE/ran" ]; echo $?)"
expect "1 receipt is schema-valid" "$(valid; echo $?)"

# ── 2 build fails ──────────────────────────────────────────────────────────────────────────
run c2 FAKE_BUILD_FAIL=1 --
expect "2 build fails -> exit 1, build gate fail" "$([ "$CODE" = 1 ] && [ "$(jqr '[.gates[]|select(.gate=="build" and .verdict=="fail")]|length')" = 1 ]; echo $?)" "exit $CODE: $OUT"
expect "2 no container started, worktree removed" "$([ ! -e "$STATE/ran" ] && [ -e "$STATE/worktree-removed" ]; echo $?)"
expect "2 receipt is schema-valid" "$(valid; echo $?)"

# ── 3 boot timeout ─────────────────────────────────────────────────────────────────────────
run c3 FAKE_READY_CODE= --
expect "3 boot timeout -> exit 1, boot gate fail" "$([ "$CODE" = 1 ] && [ "$(jqr '[.gates[]|select(.gate=="boot" and .verdict=="fail")]|length')" = 1 ]; echo $?)" "exit $CODE: $OUT"
expect "3 timed-out box is torn down" "$([ -e "$STATE/rm" ] && [ -e "$STATE/rmi" ]; echo $?)"
run c3b FAKE_EXITED=1 --
expect "3 container that exits during boot -> exit 1" "$([ "$CODE" = 1 ] && jqr '.gates[]|select(.gate=="boot").detail' | grep -q exited; echo $?)" "exit $CODE: $OUT"

# ── 4 all gates pass ───────────────────────────────────────────────────────────────────────
run c4 --
expect "4 all gates pass -> exit 0 PASS" "$([ "$CODE" = 0 ] && [ "$(jqr .verdict)" = PASS ]; echo $?)" "exit $CODE: $OUT"
expect "4 gates: branch build boot ready + 3 units" "$([ "$(jqr '[.gates[].gate]|join(",")')" = 'branch,build,boot,ready,unit:a,unit:b,unit:e' ]; echo $?)" "$(jqr '[.gates[].gate]|join(",")')"
expect "4 receipt is schema-valid" "$(valid; echo $?)"
expect "4 full teardown (container, network, image) and worktree" "$([ -e "$STATE/rm" ] && [ -e "$STATE/net-rm" ] && [ -e "$STATE/rmi" ] && [ -e "$STATE/worktree-removed" ] && [ -e "$STATE/worktree-pruned" ]; echo $?)"
expect "4 live image id unchanged" "$([ "$(jqr .live_image_untouched)" = true ]; echo $?)"
expect "4 no secret in receipt or output" "$(! grep -rq -e "$LIVE_KEY" "$RECEIPT" && ! grep -q 'Bearer' "$RECEIPT"; echo $?)"

# ── 5 one gate fails ───────────────────────────────────────────────────────────────────────
run c5 FAKE_SYSTEM="$SYS_FAIL" FAKE_SUP="$SUP_FAIL" --
expect "5 one failing unit -> exit 1, only unit:c failed" "$([ "$CODE" = 1 ] && [ "$(jqr '.summary.failed_gates|join(",")')" = unit:c ]; echo $?)" "exit $CODE: $(jqr '.summary.failed_gates')"

# ── 6 STAGED ───────────────────────────────────────────────────────────────────────────────
run c6 FAKE_SYSTEM="$SYS_STAGED" --
expect "6 unreadable sidecar unit -> exit 2 STAGED" "$([ "$CODE" = 2 ] && [ "$(jqr .verdict)" = STAGED ] && [ "$(jqr '.summary.unevaluated_gates|join(",")')" = unit:d ]; echo $?)" "exit $CODE"
expect "6 receipt is schema-valid" "$(valid; echo $?)"

# ── 7 journal posted ───────────────────────────────────────────────────────────────────────
run c7 MANAGEMENT_API_KEY="$LIVE_KEY" -- --journal
NGATES="$(jqr '.gates|length')"
expect "7 journal posted: one POST per gate" "$([ "$CODE" = 0 ] && [ "$(wc -l <"$STATE/posts.jsonl")" = "$NGATES" ] && [ "$(jqr .journal.posted)" = "$NGATES" ] && [ "$(jqr .journal.status)" = posted ]; echo $?)" "gates $NGATES posts $(wc -l <"$STATE/posts.jsonl" 2>/dev/null)"
expect "7 body: harness, tool.completed, key <session>:<gate>" "$(jq -e -s 'all(.[]; .harness == "flake-rehearsal" and .type == "tool.completed" and (. as $b | $b.key | startswith($b.session + ":")) and .payload.sha != null)' "$STATE/posts.jsonl" >/dev/null; echo $?)"
expect "7 posts go to the live URL with a Bearer token" "$(grep_q 'http://127.0.0.1:9090/v1/exec/record' "$STATE/curl.log" && grep_q "Authorization: Bearer $LIVE_KEY" "$STATE/curl.log"; echo $?)"
expect "7 live key is nowhere in the receipt or the posted bodies" "$(! grep -q -e "$LIVE_KEY" "$RECEIPT" "$STATE/posts.jsonl"; echo $?)"
expect "7 no --journal -> no POST and not_requested" "$(run c7b MANAGEMENT_API_KEY="$LIVE_KEY" --; [ ! -e "$STATE/posts.jsonl" ] && [ "$(jqr .journal.status)" = not_requested ]; echo $?)"

# ── 8 journal unreachable is non-fatal ─────────────────────────────────────────────────────
run c8 MANAGEMENT_API_KEY="$LIVE_KEY" FAKE_LIVE_DOWN=1 -- --journal
expect "8 live box down -> still exit 0, status unreachable" "$([ "$CODE" = 0 ] && [ "$(jqr .journal.status)" = unreachable ] && [ ! -e "$STATE/posts.jsonl" ]; echo $?)" "exit $CODE $(jqr .journal)"
run c8b -- --journal
expect "8 no key -> still exit 0, status skipped" "$([ "$CODE" = 0 ] && [ "$(jqr .journal.status)" = skipped ]; echo $?)" "exit $CODE $(jqr .journal)"
expect "8 receipt is schema-valid" "$(valid; echo $?)"

# ── 9 every POST refused ───────────────────────────────────────────────────────────────────
run c9 MANAGEMENT_API_KEY="$LIVE_KEY" FAKE_POST_CODE=401 -- --journal
expect "9 401 on every POST -> exit 0, status failed, breaker stops at 3 attempts" "$([ "$CODE" = 0 ] && [ "$(jqr .journal.status)" = failed ] && [ "$(wc -l <"$STATE/posts.jsonl")" = 3 ] && [ "$(jqr .journal.posted)" = 0 ]; echo $?)" "exit $CODE posts $(wc -l <"$STATE/posts.jsonl") $(jqr .journal)"

# ── 10 --keep vs teardown ──────────────────────────────────────────────────────────────────
run c10 -- --keep
expect "10 --keep leaves container, network and image" "$([ "$CODE" = 0 ] && [ ! -e "$STATE/rm" ] && [ ! -e "$STATE/net-rm" ] && [ ! -e "$STATE/rmi" ] && [ "$(jqr .kept)" = true ]; echo $?)" "exit $CODE"
expect "10 --keep prints the removal commands" "$(grep -q 'rmi -f agentbox:rehearsal-' <<<"$OUT"; echo $?)"
expect "10 --keep still removes the worktree" "$([ -e "$STATE/worktree-removed" ] && [ -e "$STATE/worktree-pruned" ]; echo $?)"

# ── 11 isolation ───────────────────────────────────────────────────────────────────────────
run c11 --
RUNLINE="$(grep '^docker run ' "$STATE/docker.log")"
expect "11 throwaway tag and name" "$(grep -q -e "agentbox:rehearsal-$SHA12\$" <<<"$RUNLINE" && grep -q -e "--name agentbox-rehearsal-$SHA12" <<<"$RUNLINE"; echo $?)" "$RUNLINE"
expect "11 no published port" "$(! grep -qE -e ' (-p|--publish|-P|--publish-all) ' <<<"$RUNLINE"; echo $?)"
expect "11 no live workspace, secrets, projects or docker-socket bind" "$(! grep -qE -e '-v [^ ]*:/(home|projects|var/lib|run/secrets|var/run)|docker\.sock' <<<"$RUNLINE"; echo $?)"
expect "11 only the branch manifest is bound, read-only" "$([ "$(grep -o -e ' -v [^ ]*' <<<"$RUNLINE" | wc -l)" = 1 ] && grep -q -e ':/etc/agentbox.toml:ro' <<<"$RUNLINE"; echo $?)"
expect "11 throwaway management-api key, not the live one" "$(grep -q -e 'MANAGEMENT_API_KEY=' <<<"$RUNLINE" && ! grep -q -e "$LIVE_KEY" <<<"$RUNLINE"; echo $?)"
expect "11 internal network, read-only rootfs, caps dropped, no-new-privileges" "$(grep -q 'network create --internal' "$STATE/docker.log" && grep -q -e '--read-only' <<<"$RUNLINE" && grep -q -e '--cap-drop ALL' <<<"$RUNLINE" && grep -q -e 'no-new-privileges:true' <<<"$RUNLINE"; echo $?)"
expect "11 nix is never asked for copyToDockerDaemon or the live tag" "$(! grep -qE 'copyToDockerDaemon|runtime-x86_64-linux' "$STATE/nix.log" && grep -q "runtime.copyTo -- docker-daemon:agentbox:rehearsal-$SHA12" "$STATE/nix.log"; echo $?)" "$(cat "$STATE/nix.log")"
expect "11 build runs against the worktree, not the live checkout" "$(grep -q "$(cat "$STATE/worktree")#runtime" "$STATE/nix.log"; echo $?)"
run c11b FAKE_LIVE_ID=bbb --
# the fake returns a fixed id per call; flip it between the two reads to prove the guard fires
cat >"$BIN/docker-flip" <<SH
#!/usr/bin/env bash
if [ "\$1" = image ] && [ "\$2" = inspect ] && [[ "\$3" == agentbox:runtime-* ]]; then
  n=\$(cat "$ROOT/flip" 2>/dev/null || echo 0); echo \$((n+1)) >"$ROOT/flip"; echo "sha256:live-\$n"; exit 0
fi
exec "$BIN/docker" "\$@"
SH
chmod +x "$BIN/docker-flip"; rm -f "$ROOT/flip"
run c11c XR_DOCKER="$BIN/docker-flip" --
expect "11 a changed live image id is recorded as live_image_untouched=false" "$([ "$(jqr .live_image_untouched)" = false ]; echo $?)"

# ── 12 /ready 503 ──────────────────────────────────────────────────────────────────────────
run c12 FAKE_READY_CODE=503 FAKE_READY_BODY="$READY_BAD" --
expect "12 /ready 503 -> exit 1, ready gate fails with the missing list" "$([ "$CODE" = 1 ] && jqr '.gates[]|select(.gate=="ready").detail' | grep -q 'adapter:memory'; echo $?)" "exit $CODE: $OUT"

# ── 13 refuses inside a container ──────────────────────────────────────────────────────────
run c13 XR_ASSUME_CONTAINER=1 --
expect "13 inside a container -> exit 3, nothing run" "$([ "$CODE" = 3 ] && grep -q 'host script' <<<"$OUT" && [ ! -e "$STATE/docker.log" ]; echo $?)" "exit $CODE: $OUT"
run c13b -- --bogus
expect "13 unknown argument -> exit 3" "$([ "$CODE" = 3 ]; echo $?)"

# ── 14 drift guards ────────────────────────────────────────────────────────────────────────
DRIFT="$(node -e '
const fs=require("fs"),path=require("path");
const src=fs.readFileSync(process.argv[1],"utf8");
const pick=(n)=>(src.match(new RegExp("^"+n+"=\"([^\"]*)\"","m"))||[])[1].split(/\s+/).filter(Boolean).sort().join(",");
const m=require(path.join(process.argv[2],"scripts/ci/check-declared-vs-running.js"));
const a=pick("ONESHOT"), b=[...m.ONESHOT].sort().join(",");
const od=pick("ON_DEMAND"), odm=Object.keys(m.ON_DEMAND).sort().join(",");
const live=pick("LIVE_STATES");
const ci=fs.readFileSync(path.join(process.argv[2],"scripts/ci/check-declared-vs-running.js"),"utf8").match(/LIVE_SUPERVISOR = new Set\(\[([^\]]*)\]/)[1].replace(/[\x27" ]/g,"").split(",").sort().join(",");
console.log(a===b&&od===odm&&live.split(",").sort().join(",")===ci?"same":`drift oneshot ${a}|${b} ondemand ${od}|${odm} live ${live}|${ci}`);' "$SCRIPT" "$REPO" 2>&1)"
expect "14 ONESHOT / ON_DEMAND / live states match check-declared-vs-running.js" "$([ "$DRIFT" = same ]; echo $?)" "$DRIFT"
run c14 MANAGEMENT_API_KEY="$LIVE_KEY" -- --journal
BODYCHK="$(node -e '
const fs=require("fs");
const route=fs.readFileSync(process.argv[1],"utf8");
const sess=new RegExp(route.match(/SESSION_RE = \/(.*)\/;/)[1]), harn=new RegExp(route.match(/HARNESS_RE = \/(.*)\/;/)[1]);
const types=[...route.match(/RECORDABLE_TYPES = Object.freeze\(\[([^\]]*)\]/)[1].matchAll(/\x27([a-z.]+)\x27/g)].map(m=>m[1]);
let bad=0;
for(const l of fs.readFileSync(process.argv[2],"utf8").trim().split("\n")){const b=JSON.parse(l);
 const extra=Object.keys(b).filter(k=>!["session","harness","type","turn","step","key","causation","correlation","privacy_class","occurred_at","payload"].includes(k));
 if(!sess.test(b.session)||!harn.test(b.harness)||!types.includes(b.type)||b.key.length>200||extra.length||!["public","internal","sensitive","secret"].includes(b.privacy_class))bad++;}
console.log(bad?`bad ${bad}`:"ok");' "$REPO/management-api/routes/exec-record.js" "$STATE/posts.jsonl" 2>&1)"
expect "14 POST bodies satisfy the /v1/exec/record schema patterns" "$([ "$BODYCHK" = ok ]; echo $?)" "$BODYCHK"

echo
echo "flake-update-rehearsal: $pass passed, $fail failed"
[ "$fail" = 0 ]
