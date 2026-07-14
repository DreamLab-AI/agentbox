#!/bin/bash
# Start the QGIS MCP endpoint, and bring up QGIS itself under VirtualGL so its map
# canvas renders on the GPU. QGIS MCP is currently a stub (see qgis-mcp-server.py);
# QGIS is launched so it is available (VNC + GPU GL) for when the adapter is wired.
set -uo pipefail
export DISPLAY="${DISPLAY:-:2}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/xdg-runtime}"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR" || true

for i in $(seq 1 30); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then break; fi
  sleep 1
done

# The MCP endpoint is the always-on part; QGIS GUI is best-effort under VirtualGL.
if command -v vglrun >/dev/null 2>&1; then
  vglrun -d egl qgis --nologo >/var/log/qgis-app.log 2>&1 &
else
  qgis --nologo >/var/log/qgis-app.log 2>&1 &
fi

exec python3 /opt/gui-tools/qgis-mcp-server.py
