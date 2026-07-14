# Blender Configuration

## Why this exists

Blender is a 3D modelling, animation and rendering suite. Agentbox bundles a Blender
build so agents can create scenes, drive modifiers, sculpt, author materials and render
frames by writing and running `bpy` Python rather than clicking a GUI. The technique
layer — how an agent actually drives Blender — lives in the **`blender` skill**
(`skills/blender/SKILL.md` and its `references/`), which is the authoritative source for
the workflow, the command surface, and per-domain method. This page covers only the
runtime/plumbing.

**When to skip this**: leave `blender = false` unless an agent workflow actually drives
Blender — the package is large and does nothing passively.

## Enabling Blender

Set in `agentbox.toml`:
```toml
[skills.spatial_and_3d]
blender = true
```

This bakes `pkgs.blender` into the image and adds the supervised `blender-mcp` program
(priority 231) plus `ENABLE_BLENDER=true`.

## Version

Agentbox uses `pkgs.blender` from the pinned nixpkgs input. The current image ships
**Blender 5.1.2**. Note this is a 5.x series: `bpy` snippets written for the 4.x tutorials
in the wild will drift — e.g. the EEVEE engine enum is `BLENDER_EEVEE` (the 4.2–4.5 name
`BLENDER_EEVEE_NEXT` does not exist on 5.x), and `Material.use_nodes` / `World.use_nodes`
are deprecated (removal expected in 6.0). The skill's SKILL.md carries the full list of
5.1.2 API corrections, all verified headless against the shipped binary.

## Two ways Blender is driven

There are two distinct transports, and they have different requirements. Pick per task.

### A. Batch `bpy` (headless) — works out of the box

For "run a script, maybe render a still" work — the majority of agent Blender tasks —
run the shipped binary directly, no server needed:

```bash
blender --background --factory-startup --python /path/to/script.py
# render needs a camera: assert scene.camera is not None before render()
```

This uses no GPU display and is the reliable standalone path. It cannot hold an
interactive session open between calls (background Blender exits when the script ends),
so each invocation is self-contained.

### B. BlenderMCP socket server — needs a GPU/GL display (external sidecar)

The interactive path (what the MCP tool and the courses use) is **BlenderMCP**
(Siddharth Ahuja, MIT — github.com/ahujasid/blender-mcp): a socket server on
`localhost:9876` that keeps a Blender session live and runs `execute_code`,
`get_scene_info`, `get_viewport_screenshot`, etc.

**This path requires an OpenGL context.** The BlenderMCP addon marshals commands onto
Blender's GUI event loop (`bpy.app.timers`), which only runs when Blender has a real GL
context — i.e. a GUI session, not `--background`. The agentbox in-container VNC display
(TigerVNC `:1`) does **not** advertise `GLX_ARB_create_context`, so a GUI Blender cannot
obtain a context there; forcing software GL (`LIBGL_ALWAYS_SOFTWARE`) does not help
because the limitation is in the Xvnc server's GLX, not the client GL library.

Therefore BlenderMCP is served from an **external GPU-capable GUI sidecar**, and agentbox
bridges to it. That is what the supervised `blender-mcp` program does.

## The `blender-mcp` supervised program

Runs `skills/blender/tools/blender-mcp-proxy.js` (priority 231, autostart/autorestart).
It bridges the local socket to the external Blender:

```
agent ──▶ 127.0.0.1:9876 (proxy) ──▶ GUI_CONTAINER_HOST:GUI_BLENDER_PORT (external Blender)
```

Configure the upstream via the container environment (inherited by supervisord children):

| Env | Default | Meaning |
|-----|---------|---------|
| `GUI_CONTAINER_HOST` | `gui-tools-service` | Host running BlenderMCP |
| `GUI_BLENDER_PORT` | `9876` | Its BlenderMCP port |
| `LOCAL_BLENDER_PROXY_PORT` | `9876` | Local listen port |

If the upstream sidecar is not running, the proxy accepts the local connection but the
upstream connect fails — it logs a clear one-line diagnostic to
`/var/log/blender-mcp.error.log` and closes the client. It does **not** silently
half-open. From a client's point of view the socket accepts then closes with no data;
the health check reports this as `silent-close` (see below), distinct from `refused`.

## Health check

`skills/blender/tools/blender-health.js` round-trips `get_scene_info` and names the
failure mode instead of a generic timeout:

```bash
node /opt/agentbox/skills/blender/tools/blender-health.js
# PASS  BlenderMCP responding at localhost:9876 (N objects in scene)
# FAIL  [refused]      — nothing is listening (proxy/sidecar down, wrong host/port)
# FAIL  [silent-close] — port bound but not serving (sidecar down behind the proxy,
#                        or a stale bind); Blender GUI not actually reachable
# FAIL  [timeout]      — connected, no response (Blender blocked on a modal/long task)
```

`BLENDER_HOST` / `BLENDER_PORT` override the target.

## Getting a live interactive Blender

1. Bring up a GPU/GL-capable Blender sidecar (external GUI-tools container with the
   BlenderMCP addon enabled and its server started — VirtualGL or a real GPU display),
   listening on its `9876`.
2. Point the proxy at it: set `GUI_CONTAINER_HOST` / `GUI_BLENDER_PORT` in the agentbox
   container environment. The supervised proxy picks these up on (re)start.
3. Register the MCP server for the session if you want tool-level access:
   `.mcp.json` → `{ "blender": { "command": "uvx", "args": ["blender-mcp"] } }`.
4. Verify with `blender-health.js` — expect `PASS`.

Until a GPU sidecar exists, use path A (headless batch `bpy`) for anything that doesn't
need a persistent interactive session.

## Custom packages / add-ons

Extend `spatialPackages` in `flake.nix` with additional `blenderPackages.*`, or pin them
in the MCP server's Python environment.
