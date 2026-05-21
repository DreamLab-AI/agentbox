#!/usr/bin/env bash
# tests/code-harness/aci-edit-diff-ctx.sh
# E4 acceptance test (PRD-008 §7 ACI criterion 4)
#
# Verifies: aci.edit_file returns a compact unified diff with ≤10 lines of
# unchanged context above and below the edit region.
#
# Method: create a 200-line fixture file, edit one line in the middle, parse
# the returned diff, count the longest contiguous run of context lines (lines
# starting with ' '). If ≤10, PASS.
#
# Exit 0: PASS.
# Exit 1: FAIL.
set -euo pipefail

ACI_SERVER="${ACI_SERVER_JS:-/home/devuser/workspace/project/agentbox/mcp/aci-shell/server.js}"
WORKSPACE="${ACI_WORKSPACE_ROOT:-/home/devuser/workspace/project}"

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

TMPFILE="$(mktemp /tmp/aci-edit-fixture-XXXXXX.txt)"
trap 'rm -f "$TMPFILE"' EXIT

# 200-line fixture
for i in $(seq 1 200); do
  echo "Line $i: the quick brown fox" >> "$TMPFILE"
done

RESULT="$(python3 - "$ACI_SERVER" "$TMPFILE" "$WORKSPACE" <<'PYEOF'
import subprocess, json, sys, os

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

# Edit line 100 (middle of 200-line file)
send({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aci.edit_file","arguments":{
    "path": tmpfile,
    "start_line": 100,
    "end_line":   100,
    "replacement": "REPLACED LINE"
}}})
resp = recv()
proc.terminate()

if resp is None:
    print("ERROR: no response")
    sys.exit(1)

result = resp.get("result", {})
content = result.get("content", [{}])
text = content[0].get("text", "") if content else ""
body = {}
try:
    body = json.loads(text)
except Exception:
    pass

if result.get("isError") or body.get("ok") is False:
    print(f"FAIL: edit returned error: {text[:300]}")
    sys.exit(1)

diff = body.get("diff", "")
if not diff:
    print(f"FAIL: diff is empty. Body: {text[:300]}")
    sys.exit(1)

# Count max contiguous context-line run (lines starting with ' ' after hunk header)
lines = diff.split("\n")
max_run = 0
run = 0
for line in lines:
    if line.startswith(" "):
        run += 1
        max_run = max(max_run, run)
    elif not line.startswith("@@") and not line.startswith("---") and not line.startswith("+++"):
        run = 0

if max_run <= 10:
    print(f"PASS: max context-line run = {max_run} (≤10)")
    sys.exit(0)
else:
    print(f"FAIL: max context-line run = {max_run} (> 10). Diff snippet:\n{diff[:600]}")
    sys.exit(1)
PYEOF
)"

echo "$RESULT"
if echo "$RESULT" | grep -q "^PASS"; then
  exit 0
else
  exit 1
fi
