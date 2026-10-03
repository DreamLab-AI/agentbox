#!/usr/bin/env bash
# X-1 step 1 boot rehearsal, HOST half (custody design §4, §8.5; workstream W6a).
#
# Run on the HOST shell (tmux tab 6) as root, against the running agentbox container. NEVER from
# inside the container: there it would reach the docker socket as devuser, which is the very
# bypass (C1) the rehearsal exists to prove closed. It refuses when it detects a container.
#
# It makes the probes that need root's view, which the container half (run as devuser) cannot:
#   (a) each role secret under /run/secrets/<role>/ is present, owned by the role, mode 0400,
#       readable by the role uid (setpriv), refused to another role and to devuser; extra files
#       in the dir (env-derived) obey the same; /run/secrets is a mount point; at-rest copies
#       are root-owned 0400 in root 0700 directories
#   (b) each role program's pid runs as the role uid (root reads /proc/<pid>/status)
#   (e) no process outside a variable's role holds a classified variable NAME in its environ
#       (all uids, PID 1 included), and identity.env names none; names only, never values
#   h-uid-collision  getent passwd / group on the host for ids 960-979: any entry is a FAIL,
#                    because files on named volumes would take that host account's identity
#   h-socket         the host's /var/run/docker.sock mode and group, RECORDED for the owner
#                    (Q2 is host-side; not a gate)
#
# The in-container probe is a script embedded below, piped to `docker exec -u 0 … /bin/bash -s`
# with PATH reduced to /nix/store entries: root never executes a devuser-writable file. This
# file itself sits in the bind-mounted checkout, which devuser can write, so by default it
# refuses when scripts/activation differs from HEAD; review the diff, then --allow-dirty.
#
# Verdict and exit code as the container half: 0 PASS, 2 STAGED (flag off: every isolation row
# not_applicable; the socket row is recorded), 1 FAIL (or could not run).
# Receipt: docs/estate-closeout/x1-rehearsal-host-<UTC>.json (schema x1-rehearsal.schema.json).
#
#   --container NAME   default agentbox
#   --receipt-dir DIR  default docs/estate-closeout of this checkout
#   --allow-dirty      run although scripts/activation differs from HEAD
#
# Test seams (tests/config/role-isolation-rehearsal.test.sh): HR_ASSUME_CONTAINER=1 (forces the
# in-container refusal; it cannot suppress it), HR_TEST_ROOT (skips the host,
# root and clean-tree guards; only for fakes), HR_DOCKER, HR_GETENT, HR_STAT, HR_HOST_SOCKET,
# HR_REGISTRY, HR_CONTAINER_REPO.

# jq programs go through the jqx wrapper, which shellcheck does not recognise as jq: their $vars
# are jq's, not the shell's.
# shellcheck disable=SC2016

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DOCKER="${HR_DOCKER:-docker}"
GETENT="${HR_GETENT:-getent}"
STAT="${HR_STAT:-stat}"
HOST_SOCKET="${HR_HOST_SOCKET:-/var/run/docker.sock}"
CONTAINER_REPO="${HR_CONTAINER_REPO:-/home/devuser/workspace/project/agentbox}"
C=agentbox
RECEIPT_DIR="$REPO/docs/estate-closeout"
ALLOW_DIRTY=0

die() { echo "role-isolation-rehearsal.host: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --container) C="${2:?--container needs a name}"; shift ;;
    --receipt-dir) RECEIPT_DIR="${2:?--receipt-dir needs a directory}"; shift ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help) sed -n '2,/^set -uo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument '$1'" ;;
  esac
  shift
done

in_container() {
  # HR_ASSUME_CONTAINER=1 can only add a refusal, never remove one: the test sets it so the
  # refusal is exercised on a CI runner that is a VM, not a container.
  [ "${HR_ASSUME_CONTAINER:-}" = 1 ] && return 0
  [ -e /.dockerenv ] || [ -e /run/.containerenv ] && return 0
  grep -qE '(docker|containerd|kubepods|libpod)' /proc/1/cgroup 2>/dev/null
}
if [ -z "${HR_TEST_ROOT:-}" ]; then
  if in_container; then die "this is the host half: run it from the host shell, never from inside the container"; fi
  [ "$(id -u)" = 0 ] || die "run as root on the host"
  if [ "$ALLOW_DIRTY" = 0 ] && ! git -C "$REPO" diff --quiet HEAD -- scripts/activation 2>/dev/null; then
    die "scripts/activation differs from HEAD; review 'git -C $REPO diff HEAD -- scripts/activation', then pass --allow-dirty"
  fi
fi

# JSON assembly: the host's jq when present, otherwise the image's jq run as devuser (data only).
if command -v jq >/dev/null 2>&1; then JQ=(jq); else JQ=("$DOCKER" exec -i -u 1000 "$C" jq); fi
jqx() { "${JQ[@]}" "$@"; }

[ "$("$DOCKER" inspect -f '{{.State.Running}}' "$C" 2>/dev/null)" = true ] || die "container '$C' is not running"
IMAGE_ID="$("$DOCKER" inspect -f '{{.Image}}' "$C" 2>/dev/null)"; IMAGE_ID="${IMAGE_ID:-unknown}"
NOW="$(date -u +%s)"; STARTED="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ)"

# Root PATH for the probe: store paths only (never /usr/local/bin or a workspace path).
PROBE_PATH="$("$DOCKER" inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$C" 2>/dev/null | sed -n 's/^PATH=//p' | tr ':' '\n' | grep '^/nix/store/' | paste -sd: -)"
[ -n "$PROBE_PATH" ] || die "could not read a /nix/store PATH from the image config"

# Manifest and role table, read from the container (image files first).
MANIFEST_TEXT="$("$DOCKER" exec -u 0 "$C" cat /etc/agentbox.toml 2>/dev/null)" || die "cannot read /etc/agentbox.toml in '$C'"
FLAG_RAW="$(awk '$0=="[security]"{f=1;next} /^\[/{f=0} f && /^role_isolation[[:space:]]*=/ {sub(/^[^=]*=[[:space:]]*/,""); sub(/[[:space:]]*(#.*)?$/,""); print; exit}' <<<"$MANIFEST_TEXT")"
if [ -z "$FLAG_RAW" ]; then FLAG=false; FLAG_SOURCE=absent-default-false
else case "$FLAG_RAW" in 1|true|TRUE|True|yes|on) FLAG=true ;; *) FLAG=false ;; esac; FLAG_SOURCE=manifest; fi

# One reader of W1's table and plan: the container half's --print-registry normalises
# /etc/agentbox/role-accounts.json + role-secrets.tsv into the rows both halves check.
if [ -n "${HR_REGISTRY:-}" ]; then REGISTRY="$HR_REGISTRY"
else REGISTRY="$("$DOCKER" exec -u 1000 "$C" bash "$CONTAINER_REPO/scripts/activation/role-isolation-rehearsal.sh" --print-registry)" || die "could not obtain the role table (the image needs /etc/agentbox/role-accounts.json and role-secrets.tsv)"; fi
REGISTRY="$(jqx -c . <<<"$REGISTRY")" || die "the role table is not JSON"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/x1-rehearsal-host.XXXXXX")" || die "mktemp failed"
trap 'rm -rf "$WORK"' EXIT
ROWS="$WORK/rows.jsonl"; : >"$ROWS"

echo "X-1 role-isolation rehearsal, host half — container $C, image $IMAGE_ID, flag role_isolation=$FLAG ($FLAG_SOURCE)"

# ── the in-container root probe (runs as root inside $C; emits JSONL rows) ─────────────────
read -r -d '' PROBE <<'PROBE_EOF'
set -uo pipefail
reg="$RH_REGISTRY_JSON"
row() { jq -nc --arg c "$1" --arg t "$2" --arg e "$3" --arg o "$4" --argjson ok "$([ "$5" = 1 ] && echo true || echo false)" --argjson ev "${6:-null}" '{check:$c,target:$t,expected:$e,observed:$o,ok:$ok,evidence:($ev // {})}'; }
as_uid() { setpriv --reuid="$1" --regid="$1" --clear-groups head -c0 -- "$2" >/dev/null 2>&1; }
other_role_uid() { jq -r --argjson u "$1" '[.roles[] | select(.uid != $u and ((.files | length) > 0 or (.programs | length) > 0)) | .uid][0] // empty' <<<"$reg"; }

# (a)
if mountpoint -q /run/secrets; then row a "/run/secrets (root view)" "a mount point" "mount point" 1 '{"path":"/run/secrets","mount_point":true}'
else row a "/run/secrets (root view)" "a mount point" "not a mount point" 0 '{"path":"/run/secrets","mount_point":false}'; fi
while IFS=$'\t' read -r role uid; do
  d="/run/secrets/$role"; other="$(other_role_uid "$uid")"
  if [ ! -d "$d" ]; then row a "$d (root view)" "present" absent 0 "$(jq -nc --arg p "$d" '{path:$p,present:false}')"; continue; fi
  want="$(jq -r --arg r "$role" '.roles[] | select(.name == $r) | .files[]' <<<"$reg")"
  have="$(ls -A "$d")"
  for f in $(printf '%s\n%s\n' "$want" "$have" | sort -u); do
    p="$d/$f"
    if [ ! -e "$p" ]; then row a "$p (root view)" "present, $role 0400" absent 0 "$(jq -nc --arg p "$p" '{path:$p,present:false}')"; continue; fi
    read -r fu fm <<<"$(stat -c '%u %a' "$p")"
    r_role=no; as_uid "$uid" "$p" && r_role=yes
    r_dev=no; as_uid 1000 "$p" && r_dev=yes
    r_oth=n/a; [ -n "$other" ] && { r_oth=no; as_uid "$other" "$p" && r_oth=yes; }
    okv=0; [ "$fu" = "$uid" ] && [ "$fm" = 400 ] && [ $r_role = yes ] && [ $r_dev = no ] && [ "$r_oth" != yes ] && okv=1
    row a "$p (root view)" "owner $role 0400; role reads; devuser and another role refused" "owner $fu mode $fm; role read=$r_role devuser read=$r_dev other-role read=$r_oth" $okv \
      "$(jq -nc --arg p "$p" --argjson u "$fu" --arg m "$fm" --arg rr "$r_role" --arg rd "$r_dev" --arg ro "$r_oth" '{path:$p,uid:$u,mode:$m,role_read:$rr,devuser_read:$rd,other_role_read:$ro}')"
  done
done < <(jq -r '.roles[] | select((.files | length) > 0 or (.programs | length) > 0) | [.name, .uid] | @tsv' <<<"$reg")
for p in $(jq -r '[.roles[].at_rest[]] | unique[]' <<<"$reg"); do
  [ -e "$p" ] || { row a "$p (root view)" "root 0400 or absent" absent 1 "$(jq -nc --arg p "$p" '{path:$p,present:false}')"; continue; }
  read -r fu fm <<<"$(stat -c '%u %a' "$p")"
  row a "$p (root view)" "root 0400 or absent" "owner $fu mode $fm" "$([ "$fu" = 0 ] && [ "$fm" = 400 ] && echo 1 || echo 0)" "$(jq -nc --arg p "$p" --argjson u "$fu" --arg m "$fm" '{path:$p,uid:$u,mode:$m}')"
done
for p in $(jq -r '[.roles[].at_rest_dirs[]] | unique[]' <<<"$reg"); do
  [ -d "$p" ] || continue
  read -r fu fm <<<"$(stat -c '%u %a' "$p")"
  row a "$p/ (root view)" "root 0700" "owner $fu mode $fm" "$([ "$fu" = 0 ] && [ "$fm" = 700 ] && echo 1 || echo 0)" "$(jq -nc --arg p "$p" --argjson u "$fu" --arg m "$fm" '{path:$p,uid:$u,mode:$m}')"
done

# (b)
conf=/etc/supervisord.conf; [ "$FLAG" = true ] && conf=/etc/supervisord.roles.conf
status="$(supervisorctl -c "$conf" status 2>/dev/null)"
while IFS=$'\t' read -r role uid prog; do
  pid="$(awk -v p="$prog" '$1 == p && $2 == "RUNNING" {sub(/,/,"",$4); print $4; exit}' <<<"$status")"
  if [ -z "$pid" ]; then row b "$prog (root view)" "RUNNING as $role ($uid)" "not RUNNING" 0 "$(jq -nc --arg p "$prog" '{program:$p}')"; continue; fi
  read -r ru eu <<<"$(awk '/^Uid:/ {print $2, $3}' "/proc/$pid/status")"
  row b "$prog (root view)" "RUNNING as $role ($uid)" "pid $pid uid $ru/$eu" "$([ "$ru" = "$uid" ] && [ "$eu" = "$uid" ] && echo 1 || echo 0)" "$(jq -nc --arg p "$prog" --argjson pid "$pid" --argjson u "$ru" '{program:$p,pid:$pid,uid:$u}')"
done < <(jq -r '.roles[] | .name as $n | .uid as $u | .programs[] | [$n, $u, .] | @tsv' <<<"$reg")

# (e) names only: environ is split on NUL and cut at '=' before anything is compared.
classified="$(jq -r '(.roles[] | .uid as $u | .env[] | "\(.) \($u)"), (.classified_root_env // [] | .[] | "\(.name) 0")' <<<"$reg")"
names="$(awk '{print $1}' <<<"$classified" | sort -u | paste -sd'|' -)"
hits="[]"; n=0
for pd in /proc/[0-9]*; do
  pid="${pd##*/}"; u="$(awk '/^Uid:/ {print $2; exit}' "$pd/status" 2>/dev/null)"; [ -n "$u" ] || continue
  n=$((n + 1))
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    holder="$(awk -v n="$name" '$1 == n {print $2; exit}' <<<"$classified")"
    if [ "$pid" = 1 ] || [ "$u" != "$holder" ]; then
      hits="$(jq -c --argjson pid "$pid" --argjson u "$u" --arg n "$name" '. + [{pid:$pid,uid:$u,name:$n}]' <<<"$hits")"
    fi
  done < <(tr '\0' '\n' <"$pd/environ" 2>/dev/null | cut -d= -f1 | grep -xE "$names")
done
row e "all-environ (root view)" "no classified name outside its role, none in PID 1 ($n processes)" "$(jq length <<<"$hits") hits" "$([ "$hits" = "[]" ] && echo 1 || echo 0)" "$(jq -nc --argjson h "$hits" --argjson n "$n" '{processes:$n,hits:$h}')"
f=/run/agentbox/identity.env
if [ -e "$f" ]; then
  c="$(cut -d= -f1 "$f" | sed 's/^export[[:space:]]*//' | grep -cxE "$names")"
  row e "$f (root view)" "no classified name" "$c lines name a role secret" "$([ "$c" = 0 ] && echo 1 || echo 0)" "$(jq -nc --argjson c "$c" '{path:"/run/agentbox/identity.env",lines:$c}')"
else row e "$f (root view)" "no classified name" absent 1 '{"path":"/run/agentbox/identity.env","present":false}'; fi
PROBE_EOF

if ! "$DOCKER" exec -i -u 0 -e "PATH=$PROBE_PATH" -e "RH_REGISTRY_JSON=$REGISTRY" -e "FLAG=$FLAG" "$C" /bin/bash -s <<<"$PROBE" >"$WORK/probe.jsonl" 2>"$WORK/probe.err"; then
  jqx -nc --arg e "$(tail -c 300 "$WORK/probe.err" | tr -d '\0')" '{check:"h-probe",target:"in-container root probe",expected:"ran",observed:("failed: " + $e),ok:false,evidence:{}}' >>"$ROWS"
fi
cat "$WORK/probe.jsonl" >>"$ROWS"
[ -s "$WORK/probe.jsonl" ] || jqx -nc '{check:"h-probe",target:"in-container root probe",expected:"rows",observed:"no rows",ok:false,evidence:{}}' >>"$ROWS"

# ── host-local checks ──────────────────────────────────────────────────────────────────────
ACCOUNTS="[]"
for id in $(seq 960 979); do
  for db in passwd group; do
    line="$("$GETENT" "$db" "$id" 2>/dev/null | head -1)"
    [ -n "$line" ] && ACCOUNTS="$(jqx -c --arg db "$db" --argjson id "$id" --arg n "${line%%:*}" '. + [{db:$db,id:$id,name:$n}]' <<<"$ACCOUNTS")"
  done
done
NCOLL="$(jqx length <<<"$ACCOUNTS")"
jqx -nc --argjson h "$ACCOUNTS" --argjson n "$NCOLL" '{check:"h-uid-collision",target:"host getent passwd/group 960-979",expected:"no host account or group in the role range",observed:"\($n) entries",ok:($n == 0),evidence:{entries:$h}}' >>"$ROWS"

S="$("$STAT" -c '%u %g %a %d' "$HOST_SOCKET" 2>/dev/null)"
read -r SU SG SM _ <<<"$S"
jqx -nc --arg s "$S" --arg u "${SU:-}" --arg g "${SG:-}" --arg m "${SM:-}" '{check:"h-socket",target:"/var/run/docker.sock (host)",expected:"recorded for the owner (Q2)",
  observed:(if $s == "" then "absent" else "uid \($u) gid \($g) mode \($m)" + (if ($m | tostring | .[-1:]) != "0" then " (world-accessible)" else "" end) end),ok:true,recorded:true,
  evidence:{path:"/var/run/docker.sock",uid:$u,gid:$g,mode:$m}}' >>"$ROWS"

# ── verdict and receipt ───────────────────────────────────────────────────────────────────
FINISHED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CHECKS="$(jqx -sc --argjson flag "$FLAG" 'map(
  if .recorded then . + {status:"recorded"}
  elif $flag then . + {status:(if .ok then "pass" else "fail" end)}
  else . + {status:"not_applicable", reason:"flag off", would_pass:.ok} end | del(.ok, .recorded))' "$ROWS")"
FAILS="$(jqx '[.[] | select(.status == "fail")] | length' <<<"$CHECKS")"
if [ "$FLAG" != true ]; then VERDICT=STAGED; CODE=2
elif [ "$FAILS" -gt 0 ]; then VERDICT=FAIL; CODE=1
else VERDICT=PASS; CODE=0; fi

COMMIT="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"
DIRTY=false; git -C "$REPO" diff --quiet HEAD -- scripts/activation 2>/dev/null || DIRTY=true
mkdir -p "$RECEIPT_DIR" || die "cannot create $RECEIPT_DIR"
RECEIPT="$RECEIPT_DIR/x1-rehearsal-host-$(date -u -d "$FINISHED" +%Y%m%dT%H%M%SZ).json"
jqx -n --arg verdict "$VERDICT" --argjson code "$CODE" --argjson flag "$FLAG" --arg fsrc "$FLAG_SOURCE" \
  --arg image "$IMAGE_ID" --arg c "$C" --arg commit "$COMMIT" --argjson dirty "$DIRTY" --arg s "$STARTED" --arg f "$FINISHED" \
  --arg op "$(id -un 2>/dev/null || echo unknown)" --argjson opuid "$(id -u)" --argjson reg "$REGISTRY" --argjson acc "$ACCOUNTS" \
  --argjson checks "$CHECKS" '{
    schema: "agentbox/x1-rehearsal@1",
    half: "host",
    verdict: $verdict, exit_code: $code,
    flag: {key: "[security].role_isolation", value: $flag, source: $fsrc, manifest: "/etc/agentbox.toml"},
    image: {build_id: $image, container: $c},
    commit: $commit, rehearsal_dirty: $dirty,
    started_at: $s, finished_at: $f,
    operator: {user: $op, uid: $opuid},
    uid_table: {source: $reg.source, roles: [$reg.roles[] | {role: .name, uid, gid, programs, files: [.files[] as $x | "/run/secrets/\(.name)/\($x)"], classified_env: .env} + (if .deferred then {deferred} else {} end)], host_accounts: $acc},
    checks: $checks,
    summary: {
      pass: ([$checks[] | select(.status == "pass")] | length),
      fail: ([$checks[] | select(.status == "fail")] | length),
      not_applicable: ([$checks[] | select(.status == "not_applicable")] | length),
      recorded: ([$checks[] | select(.status == "recorded")] | length),
      would_fail: ([$checks[] | select(.would_pass == false)] | length),
      failed_checks: ([$checks[] | select(.status == "fail" or .would_pass == false) | .check] | unique)
    },
    legacy_copies: ([$reg.roles[].legacy[]] | unique),
    degraded: [],
    not_covered: [
      "devuser-side probes, (c) signing, (d) producer, (f) group and socket reachability (role-isolation-rehearsal.sh, in the container as devuser)",
      "idempotence and rollback across reboots (owner-run; needs two boots)"
    ]
  }' >"$RECEIPT" || die "could not write $RECEIPT"

jqx -r '.[] | "  \(if .status == "pass" then "ok  " elif .status == "fail" then "FAIL" elif .status == "recorded" then "rec " else (if .would_pass then "n/a+" else "n/a-" end) end) (\(.check)) \(.target) — \(.observed)"' <<<"$CHECKS"
echo
jqx -r '"verdict \(.verdict) (exit \(.exit_code)): \(.summary.pass) pass, \(.summary.fail) fail, \(.summary.not_applicable) not applicable, \(.summary.recorded) recorded"' <"$RECEIPT"
echo "receipt ${RECEIPT#"$REPO"/}"
exit "$CODE"
