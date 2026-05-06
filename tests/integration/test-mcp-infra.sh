#!/usr/bin/env bash
# tests/integration/test-mcp-infra.sh
# Validates the MCP memory infrastructure: ruvector-postgres, xinference, and ruvector-mcp.cjs
#
# Usage: ./tests/integration/test-mcp-infra.sh [--from-host|--from-container]
#   --from-host       Run tests from the Docker host (default)
#   --from-container  Run tests from inside agentbox container

set -euo pipefail

PASS=0
FAIL=0
WARN=0

pass() { ((PASS++)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { ((FAIL++)); printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn() { ((WARN++)); printf '  \033[33m!\033[0m %s\n' "$1"; }

MODE="${1:---from-host}"

# ── Determine execution context ───────────────────────────────────────────────
if [ "$MODE" = "--from-container" ]; then
  EXEC=""
  CURL="curl"
  NODE="node"
  PG_HOST="ruvector-postgres"
  XINF_HOST="xinference"
else
  EXEC="docker exec agentbox"
  CURL="curl"
  NODE="docker exec agentbox node"
  PG_HOST="localhost"
  XINF_HOST="localhost"
fi

echo "=== MCP Infrastructure Tests (${MODE}) ==="
echo ""

# ── 1. Container health ──────────────────────────────────────────────────────
echo "[1/6] Container health"

if docker ps --filter name=agentbox --format '{{.Status}}' 2>/dev/null | grep -q healthy; then
  pass "agentbox container: healthy"
else
  fail "agentbox container: not healthy"
fi

if docker ps --filter name=ruvector-postgres --format '{{.Status}}' 2>/dev/null | grep -q healthy; then
  pass "ruvector-postgres container: healthy"
else
  fail "ruvector-postgres container: not running/healthy"
fi

if docker ps --filter name=xinference --format '{{.Status}}' 2>/dev/null | grep -q Up; then
  pass "xinference container: running"
else
  fail "xinference container: not running"
fi
echo ""

# ── 2. PostgreSQL connectivity + data ────────────────────────────────────────
echo "[2/6] PostgreSQL (ruvector-postgres)"

PG_COUNT=$($EXEC bash -c "NODE_PATH=/home/devuser/workspace/.claude-pg/node_modules node -e \"
const {Client}=require('pg');
const c=new Client({host:'ruvector-postgres',port:5432,database:'ruvector',user:'ruvector',password:'ruvector'});
c.connect().then(()=>c.query('SELECT count(*) AS n FROM memory_entries')).then(r=>{console.log(r.rows[0].n);c.end()}).catch(e=>{console.error(e.message);c.end();process.exit(1)});
\"" 2>&1) || true

if [ -n "$PG_COUNT" ] && [ "$PG_COUNT" -gt 0 ] 2>/dev/null; then
  pass "ruvector-postgres: connected, $PG_COUNT entries"
else
  fail "ruvector-postgres: connection failed or empty ($PG_COUNT)"
fi

EMB_COUNT=$($EXEC bash -c "NODE_PATH=/home/devuser/workspace/.claude-pg/node_modules node -e \"
const {Client}=require('pg');
const c=new Client({host:'ruvector-postgres',port:5432,database:'ruvector',user:'ruvector',password:'ruvector'});
c.connect().then(()=>c.query('SELECT count(*) AS n FROM memory_entries WHERE embedding IS NOT NULL')).then(r=>{console.log(r.rows[0].n);c.end()}).catch(e=>{console.error(e.message);c.end();process.exit(1)});
\"" 2>&1) || true

if [ -n "$EMB_COUNT" ] && [ "$EMB_COUNT" -gt 0 ] 2>/dev/null; then
  pass "ruvector-postgres: $EMB_COUNT entries have embeddings"
else
  warn "ruvector-postgres: no entries with embeddings"
fi

HNSW_IDX=$(docker exec ruvector-postgres psql -U ruvector -d ruvector -t -c "SELECT indexdef FROM pg_indexes WHERE indexname LIKE '%hnsw%' LIMIT 1;" 2>/dev/null | tr -d '[:space:]') || true
if [ -n "$HNSW_IDX" ]; then
  pass "HNSW index: present"
else
  fail "HNSW index: missing"
fi
echo ""

# ── 3. Xinference embedding service ─────────────────────────────────────────
echo "[3/6] Xinference embedding service"

XINF_MODELS=$($CURL -sf "http://${XINF_HOST}:9997/v1/models" 2>/dev/null) || true
if [ -n "$XINF_MODELS" ]; then
  MODEL_ID=$(echo "$XINF_MODELS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data'][0]['id'])" 2>/dev/null) || true
  MODEL_DIM=$(echo "$XINF_MODELS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data'][0]['dimensions'])" 2>/dev/null) || true
  pass "xinference API: reachable"
  if [ "$MODEL_DIM" = "384" ]; then
    pass "embedding model: ${MODEL_ID} (${MODEL_DIM}-dim)"
  else
    fail "embedding model: expected 384-dim, got ${MODEL_DIM}"
  fi
else
  fail "xinference API: unreachable at http://${XINF_HOST}:9997"
fi

# Test actual embedding generation
EMB_TEST=$($CURL -sf "http://${XINF_HOST}:9997/v1/embeddings" \
  -H "Content-Type: application/json" \
  -d '{"model":"bge-small-en-v1.5","input":"infrastructure test"}' 2>/dev/null) || true
if [ -n "$EMB_TEST" ]; then
  EMB_DIM=$(echo "$EMB_TEST" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['data'][0]['embedding']))" 2>/dev/null) || true
  if [ "$EMB_DIM" = "384" ]; then
    pass "embedding generation: working (384-dim)"
  else
    fail "embedding generation: wrong dimension ($EMB_DIM)"
  fi
else
  fail "embedding generation: API call failed"
fi

# Test reachability from inside agentbox
XINF_FROM_AGENTBOX=$($EXEC curl -sf http://xinference:9997/v1/models 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])" 2>/dev/null) || true
if [ -n "$XINF_FROM_AGENTBOX" ]; then
  pass "xinference from agentbox: reachable ($XINF_FROM_AGENTBOX)"
else
  fail "xinference from agentbox: unreachable (network issue)"
fi
echo ""

# ── 4. pg module availability ────────────────────────────────────────────────
echo "[4/6] Node.js pg module"

PG_AVAIL=$($EXEC bash -c "NODE_PATH=/home/devuser/workspace/.claude-pg/node_modules node -e \"try{require('pg');console.log('ok')}catch{console.log('missing')}\"" 2>/dev/null) || true
if [ "$PG_AVAIL" = "ok" ]; then
  pass "pg module: available via NODE_PATH"
else
  fail "pg module: not found (run: npm install --prefix /home/devuser/workspace/.claude-pg pg)"
fi
echo ""

# ── 5. .mcp.json configuration ──────────────────────────────────────────────
echo "[5/6] MCP configuration"

MCP_JSON=$($EXEC cat /home/devuser/workspace/.mcp.json 2>/dev/null) || true
if echo "$MCP_JSON" | grep -q "ruvector-mcp"; then
  pass ".mcp.json: points to ruvector-mcp.cjs"
else
  fail ".mcp.json: not configured for ruvector-mcp"
fi

if echo "$MCP_JSON" | grep -q "NODE_PATH"; then
  pass ".mcp.json: NODE_PATH configured"
else
  warn ".mcp.json: NODE_PATH missing (pg module may not resolve)"
fi

XINF_ENV=$($EXEC bash -c "grep -c XINFERENCE /home/devuser/workspace/.mcp.json 2>/dev/null || echo 0") || true
if [ "$XINF_ENV" -gt 0 ] 2>/dev/null; then
  pass ".mcp.json: XINFERENCE_ENDPOINT configured"
else
  warn ".mcp.json: XINFERENCE_ENDPOINT not set (will use default http://xinference:9997)"
fi
echo ""

# ── 6. End-to-end MCP server test ───────────────────────────────────────────
echo "[6/6] End-to-end MCP server"

E2E_RESULT=$($EXEC bash -c '
NODE_PATH=/home/devuser/workspace/.claude-pg/node_modules \
RUVECTOR_PG_CONNINFO="host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=ruvector" \
XINFERENCE_ENDPOINT="http://xinference:9997" \
timeout 15 sh -c '"'"'{
  echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"1.0\"}}}"
  sleep 1
  echo "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}"
  sleep 1
  echo "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"memory_search\",\"arguments\":{\"query\":\"rust toolchain cargo\",\"namespace\":\"patterns\",\"limit\":2}}}"
  sleep 5
} | node /opt/agentbox/mcp/servers/ruvector-mcp.cjs 2>/dev/null
'"'"'' 2>/dev/null) || true

if echo "$E2E_RESULT" | grep -q '"2.3.0-ruvector"'; then
  pass "MCP server: started (v2.3.0-ruvector)"
else
  fail "MCP server: failed to start"
fi

SEARCH_METHOD=$(echo "$E2E_RESULT" | grep '"id":2' | python3 -c "import sys,json; line=[l for l in sys.stdin if '\"id\":2' in l][0]; d=json.loads(line); t=json.loads(d['result']['content'][0]['text']); print(t.get('method','unknown'))" 2>/dev/null) || true
if [ "$SEARCH_METHOD" = "hnsw-xinference" ]; then
  pass "memory_search: using HNSW + xinference embeddings"
elif [ "$SEARCH_METHOD" = "ilike-fallback" ]; then
  warn "memory_search: fell back to ILIKE (xinference timing issue?)"
else
  fail "memory_search: no response or unknown method ($SEARCH_METHOD)"
fi

SEARCH_COUNT=$(echo "$E2E_RESULT" | grep '"id":2' | python3 -c "import sys,json; line=[l for l in sys.stdin if '\"id\":2' in l][0]; d=json.loads(line); t=json.loads(d['result']['content'][0]['text']); print(t.get('count',0))" 2>/dev/null) || true
if [ -n "$SEARCH_COUNT" ] && [ "$SEARCH_COUNT" -gt 0 ] 2>/dev/null; then
  pass "memory_search: returned $SEARCH_COUNT results"
else
  warn "memory_search: no results returned"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed, $WARN warnings ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
