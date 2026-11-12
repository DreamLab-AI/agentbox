# Blender 5.3 workflows

Use the running instance's RNA as the authority on identifiers and sockets. The
build pin is the official 5.3.0 Linux x64 archive in `lib/blender-release.json`,
shared by the GUI sidecar and optional Nix binary. A source change does not
upgrade an already running image. Use `tools/blender-introspect.js version`.

## Gaussian splats

5.3 imports Gaussian PLY and SPZ into point clouds, processes them with Geometry
Nodes and renders them in Workbench, EEVEE and Cycles. Use Blender for splats
that need cameras, animation, compositing or scene integration; keep SuperSplat
for browser inspection and its existing export workflow. Blender's PLY/SPZ
path has no splat export support in this release.

- PLY import detects splats from their attributes; arbitrary PLY files can still
  become meshes. Assert the imported object's type and inspect its point cloud.
- Splat attributes include `scale`, quaternion `rotation`, `radiance:base` and
  `radiance:sh_{index}`. Keep them intact during Geometry Nodes processing.
- PLY sources commonly use Z forward and -Y up. SPZ import converts axes, but
  some producers use a different convention: verify landmarks and camera views.
- Avoid Apply Transform on splats: scale, rotation and SH attributes are not yet
  correctly transformed. Keep object transforms and verify the rendered result.
- Low-opacity/high-radiance regions can differ because trained sRGB splats are
  rendered in linear space. Relighting is rudimentary; default emission is the
  faithful starting point. Rendering performance still needs scene-specific tests.
- Import PLY's Geometry Nodes output is now `Geometry`, not a mesh-only output.
  New nodes include Import SPZ and Set Point Cloud Type. Introspect node class
  names and sockets before building graphs.

## Lighting and rendering

- **Cycles dispersion:** Principled BSDF has transmission Dispersion; inspect
  `node.inputs` before assigning it. The official 5.3.0 build exposes
  `Transmission Dispersion Scale` and `Transmission Dispersion Abbe Number`.
  Glass and Principled transmission also
  support roughness anisotropy. Verify these in Cycles, with transmissive
  materials and lighting that reveals the effect.
- **DLSS is a viewport denoiser**, not proof of faster final renders. Upstream
  requires NVIDIA driver **620+**; the current host reports **615.78.08**, so
  DLSS is unavailable until the host driver is upgraded separately. Continue
  using tested OptiX/OIDN workflows. Do not enable DLSS based only on GPU model.
- **EEVEE panoramic cameras:** equirectangular, fisheye and other panoramic modes
  are supported. Depth of field and raytracing are not supported for these
  cameras; viewport volumetric temporal reprojection is also unsupported.
- **EEVEE material lighting nodes:** useful for toon shading and per-light
  artistic response. Inspect the Light Accumulation, Light Info, Light
  Evaluation and Shadow Raycast node interfaces in the running build.
- **Sky sun disc changes existing EEVEE lighting.** Compare reference renders;
  disable the sun disc to recover the earlier look where necessary.
- **Vulkan is now the Linux default.** The sidecar launcher keeps
  `--gpu-backend opengl` because its viewport uses VirtualGL EGL over Xvfb.
  A Vulkan experiment needs its own viewport/render evidence. Cycles OptiX
  compute is independent of this viewport choice.

## Python and pipeline changes

The official build includes `OpenEXR` and `opentimelineio`. Import them inside
Blender's Python; their presence there does not install them in Agentbox's
system Python. Stage external inputs through the exchange volume as before.

For colour configuration portability, use interop IDs when available:

```python
settings = image.colorspace_settings
if hasattr(settings, "interop_id"):
    settings.interop_id = "data"  # normal/roughness and other data textures
else:
    settings.name = "Non-Color"
```

Use `srgb_rec709_display` for display-referred sRGB textures. Keep the legacy
name fallback for earlier instances and verify interpretation in the actual
OCIO configuration.

Objects and PoseBones gain `convert_rotation_mode`: use it for animated
rotation-mode conversion rather than simply changing `rotation_mode`, after
introspecting its signature. `context.markers` and `selected_markers` depend
on the active editor; use explicit scene markers for headless scene work.
Constraint creation accepts a `name` keyword. Do not rely on the iteration
order of `bpy.data.all_ids`; sort by an explicit stable key when needed.

Geometry Nodes adds volume grid tools (including Poisson Solver and Rasterize
Points), Construct Curves, NURBS inputs and curve Miter Scale. These are
building blocks, not a complete ready-made fluid simulator. Build a small
fixture before adopting them in a production builder.

## Sources and validation

- [5.3 overview](https://www.blender.org/download/releases/5-3/)
- [Rendering and splat limitations](https://developer.blender.org/docs/release_notes/5.3/rendering/)
- [Cycles and driver requirement](https://developer.blender.org/docs/release_notes/5.3/cycles/)
- [EEVEE and viewport](https://developer.blender.org/docs/release_notes/5.3/eevee/)
- [Python API](https://developer.blender.org/docs/release_notes/5.3/python_api/)
- [Geometry Nodes](https://developer.blender.org/docs/release_notes/5.3/geometry_nodes/)

Run `tools/examples/release-smoke.py` in a background job for version, modules,
API, native splat import, GPU Cycles rendering and save/reopen checks. Its JSON
report records the actual devices and feature probes. It does not validate
DLSS, production splat fidelity or every new node. Use the health check and a
viewport screenshot separately for the interactive bridge.
