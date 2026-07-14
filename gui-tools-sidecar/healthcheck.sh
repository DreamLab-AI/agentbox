#!/bin/bash
# Healthy when the X display is up and the BlenderMCP socket answers a real command.
# QGIS is best-effort (stub MCP) and does not fail the check.
set -uo pipefail
export DISPLAY=":2"

xdpyinfo -display :2 >/dev/null 2>&1 || { echo "xvfb :2 down"; exit 1; }

# BlenderMCP round-trip: send get_scene_info, expect a JSON reply on 9876.
python3 - <<'PY' || exit 1
import socket, json, sys
try:
    s = socket.create_connection(("127.0.0.1", 9876), timeout=8)
    s.sendall(json.dumps({"type": "get_scene_info", "params": {}}).encode())
    buf = b""
    s.settimeout(8)
    while len(buf) < 4:
        chunk = s.recv(65536)
        if not chunk:
            break
        buf += chunk
        try:
            json.loads(buf.decode()); print("blender ok"); sys.exit(0)
        except Exception:
            continue
    print("blender no/invalid response"); sys.exit(1)
except Exception as e:
    print("blender socket error:", e); sys.exit(1)
PY

echo "healthy"
exit 0
