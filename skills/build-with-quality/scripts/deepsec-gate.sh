#!/usr/bin/env bash
# deepsec-gate.sh — the build-with-quality security gate, backed by deepsec
# (vercel-labs/deepsec, Apache-2.0). ADR-2033.
#
# Policy comes from the manifest ([security.deepsec] in $AGENTBOX_CONFIG,
# default /etc/agentbox.toml), overridable per key with DEEPSEC_GATE_<KEY>
# (e.g. DEEPSEC_GATE_FAIL_ON=CRITICAL). The gate never stores a credential:
# only the NAME of the env var that holds one is ever written to disk.
#
# Modes (exactly one):
#   --diff <ref>        PR mode: investigate files changed vs <ref> (net-new findings gate)
#   --diff-working      uncommitted + untracked files
#   --diff-staged       index vs HEAD
#   --files-from <p>    newline-delimited paths (or "-" for stdin)
#   --full              whole-repo scan + AI process (expensive; bounded by max_duration)
#   --scan-only         regex candidate scan only — free, never blocks
#
# Options: --root <path> --report-dir <dir> --fail-on <sev> --thinking-level <lvl>
#          --agent <claude|codex|pi> --model <id> --model-auth <local|direct|custom>
#          --dry-run (print the resolved plan as JSON and exit 0)
#
# Exit codes: 0 pass · 1 blocking findings (severity >= fail_on) · 70 deepsec
# runtime error · 78 gate unavailable or misconfigured · 124 max_duration hit.
set -euo pipefail

EX_RUNTIME=70
EX_CONFIG=78
EX_TIMEOUT=124

MODE=""; DIFF_REF=""; FILES_FROM=""; ROOT=""; REPORT_DIR=""; DRY_RUN=0
OVR_FAIL_ON=""; OVR_THINKING=""; OVR_AGENT=""; OVR_MODEL=""; OVR_MODEL_AUTH=""

die() { echo "deepsec-gate: $*" >&2; exit "$EX_CONFIG"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --diff)          MODE=diff; DIFF_REF="${2:?--diff needs a ref}"; shift 2 ;;
    --diff-working)  MODE=diff-working; shift ;;
    --diff-staged)   MODE=diff-staged; shift ;;
    --files-from)    MODE=files-from; FILES_FROM="${2:?--files-from needs a path}"; shift 2 ;;
    --full)          MODE=full; shift ;;
    --scan-only)     MODE=scan-only; shift ;;
    --root)          ROOT="${2:?}"; shift 2 ;;
    --report-dir)    REPORT_DIR="${2:?}"; shift 2 ;;
    --fail-on)       OVR_FAIL_ON="${2:?}"; shift 2 ;;
    --thinking-level) OVR_THINKING="${2:?}"; shift 2 ;;
    --agent)         OVR_AGENT="${2:?}"; shift 2 ;;
    --model)         OVR_MODEL="${2:?}"; shift 2 ;;
    --model-auth)    OVR_MODEL_AUTH="${2:?}"; shift 2 ;;
    --dry-run)       DRY_RUN=1; shift ;;
    -h|--help)       sed -n '2,24p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -n "$MODE" ] || die "choose one mode: --diff <ref> | --diff-working | --diff-staged | --files-from <p> | --full | --scan-only"

if [ -z "$ROOT" ]; then
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
ROOT="$(cd "$ROOT" && pwd -P)"
PROJECT_ID="$(basename "$ROOT" | tr -c 'A-Za-z0-9_.-' '-' | sed 's/-*$//')"
[ -n "$PROJECT_ID" ] || PROJECT_ID="project"

# ── Policy: manifest [security.deepsec] → env overrides → CLI overrides ──────
MANIFEST="${AGENTBOX_CONFIG:-/etc/agentbox.toml}"
[ -r "$MANIFEST" ] || MANIFEST=""
eval "$(MANIFEST_PATH="$MANIFEST" python3 - <<'PY'
import os, shlex, sys
try:
    import tomllib
except ImportError:  # pragma: no cover
    tomllib = None
defaults = {
    "enabled": True, "agent": "claude", "model_auth": "local", "model": "",
    "thinking_level": "high", "fail_on": "HIGH", "max_duration": "45m",
    "batch_size": 5, "concurrency": 2, "ai_provider": "", "ai_api_key_env": "",
    "ai_base_url": "",
}
cfg = dict(defaults)
p = os.environ.get("MANIFEST_PATH") or ""
source = "defaults"
if p and tomllib is not None:
    with open(p, "rb") as fh:
        m = tomllib.load(fh)
    sec = (m.get("security") or {}).get("deepsec") or {}
    for k in defaults:
        if k in sec:
            cfg[k] = sec[k]
    cfg["_toolchain"] = bool((m.get("toolchains") or {}).get("deepsec", False))
    source = p
for k in defaults:
    ov = os.environ.get("DEEPSEC_GATE_" + k.upper())
    if ov is not None and ov != "":
        cfg[k] = ov
def sh(k, v):
    if isinstance(v, bool):
        v = "true" if v else "false"
    return f"P_{k.upper()}={shlex.quote(str(v))}"
print(sh("source", source))
for k, v in cfg.items():
    print(sh(k.lstrip('_'), v))
PY
)"
P_FAIL_ON="${OVR_FAIL_ON:-$P_FAIL_ON}"
P_THINKING_LEVEL="${OVR_THINKING:-$P_THINKING_LEVEL}"
P_AGENT="${OVR_AGENT:-$P_AGENT}"
P_MODEL="${OVR_MODEL:-$P_MODEL}"
P_MODEL_AUTH="${OVR_MODEL_AUTH:-$P_MODEL_AUTH}"
P_FAIL_ON="$(printf '%s' "$P_FAIL_ON" | tr '[:lower:]' '[:upper:]')"

case "$P_FAIL_ON" in CRITICAL|HIGH|MEDIUM|HIGH_BUG|BUG|LOW) ;; *) die "fail_on must be one of CRITICAL HIGH MEDIUM HIGH_BUG BUG LOW (got '$P_FAIL_ON')";; esac
case "$P_THINKING_LEVEL" in minimal|low|medium|high|xhigh) ;; *) die "thinking_level must be minimal|low|medium|high|xhigh (got '$P_THINKING_LEVEL')";; esac
case "$P_AGENT" in claude|codex|pi) ;; *) die "agent must be claude|codex|pi (got '$P_AGENT')";; esac
case "$P_MODEL_AUTH" in local|direct|custom) ;; *) die "model_auth must be local|direct|custom (got '$P_MODEL_AUTH')";; esac

# ── Availability ─────────────────────────────────────────────────────────────
if [ "$P_ENABLED" != "true" ]; then
  echo "deepsec-gate: disabled by policy ([security.deepsec].enabled=false in ${P_SOURCE}); record the gate as SKIPPED, not passed" >&2
  exit "$EX_CONFIG"
fi
if ! command -v deepsec >/dev/null 2>&1; then
  echo "deepsec-gate: 'deepsec' is not on PATH — set [toolchains].deepsec=true and rebuild the image (ADR-2033); record the gate as UNAVAILABLE" >&2
  exit "$EX_CONFIG"
fi

# ── Model route (persisted as non-secret config; names only) ─────────────────
route_json=""
case "$P_MODEL_AUTH" in
  local)
    if [ "$MODE" != "scan-only" ]; then
      case "$P_AGENT" in
        claude) command -v claude >/dev/null 2>&1 || die "model_auth=local with agent=claude needs the 'claude' CLI on PATH ([toolchains].claude_code)";;
        codex)  command -v codex  >/dev/null 2>&1 || die "model_auth=local with agent=codex needs the 'codex' CLI on PATH ([toolchains].codex)";;
        pi)     die "model_auth=local supports agent=claude|codex only; use model_auth=custom for pi";;
      esac
    fi
    route_json='{ "mode": "local", "provider": "local" }'
    ;;
  direct)
    case "$P_AI_PROVIDER" in anthropic|openai) ;; *) die "model_auth=direct needs ai_provider=anthropic|openai";; esac
    [ -n "$P_AI_API_KEY_ENV" ] || die "model_auth=direct needs ai_api_key_env (the NAME of the env var holding the key)"
    if [ "$MODE" != "scan-only" ] && [ -z "${!P_AI_API_KEY_ENV:-}" ]; then
      die "credential env var '$P_AI_API_KEY_ENV' is unset in this process"
    fi
    base_url_part=""
    if [ -n "$P_AI_BASE_URL" ]; then base_url_part=", \"baseUrl\": \"${P_AI_BASE_URL}\""; fi
    route_json="{ \"mode\": \"direct\", \"provider\": \"${P_AI_PROVIDER}\", \"apiKeyEnv\": \"${P_AI_API_KEY_ENV}\"${base_url_part} }"
    ;;
  custom)
    [ "$P_AGENT" = "pi" ] || die "model_auth=custom (OpenAI-compatible endpoint, e.g. the Loom) requires agent=pi"
    [ -n "$P_AI_API_KEY_ENV" ] && [ -n "$P_AI_BASE_URL" ] || die "model_auth=custom needs ai_api_key_env and ai_base_url"
    route_json="{ \"mode\": \"custom\", \"provider\": \"${P_AI_PROVIDER:-custom}\", \"apiKeyEnv\": \"${P_AI_API_KEY_ENV}\", \"baseUrl\": \"${P_AI_BASE_URL}\", \"credentialHeader\": { \"name\": \"authorization\", \"scheme\": \"bearer\" } }"
    ;;
esac

# ── Workspace + receipts ─────────────────────────────────────────────────────
WS="$ROOT/.deepsec-gate"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_DIR="${REPORT_DIR:-$WS/reports/$STAMP}"
REVISION="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
DIRTY="false"; [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ] && DIRTY="true"
DEEPSEC_VERSION="$(deepsec --version 2>/dev/null | head -1 || echo unknown)"

plan_json() {
  python3 - "$@" <<'PY'
import json, sys
keys = ["mode","diff_ref","files_from","root","project_id","workspace","report_dir","revision","dirty",
        "deepsec_version","policy_source","agent","model_auth","model","thinking_level","fail_on",
        "max_duration","batch_size","concurrency","ai_provider","ai_api_key_env","ai_base_url","route"]
vals = dict(zip(keys, sys.argv[1:]))
vals["route"] = json.loads(vals["route"])
print(json.dumps(vals, indent=2))
PY
}
PLAN="$(plan_json "$MODE" "$DIFF_REF" "$FILES_FROM" "$ROOT" "$PROJECT_ID" "$WS" "$REPORT_DIR" "$REVISION" "$DIRTY" \
  "$DEEPSEC_VERSION" "$P_SOURCE" "$P_AGENT" "$P_MODEL_AUTH" "$P_MODEL" "$P_THINKING_LEVEL" "$P_FAIL_ON" \
  "$P_MAX_DURATION" "$P_BATCH_SIZE" "$P_CONCURRENCY" "$P_AI_PROVIDER" "$P_AI_API_KEY_ENV" "$P_AI_BASE_URL" "$route_json")"
if [ "$DRY_RUN" = 1 ]; then printf '%s\n' "$PLAN"; exit 0; fi

mkdir -p "$WS/data" "$REPORT_DIR"
cat > "$WS/deepsec.config.mjs" <<CFG
// Generated by build-with-quality/scripts/deepsec-gate.sh (ADR-2033). Non-secret:
// the model route names an env var, never a credential. Safe to delete.
export default {
  ai: ${route_json},
  projects: [{ id: "${PROJECT_ID}", root: "${ROOT}" }],
  dataDir: "./data",
};
CFG
[ -f "$WS/.gitignore" ] || printf '*\n' > "$WS/.gitignore"
printf '%s\n' "$PLAN" > "$REPORT_DIR/plan.json"

cd "$WS"
# NOTE: deepsec 2.3.9 (the pinned/baked CLI) accepts only --project-id,
# --root and --matchers on `scan`, and rejects unknown options with exit 1.
# It renders no TUI when stdout is not a TTY, which is how the gate runs it.
common=(--project-id "$PROJECT_ID" --root "$ROOT")
model_args=(--agent "$P_AGENT" --thinking-level "$P_THINKING_LEVEL" --batch-size "$P_BATCH_SIZE" --concurrency "$P_CONCURRENCY")
[ -n "$P_MODEL" ] && model_args+=(--model "$P_MODEL")

run_bounded() {
  # GNU timeout: SIGINT lets deepsec checkpoint; re-running resumes.
  set +e
  timeout --signal=INT --kill-after=30s "$P_MAX_DURATION" "$@" 2>&1 | tee -a "$REPORT_DIR/deepsec.log"
  local rc=${PIPESTATUS[0]}
  set -e
  return "$rc"
}

deepsec_rc=0
case "$MODE" in
  scan-only)
    run_bounded deepsec scan "${common[@]}" || deepsec_rc=$?
    ;;
  full)
    run_bounded deepsec scan "${common[@]}" || deepsec_rc=$?
    [ "$deepsec_rc" = 0 ] && { run_bounded deepsec process "${common[@]}" "${model_args[@]}" || deepsec_rc=$?; }
    ;;
  diff)
    run_bounded deepsec process --diff "$DIFF_REF" "${common[@]}" "${model_args[@]}" --comment-out "$REPORT_DIR/comment.md" || deepsec_rc=$?
    ;;
  diff-working)
    run_bounded deepsec process --diff-working "${common[@]}" "${model_args[@]}" --comment-out "$REPORT_DIR/comment.md" || deepsec_rc=$?
    ;;
  diff-staged)
    run_bounded deepsec process --diff-staged "${common[@]}" "${model_args[@]}" --comment-out "$REPORT_DIR/comment.md" || deepsec_rc=$?
    ;;
  files-from)
    run_bounded deepsec process --files-from "$FILES_FROM" "${common[@]}" "${model_args[@]}" --comment-out "$REPORT_DIR/comment.md" || deepsec_rc=$?
    ;;
esac

if [ "$deepsec_rc" = 124 ] || [ "$deepsec_rc" = 137 ]; then
  echo "deepsec-gate: max_duration=$P_MAX_DURATION reached; deepsec checkpoints, re-run the same command to resume" >&2
  python3 - "$REPORT_DIR/receipt.json" "$MODE" "$REVISION" "$DIRTY" "$deepsec_rc" <<'PY'
import json, sys, datetime
json.dump({"gate":"deepsec","result":"TIMEOUT","mode":sys.argv[2],"revision":sys.argv[3],"dirty":sys.argv[4]=="true",
           "deepsec_exit":int(sys.argv[5]),"at":datetime.datetime.now(datetime.timezone.utc).isoformat()}, open(sys.argv[1],"w"), indent=2)
PY
  exit "$EX_TIMEOUT"
fi
# PR mode: 0 = no net-new findings, 1 = net-new findings, anything else = runtime error.
# scan-only / full: any non-zero is a runtime error.
if { [ "$MODE" = scan-only ] || [ "$MODE" = full ]; } && [ "$deepsec_rc" != 0 ]; then
  echo "deepsec-gate: deepsec exited $deepsec_rc (runtime error); see $REPORT_DIR/deepsec.log" >&2; exit "$EX_RUNTIME"
fi
if [ "$MODE" != scan-only ] && [ "$MODE" != full ] && [ "$deepsec_rc" != 0 ] && [ "$deepsec_rc" != 1 ]; then
  echo "deepsec-gate: deepsec exited $deepsec_rc (runtime error); see $REPORT_DIR/deepsec.log" >&2; exit "$EX_RUNTIME"
fi

# ── Evidence + threshold ─────────────────────────────────────────────────────
if [ "$MODE" != scan-only ]; then
  deepsec export --project-id "$PROJECT_ID" --format json --min-severity LOW --out "$REPORT_DIR/findings.json" >>"$REPORT_DIR/deepsec.log" 2>&1 || true
fi
set +e
python3 - "$REPORT_DIR" "$WS/data/$PROJECT_ID" "$MODE" "$P_FAIL_ON" "$REVISION" "$DIRTY" "$deepsec_rc" "$DEEPSEC_VERSION" "$P_SOURCE" <<'PY'
import glob, json, os, sys, datetime
report, data, mode, fail_on, rev, dirty, rc, ver, src = sys.argv[1:10]
ORDER = ["CRITICAL", "HIGH", "MEDIUM", "HIGH_BUG", "BUG", "LOW"]
threshold = ORDER.index(fail_on)
findings = []
fj = os.path.join(report, "findings.json")
def load(p):
    with open(p) as fh:
        return json.load(fh)
if os.path.isfile(fj):
    doc = load(fj)
    items = doc if isinstance(doc, list) else doc.get("findings", [])
    for it in items:
        if isinstance(it, dict) and "severity" in it:
            findings.append(it)
        elif isinstance(it, dict) and isinstance(it.get("findings"), list):
            for f in it["findings"]:
                f = dict(f); f.setdefault("filePath", it.get("filePath")); findings.append(f)
elif os.path.isdir(fj):
    for p in glob.glob(os.path.join(fj, "*.json")):
        doc = load(p)
        (findings.extend(doc) if isinstance(doc, list) else findings.append(doc))
candidates = 0
for p in glob.glob(os.path.join(data, "files", "**", "*.json"), recursive=True):
    try:
        candidates += len(load(p).get("candidates", []))
    except Exception:
        pass
by_sev = {s: 0 for s in ORDER}
for f in findings:
    s = str(f.get("severity", "LOW")).upper()
    by_sev[s] = by_sev.get(s, 0) + 1
blocking = [f for f in findings if str(f.get("severity", "LOW")).upper() in ORDER and ORDER.index(str(f["severity"]).upper()) <= threshold]
if mode == "scan-only":
    result = "SCANNED"
elif blocking:
    result = "BLOCK"
else:
    result = "PASS"
receipt = {
    "gate": "deepsec", "adr": "ADR-2033", "result": result, "mode": mode, "fail_on": fail_on,
    "revision": rev, "dirty": dirty == "true", "deepsec_version": ver, "policy_source": src,
    "deepsec_exit": int(rc), "candidates": candidates, "findings_by_severity": by_sev,
    "blocking": [{"severity": f.get("severity"), "file": f.get("filePath"), "title": f.get("title"),
                  "lines": f.get("lineNumbers")} for f in blocking],
    "net_new_reported_by_deepsec": (int(rc) == 1) if mode not in ("scan-only", "full") else None,
    "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
json.dump(receipt, open(os.path.join(report, "receipt.json"), "w"), indent=2)
print(f"deepsec-gate: {result} — {len(findings)} finding(s) {by_sev}, {len(blocking)} at/above {fail_on}; candidates={candidates}; receipt {os.path.join(report,'receipt.json')}")
sys.exit(1 if result == "BLOCK" else 0)
PY
rc=$?
set -e
exit "$rc"
