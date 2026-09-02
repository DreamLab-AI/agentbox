#!/usr/bin/env bash
# tests/code-harness/multi-turn-fibonacci.sh
# B2 acceptance test (PRD-008 §7 CodeAct criterion 2)
#
# Three sequential kernel.exec calls that accumulate state across turns.
# Verifies: variables persist across calls (ADR-018 A2 / PRD-008 A2).
#
# Driven by the `mcp-call` binary (services/agentbox-ops), which runs the whole
# step script against ONE server process so kernel state survives between calls.
#
# Exit 0: stdout matches EXPECTED byte-for-byte.
# Exit 1: mismatch or tool error.
set -euo pipefail

EXPECTED="0,1,4,9,16,25,36,49,64,81,100,121,144,169,196,225,256,289,324,361"

command -v mcp-call >/dev/null 2>&1 || { echo "[FAIL] mcp-call not found on PATH" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "[FAIL] jq not found on PATH" >&2; exit 1; }

echo "[INFO] Starting MCP server ..." >&2

OUT=$(mcp-call --script - <<'JSON'
[
  {"id": "define",  "tool": "kernel.exec", "arguments": {"code": "vals = list(range(20))"}},
  {"id": "square",  "tool": "kernel.exec", "arguments": {"code": "acc = []\nfor v in vals: acc.append(v*v)"}},
  {"id": "emit",    "tool": "kernel.exec", "arguments": {"code": "print(','.join(str(x) for x in acc))"}}
]
JSON
) || true

for step in define square emit; do
  if [ "$(jq -r --arg s "$step" '.errors[$s] // empty' <<<"$OUT")" != "" ]; then
    echo "[FAIL] Step $step transport error: $(jq -r --arg s "$step" '.errors[$s]' <<<"$OUT")" >&2
    exit 1
  fi
  EXC=$(jq -r --arg s "$step" '.results[$s].exception // empty' <<<"$OUT")
  if [ -n "$EXC" ] && [ "$EXC" != "null" ]; then
    echo "[FAIL] Step $step exception: $EXC" >&2
    exit 1
  fi
done

STDOUT=$(jq -r '.results.emit.stdout // ""' <<<"$OUT" | tr -d '\n')
if [ "$STDOUT" = "$EXPECTED" ]; then
  echo "[PASS] stdout matched: $STDOUT"
  exit 0
fi
echo "[FAIL] stdout mismatch" >&2
echo "  expected: $EXPECTED" >&2
echo "  got:      $STDOUT" >&2
exit 1
