#!/usr/bin/env bash
# ADR-2087 activation check — run INSIDE the agentbox container AFTER the image
# rebuild. Writes a dated execution receipt and exits non-zero unless every
# required check passed against the RUNNING image.
#
#   scripts/activation/adr-2087-check.sh                 # full check, live probes on
#   scripts/activation/adr-2087-check.sh --night 2026-10-03
#   scripts/activation/adr-2087-check.sh --no-live-probe # provenance + logs only
#   --mcp-root DIR   probe a different governance-bridge directory (dry-running
#                    the B6 probe against a checkout; A3 will then FAIL by design)
#
# Exit status
#   0  LIVE    every required check passed, forum_auth_api is set and a receipt
#              has posted from the running process (ADR-2087's `live` bar)
#   2  STAGED  the running image carries ADR-2087 and every behavioural check
#              passed, but no receipt has reached the forum yet (forum_auth_api
#              unset, or nothing approved since boot) — `staged`, NOT `live`
#   1  FAIL    any required check failed, or a check that should have run did not
#
# What it proves, and how (each check is PASS / FAIL / NOT-RUN; NOT-RUN never
# counts as a pass):
#   A  provenance  the management-api, governance-bridge and dream-engine the
#                  supervisor is actually running carry the committed ADR-2087
#                  code (git blob equality, not version strings)
#   B  ADR-2087    boot wiring (replay armed, no fallback gate); a real
#                  zero-tolerance deny on the live API is refused with
#                  {code, hint}, hash-chain journalled and visible at
#                  /v1/agent-events; the audit chain stays intact; the baked
#                  governance-bridge MCP answers tools/list with
#                  governance_manual_continue and refuses an unapproved case
#   C  ADR-2071    clauses (a) and (b) of its Phase 1 acceptance test, read from
#                  the last completed night: audit chain intact, and a matched
#                  tool.called/tool.completed pair per side effect under each
#                  session_urn. Clause (c) (API stopped) needs the operator to
#                  stop management-api for a night; it is NOT-RUN unless
#                  --api-down-night names such a night. The stop and restart
#                  are done by scripts/activation/adr-2071-api-down-night.sh,
#                  whose state file C3 also requires (a clean, uninterrupted
#                  stop before the window and a restart after it).
#
# Side effects of the live probe (B3), stated so nobody is surprised: one
# POST /v1/llm/revoke for a grant id that does not exist. In the shipped wiring
# that route's gate has no decision surface, so it denies BEFORE publishing any
# 31402 and before touching the orderbook; the deny appends one authority.deny
# record to the hash-chained events log (which is the thing being proven). The
# probe refuses to run if the baked server.js wires that route differently.
#
# Never prints secrets: the API key is read from the environment and passed to
# curl through a 0600 header file, never on a command line.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKSPACE="${WORKSPACE:-$HOME/workspace}"
EVENTS_DIR="${AGENTBOX_EVENTS_DIR:-$WORKSPACE/events}"
NIGHT_RECORD="$WORKSPACE/.agentbox/dream-last-night.json"
MCP_ROOT="/opt/agentbox/mcp/servers"
API="http://127.0.0.1:${MANAGEMENT_API_PORT:-9090}"
OUT=""
REF=""
NIGHT=""
API_DOWN_NIGHT=""
LIVE_PROBE=1

usage() { sed -n '2,49p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    --night) NIGHT="$2"; shift 2 ;;
    --api-down-night) API_DOWN_NIGHT="$2"; shift 2 ;;
    --api) API="$2"; shift 2 ;;
    --mcp-root) MCP_ROOT="$2"; shift 2 ;;
    --no-live-probe) LIVE_PROBE=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

for bin in jq git curl node strings supervisorctl; do
  command -v "$bin" >/dev/null 2>&1 || { echo "FATAL: $bin not on PATH" >&2; exit 1; }
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
[ -n "$OUT" ] || OUT="$REPO/.claude/evidence/activation/ADR-2087-activation-$STAMP.md"
mkdir -p "$(dirname "$OUT")"
SCRATCH="$(mktemp -d)"
chmod 700 "$SCRATCH"
trap 'rm -rf "$SCRATCH"' EXIT

# ── result bookkeeping ──────────────────────────────────────────────────────
declare -a ROWS=()
FAILS=0
NOTRUN_REQUIRED=0
record() { # id status required(1|0) summary [detail-file]
  local id="$1" status="$2" required="$3" summary="$4" detail="${5:-}"
  ROWS+=("$id|$status|$required|$summary|$detail")
  if [ "$status" = FAIL ] && [ "$required" = 1 ]; then FAILS=$((FAILS + 1)); fi
  if [ "$status" = NOT-RUN ] && [ "$required" = 1 ]; then NOTRUN_REQUIRED=$((NOTRUN_REQUIRED + 1)); fi
  printf '%-8s %-7s %s\n' "$id" "$status" "$summary" >&2
}

# ── A. provenance: what is the supervisor actually running? ─────────────────
MAPI_PID="$(supervisorctl pid management-api 2>/dev/null | tr -dc '0-9')"
DREAM_PID="$(supervisorctl pid dream-engine 2>/dev/null | tr -dc '0-9')"
MAPI_ROOT=""
if [ -n "$MAPI_PID" ] && [ "$MAPI_PID" != 0 ] && [ -r "/proc/$MAPI_PID/cmdline" ]; then
  SERVER_JS="$(tr '\0' '\n' < "/proc/$MAPI_PID/cmdline" | grep -m1 '/server\.js$' || true)"
  [ -n "$SERVER_JS" ] && MAPI_ROOT="$(dirname "$SERVER_JS")"
fi
MAPI_STARTED="$( [ -n "$MAPI_PID" ] && ps -o lstart= -p "$MAPI_PID" 2>/dev/null | sed 's/^ *//' )"
if [ -n "$MAPI_ROOT" ]; then
  record A1 PASS 1 "management-api pid $MAPI_PID runs $MAPI_ROOT/server.js (started $MAPI_STARTED)"
else
  record A1 FAIL 1 "could not resolve the running management-api server.js from supervisor (pid '${MAPI_PID:-none}')"
fi

MAPI_PATHS=(server.js lib/task-properties.js lib/authority.js lib/authority-journal.js
  lib/governance-receipt-publisher.js lib/governance-manual-continue.js
  lib/governance-application-receipts.js lib/dream-ledger.js
  routes/broker-bridge.js routes/llm-marketplace.js)
if [ -z "$REF" ]; then
  REF="$(git -C "$REPO" log -1 --format=%H -- \
    $(printf 'management-api/%s ' "${MAPI_PATHS[@]}") mcp/servers/governance-bridge.js)"
fi
REF_SHORT="$(git -C "$REPO" rev-parse --short=9 "$REF" 2>/dev/null || echo "$REF")"

blob_compare() { # label root prefix detail-file paths...
  local label="$1" root="$2" prefix="$3" detail="$4"; shift 4
  local bad=0 p want have
  for p in "$@"; do
    want="$(git -C "$REPO" rev-parse "$REF:$prefix$p" 2>/dev/null || echo MISSING-IN-GIT)"
    if [ -f "$root/$p" ]; then have="$(git hash-object "$root/$p")"; else have="MISSING-IN-IMAGE"; fi
    if [ "$want" = "$have" ]; then echo "match    $prefix$p" >> "$detail"
    else echo "MISMATCH $prefix$p  committed=$want  running=$have" >> "$detail"; bad=$((bad + 1)); fi
  done
  return "$bad"
}

A2_DETAIL="$SCRATCH/A2.txt"; : > "$A2_DETAIL"
if [ -n "$MAPI_ROOT" ] && blob_compare mapi "$MAPI_ROOT" management-api/ "$A2_DETAIL" "${MAPI_PATHS[@]}"; then
  record A2 PASS 1 "running management-api equals ${REF_SHORT} for all ${#MAPI_PATHS[@]} ADR-2087 files" "$A2_DETAIL"
else
  record A2 FAIL 1 "running management-api differs from ${REF_SHORT} (image not rebuilt, or newer edits)" "$A2_DETAIL"
fi

# The MCP server resolves ../../management-api from ITS real path, which is a
# different store path from the supervised API's, so its libs are checked too.
A3_DETAIL="$SCRATCH/A3.txt"; : > "$A3_DETAIL"
MCP_REAL="$(readlink -f "$MCP_ROOT" 2>/dev/null || true)"
if [ -n "$MCP_REAL" ] \
  && blob_compare mcp "$MCP_REAL" mcp/servers/ "$A3_DETAIL" governance-bridge.js \
  && blob_compare mcp-libs "$MCP_REAL/../../management-api" management-api/ "$A3_DETAIL" \
       lib/task-properties.js lib/governance-application-receipts.js \
       lib/governance-manual-continue.js lib/governance-receipt-publisher.js lib/authority-journal.js; then
  record A3 PASS 1 "baked governance-bridge and the libs it loads equal ${REF_SHORT}" "$A3_DETAIL"
else
  record A3 FAIL 1 "baked governance-bridge (or its libs) differs from ${REF_SHORT}" "$A3_DETAIL"
fi

DREAM_EXE="$( [ -n "$DREAM_PID" ] && readlink -f "/proc/$DREAM_PID/exe" 2>/dev/null || true )"
# Container runtimes may omit CAP_SYS_PTRACE, making /proc/<pid>/exe unreadable
# even to container root. The argv remains readable and contains the immutable
# Nix-store executable that supervisord launched, so use it as the provenance
# fallback instead of reporting a stale-image false negative.
if [ -z "$DREAM_EXE" ] && [ -n "$DREAM_PID" ] && [ -r "/proc/$DREAM_PID/cmdline" ]; then
  DREAM_EXE="$(tr '\0' '\n' < "/proc/$DREAM_PID/cmdline" | grep -m1 '/dream-engine$' || true)"
fi
A4_DETAIL="$SCRATCH/A4.txt"; : > "$A4_DETAIL"
if [ -n "$DREAM_EXE" ]; then
  strings "$DREAM_EXE" > "$SCRATCH/dream.strings"
  a4_bad=0
  # One literal per change that must be in the binary: ADR-2087's ledger
  # columns, ADR-2071 Phase 1's route, and the NIP-09 withdrawal (68270e953).
  for needle in "Review-minutes" "/v1/exec/record" "governance: withdrawal"; do
    if grep -qF -- "$needle" "$SCRATCH/dream.strings"; then echo "present  \"$needle\"" >> "$A4_DETAIL"
    else echo "ABSENT   \"$needle\"" >> "$A4_DETAIL"; a4_bad=1; fi
  done
  if [ "$a4_bad" = 0 ]; then record A4 PASS 1 "dream-engine $DREAM_EXE carries ledger columns, exec journal and NIP-09 withdrawal" "$A4_DETAIL"
  else record A4 FAIL 1 "dream-engine binary lacks a required change (stale image)" "$A4_DETAIL"; fi
else
  record A4 FAIL 1 "could not resolve the running dream-engine binary from supervisor"
fi

# ── B. ADR-2087 behaviour on the running image ──────────────────────────────
LOG=/var/log/management-api.log
B1_DETAIL="$SCRATCH/B1.txt"; : > "$B1_DETAIL"
FORUM_CONFIGURED=unknown
if [ -n "$MAPI_PID" ] && [ -r "$LOG" ]; then
  grep -F "\"pid\":$MAPI_PID," "$LOG" > "$SCRATCH/boot.log" || true
  boot_line="$(grep -m1 '"event":"governance.receipt-replay.boot"' "$SCRATCH/boot.log" || true)"
  fallback_n="$(grep -c '"event":"broker-bridge.authority-fallback"' "$SCRATCH/boot.log" || true)"
  echo "replay boot line: ${boot_line:-<absent>}" >> "$B1_DETAIL"
  echo "broker-bridge fallback-gate lines this process: $fallback_n" >> "$B1_DETAIL"
  if [ -n "$boot_line" ]; then
    FORUM_CONFIGURED="$(printf '%s' "$boot_line" | jq -r '.configured')"
  fi
  if [ -n "$boot_line" ] && [ "${fallback_n:-0}" = 0 ]; then
    record B1 PASS 1 "receipt replay armed at boot (forum configured: $FORUM_CONFIGURED); broker-bridge used the boot-built gate" "$B1_DETAIL"
  else
    record B1 FAIL 1 "boot wiring not evidenced in $LOG for pid $MAPI_PID (replay line absent or fallback gate built)" "$B1_DETAIL"
  fi
else
  record B1 FAIL 1 "cannot read $LOG or no management-api pid"
fi

HDR="$SCRATCH/auth.hdr"
if [ -n "${MANAGEMENT_API_KEY:-}" ]; then
  ( umask 077; printf 'Authorization: Bearer %s\n' "$MANAGEMENT_API_KEY" > "$HDR" )
fi
api() { # method path [json-body] → body on stdout, status in $SCRATCH/status
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -m 30 -o "$SCRATCH/resp" -w '%{http_code}' -X "$method" -H @"$HDR" \
      -H 'Content-Type: application/json' --data "$body" "$API$path" > "$SCRATCH/status" 2>/dev/null
  else
    curl -sS -m 30 -o "$SCRATCH/resp" -w '%{http_code}' -X "$method" -H @"$HDR" "$API$path" > "$SCRATCH/status" 2>/dev/null
  fi
  cat "$SCRATCH/resp" 2>/dev/null
}

count_denies() { # since-iso → count of mandate_revoke authority.deny records at or after it
  local since="$1"
  cat "$EVENTS_DIR"/*.jsonl 2>/dev/null | jq -c --arg since "$since" \
    'select(.kind=="authority.deny" and .payload.action_class=="mandate_revoke" and .ts >= $since)' 2>/dev/null | wc -l
}

if [ "$LIVE_PROBE" = 0 ]; then
  for id in B2 B3 B4 B5; do record "$id" NOT-RUN 1 "live probe disabled (--no-live-probe)"; done
elif [ ! -f "$HDR" ]; then
  for id in B2 B3 B4 B5; do record "$id" FAIL 1 "MANAGEMENT_API_KEY is not set in this shell; live probe cannot authenticate"; done
else
  # B2 — the probe is only safe while the route's gate has no decision surface.
  wiring="$( [ -n "$MAPI_ROOT" ] && grep -F "require('./routes/llm-marketplace')" "$MAPI_ROOT/server.js" || true )"
  if [ "$(printf '%s' "$wiring" | tr -d ' ')" != "app.register(require('./routes/llm-marketplace'),{prefix:'',logger});" ]; then
    record B2 FAIL 1 "baked server.js wires llm-marketplace differently; a revoke probe could publish a real 31402 — refusing (review and adapt the probe)"
    for id in B3 B4 B5; do record "$id" NOT-RUN 1 "depends on B2"; done
  else
    record B2 PASS 1 "llm-marketplace is wired with no decision surface; the revoke probe cannot publish"
    PROBE_START_MS="$(date -u +%s%3N)"
    PROBE_START_ISO="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
    before="$(count_denies "$PROBE_START_ISO")"
    grant="adr-2087-activation-probe-$STAMP"
    resp="$(api POST /v1/llm/revoke "{\"grant_id\":\"$grant\",\"reason\":\"ADR-2087 activation probe: expected to be denied\"}")"
    status="$(cat "$SCRATCH/status")"
    printf 'HTTP %s\n%s\n' "$status" "$resp" > "$SCRATCH/B3.txt"
    if [ "$status" = 403 ] \
      && [ "$(printf '%s' "$resp" | jq -r '.code // empty')" = no-decision-surface ] \
      && [ "$(printf '%s' "$resp" | jq -r '.hint // empty')" = governance_manual_continue ] \
      && [ "$(printf '%s' "$resp" | jq -r '.revoked')" = false ]; then
      record B3 PASS 1 "live zero-tolerance revoke denied 403 with {code: no-decision-surface, hint: governance_manual_continue}" "$SCRATCH/B3.txt"
    else
      record B3 FAIL 1 "live revoke probe did not return the FR7.3 deny (HTTP $status)" "$SCRATCH/B3.txt"
    fi

    # B4 — journalled to the hash chain AND published to /v1/agent-events.
    sleep 1
    after="$(count_denies "$PROBE_START_ISO")"
    events="$(api GET "/v1/agent-events?since=$PROBE_START_MS&limit=1000")"
    published="$(printf '%s' "$events" | jq '[.events[]? | select(.metadata.event=="authority.deny" and .metadata.action_class=="mandate_revoke")] | length' 2>/dev/null || echo 0)"
    {
      echo "authority.deny (mandate_revoke) records in $EVENTS_DIR since $PROBE_START_ISO: before=$before after=$after"
      echo "matching /v1/agent-events records since $PROBE_START_MS: $published"
      cat "$EVENTS_DIR"/*.jsonl 2>/dev/null | jq -c --arg since "$PROBE_START_ISO" \
        'select(.kind=="authority.deny" and .ts >= $since) | {ts, kind, seq, hash, payload: {stage: .payload.stage, reason: .payload.reason, action_class: .payload.action_class, authority_class: .payload.authority_class, task_properties: .payload.task_properties}}' 2>/dev/null
    } > "$SCRATCH/B4.txt"
    if [ "$after" -eq $((before + 1)) ] && [ "${published:-0}" -ge 1 ]; then
      record B4 PASS 1 "the deny is in the hash-chained events log (+1) and at /v1/agent-events ($published)" "$SCRATCH/B4.txt"
    else
      record B4 FAIL 1 "the deny was not journalled and published exactly once (log +$((after - before)), agent-events $published)" "$SCRATCH/B4.txt"
    fi

    # B5 — the chain is intact after the probe's append.
    chain="$(api GET /v1/system/audit-chain)"
    printf '%s\n' "$chain" | jq '{ok, files, checked, broken_at, reason, tail_hash}' > "$SCRATCH/B5.txt" 2>/dev/null || printf '%s\n' "$chain" > "$SCRATCH/B5.txt"
    if [ "$(cat "$SCRATCH/status")" = 200 ] && [ "$(printf '%s' "$chain" | jq -r '.ok')" = true ] \
       && [ "$(printf '%s' "$chain" | jq -r '.checked')" -gt 0 ]; then
      record B5 PASS 1 "audit chain verifies intact after the probe ($(printf '%s' "$chain" | jq -r '.checked') records)" "$SCRATCH/B5.txt"
    else
      record B5 FAIL 1 "audit chain does not verify after the probe" "$SCRATCH/B5.txt"
    fi
  fi
fi

# B6 — the baked MCP server, launched exactly as mcp/mcp.json launches it.
B6_DETAIL="$SCRATCH/B6.txt"
cat > "$SCRATCH/b6-probe.cjs" <<'NODE'
const { spawn } = require('node:child_process');
const entry = process.argv[2];
const child = spawn(process.execPath, ['--no-warnings', entry], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = ''; const seen = new Map();
child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { try { const m = JSON.parse(buf.slice(0, i)); if (m.id !== undefined) seen.set(m.id, m); } catch {} buf = buf.slice(i + 1); } });
const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
const wait = (id, ms) => new Promise((res, rej) => { const t0 = Date.now(); const iv = setInterval(() => {
  if (seen.has(id)) { clearInterval(iv); res(seen.get(id)); }
  else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error(`no response to ${id} in ${ms} ms; process exit code ${child.exitCode}`)); } }, 25); });
(async () => {
  const out = { tools: null, required: null, refusal: null };
  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'adr-2087-check', version: '1' } } });
    await wait(1, 10000);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = await wait(2, 10000);
    out.tools = list.result.tools.map((t) => t.name);
    const mc = list.result.tools.find((t) => t.name === 'governance_manual_continue');
    out.required = mc ? mc.inputSchema.required : null;
    // A case that was never approved must be refused before anything is written.
    const caseId = `adr-2087-activation-probe-${Date.now()}`;
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'governance_manual_continue',
      arguments: { case_id: caseId, executed_by: 'did:nostr:' + '0123456789abcdef'.repeat(4), evidence: 'activation probe; nothing was executed' } } });
    const call = await wait(3, 10000);
    out.refusal = JSON.parse(call.result.content[0].text);
  } catch (err) { out.error = err.message; }
  child.kill();
  console.log(JSON.stringify(out, null, 2));
})();
NODE
node --no-warnings "$SCRATCH/b6-probe.cjs" "$MCP_ROOT/governance-bridge.js" > "$B6_DETAIL" 2>&1
b6_tools="$(jq -r '(.tools // []) | index("governance_manual_continue") != null' "$B6_DETAIL" 2>/dev/null || echo false)"
b6_req="$(jq -r '(.required // []) | sort | join(",")' "$B6_DETAIL" 2>/dev/null || echo)"
b6_ok="$(jq -r 'if .refusal == null then "absent" else (.refusal.ok // false) end' "$B6_DETAIL" 2>/dev/null || echo)"
b6_code="$(jq -r '.refusal.code // .refusal.reason // .refusal.error // empty' "$B6_DETAIL" 2>/dev/null || echo)"
if [ "$b6_tools" = true ] && [ "$b6_req" = "case_id,evidence,executed_by" ] && [ "$b6_ok" = false ] \
   && printf '%s' "$b6_code" | grep -q 'no-approved-receipt'; then
  record B6 PASS 1 "baked governance-bridge answers over stdio; governance_manual_continue refuses an unapproved case (no-approved-receipt)" "$B6_DETAIL"
else
  record B6 FAIL 1 "baked governance-bridge did not serve governance_manual_continue as specified" "$B6_DETAIL"
fi

# B7 — `live` needs forum_auth_api set and a receipt that actually posted.
B7_DETAIL="$SCRATCH/B7.txt"
posted=0
if [ -f "$SCRATCH/boot.log" ]; then posted="$(grep -c '"event":"governance.receipt-posted"' "$SCRATCH/boot.log" || true)"; fi
pending="$(ls "${AGENTBOX_STATE_DIR:-$HOME/.local/state/agentbox}/governance-receipt-outbox"/*.json 2>/dev/null | wc -l)"
{ echo "forum configured (boot line): $FORUM_CONFIGURED"; echo "receipts posted by pid ${MAPI_PID:-?}: $posted"; echo "receipts queued in outbox: $pending"; } > "$B7_DETAIL"
if [ "$FORUM_CONFIGURED" = true ] && [ "${posted:-0}" -ge 1 ]; then
  record B7 PASS 0 "forum_auth_api set and $posted receipt(s) posted by the running process" "$B7_DETAIL"
  LIVE=1
else
  record B7 NOT-RUN 0 "no receipt has posted yet (forum configured: $FORUM_CONFIGURED; posted $posted; queued $pending) — staged, not live" "$B7_DETAIL"
  LIVE=0
fi

# ── C. ADR-2071 Phase 1 acceptance, from the last completed night ───────────
C_DETAIL="$SCRATCH/C2.txt"; : > "$C_DETAIL"
if [ -z "$NIGHT" ] && [ -r "$NIGHT_RECORD" ]; then NIGHT="$(jq -r '.date // empty' "$NIGHT_RECORD")"; fi
if [ -z "$NIGHT" ] || [ ! -r "$EVENTS_DIR/$NIGHT.jsonl" ]; then
  record C1 FAIL 1 "no night to check (night='${NIGHT:-none}', events file missing)"
else
  # Every dream-engine session that night; each tool.called must have exactly
  # one tool.completed whose causation names it, under the same session_urn.
  jq -s -r '
    [ .[] | select(.payload.harness=="dream-engine") ] as $ev
    | ($ev | map(select(.kind=="exec.tool.called"))) as $called
    | ($ev | map(select(.kind=="exec.tool.completed"))) as $done
    | ($ev | map(.payload.session_urn) | unique) as $sessions
    | {
        sessions: ($sessions | length),
        called: ($called | length),
        completed: ($done | length),
        unpaired: [ $called[] | . as $c
          | select(([ $done[] | select(.payload.causation == $c.payload.event_id
                                         and .payload.session_urn == $c.payload.session_urn) ] | length) != 1)
          | {session: .payload.session_urn, tool: .payload.payload.tool, event: .payload.event_id} ],
        orphans: [ $done[] | . as $d
          | select(([ $called[] | select(.payload.event_id == $d.payload.causation) ] | length) != 1)
          | {session: .payload.session_urn, event: .payload.event_id} ],
        missing_session_urn: ([ $ev[] | select((.payload.session_urn // "") == "") ] | length)
      }' "$EVENTS_DIR/$NIGHT.jsonl" > "$C_DETAIL" 2>&1
  c_sessions="$(jq -r '.sessions' "$C_DETAIL" 2>/dev/null || echo 0)"
  c_called="$(jq -r '.called' "$C_DETAIL" 2>/dev/null || echo 0)"
  c_unpaired="$(jq -r '(.unpaired|length) + (.orphans|length) + .missing_session_urn' "$C_DETAIL" 2>/dev/null || echo 1)"
  if [ -r "$NIGHT_RECORD" ] && [ "$(jq -r '.date' "$NIGHT_RECORD")" = "$NIGHT" ]; then
    jq '{journal}' "$NIGHT_RECORD" >> "$C_DETAIL"
  fi
  if [ "${c_sessions:-0}" -ge 1 ] && [ "${c_called:-0}" -ge 1 ] && [ "$c_unpaired" = 0 ]; then
    record C1 PASS 1 "ADR-2071 (b): night $NIGHT — $c_called side effects across $c_sessions sessions, every one a matched pair under its session_urn" "$C_DETAIL"
  else
    record C1 FAIL 1 "ADR-2071 (b): night $NIGHT has no journalled side effects, or unpaired/orphaned records ($c_unpaired)" "$C_DETAIL"
  fi
fi
# (a) — the same verifier the API uses, independent of whether B ran.
if [ -f "$HDR" ]; then
  chain="$(api GET /v1/system/audit-chain)"
  if [ "$(cat "$SCRATCH/status")" = 200 ] && [ "$(printf '%s' "$chain" | jq -r '.ok')" = true ]; then
    record C2 PASS 1 "ADR-2071 (a): audit chain intact across $(printf '%s' "$chain" | jq -r '.files') day files after the night's appends"
  else
    printf '%s\n' "$chain" > "$SCRATCH/C2b.txt"
    record C2 FAIL 1 "ADR-2071 (a): audit chain does not verify" "$SCRATCH/C2b.txt"
  fi
else
  record C2 FAIL 1 "ADR-2071 (a): MANAGEMENT_API_KEY unset; audit chain not checked"
fi
# (c) — only a night run with the API deliberately stopped can show it.
if [ -n "$API_DOWN_NIGHT" ]; then
  C3_DETAIL="$SCRATCH/C3.txt"
  if [ -r "$NIGHT_RECORD" ] && [ "$(jq -r '.date' "$NIGHT_RECORD")" = "$API_DOWN_NIGHT" ]; then
    jq '{date, outcomes, journal}' "$NIGHT_RECORD" > "$C3_DETAIL"
    outcomes="$(jq '[.outcomes[]? | select(.verdict != null)] | length' "$NIGHT_RECORD")"
    failed="$(jq '[.journal[]? | .failed + .skipped] | add // 0' "$NIGHT_RECORD")"
    # The one-shot (scripts/activation/adr-2071-api-down-night.sh) records
    # when it stopped and restarted the API; without that record a night of
    # failed posts proves nothing about WHY they failed. An `interrupted`
    # night (the API came back mid-window, e.g. a container restart) fails.
    API_DOWN_STATE="$WORKSPACE/.agentbox/adr-2071-api-down-night.state"
    sget() { sed -n "s/^$1=//p" "$API_DOWN_STATE" 2>/dev/null | tail -1; }
    { echo; echo "# one-shot state ($API_DOWN_STATE)"; cat "$API_DOWN_STATE" 2>/dev/null || echo "absent"; } >> "$C3_DETAIL"
    st_night="$(sget night)"; st_phase="$(sget phase)"; st_reason="$(sget reason)"; st_stopped="$(sget stopped_at)"
    if [ "$st_night" != "$API_DOWN_NIGHT" ] || [ "$st_phase" != done ] || [ -z "$st_stopped" ] \
       || { [ "$st_reason" != night-record ] && [ "$st_reason" != deadline ]; }; then
      record C3 FAIL 0 "ADR-2071 (c): no clean API-down record for $API_DOWN_NIGHT (one-shot state: night=${st_night:-none} phase=${st_phase:-none} reason=${st_reason:-none})" "$C3_DETAIL"
    elif [ "$outcomes" -ge 1 ] && [ "$failed" -ge 1 ]; then
      record C3 PASS 0 "ADR-2071 (c): night $API_DOWN_NIGHT completed $outcomes repo verdict(s) while $failed journal posts failed/skipped; API stopped $st_stopped, restarted $(sget started_at) ($st_reason)" "$C3_DETAIL"
    else
      record C3 FAIL 0 "ADR-2071 (c): night $API_DOWN_NIGHT does not show a completed cycle with the API down" "$C3_DETAIL"
    fi
  else
    record C3 FAIL 0 "ADR-2071 (c): $NIGHT_RECORD is not the record for $API_DOWN_NIGHT (it is overwritten nightly; run this the morning after)"
  fi
else
  record C3 NOT-RUN 0 "ADR-2071 (c): needs a night with management-api stopped (owner action); pass --api-down-night DATE the morning after"
fi

# ── verdict and receipt ─────────────────────────────────────────────────────
if [ "$FAILS" -gt 0 ] || [ "$NOTRUN_REQUIRED" -gt 0 ]; then
  VERDICT=FAIL; CODE=1
elif [ "$LIVE" = 1 ]; then
  VERDICT=LIVE; CODE=0
else
  VERDICT=STAGED; CODE=2
fi
ADR2071="$(for r in "${ROWS[@]}"; do IFS='|' read -r id st _ _ _ <<<"$r"; case "$id" in C*) echo "$id=$st";; esac; done | tr '\n' ' ')"

{
  echo "---"
  echo "receipt: ADR-2087 activation check"
  echo "produced_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "produced_by: scripts/activation/adr-2087-check.sh"
  echo "checkout_head: $(git -C "$REPO" rev-parse HEAD)"
  echo "expected_ref: $REF"
  echo "management_api_pid: ${MAPI_PID:-none}"
  echo "management_api_root: ${MAPI_ROOT:-unresolved}"
  echo "dream_engine: ${DREAM_EXE:-unresolved}"
  echo "verdict: $VERDICT"
  echo "exit_code: $CODE"
  echo "---"
  echo
  echo "# ADR-2087 activation receipt — $STAMP"
  echo
  echo "**Verdict: $VERDICT.** $( case "$VERDICT" in
      LIVE) echo "Every required check passed and a receipt has posted to the forum: ADR-2087 may move to \`activation_status: live\` with \`verified_commit: $REF\`." ;;
      STAGED) echo "The running image carries ADR-2087 and every behavioural check passed, but no receipt has reached the forum yet: \`activation_status: staged\`, not \`live\`." ;;
      FAIL) echo "At least one required check failed or did not run. ADR-2087 must not be marked live on this receipt." ;;
    esac )"
  echo
  echo "ADR-2071 Phase 1 acceptance: $ADR2071"
  echo
  echo "| Check | Result | Required | Summary |"
  echo "|---|---|---|---|"
  for r in "${ROWS[@]}"; do
    IFS='|' read -r id st req sum _ <<<"$r"
    echo "| $id | $st | $( [ "$req" = 1 ] && echo yes || echo no ) | ${sum//|/\\|} |"
  done
  echo
  echo "## Raw output"
  for r in "${ROWS[@]}"; do
    IFS='|' read -r id st _ _ det <<<"$r"
    if [ -n "$det" ] && [ -s "$det" ]; then
      echo
      echo "### $id ($st)"
      echo
      echo '```'
      cat "$det"
      echo '```'
    fi
  done
} > "$OUT"

echo >&2
echo "verdict: $VERDICT (exit $CODE) — receipt: $OUT" >&2
exit "$CODE"
