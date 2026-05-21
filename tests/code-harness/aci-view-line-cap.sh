#!/usr/bin/env bash
# tests/code-harness/aci-view-line-cap.sh
# E3 acceptance test (PRD-008 §7 ACI criterion 3)
#
# Verifies: aci.view_file never returns more than 150 lines (hard budget,
# enforced server-side). Calls with max_lines=200 must return an error.
#
# Exit 0: PASS — server rejected max_lines=200 with an error response.
# Exit 1: FAIL — server accepted max_lines=200 or did not return an error.
set -euo pipefail

ACI_SERVER="${ACI_SERVER_JS:-/home/devuser/workspace/project/agentbox/mcp/aci-shell/server.js}"
WORKSPACE="${ACI_WORKSPACE_ROOT:-/home/devuser/workspace/project}"

# Verify Node is available
if ! command -v node >/dev/null 2>&1; then
  echo "[SKIP] node not found — cannot run aci-view-line-cap test" >&2
  exit 0
fi

# Verify server file exists
if [ ! -f "$ACI_SERVER" ]; then
  echo "[FAIL] ACI server not found at $ACI_SERVER" >&2
  exit 1
fi

# Verify @modelcontextprotocol/sdk is available
SERVER_DIR="$(dirname "$ACI_SERVER")"
if [ ! -d "$SERVER_DIR/node_modules/@modelcontextprotocol" ] && \
   [ ! -d "$(npm root -g 2>/dev/null)/@modelcontextprotocol" ] && \
   [ ! -d "/home/devuser/workspace/project/agentbox/mcp/node_modules/@modelcontextprotocol" ] && \
   [ ! -d "/opt/agentbox/mcp/node_modules/@modelcontextprotocol" ]; then
  echo "[SKIP] @modelcontextprotocol/sdk not installed — install with npm and re-run" >&2
  exit 0
fi

# Create a temporary >150-line fixture file
TMPFILE="$(mktemp /tmp/aci-test-fixture-XXXXXX.txt)"
trap 'rm -f "$TMPFILE"' EXIT
for i in $(seq 1 200); do
  echo "Line $i: the quick brown fox jumps over the lazy dog" >> "$TMPFILE"
done

# MCP stdio protocol: send initialize + tools/call request, check response
# We use a Python helper for the JSON-RPC framing since bash alone is fragile.
RESULT="$(python3 - "$ACI_SERVER" "$TMPFILE" "$WORKSPACE" <<'PYEOF'
import subprocess, json, sys, os, time

server_js = sys.argv[1]
tmpfile   = sys.argv[2]
workspace = sys.argv[3]

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
    # Read Content-Length header
    header = b""
    while b"\r\n\r\n" not in header:
        ch = proc.stdout.read(1)
        if not ch:
            return None
        header += ch
    length = int([l for l in header.split(b"\r\n") if b"Content-Length" in l][0].split(b":")[1].strip())
    body = proc.stdout.read(length)
    return json.loads(body)

# Initialize
send({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}})
resp = recv()
assert resp and "result" in resp, f"init failed: {resp}"

# Initialized notification
send({"jsonrpc":"2.0","method":"notifications/initialized","params":{}})

# Call aci.view_file with max_lines=200 (over 150 cap) — should be an error
send({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aci.view_file","arguments":{"path":tmpfile,"max_lines":200}}})
resp = recv()
proc.terminate()

if resp is None:
    print("ERROR: no response")
    sys.exit(1)

# Check: either isError=True in result, or the content contains an error field
result = resp.get("result", {})
content = result.get("content", [{}])
text = content[0].get("text","") if content else ""

is_error = result.get("isError", False)
body = {}
try:
    body = json.loads(text)
except Exception:
    pass

if is_error or body.get("ok") is False or "max_lines must not exceed" in text:
    print("PASS: server rejected max_lines=200 as expected")
    sys.exit(0)
else:
    print(f"FAIL: server did not reject max_lines=200. Response: {text[:500]}")
    sys.exit(1)
PYEOF
)"

echo "$RESULT"
if echo "$RESULT" | grep -q "^PASS"; then
  exit 0
else
  exit 1
fi
