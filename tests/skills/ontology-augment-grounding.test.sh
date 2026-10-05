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
#   9. vault find, zero hits        → "silent", generation from the local
#                                      .generation.json (located via agentbox.toml
#                                      [vault].repo + vault.toml [build].out), and
#                                      owl:versionIRI from its ontology_digest
#  10. vault calls are pinned with --repo, so the wrapper works from any cwd
#  11. ask with no seed             → "silent" with the vault generation
#  12. ask with a seed              → "answered", retrieve result wrapped
#  13. validate keeps its exit code (1) through the envelope
#  14. a missing .generation.json   → generation.id null with a reason, still exit 0
#  15. SPARQL ASK false → silent; ASK true → answered
#  16. neighbours with /mcp 404     → vault tree fallback, enveloped, fallback named
#  17. paths with /mcp 404          → degraded, never a corpus walk
#  18. health                       → generation from the /health body
#  19. MCP tools/call bodies        → content items counted: text "[]" silent,
#                                      a JSON array with a row answered, prose
#                                      unrecognised (silent, shape named), isError degraded
#  20. vault tree fallback          → no children (key omitted or []) silent, children answered
#  21. an unrecognised 200 body     → never "answered"; silent with shape "unrecognised"
#  22. check (VisionClaw POST /api/ontology-agent/check, ADR-2127):
#        entailed → answered, entailed_false → contradicted, not_asserted → silent,
#        HTTP 500 / unreachable / no verdict → degraded (exit 0); base URL from
#        VISIONCLAW_API_URL or agentbox.toml [skills.ontology].visionclaw_api_url;
#        {subject,class} and {subject,property,object} bodies; scope.generation cited
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
            iri = req.get("params", {}).get("arguments", {}).get("iri", "")
            def mcp(result):
                self.send_json(200, {"jsonrpc": "2.0", "id": req.get("id", 1), "result": result})
            if iri == "mcp-empty":
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

# Every run: a clean env with the stubs first on PATH. VAULT_REPO is unset on
# purpose, so the repo must come from AGENTBOX_CONFIG's [vault].repo.
run() {
  (cd "$WORK" && env -u VAULT_REPO -u VAULT_GENERATION_FILE -u VISIONCLAW_API_URL \
     PATH="$BIN:$PATH" AGENTBOX_CONFIG="$WORK/agentbox.toml" \
     STUB_VAULT_LOG="$WORK/vault.log" ONTOLOGY_TIMEOUT_SECS=3 "$@")
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

# 9 / 10. vault find, silent, generation from the local build
: > "$WORK/vault.log"
out="$(run env LOOM_BASE_URL="http://127.0.0.1:1" bash "$S" search zzz-nothing 2>"$WORK/err")"; rc=$?
[ "$rc" -eq 0 ] && ok "vault search: exit 0" || bad "vault search: exit 0" "rc=$rc" "$(cat "$WORK/err")"
check "vault search: silent"                  "$out" '.grounding == "silent" and .source == "vault"'
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
check "neighbours fallback: vault answered, fallback named, generation cited" "$out" \
  '.source == "vault" and .fallback.loom_status == "404" and .generation.id != null and .result.id == "Escrow Oracle"'

# 17. paths
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" paths a b 2>/dev/null)"; rc=$?
check "paths without /mcp: degraded, exit 0"  "$out" '.grounding == "degraded" and .result.reason == "paths_need_reasoned_graph"'

# 18. health
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" health 2>/dev/null)"
check "health: generation from the body"      "$out" '.grounding == "answered" and .generation.id == "visionGraph@stubgen0001"'
out="$(run env LOOM_BASE_URL="http://127.0.0.1:1" bash "$S" health 2>/dev/null)"; rc=$?
check "health unreachable: degraded"          "$out" '.grounding == "degraded"'
[ "$rc" -eq 0 ] && ok "health unreachable: exit 0" || bad "health unreachable: exit 0" "rc=$rc"

# 16b / 20. vault tree fallback is counted, not answered by default
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours escrow-oracle 2>/dev/null)"
check "neighbours fallback: tree with children: []  → silent" "$out" '.grounding == "silent"'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours leaf 2>/dev/null)"
check "tree fallback: children key omitted (vault skips empty) → silent" "$out" '.grounding == "silent" and .source == "vault"'
out="$(run env LOOM_BASE_URL="$STUB" bash "$S" neighbours hub 2>/dev/null)"
check "tree fallback: two children → answered" "$out" '.grounding == "answered" and .source == "vault"'

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

# 14. no generation file
rm "$CORPUS/out/.generation.json"
out="$(run bash "$S" search zzz-nothing 2>/dev/null)"; rc=$?
[ "$rc" -eq 0 ] && ok "no .generation.json: still exit 0" || bad "no .generation.json: still exit 0" "rc=$rc"
check "no .generation.json: id null with a reason" "$out" '.generation.id == null and (.generation.reason | length) > 0'

echo
echo "ontology-augment grounding: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
