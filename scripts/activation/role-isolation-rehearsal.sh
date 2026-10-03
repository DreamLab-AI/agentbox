#!/usr/bin/env bash
# X-1 step 1 boot rehearsal, container half (custody design §4; workstream W6a).
#
# Decides whether `[security].role_isolation` may stay on. Runs INSIDE the container AS
# DEVUSER and probes from devuser's side of each boundary. The root's-eye probes (role-uid
# reads, other processes' environ, host socket mode, host uid collisions) are the host half:
# scripts/activation/role-isolation-rehearsal.host.sh, run from the host shell.
#
# Checks (each row of the receipt carries one target):
#   (a) every role secret under /run/secrets/<role>/ and every at-rest copy on the volumes is
#       refused to devuser with EACCES; /run/secrets is a root-owned 0711 mount point; each
#       /run/secrets/<role>/ is 0500 and owned by the role uid
#   (b) every role program is RUNNING under supervisor with real and effective uid equal to the
#       role uid, and its /proc/<pid>/environ is unreadable to devuser
#   (c) signing works through the identity port: a pods NIP-98 header and a forum event made by
#       the port verify with the estate's own verifier (NostrBridge.verifyNip98 / nostr-tools),
#       a NIP-42 AUTH is accepted by the loopback relay, and dm_unwrap / a foreign URL / a
#       generic sign op are refused, with one sign receipt line per call
#   (d) each enabled chain's producer runs as its role uid and has a block younger than
#       2 x its interval (--wait: otherwise poll until the tip advances, at most 2 x interval)
#   (e) no role secret is ambient: classified by the role inventory's VARIABLE NAMES and flag
#       names, never by value, across every process's argv, the environ of every devuser
#       process, the supervisor configs' environment= lines, identity.env and /var/log
#   (f) devuser is not in group 0, cannot drive the docker socket, cannot sudo, and no role
#       gid equals the socket's group
#
# Verdict and exit code:
#   0 PASS    flag on, every row passed
#   2 STAGED  flag off (absent = false): every row is "not_applicable: flag off"; the receipt
#             still carries what was observed and whether the row would have passed
#   1 FAIL    flag on and a row failed, OR the rehearsal could not run. A check that is
#             required but could not be made (missing tool, socket, program) is a FAIL.
#
# Receipt: docs/estate-closeout/x1-rehearsal-<UTC>.json, schema
# docs/estate-closeout/schema/x1-rehearsal.schema.json. It holds names, paths, modes, uids,
# pids, counts and public keys only. No secret value is read into the receipt or printed:
# environ files are parsed for names, log files are counted with grep -c, and secret files
# are only opened, never read.
#
# The role table: /etc/agentbox/role-accounts.json when the image ships it (W1 emits it from
# lib/role-accounts.nix); otherwise derived here from the manifest with the design's §2.2
# numbering (960 identity, 961 gateway, 962 ingress, 963 spend, then per chain from 964:
# ab-sidestr-<chain>, ab-faucet-<chain>; dreamlab first, then [sidechain.<name>] sorted).
#
# Identity-port client contract assumed for (c) (W3a implements it; design §2.5):
#   nostr-pod-bridge sign-request <op>   JSON params on stdin, JSON on stdout, exit 0
#     pubkey        {key}                               -> {"pubkey": "<x-only hex>"}
#     nip98         {key, method, url, payload_sha256}  -> {"header": "Nostr <base64>"}
#     forum_event   {key, kind, content, dry_run}       -> {"event": {...signed...}}
#     nip42_auth    {key, relay, challenge}             -> {"event": {...kind 22242...}}
#   a refusal exits non-zero with {"refused": "<reason>"}.
#
#   --print-registry   print the role table as JSON and exit (the host half uses this)
#   --wait             (d): poll a stale tip for up to 2 x interval instead of failing at once
#   --receipt-dir DIR  where the receipt goes (default: docs/estate-closeout of this checkout)
#
# Test seams (tests/config/role-isolation-rehearsal.test.sh): RH_ROOT (prefix for every
# filesystem path), RH_MANIFEST, RH_REGISTRY, RH_SUPERVISORCTL, RH_DOCKER, RH_SUDO, RH_GROUPS,
# RH_DEVUSER_UID, RH_STAT, RH_SIGN_CLIENT, RH_NIP98_VERIFIER, RH_RELAY_AUTH, RH_CURL, RH_NOW,
# RH_EXPECT_CORE_PUBKEY, RH_EXPECT_JJ_PUBKEY, RH_IMAGE_ID, RH_RELAY_URL.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
R="${RH_ROOT:-}"
MANIFEST="${RH_MANIFEST:-$R/etc/agentbox.toml}"
SUPERVISORCTL="${RH_SUPERVISORCTL:-supervisorctl}"
DOCKER="${RH_DOCKER:-docker}"
SUDO="${RH_SUDO:-sudo}"
STAT="${RH_STAT:-stat}"
CURL="${RH_CURL:-curl}"
SIGN_CLIENT="${RH_SIGN_CLIENT:-nostr-pod-bridge sign-request}"
RELAY_URL="${RH_RELAY_URL:-ws://127.0.0.1:7777}"
DEV_UID="${RH_DEVUSER_UID:-$(id -u)}"
EXPECT_CORE="${RH_EXPECT_CORE_PUBKEY-${AGENTBOX_X_ONLY_PUBKEY_HEX:-}}"
EXPECT_JJ="${RH_EXPECT_JJ_PUBKEY-${JUNKIEJARVIS_PUBKEY:-}}"
IMAGE_ID="${RH_IMAGE_ID-${AGENTBOX_IMAGE_HASH:-}}"
RECEIPT_DIR="$REPO/docs/estate-closeout"
WAIT=0
MODE=run

while [ $# -gt 0 ]; do
  case "$1" in
    --print-registry) MODE=registry ;;
    --wait) WAIT=1 ;;
    --receipt-dir) RECEIPT_DIR="${2:?--receipt-dir needs a directory}"; shift ;;
    -h|--help) sed -n '2,/^set -uo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) echo "role-isolation-rehearsal: unknown argument '$1'" >&2; exit 1 ;;
  esac
  shift
done

die() { echo "role-isolation-rehearsal: $*" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || die "jq is required"
command -v node >/dev/null 2>&1 || die "node is required"

# The container half is devuser's view. Run as root it would see through every boundary and
# pass vacuously; outside the container it would probe the host.
if [ -z "$R" ]; then
  [ "$(id -u)" != 0 ] || die "run this as devuser; the root view is the host half's job"
  [ -e /.dockerenv ] || die "run this inside the agentbox container (the host half is role-isolation-rehearsal.host.sh)"
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/x1-rehearsal.XXXXXX")" || die "mktemp failed"
trap 'rm -rf "$WORK"' EXIT
ROWS="$WORK/rows.jsonl"; : >"$ROWS"

# ── manifest ──────────────────────────────────────────────────────────────────────────────
# Same anchored-awk reader as config/entrypoint-unified.sh (_ab_toml_val).
toml_val() { # <section> <key>
  awk -v sec="[$1]" -v key="$2" '
    $0==sec {f=1;next} /^\[/{f=0}
    f && index($0,key)==1 && $0 ~ ("^" key "[[:space:]]*=") {
      sub(/^[^=]*=[[:space:]]*/,""); sub(/[[:space:]]*(#.*)?$/,""); gsub(/"/,"");
      print; exit }' "$MANIFEST"
}
toml_bool() { case "$(toml_val "$1" "$2")" in 1|true|TRUE|True|yes|on) echo true ;; *) echo false ;; esac; }
toml_int() { local v; v="$(toml_val "$1" "$2")"; case "$v" in ''|*[!0-9]*) echo "$3" ;; *) echo "$v" ;; esac; }

[ -r "$MANIFEST" ] || die "manifest $MANIFEST is unreadable; the flag cannot be known"
FLAG_RAW="$(toml_val security role_isolation)"
if [ -z "$FLAG_RAW" ]; then FLAG=false; FLAG_SOURCE="absent-default-false"
else FLAG="$(toml_bool security role_isolation)"; FLAG_SOURCE="manifest"; fi

# ── role table ────────────────────────────────────────────────────────────────────────────
IDENTITY_ENV='["AGENTBOX_PRIVKEY_HEX","AGENTBOX_NSEC","AGENTBOX_BRIDGE_SK","AGENTBOX_AGENT_PRIVKEY_HEX","JUNKIEJARVIS_PRIVKEY_HEX","CONCIERGE_PRIVKEY_HEX"]'
INGRESS_ENV='["NIP98_PROXY_ALLOW_BEARER","NIP98_PROXY_SESSION_SECRET"]'

derive_registry() {
  local chains=() c i=0 base=964 enabled faucet port interval cred fkey prod_prog fauc_prog roles
  grep -q '^\[sidechain\]' "$MANIFEST" && chains+=(dreamlab)
  while IFS= read -r c; do [ -n "$c" ] && chains+=("$c"); done < <(sed -n 's/^\[sidechain\.\([A-Za-z0-9_-]*\)\][[:space:]]*$/\1/p' "$MANIFEST" | sort)
  roles="$(jq -nc --argjson ienv "$IDENTITY_ENV" --argjson genv "$INGRESS_ENV" '[
    {name:"ab-identity",uid:960,gid:960,programs:["nostr-relay"],files:["nostr.key"],env:$ienv,
     at_rest:["/var/lib/agentbox/identities/agentbox-core.json","/run/secrets/nostr.key"],
     at_rest_dirs:["/var/lib/agentbox/identities"],legacy:["/home/devuser/workspace/.agentbox/zone-keys.json"]},
    {name:"ab-gateway",uid:961,gid:961,programs:["nostr-gateway"],files:[],env:[],at_rest:[],at_rest_dirs:[],legacy:[]},
    {name:"ab-ingress",uid:962,gid:962,programs:["nip98-proxy"],files:[],env:$genv,at_rest:[],at_rest_dirs:[],legacy:[]},
    {name:"ab-spend",uid:963,gid:963,programs:[],files:[],env:[],at_rest:[],at_rest_dirs:[],legacy:[],deferred:"Q6: pay402 and Hitch stay devuser-class in step 1"}
  ]')"
  for c in "${chains[@]}"; do
    if [ "$c" = dreamlab ]; then
      enabled="$(toml_bool sidechain enabled)"; faucet="$(toml_bool sidechain faucet)"
      port="$(toml_int sidechain port 3450)"; interval="$(toml_int sidechain interval 600)"
      cred="$(toml_val sidechain parent_credential_file)"; cred="${cred:-/var/lib/agentbox/secrets/sidestr-tbtc4.cookie}"
      fkey="$(toml_val sidechain faucet_key_file)"; prod_prog=sidestr-producer; fauc_prog=sidestr-faucet
    else
      enabled=false; [ "$(toml_bool sidechain enabled)" = true ] && enabled="$(toml_bool "sidechain.$c" enabled)"
      faucet="$(toml_bool "sidechain.$c" faucet)"
      port="$(toml_int "sidechain.$c" port 3450)"; interval="$(toml_int "sidechain.$c" interval 600)"
      cred="$(toml_val "sidechain.$c" parent_credential_file)"
      fkey="$(toml_val "sidechain.$c" faucet_key_file)"; prod_prog="sidestr-producer-$c"; fauc_prog="sidestr-faucet-$c"
    fi
    [ "$enabled" = true ] || faucet=false
    roles="$(jq -c --arg c "$c" --argjson u $((base + 2 * i)) --argjson en "$enabled" --argjson fa "$faucet" \
      --argjson port "$port" --argjson iv "$interval" --arg cred "$cred" --arg fkey "$fkey" \
      --arg pp "$prod_prog" --arg fp "$fauc_prog" '. + [
      {name:("ab-sidestr-" + $c),uid:$u,gid:$u,chain:$c,port:$port,interval:$iv,enabled:$en,
       programs:(if $en then [$pp] else [] end),files:(if $en then ["signer.key","parent.cred"] else [] end),env:[],
       at_rest:(if $en then ["/var/lib/agentbox/secrets/sidestr-" + $c + ".key"] + (if $cred == "" then [] else [$cred] end) else [] end),
       at_rest_dirs:(if $en then ["/var/lib/agentbox/secrets"] else [] end),legacy:[]},
      {name:("ab-faucet-" + $c),uid:($u + 1),gid:($u + 1),chain:$c,enabled:$fa,
       programs:(if $fa then [$fp] else [] end),files:(if $fa then ["treasury.key"] else [] end),env:[],
       at_rest:(if $fa then ["/var/lib/agentbox/secrets/sidestr-faucet-" + $c + ".key"] else [] end),at_rest_dirs:[],
       legacy:(if $fa and $fkey != "" then [$fkey] else [] end)}
    ]' <<<"$roles")"
    i=$((i + 1))
  done
  jq -c --arg src "derived from $MANIFEST (design §2.2 numbering)" '{source:$src, roles:., classified_root_env:[{name:"TAILSCALE_AUTHKEY",holder:"tailscale-up (root)"}]}' <<<"$roles"
}

if [ -n "${RH_REGISTRY:-}" ]; then REGISTRY="$(jq -c . "$RH_REGISTRY")" || die "RH_REGISTRY is not JSON"
elif [ -r "$R/etc/agentbox/role-accounts.json" ]; then REGISTRY="$(jq -c --arg src "$R/etc/agentbox/role-accounts.json" '.source = $src' "$R/etc/agentbox/role-accounts.json")" || die "role-accounts.json is not JSON"
else REGISTRY="$(derive_registry)" || die "could not derive the role table"; fi

if [ "$MODE" = registry ]; then printf '%s\n' "$REGISTRY"; exit 0; fi

# Every classified variable name, each with the role allowed to hold it.
CLASSIFIED="$(jq -r '(.roles[] | .name as $r | .env[] | "\(.) \($r)"), (.classified_root_env // [] | .[] | "\(.name) root")' <<<"$REGISTRY")"
CLASS_NAMES="$(awk '{print $1}' <<<"$CLASSIFIED" | sort -u | paste -sd'|' -)"
SECRET_FLAGS='--nsec|--privkey|--private-key|--secret-key|--sk'
ROLE_GIDS="$(jq -r '.roles[].gid' <<<"$REGISTRY" | sort -u | paste -sd' ' -)"

# ── row recording ─────────────────────────────────────────────────────────────────────────
# row <check> <target> <expected> <observed> <ok 1|0> [evidence-json]
row() {
  local ev="${6:-}"; [ -n "$ev" ] || ev='{}'
  jq -nc --arg c "$1" --arg t "$2" --arg e "$3" --arg o "$4" --argjson ok "$([ "$5" = 1 ] && echo true || echo false)" \
    --argjson ev "$ev" '{check:$c,target:$t,expected:$e,observed:$o,ok:$ok,evidence:$ev}' >>"$ROWS"
}

# st <path> -> "uid gid octal-mode device" (empty when the path cannot be stat'ed)
st() { "$STAT" -c '%u %g %a %d' "$1" 2>/dev/null; }

# try_open <path> -> ok | EACCES | ENOENT | other:<msg>. Opens for reading, reads nothing.
try_open() {
  local err
  if err="$( { : <"$1"; } 2>&1 )"; then echo ok; return; fi
  case "$err" in *"Permission denied"*) echo EACCES ;; *"No such file"*) echo ENOENT ;; *) echo "other:${err##*: }" ;; esac
}
try_list() {
  local err
  if err="$(ls -- "$1" 2>&1 >/dev/null)"; then echo ok; return; fi
  case "$err" in *"Permission denied"*) echo EACCES ;; *"No such file"*) echo ENOENT ;; *) echo other ;; esac
}

# proc_uids <pid> -> "real effective saved fs" ("" if gone)
proc_uids() { awk '/^Uid:/ {print $2, $3, $4, $5; exit}' "$R/proc/$1/status" 2>/dev/null; }

# ── supervisor view ───────────────────────────────────────────────────────────────────────
ROLES_CONF="$R/etc/supervisord.roles.conf"
PLAIN_CONF="$R/etc/supervisord.conf"
if [ "$FLAG" = true ] || [ -r "$ROLES_CONF" ]; then ACTIVE_CONF="$ROLES_CONF"; else ACTIVE_CONF="$PLAIN_CONF"; fi
SUP_STATUS="$("$SUPERVISORCTL" -c "${ACTIVE_CONF#"$R"}" status 2>/dev/null)"; SUP_RC=$?
# supervisorctl status exits 3 when any program is not RUNNING; that is not an error here.
[ -n "$SUP_STATUS" ] || SUP_RC=99
sup_line() { awk -v p="$1" '$1 == p {print; exit}' <<<"$SUP_STATUS"; }
sup_state() { awk '{print $2}' <<<"$(sup_line "$1")"; }
sup_pid() { sed -n 's/.* pid \([0-9]*\),.*/\1/p' <<<"$(sup_line "$1")"; }

echo "X-1 role-isolation rehearsal, container half — flag role_isolation=$FLAG ($FLAG_SOURCE)"

# ── (a) only the role can read its secret ─────────────────────────────────────────────────
check_a() {
  local s uid mode dev rdev role ruid f p r d
  local obs mp=false ok=0
  s="$(st "$R/run/secrets")"; read -r uid _ mode dev <<<"$s"
  rdev="$(st "$R/run" | awk '{print $4}')"
  if [ -z "$s" ]; then obs=absent
  else
    [ -n "$rdev" ] && [ "$dev" != "$rdev" ] && mp=true
    obs="uid $uid mode $mode, $([ "$mp" = true ] && echo "own mount" || echo "same filesystem as /run (renamable by /run's owner)")"
    [ "$uid" = 0 ] && [ "$mode" = 711 ] && [ "$mp" = true ] && ok=1
  fi
  row a /run/secrets "root-owned 0711 mount point" "$obs" "$ok" \
    "$(jq -nc --arg u "${uid:-}" --arg m "${mode:-}" --argjson mp "$mp" '{path:"/run/secrets",uid:$u,mode:$m,mount_point:$mp}')"
  while IFS=$'\t' read -r role ruid; do
    d="/run/secrets/$role"; s="$(st "$R$d")"; read -r uid _ mode dev <<<"$s"
    if [ -n "$s" ] && [ "$uid" = "$ruid" ] && [ "$mode" = 500 ]; then
      row a "$d" "dir 0500 owned by $role ($ruid)" "uid $uid mode $mode" 1 "$(jq -nc --arg p "$d" --argjson u "$uid" --arg m "$mode" '{path:$p,uid:$u,mode:$m}')"
    else
      if [ -n "$s" ]; then obs="uid $uid mode $mode"; else obs=absent; fi
      row a "$d" "dir 0500 owned by $role ($ruid)" "$obs" 0 "$(jq -nc --arg p "$d" --arg u "${uid:-}" --arg m "${mode:-}" '{path:$p,uid:$u,mode:$m}')"
    fi
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      p="$d/$f"; r="$(try_open "$R$p")"
      row a "$p" "devuser open() -> EACCES" "$r" "$([ "$r" = EACCES ] && echo 1 || echo 0)" "$(jq -nc --arg p "$p" --arg r "$r" '{path:$p,devuser_open:$r}')"
    done < <(jq -r --arg r "$role" '.roles[] | select(.name == $r) | .files[]' <<<"$REGISTRY")
  done < <(jq -r '.roles[] | select((.files | length) > 0 or (.programs | length) > 0) | [.name, .uid] | @tsv' <<<"$REGISTRY")
  # At-rest copies: refused or absent (absence of a source is caught by the role's own copy).
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    r="$(try_open "$R$p")"
    row a "$p" "devuser open() -> EACCES or ENOENT (at rest)" "$r" "$(case "$r" in EACCES|ENOENT) echo 1 ;; *) echo 0 ;; esac)" "$(jq -nc --arg p "$p" --arg r "$r" '{path:$p,devuser_open:$r}')"
  done < <(jq -r '[.roles[].at_rest[]] | unique[]' <<<"$REGISTRY")
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    r="$(try_list "$R$p")"
    row a "$p/" "devuser opendir() -> EACCES (at rest)" "$r" "$([ "$r" = EACCES ] && echo 1 || echo 0)" "$(jq -nc --arg p "$p" --arg r "$r" '{path:$p,devuser_opendir:$r}')"
  done < <(jq -r '[.roles[].at_rest_dirs[]] | unique[]' <<<"$REGISTRY")
}

# ── (b) programs run as their roles ───────────────────────────────────────────────────────
check_b() {
  local role ruid prog state pid uids r ru eu
  if [ "$FLAG" = true ] && [ ! -r "$ROLES_CONF" ]; then
    row b /etc/supervisord.roles.conf "present (the flag selects it)" absent 0 '{"path":"/etc/supervisord.roles.conf"}'
  fi
  if [ "$SUP_RC" = 99 ]; then
    row b supervisorctl "status answers" "no output" 0 '{}'
    return
  fi
  while IFS=$'\t' read -r role ruid prog; do
    if ! grep -q "^\[program:$prog\]" "$ACTIVE_CONF" 2>/dev/null; then
      row b "$prog" "baked in ${ACTIVE_CONF#"$R"}" "no [program:$prog] block" 0 "$(jq -nc --arg p "$prog" --arg c "${ACTIVE_CONF#"$R"}" '{program:$p,config:$c}')"
      continue
    fi
    state="$(sup_state "$prog")"; pid="$(sup_pid "$prog")"
    if [ "$state" != RUNNING ] || [ -z "$pid" ]; then
      row b "$prog" "RUNNING as $role ($ruid)" "${state:-not in supervisorctl status}" 0 "$(jq -nc --arg p "$prog" --arg s "${state:-missing}" '{program:$p,state:$s}')"
      continue
    fi
    uids="$(proc_uids "$pid")"; read -r ru eu _ _ <<<"$uids"
    r="$(try_open "$R/proc/$pid/environ")"
    if [ "$ru" = "$ruid" ] && [ "$eu" = "$ruid" ] && [ "$r" = EACCES ]; then
      row b "$prog" "RUNNING as $role ($ruid), environ unreadable" "pid $pid uid $ru/$eu, environ $r" 1 "$(jq -nc --arg p "$prog" --argjson pid "$pid" --argjson u "$ru" --arg r "$r" '{program:$p,pid:$pid,uid:$u,environ_devuser_open:$r}')"
    else
      row b "$prog" "RUNNING as $role ($ruid), environ unreadable" "pid $pid uid ${ru:-?}/${eu:-?}, environ $r" 0 "$(jq -nc --arg p "$prog" --argjson pid "$pid" --arg u "${ru:-}" --arg r "$r" '{program:$p,pid:$pid,uid:$u,environ_devuser_open:$r}')"
    fi
  done < <(jq -r '.roles[] | .name as $n | .uid as $u | .programs[] | [$n, $u, .] | @tsv' <<<"$REGISTRY")
}

# ── (c) signing works through the identity port ───────────────────────────────────────────
VERIFY_JS='
const path = require("path");
const [mode, expected, method, url, wantKind] = process.argv.slice(1);
const verifierPath = process.env.RH_VERIFIER;
const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(o.ok ? 0 : 1); };
let resp; try { resp = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { out({ ok: false, error: "client output is not JSON" }); }
let bridge, tools;
try {
  bridge = require(verifierPath);
  tools = require(require.resolve("nostr-tools", { paths: [path.dirname(verifierPath)] }));
} catch (e) { out({ ok: false, error: "verifier unavailable: " + e.code }); }
let want = expected || "";
if (want.startsWith("npub1")) { try { want = tools.nip19.decode(want).data; } catch { out({ ok: false, error: "expected npub undecodable" }); } }
if (!/^[0-9a-f]{64}$/.test(want)) out({ ok: false, error: "no expected public key to compare against" });
if (mode === "nip98") {
  const r = bridge.NostrBridge.verifyNip98(String(resp.header || ""), method, url);
  let id = null; try { id = JSON.parse(Buffer.from(String(resp.header).slice(6), "base64").toString()).id; } catch {}
  out({ ok: !!r.valid && r.pubkey === want, valid: !!r.valid, pubkey: r.pubkey, pubkey_match: r.pubkey === want, error: r.error || null, event_id: id });
}
const ev = resp.event || {};
let valid = false; try { valid = tools.verifyEvent(ev); } catch {}
const kindOk = !wantKind || ev.kind === Number(wantKind);
out({ ok: valid && ev.pubkey === want && kindOk, valid, pubkey: ev.pubkey || null, pubkey_match: ev.pubkey === want, kind: ev.kind ?? null, event_id: ev.id || null });
'

# Default relay probe: a real NIP-42 exchange with the loopback relay; the challenge comes from
# the relay and the AUTH event from the port.
RELAY_JS='
const { execFileSync } = require("child_process");
const relay = process.argv[1];
const client = (process.env.RH_SIGN_CLIENT || "").split(/\s+/).filter(Boolean);
const done = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(o.accepted ? 0 : 1); };
if (typeof WebSocket !== "function") done({ accepted: false, reason: "no WebSocket in this node" });
const ws = new WebSocket(relay); let sent = null;
setTimeout(() => done({ accepted: false, reason: sent ? "no OK for the AUTH event" : "relay issued no AUTH challenge" }), 8000);
ws.onerror = () => done({ accepted: false, reason: "relay unreachable" });
ws.onopen = () => setTimeout(() => { if (!sent) ws.send(JSON.stringify(["REQ", "x1-rehearsal", { limit: 0 }])); }, 1500);
ws.onmessage = (m) => {
  let msg; try { msg = JSON.parse(String(m.data)); } catch { return; }
  if (msg[0] === "AUTH" && !sent) {
    let resp;
    try { resp = JSON.parse(execFileSync(client[0], [...client.slice(1), "nip42_auth"], { input: JSON.stringify({ key: "core", relay, challenge: msg[1] }) }).toString()); }
    catch { done({ accepted: false, reason: "port refused nip42_auth" }); }
    if (!resp || !resp.event) done({ accepted: false, reason: "port returned no event" });
    sent = resp.event; ws.send(JSON.stringify(["AUTH", sent]));
  } else if (msg[0] === "OK" && sent && msg[1] === sent.id) {
    done({ accepted: msg[2] === true, event_id: sent.id, reason: msg[2] ? null : String(msg[3] || "rejected") });
  }
};
'

check_c() {
  local sock="/run/secrets/port/identity.sock" verifier client=() r out ok pod_base url before after calls=0 rdir
  local ops=(pods-nip98 forum-event relay-nip42 refuse-dm_unwrap refuse-foreign-url refuse-generic-sign)
  verifier="${RH_NIP98_VERIFIER:-}"
  if [ -z "$verifier" ]; then
    for v in /opt/agentbox/management-api/lib/nostr-bridge.js "$REPO/mcp/servers/nostr-bridge.js"; do [ -r "$v" ] && { verifier="$v"; break; }; done
  fi
  if [ ! -S "$R$sock" ]; then
    row c "$sock" "identity port socket present" absent 0 "$(jq -nc --arg p "$sock" '{path:$p}')"
    for op in pubkey "${ops[@]}" receipts; do row c "$op" "made through the port" "not attempted: port socket absent" 0 '{}'; done
    return
  fi
  row c "$sock" "identity port socket present" present 1 "$(jq -nc --arg p "$sock" '{path:$p}')"
  if [ -z "$verifier" ] || [ ! -r "$verifier" ]; then
    for op in "${ops[@]}"; do row c "$op" "verified by NostrBridge.verifyNip98 / nostr-tools" "not attempted: verifier not found" 0 '{}'; done
    return
  fi
  read -ra client <<<"$SIGN_CLIENT"
  rdir="$R/var/lib/agentbox/events/sign"
  count_receipts() { cat "$rdir"/*.jsonl 2>/dev/null | wc -l; }
  before="$(count_receipts)"
  # Each call runs in a command substitution, so the caller counts it (calls=...) itself.
  call() { "${client[@]}" "$1" <<<"$2" 2>/dev/null; }

  calls=$((calls + 1)); out="$(call pubkey '{"key":"core"}')"; r="$(jq -r '.pubkey // empty' <<<"$out" 2>/dev/null)"
  ok=0; [ -n "$r" ] && [ "$r" = "$EXPECT_CORE" ] && ok=1
  row c pubkey "port's core pubkey equals the identity's public key" "${r:-no pubkey}${EXPECT_CORE:+ vs expected}$([ -z "$EXPECT_CORE" ] && echo ', no expected key (AGENTBOX_X_ONLY_PUBKEY_HEX unset)')" "$ok" "$(jq -nc --arg p "$r" '{pubkey:$p}')"

  pod_base="$(toml_val integrations.solid_pod_rs base_url)"; url="${pod_base%/}/.agentbox-rehearsal/x1-probe"
  if [ -z "$pod_base" ]; then
    row c pods-nip98 "NIP-98 for the pod verifies under the core key" "no [integrations.solid_pod_rs].base_url to sign for" 0 '{}'
  else
    calls=$((calls + 1)); out="$(call nip98 "$(jq -nc --arg u "$url" '{key:"core",method:"PUT",url:$u,payload_sha256:"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}')")"
    r="$(RH_VERIFIER="$verifier" node -e "$VERIFY_JS" nip98 "$EXPECT_CORE" PUT "$url" <<<"$out")"; ok=$?
    [ -n "$r" ] || r='{"ok":false,"error":"verifier produced no output"}'
    row c pods-nip98 "NIP-98 for the pod verifies under the core key" "$(jq -r '"valid=\(.valid) pubkey_match=\(.pubkey_match)" + (if .error then " (\(.error))" else "" end)' <<<"$r")" "$([ $ok = 0 ] && echo 1 || echo 0)" \
      "$(jq -c --arg u "$url" '{url:$u, pubkey, event_id, verifier:"NostrBridge.verifyNip98"}' <<<"$r")"
  fi

  calls=$((calls + 1)); out="$(call forum_event '{"key":"junkiejarvis","kind":1,"content":"x1 role-isolation rehearsal probe (dry run, not published)","dry_run":true}')"
  r="$(RH_VERIFIER="$verifier" node -e "$VERIFY_JS" event "$EXPECT_JJ" "" "" 1 <<<"$out")"; ok=$?
  [ -n "$r" ] || r='{"ok":false,"error":"verifier produced no output"}'
  row c forum-event "dry-run forum event verifies under JunkieJarvis's key" "$(jq -r '"valid=\(.valid) pubkey_match=\(.pubkey_match)" + (if .error then " (\(.error))" else "" end)' <<<"$r")" "$([ $ok = 0 ] && echo 1 || echo 0)" \
    "$(jq -c '{pubkey, event_id, kind, verifier:"nostr-tools verifyEvent"}' <<<"$r")"

  if [ -n "${RH_RELAY_AUTH:-}" ]; then r="$(RH_SIGN_CLIENT="$SIGN_CLIENT" "$RH_RELAY_AUTH" "$RELAY_URL")"; ok=$?
  else r="$(RH_SIGN_CLIENT="$SIGN_CLIENT" node -e "$RELAY_JS" "$RELAY_URL")"; ok=$?; fi
  calls=$((calls + 1))
  row c relay-nip42 "NIP-42 AUTH from the port is accepted by $RELAY_URL" "$(jq -r 'if .accepted then "accepted" else "refused: \(.reason)" end' <<<"$r" 2>/dev/null || echo 'no answer')" "$([ $ok = 0 ] && echo 1 || echo 0)" \
    "$(jq -c --arg relay "$RELAY_URL" '{relay:$relay, event_id:(.event_id // null)}' <<<"$r" 2>/dev/null || echo '{}')"

  refuse() { # <target> <op> <json>
    local o rc
    calls=$((calls + 1)); o="$(call "$2" "$3")"; rc=$?
    if [ $rc != 0 ]; then row c "$1" "refused" "refused: $(jq -r '.refused // "no reason"' <<<"$o" 2>/dev/null)" 1 "$(jq -nc --arg op "$2" --argjson rc "$rc" '{op:$op,exit:$rc}')"
    else row c "$1" "refused" "ADMITTED" 0 "$(jq -nc --arg op "$2" '{op:$op,exit:0}')"; fi
  }
  refuse refuse-dm_unwrap dm_unwrap '{"envelope":{}}'
  refuse refuse-foreign-url nip98 '{"key":"core","method":"GET","url":"https://not-allowlisted.invalid/x"}'
  refuse refuse-generic-sign sign '{"event":{"kind":1,"content":"x","tags":[]}}'

  after="$(count_receipts)"
  ok=0; [ $((after - before)) -ge "$calls" ] && ok=1
  row c receipts "one sign receipt line per call (>= $calls)" "$((after - before)) new lines" "$ok" "$(jq -nc --arg d "/var/lib/agentbox/events/sign" --argjson n $((after - before)) --argjson c "$calls" '{dir:$d,new_lines:$n,calls:$c}')"
}

# ── (d) the producer still makes a block ──────────────────────────────────────────────────
check_d() {
  local role ruid chain port iv prog tip h t age pid ru eu n=0 deadline h2 obs
  while IFS=$'\t' read -r role ruid chain port iv prog; do
    n=$((n + 1))
    pid="$(sup_pid "$prog")"; read -r ru eu _ _ <<<"$(proc_uids "${pid:-0}")"
    if [ -n "$pid" ] && [ "$ru" = "$ruid" ] && [ "$eu" = "$ruid" ]; then
      row d "$prog" "producer runs as $role ($ruid)" "pid $pid uid $ru" 1 "$(jq -nc --arg p "$prog" --argjson pid "$pid" --argjson u "$ru" '{program:$p,pid:$pid,uid:$u}')"
    else
      if [ -n "$pid" ]; then obs="pid $pid uid ${ru:-?}"; else obs="not RUNNING under supervisor"; fi
      row d "$prog" "producer runs as $role ($ruid)" "$obs" 0 "$(jq -nc --arg p "$prog" --arg pid "${pid:-}" --arg u "${ru:-}" '{program:$p,pid:$pid,uid:$u}')"
    fi
    tip="$("$CURL" -fsS --max-time 5 "http://127.0.0.1:$port/tip" 2>/dev/null)"
    h="$(jq -r '.height // empty' <<<"$tip" 2>/dev/null)"; t="$(jq -r '.time // empty' <<<"$tip" 2>/dev/null)"
    if [ -z "$h" ] || [ -z "$t" ]; then
      row d "sidestr:$chain tip" "a block younger than $((2 * iv))s on :$port" "tip unreachable" 0 "$(jq -nc --argjson port "$port" '{port:$port}')"
      continue
    fi
    age=$((NOW - t))
    if [ "$age" -gt $((2 * iv)) ] && [ "$WAIT" = 1 ]; then
      deadline=$((NOW + 2 * iv))
      while [ "$(date -u +%s)" -lt "$deadline" ]; do
        sleep 30
        h2="$(jq -r '.height // empty' <<<"$("$CURL" -fsS --max-time 5 "http://127.0.0.1:$port/tip" 2>/dev/null)" 2>/dev/null)"
        if [ -n "$h2" ] && [ "$h2" -gt "$h" ]; then age=0; h="$h2"; break; fi
      done
    fi
    row d "sidestr:$chain tip" "a block younger than $((2 * iv))s on :$port" "height $h, newest block ${age}s old" "$([ "$age" -le $((2 * iv)) ] && echo 1 || echo 0)" \
      "$(jq -nc --argjson port "$port" --argjson h "$h" --argjson a "$age" --argjson iv "$iv" '{port:$port,height:$h,block_age_s:$a,interval_s:$iv}')"
  done < <(jq -r '.roles[] | select(.chain and (.name | startswith("ab-sidestr-")) and .enabled) | [.name, .uid, .chain, .port, .interval, .programs[0]] | @tsv' <<<"$REGISTRY")
  [ "$n" -gt 0 ] || row d producers "at least one enabled chain" "no enabled producer in the role table" 0 '{}'
}

# ── (e) no secret is ambient (names, never values) ────────────────────────────────────────
# hits_evidence <tsv pid,uid,name,holder> <label> <n>: per-name counts and pid sample (bounded).
hits_evidence() {
  jq -Rsc --arg l "$2" --argjson n "$3" '
    [split("\n")[] | select(length > 0) | split("\t") | {pid: (.[0] | tonumber), uid: (.[1] | tonumber), name: .[2], belongs_to: .[3]}] as $h
    | {($l): $n, hits_total: ($h | length),
       by_name: ($h | group_by(.name) | map({name: .[0].name, belongs_to: .[0].belongs_to, processes: length})),
       sample: ($h | .[:20] | map({pid, uid, name}))}' "$1"
}
check_e() {
  local p pid uids ru eu su fu tok hits_argv=0 hits_env=0 unread=0 nproc=0 ndev=0 name f n sup_ev="[]" log_ev="[]" holder
  local argv_tsv="$WORK/argv-hits.tsv" env_tsv="$WORK/env-hits.tsv"
  : >"$argv_tsv"; : >"$env_tsv"
  for p in "$R"/proc/[0-9]*; do
    pid="${p##*/}"; uids="$(proc_uids "$pid")"; [ -n "$uids" ] || continue
    read -r ru eu su fu <<<"$uids"; nproc=$((nproc + 1))
    while IFS= read -r -d '' tok; do
      name=""
      if [[ "$tok" =~ ^($CLASS_NAMES)= ]]; then name="${BASH_REMATCH[1]}"
      elif [[ "$tok" =~ ^($SECRET_FLAGS)(=|$) ]]; then name="${BASH_REMATCH[1]}"; fi
      if [ -n "$name" ]; then
        hits_argv=$((hits_argv + 1)); printf '%s\t%s\t%s\t-\n' "$pid" "$ru" "$name" >>"$argv_tsv"
      fi
    done <"$p/cmdline" 2>/dev/null
    [ "$ru" = "$DEV_UID" ] && [ "$eu" = "$DEV_UID" ] && [ "$su" = "$DEV_UID" ] && [ "$fu" = "$DEV_UID" ] || continue
    ndev=$((ndev + 1))
    if ! { : <"$p/environ"; } 2>/dev/null; then
      [ -e "$p/status" ] && { unread=$((unread + 1)); printf '%s\t%s\t(environ unreadable to its own uid)\t-\n' "$pid" "$ru" >>"$env_tsv"; }
      continue
    fi
    while IFS= read -r -d '' tok; do
      name="${tok%%=*}"
      if [[ "$name" =~ ^($CLASS_NAMES)$ ]]; then
        holder="$(awk -v n="$name" '$1 == n {print $2; exit}' <<<"$CLASSIFIED")"
        hits_env=$((hits_env + 1)); printf '%s\t%s\t%s\t%s\n' "$pid" "$ru" "$name" "$holder" >>"$env_tsv"
      fi
    done <"$p/environ" 2>/dev/null
  done
  row e argv "no classified name or secret flag on any argv ($nproc processes)" "$hits_argv hits" "$([ "$hits_argv" = 0 ] && echo 1 || echo 0)" "$(hits_evidence "$argv_tsv" processes "$nproc")"
  row e devuser-environ "no classified name in any devuser process environ ($ndev processes)" "$hits_env hits, $unread unreadable" "$([ "$hits_env" = 0 ] && [ "$unread" = 0 ] && echo 1 || echo 0)" "$(hits_evidence "$env_tsv" devuser_processes "$ndev")"

  n=0
  for f in "$PLAIN_CONF" "$ROLES_CONF"; do
    [ -r "$f" ] || continue
    while IFS= read -r ln; do
      [ -n "$ln" ] || continue
      n=$((n + 1)); sup_ev="$(jq -c --arg f "${f#"$R"}" --argjson l "$ln" '. + [{path:$f,line:$l}]' <<<"$sup_ev")"
    done < <(grep -nE "^[[:space:]]*environment[[:space:]]*=(.*[^A-Za-z0-9])?(ENV_)?($CLASS_NAMES)([^A-Za-z0-9_]|$)" "$f" | cut -d: -f1)
  done
  row e supervisor-text "no classified name on an environment= line" "$n lines" "$([ "$n" = 0 ] && echo 1 || echo 0)" "$(jq -nc --argjson h "$sup_ev" '{hits:$h}')"

  f="$R/run/agentbox/identity.env"
  if [ ! -e "$f" ]; then row e /run/agentbox/identity.env "no classified name" absent 1 '{"path":"/run/agentbox/identity.env","present":false}'
  elif [ "$(try_open "$f")" != ok ]; then row e /run/agentbox/identity.env "no classified name" "unreadable to devuser (root half reads it)" 1 '{"path":"/run/agentbox/identity.env","devuser_open":"EACCES"}'
  else
    n="$(grep -cE "^(export[[:space:]]+)?($CLASS_NAMES)=" "$f")"
    row e /run/agentbox/identity.env "no classified name" "$n lines name a role secret" "$([ "$n" = 0 ] && echo 1 || echo 0)" "$(jq -nc --argjson n "$n" '{path:"/run/agentbox/identity.env",lines:$n}')"
  fi

  n=0
  if [ -d "$R/var/log" ]; then
    while IFS= read -r -d '' f; do
      local c; c="$(grep -cE "\b($CLASS_NAMES)=[^[:space:]\"'\$%]" "$f" 2>/dev/null)"
      if [ "${c:-0}" -gt 0 ]; then n=$((n + c)); log_ev="$(jq -c --arg f "${f#"$R"}" --argjson c "$c" '. + [{path:$f,lines:$c}]' <<<"$log_ev")"; fi
    done < <(find "$R/var/log" -type f -readable -print0 2>/dev/null)
  fi
  row e /var/log "no NAME=value line for a classified name" "$n lines" "$([ "$n" = 0 ] && echo 1 || echo 0)" "$(jq -nc --argjson h "$log_ev" '{hits:$h}')"
}

# ── (f) devuser cannot become root ────────────────────────────────────────────────────────
check_f() {
  local gids out rc s sgid g coll=""
  gids="${RH_GROUPS-$(id -G)}"
  if [[ " $gids " == *" 0 "* ]]; then row f groups "devuser not in group 0" "in group 0 (groups: $gids)" 0 "$(jq -nc --arg g "$gids" '{groups:$g}')"
  else row f groups "devuser not in group 0" "groups: $gids" 1 "$(jq -nc --arg g "$gids" '{groups:$g}')"; fi
  out="$("$DOCKER" version --format '{{.Server.Version}}' 2>&1)"; rc=$?
  if [ $rc = 0 ] && [ -n "$out" ]; then row f docker "devuser cannot drive the docker daemon" "docker version answered (server ${out%%$'\n'*})" 0 '{"command":"docker version"}'
  else row f docker "devuser cannot drive the docker daemon" "refused (exit $rc)" 1 "$(jq -nc --argjson rc "$rc" '{command:"docker version",exit:$rc}')"; fi
  if "$SUDO" -n true >/dev/null 2>&1; then row f sudo "devuser cannot sudo" "sudo -n true succeeded" 0 '{"command":"sudo -n true"}'
  else row f sudo "devuser cannot sudo" "refused" 1 '{"command":"sudo -n true"}'; fi
  s="$(st "$R/var/run/docker.sock")"
  if [ -n "$s" ]; then
    sgid="$(awk '{print $2}' <<<"$s")"
    for g in $ROLE_GIDS; do [ "$g" = "$sgid" ] && coll="$g"; done
    row f docker.sock-gid "no role gid equals the socket's group" "socket gid $sgid${coll:+, collides with a role gid}" "$([ -z "$coll" ] && echo 1 || echo 0)" \
      "$(jq -nc --argjson g "$sgid" --arg m "$(awk '{print $3}' <<<"$s")" '{path:"/var/run/docker.sock",gid:$g,mode:$m}')"
  else
    row f docker.sock-gid "no role gid equals the socket's group" "no socket in the container" 1 '{"path":"/var/run/docker.sock","present":false}'
  fi
}

NOW="${RH_NOW:-$(date -u +%s)}"
STARTED="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ)"
check_a; check_b; check_c; check_d; check_e; check_f

# ── verdict and receipt ───────────────────────────────────────────────────────────────────
FINISHED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CHECKS="$(jq -sc --argjson flag "$FLAG" 'map(
  if $flag then . + {status:(if .ok then "pass" else "fail" end)}
  else . + {status:"not_applicable", reason:"flag off", would_pass:.ok} end | del(.ok))' "$ROWS")"
FAILS="$(jq '[.[] | select(.status == "fail")] | length' <<<"$CHECKS")"
if [ "$FLAG" != true ]; then VERDICT=STAGED; CODE=2
elif [ "$FAILS" -gt 0 ]; then VERDICT=FAIL; CODE=1
else VERDICT=PASS; CODE=0; fi

COMMIT="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"
DIRTY=false; git -C "$REPO" diff --quiet HEAD -- scripts/activation 2>/dev/null || DIRTY=true
STAMP="$(date -u -d "$FINISHED" +%Y%m%dT%H%M%SZ)"
RECEIPT="$RECEIPT_DIR/x1-rehearsal-$STAMP.json"
mkdir -p "$RECEIPT_DIR" || die "cannot create $RECEIPT_DIR"
jq -n --arg verdict "$VERDICT" --argjson code "$CODE" --argjson flag "$FLAG" --arg fsrc "$FLAG_SOURCE" \
  --arg mpath "${MANIFEST#"$R"}" --arg image "${IMAGE_ID:-unknown}" --arg ver "${AGENTBOX_VERSION:-unknown}" \
  --arg commit "$COMMIT" --argjson dirty "$DIRTY" --arg s "$STARTED" --arg f "$FINISHED" \
  --arg op "$(id -un 2>/dev/null || echo unknown)" --argjson opuid "$DEV_UID" --argjson reg "$REGISTRY" \
  --argjson checks "$CHECKS" --arg conf "${ACTIVE_CONF#"$R"}" '{
    schema: "agentbox/x1-rehearsal@1",
    half: "container",
    verdict: $verdict, exit_code: $code,
    flag: {key: "[security].role_isolation", value: $flag, source: $fsrc, manifest: $mpath},
    image: {build_id: $image, version: $ver},
    commit: $commit, rehearsal_dirty: $dirty,
    started_at: $s, finished_at: $f,
    operator: {user: $op, uid: $opuid},
    supervisor_config: $conf,
    uid_table: {source: $reg.source, roles: [$reg.roles[] | {role: .name, uid, gid, programs, files: [.files[] as $x | "/run/secrets/\(.name)/\($x)"], classified_env: .env} + (if .deferred then {deferred} else {} end)]},
    checks: $checks,
    summary: {
      pass: ([$checks[] | select(.status == "pass")] | length),
      fail: ([$checks[] | select(.status == "fail")] | length),
      not_applicable: ([$checks[] | select(.status == "not_applicable")] | length),
      would_fail: ([$checks[] | select(.would_pass == false)] | length),
      failed_checks: ([$checks[] | select(.status == "fail" or .would_pass == false) | .check] | unique)
    },
    legacy_copies: ([$reg.roles[].legacy[]] | unique),
    degraded: [],
    not_covered: [
      "planting a probe on root PATH and starting [program:bootstrap] (W0 runtime-contract test; the rehearsal never starts or restarts programs)",
      "renaming /run/secrets (destructive on a failing image; the mount-point and owner test in (a) stands in for it)",
      "a real pod write with sign_requests=true (the pods header is verified by NostrBridge.verifyNip98, not sent)",
      "idempotence and rollback across reboots (owner-run; needs two boots)",
      "role-uid reads, other uids environ and host socket mode and host uid collisions (role-isolation-rehearsal.host.sh)"
    ]
  }' >"$RECEIPT" || die "could not write $RECEIPT"

jq -r '.[] | "  \(if .status == "pass" then "ok  " elif .status == "fail" then "FAIL" else (if .would_pass then "n/a+" else "n/a-" end) end) (\(.check)) \(.target) — \(.observed)"' <<<"$CHECKS"
echo
jq -r '"verdict \(.verdict) (exit \(.exit_code)): \(.summary.pass) pass, \(.summary.fail) fail, \(.summary.not_applicable) not applicable (\(.summary.would_fail) would fail)"' "$RECEIPT"
echo "receipt ${RECEIPT#"$REPO"/}"
exit "$CODE"
