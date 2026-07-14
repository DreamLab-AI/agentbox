# gui-tools-service — GPU sidecar for Blender + QGIS

A standalone Arch-Linux (FHS) Docker service that runs **Blender** (with the BlenderMCP
addon) and **QGIS** with real GPU acceleration, for agentbox agents to drive.

## Why this exists

agentbox's main image is **nix-built**. Nix binaries carry nix-store RPATHs and do not
search `/usr/lib`, which is exactly where the nvidia-container-runtime injects the GPU
driver libraries (`libcuda`, `libGLX_nvidia`, `libEGL_nvidia`). So in agentbox-main:

- Blender's Cycles CUDA fails to initialise (`CUEW initialization failed`) and silently
  falls back to CPU.
- The BlenderMCP addon (which needs a GUI GL context) can't get one — the in-container
  TigerVNC display offers only software GLX.

This sidecar is **FHS (Arch)**, so `/usr/lib` is on the default loader path and the injected
NVIDIA userspace Just Works — the same reason the browser sidecar gets full GPU acceleration.
Blender's GLX viewport is routed onto the GPU with **VirtualGL** (`vglrun -d egl`), which
renders on the GPU via EGL without needing a hardware X server (mirroring how the browser
sidecar uses Vulkan/ANGLE to bypass X GLX).

## Layout

```
gui-tools-sidecar/
  Dockerfile            Arch base + blender + qgis + vulkan/egl + virtualgl (AUR) + xvfb + vnc
  supervisord.conf      dbus, Xvfb :2, x11vnc :5905, blender (9876), qgis (9877)
  blendermcp-addon.py   BlenderMCP addon (Siddharth Ahuja, MIT)
  launch-blender.py     registers the addon, serves 0.0.0.0:9876
  launch-blender.sh     vglrun wrapper (GPU GL) around Blender
  launch-qgis.sh        QGIS under vglrun + the QGIS MCP endpoint
  qgis-mcp-server.py    QGIS MCP endpoint (stub — seam for a PyQGIS adapter)
  healthcheck.sh        X up + BlenderMCP get_scene_info round-trip
```

## Ports

| Container | Purpose |
|-----------|---------|
| 9876 | BlenderMCP socket (agentbox `blender-mcp-proxy.js` bridges `localhost:9876` here) |
| 9877 | QGIS MCP endpoint (agentbox `qgis_mcp_standalone.py` proxy bridges here) |
| 5905 | VNC — view the Blender/QGIS desktop |

## Operate

```bash
./agentbox.sh gui-tools up       # build + start, wait for BlenderMCP health
./agentbox.sh gui-tools health   # in-container healthcheck
./agentbox.sh gui-tools gpu      # nvidia-smi + vulkaninfo inside the container
./agentbox.sh gui-tools logs
./agentbox.sh gui-tools down
```

Requires the external `visionclaw_network` and the nvidia container runtime (same as the
browser sidecar). GPU selection is `NVIDIA_VISIBLE_DEVICES` (default `all`).

## Notes

- The QGIS MCP endpoint is a **stub** carried over from agentbox-main; QGIS itself runs here
  with GPU GL, ready for a concrete PyQGIS MCP adapter to be wired at the seam.
- If VirtualGL is unavailable at runtime, the launchers fall back to software GL (degraded,
  CPU render) so the socket server still comes up rather than the program dying.
