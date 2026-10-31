#!/usr/bin/env bash
# ADR-2129 — ontology grounding treats silence as unknown and cites its generation.
#
# skills/ontology-augment/scripts/ontology-augment.sh runs against a stub Loom
# (a local python http.server on an ephemeral port) and a stub `vault` that
# records its argv. Neither the real Loom nor the real corpus is touched.
#
# Cases:
#   1. healthy Loom, zero rows      → grounding "silent", degraded false,
#                                      generation = x-loom-generation / -content-digest
#   2. healthy Loom, one row        → grounding "answered", generation carried
#   3. Loom unreachable             → grounding "degraded", degraded true, exit 0,
#                                      no generation claimed (nobody answered)
#   4. 200 with a degraded body     → "degraded", not "silent"
#   5. body carries truth=entailed_false (ADR-2127) → "contradicted"
#   6. no entailed_false anywhere   → "contradicted" never appears
#   7. FILTER NOT EXISTS / MINUS    → negation.reading "not asserted at this generation"
#   8. x-loom-version-iri header    → generation.version_iri
#   9. ontomark find, zero hits        → "silent", generation from the local
#                                      .generation.json (located via agentbox.toml
#                                      [vault].repo + vault.toml [build].out), and
#                                      owl:versionIRI from its ontology_digest
#  10. vault calls are pinned with --repo, so the wrapper works from any cwd
#  11. ask with no seed             → "silent" with the vault generation
#  12. ask with a seed              → "answered", retrieve result wrapped
#  13. validate keeps its exit code (1) through the envelope
#  14. a missing .generation.json   → generation.id null with a reason, still exit 0
#  15. SPARQL ASK false → silent; ASK true → answered
#  16. neighbours with /mcp 404     → ontomark tree fallback, enveloped, fallback named
#  17. paths with /mcp 404          → degraded, never a corpus walk
#  18. health                       → generation from the /health body
#  19. MCP tools/call bodies        → content items counted: text "[]" silent,
#                                      a JSON array with a row answered, prose
#                                      unrecognised (silent, shape named), isError degraded
#  20. ontomark tree fallback       → no children (key omitted or []) silent, children answered
#  21. an unrecognised 200 body     → never "answered"; silent with shape "unrecognised"
#  22. check (VisionClaw POST /api/ontology-agent/check, ADR-2127):
#        entailed → answered, entailed_false → contradicted, not_asserted → silent,
#        HTTP 500 / unreachable / no verdict → degraded (exit 0); base URL from
#        VISIONCLAW_API_URL or agentbox.toml [skills.ontology].visionclaw_api_url;
#        {subject,class} and {subject,property,object} bodies; scope.generation cited
#  23. result labels and --ref (2026-10-31): every envelope carries call_id and
#      refs (E/N/P/S labels, unique per call, deterministic, additive to the
#      unchanged .result); --ref <call_id>:<label> resolves through a per-call
#      cache file under ${XDG_RUNTIME_DIR:-/tmp}, rejects malformed or unknown
#      refs with exit 2, and an unusable cache never costs the answer.
#
# Run: bash tests/skills/ontology-augment-grounding.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
S="$REPO/skills/ontology-augment/scripts/ontology-augment.sh"

pass=0
fail=0
ok()  { echo "ok   — $1"; pass=$((pass + 1)); }
bad() { echo "FAIL — $1"; shift; printf '%s\n' "$@" | sed 's/^/       | /'; fail=$((fail + 1)); }
# check <name> <json> <jq predicate>
check() {
  if printf '%s' "$2" | jq -e "$3" >/dev/null 2>&1; then ok "$1"; else bad "$1" "predicate: $3" "$2"; fi
}

command -v jq >/dev/null || { echo "FAIL — jq is required"; exit 1; }
command -v python3 >/dev/null || { echo "FAIL — python3 is required for the stub Loom"; exit 1; }

WORK="$(mktemp -d)"
STUB_PID=""
cleanup() { [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

# ── stub Loom ────────────────────────────────────────────────────────────────
cat > "$WORK/loom.py" <<'PY'
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

GEN = "visionGraph@stubgen0001"
DIGEST = "c0ffee0000000000000000000000000000000000000000000000000000000000"

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send_json(self, code, body, extra=None):
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("X-Loom-Generation", GEN)
        self.send_header("x-loom-content-digest", DIGEST)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True, "generation": {"id": GEN, "content_digest": DIGEST}})
        else:
            self.send_json(404, {"error": "no route"})
    def do_POST(self):
        n = int(self.headers.get("content-length", "0"))
        req = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/api/ontology-agent/check":
            with open(CHECK_LOG, "a") as f:
                f.write(json.dumps(req, sort_keys=True) + "\n")
            subj = req.get("subject", "")
            scope = {"closure": "open", "generation": "https://narrativegoldmine.com/ontology/sha256-12-feedfeedfeed"}
            base = {"subject": subj, "class": req.get("class", ""), "basis": None, "witness": None, "scope": scope}
            # The live server wraps every 200 in ok_json!'s envelope; s-bare
            # keeps the unwrapped shape covered too.
            def ok(payload):
                if "s-bare" in subj:
                    self.send_json(200, payload)
                else:
                    self.send_json(200, {"success": True, "data": payload, "error": None,
                                         "timestamp": "2026-10-05T00:00:00Z", "request_id": None})
            if "s-500" in subj:
                self.send_json(500, {"error": "Membership check failed"})
            elif "s-unknown" in subj:
                self.send_json(400, {"error": "Unresolved term",
                                     "message": "'s-unknown' names no class in the loaded ontology"})
            elif "s-noverdict" in subj:
                ok({"success": True})
            elif "s-entailed" in subj:
                ok({"success": True, "check": dict(base, verdict="entailed", basis="inferred")})
            elif "s-false" in subj:
                ok({"success": True, "check": dict(base, verdict="entailed_false",
                                     witness={"asserted": "urn:x:A", "disjoint_with": "urn:x:B"})})
            else:
                ok({"success": True, "check": dict(base, verdict="not_asserted")})
            return
        if self.path == "/mcp":
            params = req.get("params", {})
            tool = params.get("name", "")
            args = params.get("arguments", {})
            iri = args.get("iri", "")
            def mcp(result):
                self.send_json(200, {"jsonrpc": "2.0", "id": req.get("id", 1), "result": result})
            def live(obj):
                # the shape the deployed :8084 /mcp returns (probed 2026-10-13):
                # text content AND structuredContent.result, both carrying obj
                mcp({"content": [{"type": "text", "text": json.dumps(obj, indent=2)}],
                     "structuredContent": {"result": obj, "grounding": {"generation": GEN}}})
            if tool == "loom.browse":
                if args.get("query") == "Escrow Oracle":
                    live({"query": "Escrow Oracle", "kind": "any", "candidates": [
                        {"iri": "urn:ngm:class:escrow-oracle-extended", "title": "Escrow Oracle Extended", "score": 12.0},
                        {"iri": "urn:ngm:class:escrow-oracle", "title": "Escrow Oracle", "score": 19.5}]})
                else:
                    live({"query": args.get("query"), "kind": "any", "candidates": []})
            elif tool == "loom.paths":
                frm, to = args.get("from", ""), args.get("to", "")
                if frm == "rpc-err":
                    self.send_json(200, {"jsonrpc": "2.0", "id": 1,
                                         "error": {"code": -32602, "message": "missing or empty string argument: to"}})
                elif to == "live-b":
                    live({"from": frm, "to": to, "max_hops": 4, "found": True, "hops": 1, "path": [frm, to]})
                else:
                    live({"from": frm, "to": to, "max_hops": 4, "found": False, "hops": None, "path": None})
            elif iri == "urn:ngm:class:escrow-oracle" or iri == "urn:ngm:class:live-hit":
                live({"iri": iri, "title": "Live Hit", "is_a": ["urn:ngm:class:parent"],
                      "ancestors": ["urn:ngm:class:grandparent"],
                      "relations": [{"predicate": "requires", "targets": ["urn:ngm:class:a", "urn:ngm:class:b"]}]})
            elif iri == "urn:ngm:class:live-missing":
                live({"iri": iri, "found": False})
            elif iri == "rpc-err":
                self.send_json(200, {"jsonrpc": "2.0", "id": 1,
                                     "error": {"code": -32603, "message": "index not loaded"}})
            elif iri == "mcp-empty":
                mcp({"content": [{"type": "text", "text": "[]"}]})
            elif iri == "mcp-nocontent":
                mcp({"content": []})
            elif iri == "mcp-hit":
                mcp({"content": [{"type": "text", "text": json.dumps([{"iri": "urn:x:n1"}])}]})
            elif iri == "mcp-prose":
                mcp({"content": [{"type": "text", "text": "here are some neighbours, maybe"}]})
            elif iri == "mcp-error":
                mcp({"isError": True, "content": [{"type": "text", "text": "tool failed"}]})
            else:
                self.send_json(404, {"error": "no /mcp on this generation"})
            return
        if self.path not in ("/loom/sparql", "/sparql"):
            self.send_json(404, {"error": "no route"})
            return
        q = req.get("query", "")
        empty = {"boolean": None, "columns": ["c"], "rows": [], "truncated": False}
        if "DEGRADEDBODY" in q:
            self.send_json(200, {"degraded": True, "reason": "graph_unavailable", "rows": []})
        elif "CONTRA" in q:
            self.send_json(200, {"boolean": None, "columns": ["c"], "rows": [],
                                 "answers": [{"subject": "urn:ngm:class:p", "truth": "entailed_false"}]})
        elif "VERSIONIRI" in q:
            self.send_json(200, empty, {"x-loom-version-iri": "https://narrativegoldmine.com/ontology/sha256-12-abcdefabcdef"})
        elif "WEIRD" in q:
            self.send_json(200, {"something": "else", "count_me": "no"})
        elif "ASKFALSE" in q:
            self.send_json(200, {"boolean": False, "columns": [], "rows": []})
        elif "ASKTRUE" in q:
            self.send_json(200, {"boolean": True, "columns": [], "rows": []})
        elif "HIT" in q:
            self.send_json(200, {"boolean": None, "columns": ["c"],
                                 "rows": [["https://narrativegoldmine.com/class/smart-contract"]], "truncated": False})
        else:
            self.send_json(200, empty)

CHECK_LOG = sys.argv[1]
srv = HTTPServer(("127.0.0.1", 0), H)
print(srv.server_address[1], flush=True)
srv.serve_forever()
PY
python3 "$WORK/loom.py" "$WORK/check.log" > "$WORK/port" 2>/dev/null &
STUB_PID=$!
for _ in $(seq 1 50); do [ -s "$WORK/port" ] && break; sleep 0.1; done
PORT="$(head -1 "$WORK/port")"
[ -n "$PORT" ] || { echo "FAIL — stub Loom did not start"; exit 1; }
STUB="http://127.0.0.1:$PORT"

# ── stub corpus + stub vault ─────────────────────────────────────────────────
CORPUS="$WORK/corpus"
mkdir -p "$CORPUS/ontology" "$CORPUS/out"
: > "$CORPUS/ontology/vocabulary.yaml"
cat > "$CORPUS/vault.toml" <<'EOF'
[vault]
name = "stub"

[build]
out = "out"
vault = "knowledge"
EOF
cat > "$CORPUS/out/.generation.json" <<'EOF'
{
  "id": "visionGraph@1111111111111111111111111111111111111111",
  "commit": "1111111111111111111111111111111111111111",
  "content_digest": "abababababababababababababababababababababababababababababababab",
  "ontology_digest": "sha256-12-0123456789ab",
  "generated_at": "2026-10-05T00:00:00+00:00",
  "artifacts": []
}
EOF
cat > "$WORK/agentbox.toml" <<EOF
[vault]
root = "$CORPUS/knowledge"
repo = "$CORPUS"   # the repository root
EOF

BIN="$WORK/bin"; mkdir -p "$BIN"
cat > "$BIN/vault" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_VAULT_LOG"
args=" $* "
case "$args" in
  *" find "*"--query zzz-nothing"*) echo '[]' ;;
  *" find "*"--query escrow"*)      echo '[{"id":"Escrow Oracle","title":"Escrow Oracle","type":"Class","score":1.0}]' ;;
  *" find "*)                       echo '[]' ;;
  *" retrieve "*)                   echo '{"seeds":[{"id":"Escrow Oracle"}],"expanded":[],"missing":[],"truncated":false}' ;;
  *" tree hub "*)                   echo '{"id":"Hub","title":"Hub","children":[{"id":"A","title":"A"},{"id":"B","title":"B"}]}' ;;
  *" tree leaf "*)                  echo '{"id":"Leaf","title":"Leaf"}' ;;
  *" tree "*)                       echo '{"id":"Escrow Oracle","title":"Escrow Oracle","children":[]}' ;;
  *" validate "*)                   echo '{"errors":1,"warnings":0}'; exit 1 ;;
  *)                                echo '{}' ;;
esac
EOF
chmod +x "$BIN/vault"

# A stub `ontomark` first on PATH, so the suite never reaches the host's real binary (the wrapper
# takes the first ontomark on PATH; without this, `validate` ran the real one against no vault).
cat > "$BIN/ontomark" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_VAULT_LOG"
args=" $* "
case "$args" in
  *" find "*"--query zzz-nothing"*) echo '[]' ;;
  *" find "*"--query escrow"*)      echo '[{"id":"Escrow Oracle","title":"Escrow Oracle","type":"Class","score":1.0}]' ;;
  *" find "*)                       echo '[]' ;;
  *" retrieve "*)                   echo '{"seeds":[{"id":"Escrow Oracle"}],"expanded":[],"missing":[],"truncated":false}' ;;
  *" tree hub "*)                   echo '{"id":"Hub","title":"Hub","children":[{"id":"A","title":"A"},{"id":"B","title":"B"}]}' ;;
  *" tree leaf "*)                  echo '{"id":"Leaf","title":"Leaf"}' ;;
  *" tree "*)                       echo '{"id":"Escrow Oracle","title":"Escrow Oracle","children":[]}' ;;
  *" validate "*)                   echo '{"errors":1,"warnings":0}'; exit 1 ;;
  *)                                echo '{}' ;;
esac
EOF
chmod +x "$BIN/ontomark"

# Every run: a clean env with the stubs first on PATH. VAULT_REPO is unset on
# purpose, so the repo must come from AGENTBOX_CONFIG's [vault].repo.
run() {
  (cd "$WORK" && env -u VAULT_REPO -u VAULT_GENERATION_FILE -u VISIONCLAW_API_URL \
     PATH="$BIN:$PATH" AGENTBOX_CONFIG="$WORK/agentbox.toml" \
     STUB_VAULT_LOG="$WORK/vault.log" ONTOLOGY_TIMEOUT_SECS=3 XDG_RUNTIME_DIR="$WORK/xdg" "$@")
}

# 1. silent
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" sparql 'SELECT ?c WHERE { ?c a <urn:x:Nope> } LIMIT 5' 2>"$WORK/err")"; rc=$?
[ "$rc" -eq 0 ] && ok "silent: exit 0" || bad "silent: exit 0" "rc=$rc" "$(cat "$WORK/err")"
check "silent: grounding is silent"            "$out" '.grounding == "silent" and .degraded == false'
check "silent: generation id from header"      "$out" '.generation.id == "visionGraph@stubgen0001"'
check "silent: content digest from header"     "$out" '.generation.content_digest | startswith("c0ffee")'
check "silent: source is loom"                 "$out" '.source == "loom"'
check "silent: says it is not negative evidence" "$out" '.note | test("not negative evidence")'
check "silent: original body under .result"    "$out" '.result.rows == []'

# 2. answered
out="$(run env LOOM_BASE_URL="$STUB/v1" bash "$S" sparql 'SELECT ?c WHERE { ?c ?p ?o } LIMIT 1 #HIT' 2>/dev/null)"
check "answered: grounding answered, generation carried" "$out" \
  '.grounding == "answered" and .generation.id == "visionGraph@stubgen0001" and (.result.rows | length) == 1'

# 3. degraded (unreachable)
out="$(run env LOOM_BASE_URL="http://127.0.0.1:1" bash "$S" sparql 'SELECT ?c WHERE { ?c ?p ?o }' 2>"$WORK/err")"; rc=$?
[ "$rc" -eq 0 ] && ok "degraded: fail-open exit 0" || bad "degraded: fail-open exit 0" "rc=$rc"
check "degraded: grounding degraded"           "$out" '.grounding == "degraded" and .degraded == true'
check "degraded: reason loom_unreachable"      "$out" '.result.reason == "loom_unreachable"'
check "degraded: no generation claimed"        "$out" '.generation.id == null'
check "degraded: distinct from silent"         "$out" '.grounding != "silent"'
grep -q "unreachable" "$WORK/err" && ok "degraded: stderr names the cause" || bad "degraded: stderr names the cause" "$(cat "$WORK/err")"

# 4. degraded body on a 200
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" sparql 'SELECT ?c WHERE { ?c ?p ?o } #DEGRADEDBODY' 2>/dev/null)"
check "200-degraded body: degraded, not silent" "$out" '.grounding == "degraded" and .degraded == true'

# 5. contradicted
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" sparql 'ASK { <urn:ngm:class:p> ?p ?o } #CONTRA' 2>/dev/null)"
check "entailed_false: grounding contradicted" "$out" '.grounding == "contradicted"'

# 6. never invented
seen=0
for q in 'SELECT ?c WHERE {?c ?p ?o}' 'SELECT ?c WHERE {?c ?p ?o} #HIT'; do
  o="$(run env LOOM_BASE_URL="$STUB" bash "$S" sparql "$q" 2>/dev/null)"
  printf '%s' "$o" | grep -q contradicted && seen=1
done
[ "$seen" -eq 0 ] && ok "contradicted is never emitted without entailed_false" || bad "contradicted leaked" "$o"

# 7. negation
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" sparql \
  'SELECT ?c WHERE { ?c a <urn:x:C> FILTER NOT EXISTS { ?c <urn:x:p> ?o } } #HIT' 2>/dev/null)"
check "FILTER NOT EXISTS: labelled not asserted at this generation" "$out" \
  '.negation.reading == "not asserted at this generation" and (.negation.operators | index("FILTER NOT EXISTS")) != null'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" sparql \
  'select ?c where { ?c a <urn:x:C> minus { ?c <urn:x:p> ?o } }' 2>/dev/null)"
check "MINUS (any case): labelled"            "$out" '(.negation.operators | index("MINUS")) != null'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" sparql 'SELECT ?c WHERE { ?c ?p ?o } #HIT' 2>/dev/null)"
check "no negation operator: no negation label" "$out" 'has("negation") | not'

# 8. versionIRI header
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" sparql 'SELECT ?c WHERE { ?c ?p ?o } #VERSIONIRI' 2>/dev/null)"
check "x-loom-version-iri: carried as version_iri" "$out" \
  '.generation.version_iri == "https://narrativegoldmine.com/ontology/sha256-12-abcdefabcdef"'

# 9 / 10. ontomark find, silent, generation from the local build
: > "$WORK/vault.log"
out="$(run env LOOM_BASE_URL="http://127.0.0.1:1" bash "$S" search zzz-nothing 2>"$WORK/err")"; rc=$?
[ "$rc" -eq 0 ] && ok "vault search: exit 0" || bad "vault search: exit 0" "rc=$rc" "$(cat "$WORK/err")"
check "ontomark search: silent"                  "$out" '.grounding == "silent" and .source == "ontomark"'
check "vault search: generation id from .generation.json" "$out" \
  '.generation.id == "visionGraph@1111111111111111111111111111111111111111"'
check "vault search: versionIRI from ontology_digest" "$out" \
  '.generation.version_iri == "https://narrativegoldmine.com/ontology/sha256-12-0123456789ab"'
check "vault search: names the file it read"  "$out" '.generation.from | endswith("out/.generation.json")'
grep -q -- "--repo $WORK/corpus" "$WORK/vault.log" \
  && ok "vault calls pinned with --repo from agentbox.toml [vault].repo" \
  || bad "vault calls pinned with --repo" "$(cat "$WORK/vault.log")"

# 11. ask, no seed
out="$(run bash "$S" ask zzz-nothing 2>/dev/null)"
check "ask without a seed: silent with generation" "$out" \
  '.grounding == "silent" and .generation.id == "visionGraph@1111111111111111111111111111111111111111"'

# 12. ask, a seed
out="$(run bash "$S" ask escrow 2>/dev/null)"
check "ask with a seed: answered, retrieve result wrapped" "$out" \
  '.grounding == "answered" and .result.seeds[0].id == "Escrow Oracle"'

# 13. validate exit code survives
out="$(run bash "$S" validate 2>/dev/null)"; rc=$?
[ "$rc" -eq 1 ] && ok "validate: exit 1 passed through" || bad "validate: exit 1 passed through" "rc=$rc" "$out"
check "validate: still enveloped with generation" "$out" '.result.errors == 1 and .generation.id != null'

# 15. ASK
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" sparql 'ASK { ?c ?p ?o } #ASKFALSE' 2>/dev/null)"
check "ASK false: silent, not a negative"     "$out" '.grounding == "silent"'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" sparql 'ASK { ?c ?p ?o } #ASKTRUE' 2>/dev/null)"
check "ASK true: answered"                    "$out" '.grounding == "answered"'

# 16. neighbours fallback
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours escrow-oracle 2>/dev/null)"; rc=$?
[ "$rc" -eq 0 ] && ok "neighbours fallback: exit 0" || bad "neighbours fallback: exit 0" "rc=$rc"
check "neighbours fallback: ontomark answered, fallback named, generation cited" "$out" \
  '.source == "ontomark" and .fallback.loom_status == "404" and .generation.id != null and .result.id == "Escrow Oracle"'

# 17. paths
out="$(run env LOOM_BASE_URL="http://127.0.0.1:1" bash "$S" paths a b 2>/dev/null)"; rc=$?
check "paths with the Loom unreachable: degraded, never a corpus walk" "$out" '.grounding == "degraded" and .result.reason == "paths_need_reasoned_graph"'
[ "$rc" -eq 0 ] && ok "paths unreachable: exit 0" || bad "paths unreachable: exit 0" "rc=$rc"

# 18. health
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" health 2>/dev/null)"
check "health: generation from the body"      "$out" '.grounding == "answered" and .generation.id == "visionGraph@stubgen0001"'
out="$(run env LOOM_BASE_URL="http://127.0.0.1:1" bash "$S" health 2>/dev/null)"; rc=$?
check "health unreachable: degraded"          "$out" '.grounding == "degraded"'
[ "$rc" -eq 0 ] && ok "health unreachable: exit 0" || bad "health unreachable: exit 0" "rc=$rc"

# 16b / 20. ontomark tree fallback is counted, not answered by default
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours escrow-oracle 2>/dev/null)"
check "neighbours fallback: tree with children: []  → silent" "$out" '.grounding == "silent"'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours leaf 2>/dev/null)"
check "tree fallback: children key omitted (ontomark skips empty) → silent" "$out" '.grounding == "silent" and .source == "ontomark"'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours hub 2>/dev/null)"
check "tree fallback: two children → answered" "$out" '.grounding == "answered" and .source == "ontomark"'

# 19. MCP tools/call bodies
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours mcp-empty 2>/dev/null)"
check "MCP: text item \"[]\" → silent, loom answered"  "$out" '.grounding == "silent" and .source == "loom"'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours mcp-nocontent 2>/dev/null)"
check "MCP: content [] → silent"                     "$out" '.grounding == "silent"'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours mcp-hit 2>/dev/null)"
check "MCP: text item with one row → answered"       "$out" '.grounding == "answered" and .generation.id == "visionGraph@stubgen0001"'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours mcp-prose 2>/dev/null)"
check "MCP: uncountable prose → not answered, shape unrecognised" "$out" \
  '.grounding == "silent" and .shape == "unrecognised"'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours mcp-error 2>/dev/null)"
check "MCP: isError → degraded"                      "$out" '.grounding == "degraded" and .degraded == true'

# 19b. the LIVE /mcp shape (structuredContent; probed on :8084 2026-10-13)
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours urn:ngm:class:live-hit 2>/dev/null)"
check "live neighbours: found class with relations → answered, loom, no shape flag" "$out" \
  '.grounding == "answered" and .source == "loom" and (has("shape") | not) and .generation.id == "visionGraph@stubgen0001"'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours urn:ngm:class:live-missing 2>/dev/null)"
check "live neighbours: found:false → silent (unknown, not negative), not unrecognised" "$out" \
  '.grounding == "silent" and .source == "loom" and (has("shape") | not)'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours "Escrow Oracle" 2>/dev/null)"
check "title input is resolved by exact title through loom.browse, not slugified" "$out" \
  '.grounding == "answered" and .result.result.structuredContent.result.iri == "urn:ngm:class:escrow-oracle"'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours "Escrow Oracl" 2>/dev/null)"
check "a title with no exact browse match is passed through verbatim (no guessing)" "$out" \
  '.source == "ontomark" and .fallback.loom_status == "404"'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours rpc-err 2>/dev/null)"; rc=$?
[ "$rc" -eq 0 ] && ok "JSON-RPC error on HTTP 200: exit 0" || bad "JSON-RPC error on HTTP 200: exit 0" "rc=$rc"
check "JSON-RPC error on HTTP 200 → ontomark tree fallback named rpc_error, never answered" "$out" \
  '.source == "ontomark" and .fallback.loom_status == "rpc_error"'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" paths live-a live-b 2>/dev/null)"
check "live paths: found:true → answered, loom" "$out" \
  '.grounding == "answered" and .source == "loom" and .result.result.structuredContent.result.hops == 1'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" paths live-a live-none 2>/dev/null)"
check "live paths: found:false → silent (no path asserted), not unrecognised" "$out" \
  '.grounding == "silent" and .source == "loom" and (has("shape") | not)'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" paths rpc-err live-b 2>/dev/null)"; rc=$?
check "paths: JSON-RPC error → degraded, still no corpus walk, exit 0" "$out" \
  '.grounding == "degraded" and .result.reason == "paths_need_reasoned_graph"'
[ "$rc" -eq 0 ] && ok "paths JSON-RPC error: exit 0" || bad "paths JSON-RPC error: exit 0" "rc=$rc"

# 19c. fail-open must not multiply the timeout: with the Loom unreachable the wrapper
# makes ONE attempt per command (a title lookup that finds the Loom down ends the
# attempts), and makes none at all to resolve something already IRI/slug-shaped.
cat > "$WORK/drop.py" <<'PYDROP'
import socket, sys
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", 0)); srv.listen(16)
open(sys.argv[1], "w").write(str(srv.getsockname()[1]))
while True:
    c, _ = srv.accept()
    open(sys.argv[2], "a").write("hit\n")
    c.close()
PYDROP
python3 "$WORK/drop.py" "$WORK/drop.port" "$WORK/drop.hits" & DROP_PID=$!
for _ in $(seq 1 50); do [ -s "$WORK/drop.port" ] && break; sleep 0.1; done
DROP="http://127.0.0.1:$(cat "$WORK/drop.port")"
hits() { if [ -f "$WORK/drop.hits" ]; then wc -l < "$WORK/drop.hits" | tr -d ' '; else echo 0; fi; }

: > "$WORK/drop.hits"
out="$(run env LOOM_BASE_URL="$DROP" bash "$S" neighbours "Escrow Oracle" 2>/dev/null)"; rc=$?
[ "$(hits)" = "1" ] && ok "Loom down, title input: one attempt, not one per call" || bad "Loom down, title input: one attempt" "attempts: $(hits)"
check "Loom down, title input: still falls back to the corpus" "$out" '.source == "ontomark" and .fallback.loom_status == "000"'
[ "$rc" -eq 0 ] && ok "Loom down, title input: exit 0" || bad "Loom down, title input: exit 0" "rc=$rc"

: > "$WORK/drop.hits"
run env LOOM_BASE_URL="$DROP" bash "$S" neighbours escrow-oracle >/dev/null 2>&1
[ "$(hits)" = "1" ] && ok "Loom down, slug input: one attempt (no lookup call)" || bad "Loom down, slug input: one attempt" "attempts: $(hits)"

: > "$WORK/drop.hits"
out="$(run env LOOM_BASE_URL="$DROP" bash "$S" paths "Escrow Oracle" "Knowledge Graph" 2>/dev/null)"; rc=$?
[ "$(hits)" = "1" ] && ok "Loom down, paths with two titles: one attempt" || bad "Loom down, paths with two titles: one attempt" "attempts: $(hits)"
check "Loom down, paths: degraded, never a corpus walk" "$out" '.grounding == "degraded" and .result.reason == "paths_need_reasoned_graph" and .result.loom_status == "000"'
[ "$rc" -eq 0 ] && ok "Loom down, paths: exit 0" || bad "Loom down, paths: exit 0" "rc=$rc"
kill "$DROP_PID" 2>/dev/null

# 21. unrecognised 200 body
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" sparql 'SELECT ?c WHERE { ?c ?p ?o } #WEIRD' 2>/dev/null)"
check "unrecognised body: never answered"            "$out" '.grounding == "silent" and .shape == "unrecognised"'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" sparql 'SELECT ?c WHERE { ?c ?p ?o } #HIT' 2>/dev/null)"
check "recognised body: no shape flag"               "$out" 'has("shape") | not'

# 22. check — VisionClaw tri-valued membership (ADR-2127)
: > "$WORK/check.log"
out="$(run env VISIONCLAW_API_URL="$STUB/" bash "$S" check s-entailed 'urn:x:C' 2>"$WORK/err")"; rc=$?
[ "$rc" -eq 0 ] && ok "check: exit 0" || bad "check: exit 0" "rc=$rc" "$(cat "$WORK/err")"
check "check: entailed → answered, source visionclaw"  "$out" \
  '.grounding == "answered" and .source == "visionclaw" and .result.check.verdict == "entailed"'
check "check: scope.generation cited as version_iri"   "$out" \
  '.generation.version_iri == "https://narrativegoldmine.com/ontology/sha256-12-feedfeedfeed"'
out="$(run env VISIONCLAW_API_URL="$STUB" bash "$S" check s-false 'urn:x:C' 2>/dev/null)"
check "check: entailed_false → contradicted"           "$out" '.grounding == "contradicted" and .result.check.witness != null'
out="$(run env VISIONCLAW_API_URL="$STUB" bash "$S" check s-silent 'urn:x:C' 2>/dev/null)"
check "check: not_asserted → silent (open world)"      "$out" '.grounding == "silent" and .degraded == false'
out="$(run env VISIONCLAW_API_URL="$STUB" bash "$S" check s-500 'urn:x:C' 2>/dev/null)"; rc=$?
check "check: HTTP 500 → degraded"                     "$out" '.grounding == "degraded" and .result.reason == "visionclaw_http_500"'
[ "$rc" -eq 0 ] && ok "check: HTTP 500 exit 0 (fail-open)" || bad "check: HTTP 500 exit 0" "rc=$rc"
out="$(run env VISIONCLAW_API_URL="$STUB" bash "$S" check s-entailed-s-bare 'urn:x:C' 2>/dev/null)"
check "check: unenveloped body still answered"         "$out" '.grounding == "answered" and .result.check.verdict == "entailed"'
out="$(run env VISIONCLAW_API_URL="$STUB" bash "$S" check s-unknown 'urn:x:C' 2>/dev/null)"; rc=$?
check "check: 400 unknown term → degraded with the message" "$out" \
  '.grounding == "degraded" and .result.reason == "visionclaw_http_400" and (.result.message | test("names no class"))'
[ "$rc" -eq 0 ] && ok "check: 400 exit 0 (fail-open)" || bad "check: 400 exit 0" "rc=$rc"
out="$(run env VISIONCLAW_API_URL="$STUB" bash "$S" check s-noverdict 'urn:x:C' 2>/dev/null)"
check "check: 200 with no verdict → degraded"          "$out" '.grounding == "degraded"'
out="$(run env VISIONCLAW_API_URL="http://127.0.0.1:1" bash "$S" check s-entailed 'urn:x:C' 2>/dev/null)"; rc=$?
check "check: unreachable → degraded, no generation"   "$out" \
  '.grounding == "degraded" and .result.reason == "visionclaw_unreachable" and .generation.id == null'
[ "$rc" -eq 0 ] && ok "check: unreachable exit 0 (fail-open)" || bad "check: unreachable exit 0" "rc=$rc"
out="$(run env VISIONCLAW_API_URL="$STUB" bash "$S" check s-silent --property 'urn:x:p' --object 'urn:x:o' 2>/dev/null)"
check "check: property form → silent"                  "$out" '.grounding == "silent"'
grep -qF '{"object": "urn:x:o", "property": "urn:x:p", "subject": "s-silent"}' "$WORK/check.log" \
  && ok "check: property form posts {subject, property, object}" \
  || bad "check: property form body" "$(cat "$WORK/check.log")"
grep -qF '{"class": "urn:x:C", "subject": "s-entailed"}' "$WORK/check.log" \
  && ok "check: class form posts {subject, class}" || bad "check: class form body" "$(cat "$WORK/check.log")"
cp "$WORK/agentbox.toml" "$WORK/agentbox.toml.bak"
printf '\n[skills.ontology]\nenabled = true\nvisionclaw_api_url = "%s"   # manifest\n' "$STUB" >> "$WORK/agentbox.toml"
out="$(run bash "$S" check s-false 'urn:x:C' 2>/dev/null)"
check "check: base URL from agentbox.toml [skills.ontology]" "$out" '.grounding == "contradicted"'
mv "$WORK/agentbox.toml.bak" "$WORK/agentbox.toml"
run bash "$S" check s-false >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "check: missing class/property is a usage error (exit 2)" || bad "check: usage error" "rc=$rc"

# 23. result labels and --ref
mkdir -p "$WORK/xdg"; XDGD="$WORK/xdg/ontology-augment"
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" sparql 'SELECT ?c WHERE { ?c ?p ?o } LIMIT 1 #HIT' 2>/dev/null)"
check "labels: envelope has a call_id"                   "$out" '.call_id | test("^c-[0-9a-f]{8}$")'
check "labels: sparql IRI is S1, kind S"                  "$out" \
  '.refs == [{"label":"S1","kind":"S","id":"https://narrativegoldmine.com/class/smart-contract"}]'
check "labels: .result is untouched, old fields intact"   "$out" \
  '.result.rows == [["https://narrativegoldmine.com/class/smart-contract"]] and .grounding == "answered" and .source == "loom" and .generation.id == "visionGraph@stubgen0001"'
check "labels: call_id and refs sit before result"        "$out" '(keys_unsorted | index("refs")) < (keys_unsorted | index("result"))'
[ -f "$XDGD/$(printf '%s' "$out" | jq -r .call_id).json" ] && ok "labels: call record written under XDG_RUNTIME_DIR" || bad "labels: call record written" "$(ls -la "$XDGD" 2>&1)"
[ "$(stat -c %a "$XDGD")" = "700" ] && ok "labels: cache dir is mode 0700" || bad "labels: cache dir mode" "$(stat -c %a "$XDGD")"

out1="$(run bash "$S" search escrow 2>/dev/null)"; out2="$(run bash "$S" search escrow 2>/dev/null)"
check "labels: ontomark search entry is E1 with its title" "$out1" '.refs == [{"label":"E1","kind":"E","id":"Escrow Oracle","title":"Escrow Oracle"}]'
[ "$(printf '%s' "$out1" | jq -c .refs)" = "$(printf '%s' "$out2" | jq -c .refs)" ] \
  && ok "labels: deterministic for the same body" || bad "labels: deterministic" "$out1" "$out2"
[ "$(printf '%s' "$out1" | jq -r .call_id)" != "$(printf '%s' "$out2" | jq -r .call_id)" ] \
  && ok "labels: call_id differs between calls" || bad "labels: call_id differs"
out="$(run bash "$S" ask escrow 2>/dev/null)"
check "labels: ask seeds are E-labelled"                  "$out" '.refs[0] | .label == "E1" and .id == "Escrow Oracle"'

out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours urn:ngm:class:live-hit 2>/dev/null)"
check "labels: neighbours N1..N4 with via, unique, subject excluded" "$out" \
  '[.refs[] | "\(.label) \(.via) \(.id)"] == ["N1 is-a urn:ngm:class:parent","N2 ancestor urn:ngm:class:grandparent","N3 requires urn:ngm:class:a","N4 requires urn:ngm:class:b"]
   and ((.refs | map(.label) | unique | length) == (.refs | length))'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" paths live-a live-b 2>/dev/null)"
check "labels: path steps are P1, P2"                     "$out" '[.refs[] | "\(.label) \(.id)"] == ["P1 live-a","P2 live-b"]'
PCID="$(printf '%s' "$out" | jq -r .call_id)"
out="$(run env LOOM_BASE_URL="http://127.0.0.1:1" bash "$S" neighbours hub 2>/dev/null)"
check "labels: tree fallback children are N-labelled"     "$out" '[.refs[] | .label + " " + .id] == ["N1 A","N2 B"]'

out="$(run env LOOM_BASE_URL="$STUB" bash "$S" sparql 'SELECT ?c WHERE { ?c a <urn:x:Nope> } LIMIT 5' 2>/dev/null)"
check "labels: a silent call has call_id and empty refs"  "$out" '.refs == [] and (.call_id | length) > 0'
[ ! -f "$XDGD/$(printf '%s' "$out" | jq -r .call_id).json" ] && ok "labels: nothing cached when there is nothing to label" || bad "labels: empty refs cached"

# --ref
: > "$WORK/vault.log"
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" paths --ref "$PCID:P1" --ref "$PCID:P2" 2>"$WORK/err")"; rc=$?
[ "$rc" -eq 0 ] && ok "--ref: paths with two refs, exit 0" || bad "--ref: paths" "rc=$rc" "$(cat "$WORK/err")"
check "--ref: both ends resolved (live-a → live-b answered)" "$out" '.grounding == "answered" and .result.result.structuredContent.result.hops == 1'
grep -q -- "--ref $PCID:P1 -> live-a" "$WORK/err" && ok "--ref: resolution is announced on stderr" || bad "--ref: stderr" "$(cat "$WORK/err")"
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" paths live-a --ref "$PCID:P2" 2>/dev/null)"
check "--ref: mixes with a literal positional"            "$out" '.grounding == "answered" and .source == "loom"'
SCID="$(printf '%s' "$out1" | jq -r .call_id)"
run bash "$S" get --ref "$SCID:E1" >/dev/null 2>&1
grep -q 'retrieve Escrow Oracle --json' "$WORK/vault.log" && ok "--ref: get --ref E1 retrieves the labelled page (title with a space intact)" || bad "--ref: get" "$(cat "$WORK/vault.log")"
NCID="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours urn:ngm:class:live-hit 2>/dev/null | jq -r .call_id)"
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours --ref "$NCID:N3" --limit 3 2>/dev/null)"
check "--ref: neighbours --ref N3 keeps its other flags (urn:ngm:class:a is unknown to the stub: falls back)" "$out" '.fallback.loom_status == "404"'

run bash "$S" get --ref "c-deadbeef:E1" >/dev/null 2>"$WORK/err"; rc=$?
[ "$rc" -eq 2 ] && grep -q "no record of call c-deadbeef" "$WORK/err" && ok "--ref: unknown call → exit 2 with a reason" || bad "--ref: unknown call" "rc=$rc" "$(cat "$WORK/err")"
run bash "$S" get --ref "$SCID:E9" >/dev/null 2>"$WORK/err"; rc=$?
[ "$rc" -eq 2 ] && grep -q "has no entry E9 (labels: E1)" "$WORK/err" && ok "--ref: unknown label → exit 2 naming the labels that exist" || bad "--ref: unknown label" "rc=$rc" "$(cat "$WORK/err")"
for badref in '../../etc/passwd:E1' 'c-1234:E1' "$SCID:e1" "$SCID" "$SCID:E1;rm"; do
  run bash "$S" get --ref "$badref" >/dev/null 2>"$WORK/err"; rc=$?
  [ "$rc" -eq 2 ] && ok "--ref: malformed '$badref' rejected (exit 2)" || bad "--ref: malformed '$badref'" "rc=$rc" "$(cat "$WORK/err")"
done
run bash "$S" search escrow --ref "$SCID:E1" >/dev/null 2>"$WORK/err"; rc=$?
[ "$rc" -eq 2 ] && grep -q "not supported for 'search'" "$WORK/err" && ok "--ref: refused on subcommands that take no id" || bad "--ref on search" "rc=$rc" "$(cat "$WORK/err")"
run bash "$S" get --ref >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "--ref: missing value → exit 2" || bad "--ref: missing value" "rc=$rc"

# an unusable cache costs the labels, never the answer
echo notadir > "$WORK/blocked"
out="$(run env XDG_RUNTIME_DIR="$WORK/blocked" LOOM_BASE_URL="$STUB" bash "$S" sparql 'SELECT ?c WHERE { ?c ?p ?o } #HIT' 2>/dev/null)"; rc=$?
[ "$rc" -eq 0 ] && ok "cache unusable: exit 0" || bad "cache unusable: exit 0" "rc=$rc"
check "cache unusable: answer and labels intact, ref_cache flagged" "$out" \
  '.grounding == "answered" and .refs[0].label == "S1" and .ref_cache == "unavailable"'
run env XDG_RUNTIME_DIR="$WORK/blocked" bash "$S" get --ref "$SCID:E1" >/dev/null 2>"$WORK/err"; rc=$?
[ "$rc" -eq 2 ] && grep -q "ref cache is unavailable" "$WORK/err" && ok "cache unusable: --ref says so (exit 2)" || bad "cache unusable: --ref" "rc=$rc" "$(cat "$WORK/err")"
# a symlinked cache dir is refused, not followed
mkdir -p "$WORK/evil" "$WORK/xdg2"; ln -s "$WORK/evil" "$WORK/xdg2/ontology-augment"
out="$(run env XDG_RUNTIME_DIR="$WORK/xdg2" bash "$S" search escrow 2>/dev/null)"
check "symlinked cache dir: refused (ref_cache unavailable), nothing written through it" "$out" '.ref_cache == "unavailable"'
[ -z "$(ls -A "$WORK/evil")" ] && ok "symlinked cache dir: target untouched" || bad "symlinked cache dir: target written" "$(ls -A "$WORK/evil")"

# concurrent sessions: 12 parallel calls, 12 distinct ids, every one resolvable
rm -rf "$WORK/xdgc"; mkdir -p "$WORK/xdgc"
for i in $(seq 1 12); do
  ( run env XDG_RUNTIME_DIR="$WORK/xdgc" bash "$S" search escrow 2>/dev/null | jq -r .call_id > "$WORK/par.$i" ) &
done
wait $(jobs -p | grep -v "^$STUB_PID$" | grep -v "^$DROP_PID$") 2>/dev/null
[ "$(cat "$WORK"/par.* | sort -u | wc -l | tr -d ' ')" = "12" ] && ok "concurrent: 12 calls, 12 distinct call_ids" || bad "concurrent: call_ids" "$(cat "$WORK"/par.* | sort | uniq -c)"
okc=0; for i in $(seq 1 12); do
  run env XDG_RUNTIME_DIR="$WORK/xdgc" bash "$S" get --ref "$(cat "$WORK/par.$i"):E1" >/dev/null 2>&1 && okc=$((okc+1))
done
[ "$okc" = "12" ] && ok "concurrent: every call's label still resolves (no clobbering)" || bad "concurrent: resolvable" "$okc/12"
[ -z "$(ls -A "$WORK/xdgc/ontology-augment" | grep '^\.tmp\.')" ] && ok "concurrent: no temp files left behind" || bad "concurrent: temp files" "$(ls -A "$WORK/xdgc/ontology-augment")"

# 14. no generation file
rm "$CORPUS/out/.generation.json"
out="$(run bash "$S" search zzz-nothing 2>/dev/null)"; rc=$?
[ "$rc" -eq 0 ] && ok "no .generation.json: still exit 0" || bad "no .generation.json: still exit 0" "rc=$rc"
check "no .generation.json: id null with a reason" "$out" '.generation.id == null and (.generation.reason | length) > 0'

echo
echo "ontology-augment grounding: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
