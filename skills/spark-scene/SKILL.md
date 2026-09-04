---
name: spark-scene
description: "Integrate Spark Gaussian splats into a Three.js browser scene with spatial annotations, evidence links, or graph overlays. Use for viewing trained captures alongside data, splat picking, and scene registration; use lichtfeld-studio for reconstruction/training and blender for mesh authoring."
---

# Spark scene integration

Use Spark as the browser presentation layer for an existing trained scene. It
complements the LichtFeld/COLMAP capture pipeline; it does not recover geometry,
metric scale, semantics, or reliable evidence from images by itself.

Read [the integration reference](references/integration.md) when adding a scene
layer. It covers package pins, the shared render loop, coordinate registration,
annotation ownership, cleanup, and the hardware acceptance checks.

## Fit and boundaries

- Add splats to the application's existing Three.js scene and renderer. Preserve
  its camera, selection, graph overlays and XR lifecycle. Avoid a second canvas
  or animation loop merely to display the capture.
- Treat spatial coordinates and semantic embedding layouts as distinct frames.
  An embedding neighbour is not a nearby physical object. Place data into the
  capture only through an explicit, recorded spatial anchor or registration.
- Keep evidence/annotation records outside the splat buffer. Splat indices can
  change during conversion, level-of-detail selection and retraining; use stable
  application identifiers to link records and geometry.
- Reuse the host's identifier allocator and durable-state APIs. In Agentbox,
  durable identifiers come from `management-api/lib/uris.js`, and persistence
  uses the configured adapters. The viewer does not introduce a memory store.
- For reconstruction, export a trained PLY/SPZ from `lichtfeld-studio`; for mesh
  modelling use `blender`. Use `browser` for real WebGL2 validation. Loading this
  skill requires neither the CUDA training gate nor a new MCP daemon.

For an investigative scene, display source capture references, measured scale,
registration error and reconstruction gaps. Label inferred placements separately
from observed ones. A photorealistic rendering does not establish measurement
accuracy or resolve occluded surfaces.
