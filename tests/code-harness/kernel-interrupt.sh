#!/usr/bin/env bash
# tests/code-harness/kernel-interrupt.sh
# I02 atomicity test (DDD-005 I02)
#
# Verifies that kernel.interrupt fires cleanly mid-exec and that the kernel
# recovers to accept subsequent calls.
#
# Protocol:
#   1. Dispatch kernel.exec("import time; time.sleep(60); print('ok')") in background.
#   2. After 1 s, dispatch kernel.interrupt.
#   3. The first exec must NOT print 'ok' — the interrupt must land first.
#   4. A subsequent kernel.exec("x=42; print(x)") must return stdout "42".
#
# Driven by the `mcp-call` binary (services/agentbox-ops); the background step
# and the interrupt share one kernel server-side.
#
# Exit 0: all assertions pass.
# Exit 1: any assertion fails.
set -euo pipefail

command -v mcp-call >/dev/null 2>&1 || { echo "[FAIL] mcp-call not found on PATH" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "[FAIL] jq not found on PATH" >&2; exit 1; }

echo "[INFO] Starting MCP server for interrupt test ..." >&2

OUT=$(mcp-call --script - <<'JSON'
[
  {"id": "sleep", "tool": "kernel.exec", "background": true, "timeout": 90,
   "arguments": {"code": "import time; time.sleep(60); print('ok')", "timeout_s": 90}},
  {"op": "sleep", "seconds": 1},
  {"id": "intr",  "tool": "kernel.interrupt", "arguments": {}},
  {"op": "await", "id": "sleep"},
  {"op": "sleep", "seconds": 0.5},
  {"id": "recover", "tool": "kernel.exec", "arguments": {"code": "x=42; print(x)"}}
]
JSON
) || true

# Assertion 1: interrupt returned ok=true.
if [ "$(jq -r '.results.intr.ok // false' <<<"$OUT")" != "true" ]; then
  echo "[FAIL] kernel.interrupt returned ok=false: $(jq -c '.results.intr // .errors.intr' <<<"$OUT")" >&2
  exit 1
fi
echo "[INFO] interrupt result: $(jq -c '.results.intr' <<<"$OUT")" >&2

# Assertion 2: the interrupted call must not have completed.
SLEEP_STDOUT=$(jq -r '.results.sleep.stdout // ""' <<<"$OUT" | tr -d '[:space:]')
if [ "$SLEEP_STDOUT" = "ok" ]; then
  echo "[FAIL] sleep printed 'ok' — interrupt did not fire in time" >&2
  exit 1
fi
echo "[INFO] sleep exception type: $(jq -r '.results.sleep.exception.type // "none"' <<<"$OUT")" >&2

# Assertion 3: the kernel recovers — the next exec works.
RECOVER=$(jq -r '.results.recover.stdout // ""' <<<"$OUT" | tr -d '[:space:]')
if [ "$RECOVER" != "42" ]; then
  echo "[FAIL] post-interrupt exec stdout expected '42', got: '$RECOVER'" >&2
  exit 1
fi

echo "[PASS] kernel.interrupt test passed — kernel recovered cleanly."
exit 0
