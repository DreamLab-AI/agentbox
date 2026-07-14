#!/bin/bash
# Launch Blender under VirtualGL so its GLX viewport renders on the GPU (EGL backend),
# with the BlenderMCP addon serving on 0.0.0.0:9876. DISPLAY is the sidecar Xvfb (:2).
set -euo pipefail
export DISPLAY="${DISPLAY:-:2}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/xdg-runtime}"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR" || true

# Wait for the X display to be up before starting the GUI.
for i in $(seq 1 30); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then break; fi
  sleep 1
done

# vglrun -d egl: render on the GPU via EGL device, no hardware X server needed.
# If VirtualGL is unavailable, fall back to a direct launch (software GL) so the
# socket server still comes up (degraded, CPU render) rather than the program dying.
if command -v vglrun >/dev/null 2>&1; then
  exec vglrun -d egl blender --factory-startup --python /opt/gui-tools/launch-blender.py
else
  echo "[launch-blender] WARNING: vglrun not found; starting with software GL (no GPU viewport)"
  exec blender --factory-startup --python /opt/gui-tools/launch-blender.py
fi
