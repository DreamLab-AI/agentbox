#!/bin/bash
set -euo pipefail

FAIL=0

# Check Xvfb is running
if ! pgrep -x Xvfb >/dev/null 2>&1; then
    echo "FAIL: Xvfb not running"
    FAIL=1
fi

# Check x11vnc is responding on port 5903
if ! ss -tlnp 2>/dev/null | grep -q ':5903 '; then
    echo "FAIL: x11vnc not listening on port 5903"
    FAIL=1
fi

# Check MCP server is listening on port 8931
if ! ss -tlnp 2>/dev/null | grep -q ':8931 '; then
    echo "FAIL: MCP server not listening on port 8931"
    FAIL=1
fi

# Check MCP health endpoint responds
if ! curl -fsS --max-time 5 http://127.0.0.1:8931/health >/dev/null 2>&1; then
    echo "FAIL: MCP health endpoint not responding"
    FAIL=1
fi

# Check NVIDIA GPU is accessible
if ! nvidia-smi >/dev/null 2>&1; then
    echo "FAIL: nvidia-smi not available"
    FAIL=1
fi

if [ "$FAIL" -eq 1 ]; then
    exit 1
fi

echo "OK: all services healthy"
exit 0
