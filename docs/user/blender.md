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

**This deployment (2026-10-15): sidecar-first (ADR-2142).** `blender = true` with `blender_local = false` keeps
the `blender-mcp` proxy and the skill but does **not** bake the in-container Blender
binary; all Blender runs in the `gui-tools-service` GPU sidecar (see "Two ways Blender is
driven" and "Shared volume" below).

## Enabling Blender

Set in `agentbox.toml`:
```toml
[skills.spatial_and_3d]
blender = true
blender_local = false   # sidecar-first (this deployment); omit or true to also bake the local binary
```

`blender = true` adds the supervised `blender-mcp` program (priority 231), the skill and
`ENABLE_BLENDER=true`. `blender_local` (schema: boolean, default true when absent) decides
whether the pinned local Blender is also baked into the image; `ENABLE_BLENDER_LOCAL` reports the
result. With `blender_local = false` the toolchain test `tests/toolchains/blender-present.sh`
skips, and `blender-batch.sh` exits 2 pointing at `blender-job.js`. Revert by setting
`blender_local = true` and rebuilding.

## Version

Both x86_64 Linux build paths use the official **Blender 5.3.0** archive and
SHA-256 in `lib/blender-release.json`: the sidecar installer and
`lib/blender.nix` share that pin. Other platforms keep their native nixpkgs
package. The local binary remains gated by `blender_local`; enabling the proxy
alone does not add it.

The sidecar's build context is the repository root, using
`gui-tools-sidecar/Dockerfile`, so Compose can include the shared manifest.
Build from the host checkout with
`docker compose --project-name agentbox -f docker-compose.gui-tools.yml build`.
Prepare Agentbox with `./agentbox.sh prepare`; activate it separately when ready.
Test the optional local binary independently with `nix build .#blender` on the
host, even when `blender_local` is false; its install check imports the bundled
Python modules. The standalone derivation still needs host build verification.
A source pin is not proof that a running image has been upgraded: query each
instance with `blender --version` or `blender-introspect.js version`.

5.3 adds native Gaussian splats, Cycles dispersion, EEVEE panoramic cameras and
bundled OpenEXR/OpenTimelineIO Python modules. The
[5.3 workflow reference](../../skills/blender/references/blender-5.3.md) covers
API changes and limits. DLSS viewport denoising needs NVIDIA driver 620+; the
current host driver 615.78.08 does not qualify. The sidecar explicitly selects
OpenGL for its tested VirtualGL path despite 5.3's default Vulkan backend.

Run the Blender skill's `tools/examples/release-smoke.py` as a background job
to verify the actual version, native splat import, new APIs, GPU rendering and
save/reopen. Check the interactive bridge and viewport separately.

## Two ways Blender is driven

There are two distinct transports, and they have different requirements. Pick per task.

### A. Batch `bpy` (headless)

**Sidecar-first:** run it inside the sidecar with `skills/blender/tools/blender-job.js`
(`submit` / `wait` / `tail`; files over the shared volume). Verified 2026-10-15: a Cycles GPU
render on three RTX 6000 Ada (OptiX) completed in 5 s and the PNG appeared in this container.

**Local binary (only when `blender_local` is true or absent):** run the shipped binary
directly, no server needed:

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

## Shared volume between this container and the sidecar

This container's `/home/devuser/gui-tools` and the sidecar's `/home/devuser/exchange` are the
**same volume** (verified bidirectionally 2026-10-15; one ext4 mount, hundreds of GB free).
It is the only file path between the two; the workspace and repository are **not** mounted
in the sidecar. `skills/blender/tools/blender-job.js` uses it for inputs, logs and renders
(`jobs/<id>/`). Treat it as shared scratch, not storage of record: commit results you keep
into the repository, and note that `.blend` files over the Git LFS threshold belong in LFS.

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

The GUI sidecar also offers a build-pinned DCC-MCP candidate at the internal
`http://gui-tools-service:9881/mcp` endpoint. The established socket remains
available; see [control planes](../../skills/blender/references/control-planes.md).
