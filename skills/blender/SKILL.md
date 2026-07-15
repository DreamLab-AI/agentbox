---
name: blender
description: "Meta-skill for driving Blender via BlenderMCP: 3D modelling (box, hard-surface, boolean), digital sculpting, PBR material authoring, lighting, rendering, and scene assembly. Claude writes and runs bpy Python (execute_code), screenshots the viewport, inspects, and corrects — with GPU renders via blender-batch and interactive sessions via the gui-tools GPU sidecar. Use this whenever a task involves Blender, a .blend file, 3D modelling/sculpting/texturing, a Cycles or EEVEE render, or generating and processing 3D assets — even when the user does not name Blender explicitly (e.g. 'model a low-poly house', 'sculpt a creature head', 'make a PBR metal material', 'render this scene on the GPU', 'build a modular sci-fi corridor kit'). Not for 2D image editing (use imagemagick), text-to-image generation (use comfyui), or GIS map rendering (use qgis)."
---

# Blender 3D Skill

Drive Blender programmatically through **BlenderMCP** — a socket bridge that lets an agent
run arbitrary `bpy` Python inside a live Blender, see the result, and iterate. This skill is
the distilled method for doing that well: how to connect, the working loop, the real command
surface, version-specific `bpy` facts, and per-domain technique references.

## Mental model (read this first)

Claude does **not** model by clicking tools. It:

1. **Decomposes** the target into an ordered build plan (blockout → parts → detail → material → light → render).
2. **Writes a `bpy` script** for one step and runs it via `execute_code`.
3. **Looks** at the result with `get_viewport_screenshot`, and introspects state with `get_scene_info` / `get_object_info`.
4. **Corrects** and moves to the next step.

`execute_code` is the workhorse — roughly 90% of all work is Python you send through it. The
other commands exist so you can *see* and *verify*. Never assume a step worked; screenshot and
check, because errors compound when the next piece snaps or parents to a wrong origin.

## When to use

- Create or edit 3D models, sculpts, or scenes programmatically
- Author PBR materials / shader node graphs
- Set up cameras, lights, and render a scene
- Batch-process or procedurally generate 3D assets
- Build modular asset libraries or environments

## When NOT to use

- 2D image processing (resize, crop, filter, convert) → **imagemagick** skill
- AI image generation from a text prompt → **comfyui** skill
- Diagrams / flowcharts → **mermaid-diagrams** skill
- Video editing / transcoding / audio → **ffmpeg-processing** skill
- Geospatial 3D → **qgis** skill

## Connecting (do this before any modelling)

BlenderMCP has two halves that must both be running:

- **Blender side**: the "Blender MCP" addon runs a raw TCP JSON server. Enable the addon, open
  `View3D > Sidebar (N) > BlenderMCP`, and click **Connect to MCP server**. It listens on
  `localhost:9876` by default. This is **per-session** — a fresh Blender starts with the socket
  closed even though the addon stays enabled.
- **Agent side**: an MCP server launched with `uvx blender-mcp`, registered in your MCP client
  (`.mcp.json` entry: `{"command": "uvx", "args": ["blender-mcp"]}`).

**Verify the link before working** — run the health check, which distinguishes the failure
modes that actually happen:

```bash
node tools/blender-health.js          # PASS / FAIL [refused|silent-close|timeout|bad-json]
# env: BLENDER_HOST (default localhost), BLENDER_PORT (default 9876)
```

Full setup, the `uvx` registration, container-split topology, asset-integration toggles, and
troubleshooting: **[references/connection-and-protocol.md](references/connection-and-protocol.md)**.

### Deployment topology (agentbox)

There are two paths, because agentbox's main image is **nix-built** and nix binaries don't
search `/usr/lib`, where the nvidia-container-runtime injects the GPU driver libraries — so
in-container Blender is blind to the GPU for both CUDA and GL unless helped.

- **Headless GPU batch (local, works now):** run `tools/blender-batch.sh script.py` (or
  `--render file.blend out.png`). It prepends `/usr/lib` to `LD_LIBRARY_PATH` so Cycles finds
  the injected `libcuda` and renders on the GPUs. No GL context / socket server needed. This is
  the reliable path for "run a `bpy` script, render an image."
- **Interactive BlenderMCP (GPU sidecar):** the socket server needs a GUI GL context, which the
  in-container VNC display can't provide. So Blender runs in the **`gui-tools-service`** GPU
  sidecar (Arch/FHS, VirtualGL → GPU EGL), and `tools/blender-mcp-proxy.js` bridges
  `localhost:9876 → gui-tools-service:9876`. Bring the sidecar up with
  `./agentbox.sh gui-tools up`. If it's down, the proxy accepts then closes with no reply —
  the health check reports `silent-close`, not `refused`.

Run `node tools/blender-health.js` to confirm the interactive path is live before using it.

**Native MCP tools are optional (on-demand).** The supervised proxy already exposes the
socket on `localhost:9876`, so you can drive Blender through it directly (or via
`tools/mcp-blender-client.js`) without any MCP registration. When you want the BlenderMCP
tools to appear natively in the session, register them on demand with
`tools/register-mcp.sh` (adds `uvx blender-mcp → localhost:9876` to the workspace
`.mcp.json`; idempotent; `--remove` to unregister). This keeps `.mcp.json` lean by default
and only loads the heavy sidecar-backed server when 3D work actually needs it.

## The real command surface

Everything BlenderMCP exposes (anything else goes through `execute_code`):

| Command | Purpose |
|---|---|
| `get_scene_info` | List objects, materials, scene state |
| `get_object_info(name)` | Mesh/transform detail for one object |
| `get_viewport_screenshot(max_size, filepath, format)` | See the current viewport |
| `execute_code(code)` | Run arbitrary `bpy` Python — **the workhorse** |
| `get_telemetry_consent` | Addon housekeeping |

Optional, only if the user enables the matching toggle in the addon panel:

- **PolyHaven** (free HDRIs/textures/models): `get_polyhaven_categories`, `search_polyhaven_assets`, `download_polyhaven_asset`, `set_texture`
- **Hyper3D Rodin** (text/image→mesh): `create_rodin_job`, `poll_rodin_job_status`, `import_generated_asset`
- **Sketchfab**: `search_sketchfab_models`, `get_sketchfab_model_preview`, `download_sketchfab_model`
- **Hunyuan3D**: `create_hunyuan_job`, `poll_hunyuan_job_status`, `import_generated_asset_hunyuan`

## Technique references (route by task)

Each is a dense, practical reference for an agent mid-task — workflow phases, concrete `bpy`,
prompt strategy, and pitfalls.

| Task | Reference |
|---|---|
| Connect, protocol, the loop, troubleshooting | [connection-and-protocol.md](references/connection-and-protocol.md) |
| Box/primitive modelling, decomposition, blockout | [modeling-foundations.md](references/modeling-foundations.md) |
| Hard-surface, Boolean & non-destructive, vehicles/mechanical | [hard-surface-and-boolean.md](references/hard-surface-and-boolean.md) |
| Digital sculpting, dyntopo/remesh/multires, organic & portraits | [sculpting-organic.md](references/sculpting-organic.md) |
| Low-poly/stylized, modular asset libraries, environments | [stylized-and-environments.md](references/stylized-and-environments.md) |
| PBR materials & shader node graphs | [materials-and-pbr.md](references/materials-and-pbr.md) |
| Cameras, lighting (3-point/portrait/HDRI), rendering, basic rig/anim | [lighting-rendering-and-scene.md](references/lighting-rendering-and-scene.md) |
| Verified anatomy of 52 finished pro scenes (render/modifier/material/tri norms) | [reference-scenes.md](references/reference-scenes.md) |

## Version facts (verified against the installed Blender 5.1.2)

The course material this skill distils was authored for Blender 4.x. On 5.x, three things drift
— a snippet copied from a 4.x tutorial will otherwise throw:

- **Render engine enum is `('BLENDER_EEVEE', 'BLENDER_WORKBENCH', 'CYCLES')`.** The 4.2–4.5 name
  `BLENDER_EEVEE_NEXT` does **not** exist on 5.1.2; setting it raises `TypeError`. Use
  `scene.render.engine = "BLENDER_EEVEE"`.
- **`Material.use_nodes` / `World.use_nodes` are deprecated** (removal expected in Blender 6.0).
  New materials/worlds already have a `node_tree`. Guard rather than assert: `if not mat.use_nodes: mat.use_nodes = True`.
- **`bpy.ops.render.render(write_still=True)` needs a camera.** Assert `scene.camera is not None`
  first, or it raises `RuntimeError: Cannot render, no camera`.

Verified-working on 5.1.2: `primitive_*_add`, `transform_apply`, `bmesh.from_edit_mesh`,
modifiers `BEVEL/SUBSURF/BOOLEAN/MIRROR/ARRAY/SOLIDIFY` via `obj.modifiers.new`,
`shade_smooth`/`shade_flat`, Principled BSDF inputs `Base Color`/`Metallic`/`Roughness`,
`ShaderNodeTexImage`+`ShaderNodeNormalMap`, lights `SUN/AREA/POINT/SPOT`, camera + `TRACK_TO`
constraint, world `ShaderNodeTexEnvironment`, `armature_add` + `keyframe_insert`.

## Tools

| File | Purpose |
|---|---|
| `tools/blender-batch.sh` | Headless GPU batch runner — prepends `/usr/lib` so nix Blender finds the injected CUDA driver; run a `bpy` script or `--render file.blend out.png` on the GPUs |
| `tools/blender-health.js` | Health check — round-trips `get_scene_info`, diagnoses refused/silent-close/timeout/bad-json |
| `tools/mcp-blender-client.js` | Stdio↔TCP bridge; maps `{tool, params}` → BlenderMCP `{type, params}` on port 9876 |
| `tools/blender-mcp-proxy.js` | TCP proxy to the GPU sidecar (`localhost:9876 → gui-tools-service:9876`) |

## Security

`execute_code` runs **arbitrary Python inside Blender** with full filesystem and process access
of the Blender process. Treat it as a trust boundary: only run scripts you constructed for the
task, never opaque code from an untrusted source, and be deliberate about scripts that read/write
files or reach the network. See the trust-boundary section in
[connection-and-protocol.md](references/connection-and-protocol.md).

## Attribution

- **BlenderMCP** addon and MCP server: Siddharth Ahuja, MIT — github.com/ahujasid/blender-mcp.
  Command names, parameters, and socket behaviour documented here are read from that source.
- Workflow techniques were distilled — in original form — from Blender-with-Claude-Code
  courseware the operator licensed. The operator's private staged `.blend` files, prompt
  transcripts, and lesson material live outside this skill at
  `/home/devuser/workspace/blender-course-assets/` (not shipped with the skill). This skill
  contains original method, not course text.
