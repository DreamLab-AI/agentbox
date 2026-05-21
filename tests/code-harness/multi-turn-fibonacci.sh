#!/usr/bin/env bash
# tests/code-harness/multi-turn-fibonacci.sh
# B2 acceptance test (PRD-008 §7 CodeAct criterion 2)
#
# Three sequential kernel.exec calls that accumulate state across turns.
# Verifies: variables persist across calls (ADR-018 A2 / PRD-008 A2).
#
# Exit 0: stdout matches EXPECTED byte-for-byte.
# Exit 1: mismatch or tool error.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECTED="0,1,4,9,16,25,36,49,64,81,100,121,144,169,196,225,256,289,324,361"

# Locate the MCP client helper
LIB="$SCRIPT_DIR/lib/mcp_call.py"
if [ ! -f "$LIB" ]; then
  echo "[FAIL] mcp_call.py not found at $LIB" >&2
  exit 1
fi

# Run via Python helper
RESULT=$(python3 - <<'PYEOF'
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
# __file__ is not defined in heredoc context; use env-based path
import importlib.util, pathlib

lib = pathlib.Path(os.environ.get("SCRIPT_DIR", "/tests/code-harness")) / "lib" / "mcp_call.py"
spec = importlib.util.spec_from_file_location("mcp_call", str(lib))
mod  = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
MCPClient = mod.MCPClient

PYEOF
)

# Use inline Python that directly uses the library
python3 - "$SCRIPT_DIR" "$EXPECTED" <<'PYEOF'
import sys, os, pathlib, importlib.util, json

script_dir = sys.argv[1]
expected   = sys.argv[2]

# Load mcp_call module
lib_path = pathlib.Path(script_dir) / "lib" / "mcp_call.py"
spec = importlib.util.spec_from_file_location("mcp_call", str(lib_path))
mod  = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
MCPClient = mod.MCPClient

print("[INFO] Starting MCP server ...", file=sys.stderr)
with MCPClient() as client:
    # Step 1: define vals
    r1 = client.call("kernel.exec", {"code": "vals = list(range(20))"})
    if r1.get("exception"):
        print(f"[FAIL] Step 1 exception: {r1['exception']}", file=sys.stderr)
        sys.exit(1)

    # Step 2: compute squares
    r2 = client.call("kernel.exec", {"code": "acc = []\nfor v in vals: acc.append(v*v)"})
    if r2.get("exception"):
        print(f"[FAIL] Step 2 exception: {r2['exception']}", file=sys.stderr)
        sys.exit(1)

    # Step 3: print
    r3 = client.call("kernel.exec",
                     {"code": "print(','.join(str(x) for x in acc))"})
    if r3.get("exception"):
        print(f"[FAIL] Step 3 exception: {r3['exception']}", file=sys.stderr)
        sys.exit(1)

    stdout = r3.get("stdout", "").strip()
    if stdout == expected:
        print(f"[PASS] stdout matched: {stdout}")
        sys.exit(0)
    else:
        print(f"[FAIL] stdout mismatch\n  expected: {expected}\n  got:      {stdout}",
              file=sys.stderr)
        sys.exit(1)
PYEOF
