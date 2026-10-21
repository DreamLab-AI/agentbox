---
name: blender
description: "Meta-skill for driving Blender via BlenderMCP: 3D modelling (box, hard-surface, boolean), digital sculpting, PBR material authoring, lighting, rendering, and scene assembly. Claude writes and runs bpy Python (execute_code), screenshots the viewport, inspects, and corrects — with GPU renders via blender-batch and interactive sessions via the gui-tools GPU sidecar. Use this whenever a task involves Blender, a .blend file, 3D modelling/sculpting/texturing, a Cycles or EEVEE render, or generating and processing 3D assets — even when the user does not name Blender explicitly (e.g. 'model a low-poly house', 'sculpt a creature head', 'make a PBR metal material', 'render this scene on the GPU', 'build a modular sci-fi corridor kit'). Not for 2D image editing (use imagemagick), text-to-image generation (use comfyui), or GIS map rendering (use qgis)."
depends_on_mcps:
  - blender-mcp
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

- For an explainer-video shot, read [references/explainer-video.md](references/explainer-video.md): editable scene, PNG sequence and a timed handoff to `codebase-video` or ComfyUI.
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
- **Agent side**: the baked MCP stdio bridge `node tools/mcp-blender-client.js`, registered in your MCP client
  (`.mcp.json` entry: `{"command":"node","args":["/opt/agentbox/skills/blender/tools/mcp-blender-client.js"]}`).

**Verify the link before working** — run the health check, which distinguishes the failure
modes that actually happen:

```bash
node tools/blender-health.js          # PASS / FAIL [refused|silent-close|timeout|bad-json]
# env: BLENDER_HOST (default localhost), BLENDER_PORT (default 9876)
```

Full setup, the `uvx` registration, container-split topology, asset-integration toggles, and
troubleshooting: **[references/connection-and-protocol.md](references/connection-and-protocol.md)**.

### Deployment topology (agentbox)

**Sidecar-first (default since 2026-10-15).** Blender runs in the **`gui-tools-service`** GPU
sidecar (Arch/FHS, VirtualGL → GPU EGL; three RTX 6000 Ada via OptiX measured), and
`agentbox.toml` sets `[skills.spatial_and_3d] blender_local = false`, so the next image build
does **not** bake the nix Blender binary. The `blender-mcp` proxy and this skill stay on.
`tools/blender-mcp-proxy.js` bridges `localhost:9876 → gui-tools-service:9876`. Bring the
sidecar up with `./agentbox.sh gui-tools up`; if it is down the proxy accepts then closes
with no reply (the health check reports `silent-close`, not `refused`).

- **Interactive (BlenderMCP):** `execute_code`, `get_scene_info`, viewport screenshots, and
  `tools/blender-introspect.js`, over `localhost:9876`.
- **Scripted builds and renders (headless, in the sidecar):** `tools/blender-job.js`. It
  launches `blender -b` **inside the sidecar** with the script you give it, logs to the
  shared volume, and reports status; no GUI event loop is blocked and no socket timeout
  applies to a long render. Example: `node tools/blender-job.js submit script.py --name hero`,
  then `wait hero`, `tail hero`.
- **Shared volume (the file path between the two containers):** this container's
  `/home/devuser/gui-tools` **is** the sidecar's `/home/devuser/exchange` (same ext4 volume,
  verified bidirectional 2026-10-15). Put inputs there (`blender-job.js stage <src> [dest]`
  copies and skips unchanged files); read outputs from there. Scripts running in the sidecar
  must use the `exchange` spelling (`$BLENDER_SHARE`, `$BLENDER_JOB_DIR`); local tools use the
  `gui-tools` spelling. `blender-job.js paths` prints the mapping. The **workspace and
  repository are not mounted** in the sidecar: stage what a build needs.
- **Local headless batch (only when `blender_local` is true or absent):**
  `tools/blender-batch.sh`. On a sidecar-first image it exits 2 with a pointer to
  `blender-job.js`. Nix binaries don't search `/usr/lib` (where the nvidia-container-runtime
  injects the driver), which is why that script prepends it; the sidecar needs no such trick.

Run `node tools/blender-health.js` to confirm the sidecar is live before using it. The
sidecar Blender and any local one can be different builds (5.2.0 LTS vs 5.2.2 LTS
measured): run `blender-introspect.js version` against the one you use. The sidecar prints a
harmless `bl_pkg ... already registered` warning in headless jobs.

**Native MCP tools are optional (on-demand).** The supervised proxy already exposes the
socket on `localhost:9876`, so you can drive Blender through it directly (or via
`tools/mcp-blender-client.js`) without any MCP registration. When you want the BlenderMCP
tools to appear natively in the session, register the baked, dependency-free MCP bridge on demand with
`tools/register-mcp.sh` (adds the baked Node MCP bridge → localhost:9876 to the workspace
`.mcp.json`; idempotent; `--remove` to unregister). This keeps `.mcp.json` lean by default
and only loads the heavy sidecar-backed server when 3D work actually needs it.

For typed pipeline work, the sidecar also runs **DCC-MCP** on the internal
`http://gui-tools-service:9881/mcp` endpoint. See
[control planes](references/control-planes.md) for discovery, remote operation
and tested limits. The established raw socket remains available.

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
| Evaluating the Scenario cloud-generation plugin; optional AI-asset lane rules | [scenario-plugin-evaluation.md](references/scenario-plugin-evaluation.md) |

## Version facts (verified on Blender 5.1.2 and, for items marked 5.2, on the headless 5.2.2 LTS in the nix store)

The course material this skill distils was authored for Blender 4.x. On 5.x, three things drift
— a snippet copied from a 4.x tutorial will otherwise throw:

- **Render engine enum is `('BLENDER_EEVEE', 'BLENDER_WORKBENCH', 'CYCLES')`.** The 4.2–4.5 name
  `BLENDER_EEVEE_NEXT` does **not** exist on 5.1.2; setting it raises `TypeError`. Use
  `scene.render.engine = "BLENDER_EEVEE"`.
- **`Material.use_nodes` / `World.use_nodes` are deprecated** (removal expected in Blender 6.0).
  New materials/worlds already have a `node_tree`. Guard rather than assert: `if not mat.use_nodes: mat.use_nodes = True`.
- **`bpy.ops.render.render(write_still=True)` needs a camera.** Assert `scene.camera is not None`
  first, or it raises `RuntimeError: Cannot render, no camera`.

- **Do not trust enum listings for render engines (5.2).** In headless 5.2.2,
  `RenderSettings.bl_rna.properties['engine'].enum_items` lists only `BLENDER_EEVEE`,
  even after enabling the add-on, yet `scene.render.engine = "CYCLES"` succeeds and the
  Cycles preferences report the CUDA GPUs and CPU. Test an engine by setting it inside
  `try/except TypeError`, not by reading the enum.
- **`Material.use_nodes` still defaults to True and warns (5.2):**
  "expected to be removed in Blender 6.0". Keep the guard.

Verified-working on 5.1.2: `primitive_*_add`, `transform_apply`, `bmesh.from_edit_mesh`,
modifiers `BEVEL/SUBSURF/BOOLEAN/MIRROR/ARRAY/SOLIDIFY` via `obj.modifiers.new`,
`shade_smooth`/`shade_flat`, Principled BSDF inputs `Base Color`/`Metallic`/`Roughness`,
`ShaderNodeTexImage`+`ShaderNodeNormalMap`, lights `SUN/AREA/POINT/SPOT`, camera + `TRACK_TO`
constraint, world `ShaderNodeTexEnvironment`, `armature_add` + `keyframe_insert`.

## Introspect before you script

Before writing a `bpy` snippet for an operator, type or property you have not used this
session, ask the running Blender (through `execute_code`) instead of recalling it:

```python
import bpy
print(bpy.ops.mesh.primitive_cube_add.get_rna_type().bl_rna.properties.keys())   # operator args
print([p.identifier for p in bpy.types.Object.bl_rna.properties][:40])            # type props
print(bpy.app.version_string, list(bpy.data.objects.keys())[:10])                 # version, scene
```

The same queries are packaged as `node tools/blender-introspect.js op mesh.primitive_cube_add`,
`... type Object visible`, `... enum scene.render.engine CYCLES`, `... version`, `... data`,
`... path context.scene.render` (read-only except `enum`, which briefly assigns each candidate value and restores the original, so it can mark the file modified; names are validated). Enum item lists are
dynamic (see the render-engine note above): the `enum` command tests assignment and restores
the original value, because a listing alone can be wrong. The interactive sidecar and the
headless nix Blender can be different builds (5.2.0 LTS and 5.2.2 LTS measured 2026-10-15):
run `version` on the one you are using. Do this once per unfamiliar API per session; it is
the main defence against the 4.x-to-5.x drift this skill documents.

## Operating rules learned in use

- **Rebuildable scenes come from repo inputs by script.** A scene that matters (a design
  of record, a report figure) is generated by a committed builder from committed inputs
  and rebuilt headless in the sidecar with `tools/blender-job.js` (or locally with
  `tools/blender-batch.sh` where a local binary exists). The sidecar does not mount the
  repository: `blender-job.js stage` the inputs into the shared volume first, point the
  builder's input root at the staged copy, and copy results back into the repository
  deliberately. Use interactive MCP for look-development.
- **Check a builder's input roots before running it.** A hard-coded path to a folder that
  exists only on another machine fails late; parametrise the root (environment
  variable, default the repository) rather than recreating the folder.
- **Never hand-edit generated provenance** (scene-build checks, render indexes, hash
  ledgers). Re-run the tool that writes them.
- **Fact-check every final render against the design** (counts, dimensions, orientation,
  what must not be shown) and record the result, including failures, beside the images.
- **Captions describe the camera truthfully** (oblique vs orthographic, true north-up or
  not). Never draw an unresolved boundary as if it were settled.
- **A timeout means the outcome is unknown.** A request that expired may never have run
  (or may have run late). Re-read scene state before retrying anything that mutates.
- **Large `.blend`/`.glb` files** need Git LFS routing verified before staging
  (`git check-attr filter <path>`; a staged pointer is ~130 bytes via `git cat-file -s`).

## Tools

| File | Purpose |
|---|---|
| `tools/blender-job.js` | Sidecar-first headless runner: `stage`, `submit`, `status`, `tail`, `wait`, `list`, `cancel`, `paths`; runs `blender -b` inside the GPU sidecar over the shared volume (`tools/examples/gpu-smoke.py` is the smoke test) |
| `tools/blender-batch.sh` | Local headless GPU runner (only when an in-container Blender is baked): prepends `/usr/lib` so nix Blender finds the injected CUDA driver; exits 2 with a pointer to `blender-job.js` when absent |
| `tools/blender-introspect.js` | Read-only API introspection of the live Blender (`version`, `op`, `type`, `data`, `enum`, `path`); validated identifiers only; `enum` tests assignment and restores the value |
| `tools/blender-health.js` | Health check — round-trips `get_scene_info`, diagnoses refused/silent-close/timeout/bad-json |
| `tools/mcp-blender-client.js` | Stdio↔TCP bridge; maps `{tool, params}` → BlenderMCP `{type, params}` on port 9876 |
| `tools/blender-mcp-proxy.js` | TCP proxy to the GPU sidecar (`localhost:9876 → gui-tools-service:9876`) |

## Security

`execute_code` runs **arbitrary Python inside Blender** with full filesystem and process access
of the Blender process. Treat it as a trust boundary: only run scripts you constructed for the
task, never opaque code from an untrusted source, and be deliberate about scripts that read/write
files or reach the network. See the trust-boundary section in
[connection-and-protocol.md](references/connection-and-protocol.md).

Third-party Blender extensions (for example cloud-generation plugins) are the same class
of risk and also send data off the machine. Read, do not install, an unreviewed one;
see [scenario-plugin-evaluation.md](references/scenario-plugin-evaluation.md) for the
checklist and for the rule that generated assets never appear in factual or
planning-facing renders. Only one MCP server may own port 9876 at a time.

## Attribution

- **BlenderMCP** addon and MCP server: Siddharth Ahuja, MIT — github.com/ahujasid/blender-mcp.
  Command names, parameters, and socket behaviour documented here are read from that source.
- Workflow techniques were distilled — in original form — from Blender-with-Claude-Code
  courseware the operator licensed. The operator's private staged `.blend` files, prompt
  transcripts, and lesson material live outside this skill at
  `/home/devuser/workspace/blender-course-assets/` (not shipped with the skill). This skill
  contains original method, not course text.
