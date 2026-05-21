#!/usr/bin/env bash
# tests/code-harness/aci-search-truncation.sh
# E5 acceptance test (PRD-008 §7 ACI criterion 5)
#
# Verifies: aci.search_repo truncates at max_results and explicitly reports
# total_found (including omitted results) and truncated=true when the budget
# was hit.
#
# Method: create a directory of files each containing a unique string many
# times so total hits > max_results, then call with max_results=3. Verify
# that hits.length <= 3, total_found > 3, and truncated is true.
#
# Exit 0: PASS.
# Exit 1: FAIL.
set -euo pipefail

ACI_SERVER="${ACI_SERVER_JS:-/home/devuser/workspace/project/agentbox/mcp/aci-shell/server.js}"

if ! command -v node >/dev/null 2>&1; then
  echo "[SKIP] node not found" >&2
  exit 0
fi

if [ ! -f "$ACI_SERVER" ]; then
  echo "[FAIL] ACI server not found at $ACI_SERVER" >&2
  exit 1
fi

if [ ! -d "$(dirname "$ACI_SERVER")/node_modules/@modelcontextprotocol" ] && \
   [ ! -d "/home/devuser/workspace/project/agentbox/mcp/node_modules/@modelcontextprotocol" ] && \
   [ ! -d "/opt/agentbox/mcp/node_modules/@modelcontextprotocol" ]; then
  echo "[SKIP] @modelcontextprotocol/sdk not installed" >&2
  exit 0
fi

# Create a temp workspace with many matching lines
TMPDIR="$(mktemp -d /tmp/aci-search-XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

# 5 files, each with 5 lines matching the search term = 25 total hits
for f in 1 2 3 4 5; do
  for i in 1 2 3 4 5; do
    echo "UNIQUE_SEARCH_NEEDLE_XYZ line $f-$i" >> "$TMPDIR/file${f}.txt"
  done
done

RESULT="$(python3 - "$ACI_SERVER" "$TMPDIR" <<'PYEOF'
import subprocess, json, sys, os

server_js = sys.argv[1]
workspace = sys.argv[2]

env = os.environ.copy()
env["ACI_WORKSPACE_ROOT"] = workspace
env["NODE_PATH"] = "/home/devuser/workspace/project/agentbox/mcp/node_modules:/opt/agentbox/mcp/node_modules"

proc = subprocess.Popen(
    ["node", server_js],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    env=env,
)

def send(msg):
    body = json.dumps(msg).encode()
    proc.stdin.write(f"Content-Length: {len(body)}\r\n\r\n".encode() + body)
    proc.stdin.flush()

def recv():
    header = b""
    while b"\r\n\r\n" not in header:
        ch = proc.stdout.read(1)
        if not ch:
            return None
        header += ch
    length = int([l for l in header.split(b"\r\n") if b"Content-Length" in l][0].split(b":")[1].strip())
    body = proc.stdout.read(length)
    return json.loads(body)

send({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}})
recv()
send({"jsonrpc":"2.0","method":"notifications/initialized","params":{}})

# Search with max_results=3 in a workspace that has 25 matching lines
send({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aci.search_repo","arguments":{
    "query":       "UNIQUE_SEARCH_NEEDLE_XYZ",
    "max_results": 3
}}})
resp = recv()
proc.terminate()

if resp is None:
    print("ERROR: no response")
    sys.exit(1)

result = resp.get("result", {})
content = result.get("content", [{}])
text = content[0].get("text", "") if content else ""

if result.get("isError"):
    print(f"FAIL: search returned error: {text[:300]}")
    sys.exit(1)

body = {}
try:
    body = json.loads(text)
except Exception:
    print(f"FAIL: response not valid JSON: {text[:300]}")
    sys.exit(1)

hits        = body.get("hits", [])
total_found = body.get("total_found", 0)
truncated   = body.get("truncated", False)

if len(hits) > 3:
    print(f"FAIL: hits={len(hits)} exceeds max_results=3")
    sys.exit(1)

if total_found <= 3:
    print(f"FAIL: total_found={total_found} should be > 3 (25 lines in fixture)")
    sys.exit(1)

if not truncated:
    print(f"FAIL: truncated should be true when total_found({total_found}) > max_results(3)")
    sys.exit(1)

print(f"PASS: hits={len(hits)} (≤3), total_found={total_found} (>3), truncated=true")
sys.exit(0)
PYEOF
)"

echo "$RESULT"
if echo "$RESULT" | grep -q "^PASS"; then
  exit 0
else
  exit 1
fi
