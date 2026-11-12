---
name: supersplat
description: "Inspect, clean, crop and convert Gaussian splats with the SuperSplat editor (served in-container, driven in the browser sidecar) and the splat-transform CLI. Use to open a trained .ply/.compressed.ply/.sog/.spz for review, delete floaters or crop a region, read splat counts, render a still, or convert/compress a splat for the web. Not for training (comfyui builds the dataset; no splat trainer is baked) or for embedding a splat in a Three.js app (spark-scene)."
---

# SuperSplat editor and splat-transform

Two pinned tools from PlayCanvas (MIT, ADR-2177), gated by
`[skills.spatial_and_3d] supersplat` in `agentbox.toml`:

| Tool | Where | Use |
|---|---|---|
| SuperSplat 3.6.0 | `http://agentbox:8795/editor/` (static, served by `[program:supersplat]`) | Look at a splat, select and delete splats, crop, render, export |
| `splat-transform` 3.10.3 | on PATH | Headless conversion, compression, filtering, merging |

For splats that need Blender cameras, animation, compositing or scene integration,
use the Blender skill’s [5.3 workflow](../blender/references/blender-5.3.md). Native
PLY/SPZ import and rendering do not provide a Blender splat export path; retain
SuperSplat/splat-transform for conversion and web delivery.

## Before you start

Probe the server; a gate that is on but not yet built into the image shows up here:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8795/editor/   # 200 = served
supervisorctl status supersplat
command -v splat-transform
```

No answer means the image predates ADR-2177 or the gate is off: say so and stop,
or fall back to `splat-transform` from a scratch `npm install @playcanvas/splat-transform@3.10.3`.

## Opening a splat

The server's root is `$WORKSPACE/splats/share`. Copy or convert a splat into its own
folder there, then open it. The editor and the file share one origin, so no CORS.

```bash
mkdir -p "$WORKSPACE/splats/share/workshop"
splat-transform scene.ply "$WORKSPACE/splats/share/workshop/scene.compressed.ply"
```

Open `http://agentbox:8795/editor/?load=/workshop/scene.compressed.ply` in the browser
sidecar (`browser` skill). Repeat `load=` for several files.

**WebGPU only.** SuperSplat 3.6.0 creates a WebGPU device and has no WebGL2 fallback,
so the page must be a secure context. `http://agentbox:8795` is on the browser
sidecar's `TREAT_AS_SECURE` list. That list is read when the sidecar starts, so on
an older sidecar forward the port to `localhost` inside it and open
`http://localhost:8795/editor/...` instead:

```bash
docker exec -d browsercontainer socat TCP-LISTEN:8795,bind=127.0.0.1,fork,reuseaddr TCP:agentbox:8795
```

Do not recreate the browser sidecar to pick the list up without asking: it locks the
owner's Podkey until they unlock it again over VNC.

## Driving the editor

The page exposes `window.scene`; `window.scene.events` is the editor's own event bus.
Wait for the import, then check you are on hardware WebGPU before trusting anything:

```js
async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 60 && !window.scene?.events; i++) await sleep(1000);
  const ev = window.scene.events;
  let splats = [];
  for (let i = 0; i < 120 && !splats.length; i++) { splats = ev.invoke('scene.splats') || []; await sleep(1000); }
  const a = window.scene.graphicsDevice?.gpuAdapter;
  return { secure: isSecureContext, adapter: a?.info?.vendor,
           fallback: a?.info?.isFallbackAdapter ?? a?.isFallbackAdapter,
           files: splats.map(s => ({ name: s.name, numSplats: s.numSplats })) };
}
```

`fallback: true` or a vendor of `google` means software rendering: report it, do not
judge quality from it. The verified calls and an edit recipe are in
[the event-bus reference](references/event-bus.md). That surface is SuperSplat's
internal API, pinned to 3.6.0: re-check it against `src/` after a version bump.

## splat-transform

Formats in: `.ply .compressed.ply .sog .spz .ksplat .splat .lcc`. Out adds `.glb .csv .html`.

```bash
splat-transform in.ply out.compressed.ply           # ~4x smaller, CPU, seconds
splat-transform in.ply out.spz                       # Niantic SPZ
splat-transform -g cpu in.ply out.sog                # PlayCanvas SOG, smallest; -g cpu works
splat-transform --help                               # transforms, filters, merging
```

Measured on the 1.04 M-splat workshop scene (71 MB PLY): compressed PLY 16.2 MB,
SPZ 15.7 MB, SOG 11.2 MB, each in under 4 s on CPU. The CLI loads the Dawn WebGPU
addon on every command, but this container exposes no WebGPU adapter
(`--list-gpus` finds none), so pass `-g cpu`. The GPU-only features
(`--filter-cluster`, `--filter-floaters`, `.voxel.json`) need a host with one.

## Limits

- Exports from the editor download inside the browser sidecar, not to this container.
  Prefer `splat-transform` for files you need back here, and the editor for looking
  and for selection edits you then reproduce headlessly.
- The share root is readable by every container on the docker network. Put only
  splats there that may be seen; datasets stay in `$WORKSPACE/splats/<name>/`.
