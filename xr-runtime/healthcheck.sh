#!/bin/bash
set -euo pipefail

FAIL=0

# Xvfb display server
if ! pgrep -x Xvfb >/dev/null 2>&1; then
    echo "FAIL: Xvfb not running"
    FAIL=1
fi

# x11vnc mirror on 5904
if ! ss -tlnp 2>/dev/null | grep -q ':5904 '; then
    echo "FAIL: x11vnc not listening on port 5904"
    FAIL=1
fi

# Monado OpenXR runtime
if ! pgrep -f monado-service >/dev/null 2>&1; then
    echo "FAIL: monado-service not running"
    FAIL=1
else
    SOCK="${XDG_RUNTIME_DIR:-/tmp/xdg-runtime}/monado_comp_ipc"
    if [ ! -S "$SOCK" ]; then
        echo "WARN: Monado IPC socket $SOCK not present yet (runtime still starting)"
    fi
fi

# Godot is warn-only: on first boot it is still compiling the gdext cdylib, so
# its absence here does not mean the sidecar is unhealthy.
if ! pgrep -f 'godot' >/dev/null 2>&1; then
    echo "WARN: Godot not running yet (gdext build in progress, or scene exited)"
fi

# GPU is optional — Monado falls back to llvmpipe without it (slow but functional).
if ! nvidia-smi >/dev/null 2>&1; then
    echo "WARN: nvidia-smi not available (Monado compositor will use software Vulkan)"
fi

if [ "$FAIL" -eq 1 ]; then
    exit 1
fi

echo "OK: display + Monado runtime healthy"
exit 0
