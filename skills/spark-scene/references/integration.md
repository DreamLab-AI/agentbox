# Integrating captures and data

## Dependency boundary

Reviewed 2026-09-04 against [Spark v2.1.0](https://github.com/sparkjsdev/spark/tree/v2.1.0),
tag commit `f22236f95fdd8078f0c12e3aab479523d401daf6` (MIT). Its
[package manifest](https://github.com/sparkjsdev/spark/blob/v2.1.0/package.json)
requires Three.js `>=0.180.0`. The upstream renderer combines splats and ordinary
meshes under WebGL2 and includes Rust/WASM internals. Use the published package
and the application's lockfile; a native Rust renderer rewrite adds no immediate
integration benefit.

In a chosen frontend project, add `@sparkjsdev/spark@2.1.0` as an exact dependency
using its existing package manager. Retain a compatible existing Three.js pin;
for a new isolated example the upstream baseline is `three@0.180.0`. Verify the
lockfile contains one Three.js instance and matching types. Do not install these
as global Agentbox dependencies or silently replace an application's Three.js.
Serve application bundles and authorised captures through its existing origin;
a private capture should not need a public asset CDN.

## Scene lifecycle

The [v2.1.0 renderer source](https://github.com/sparkjsdev/spark/blob/v2.1.0/src/SparkRenderer.ts)
and [mesh source](https://github.com/sparkjsdev/spark/blob/v2.1.0/src/SplatMesh.ts)
are the API authority. The minimal integration shape is:

```js
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

// renderer and scene belong to the application.
const spark = new SparkRenderer({ renderer, onDirty: invalidate });
scene.add(spark);
const capture = new SplatMesh({ url: authorisedCaptureUrl });
captureRoot.add(capture); // captureRoot carries the registered rigid transform
```

This fragment is an integration sketch, not a standalone tested viewer. Supply
`invalidate` from a demand-rendered host (or omit `onDirty` for its continuous
loop). Render with the existing host loop. In React Three Fiber obtain `gl`,
`scene`, and `invalidate` from the canvas context; create objects in an effect,
not during React render. Reuse a single Spark renderer for multiple captures.
Remove objects and dispose their owned resources on unmount, including failures
and a load completing after unmount; do not dispose the host renderer. Verify
StrictMode remounts do not leave workers, canvases, or duplicate renderers alive.

Start with one small PLY/SPZ. Handle loading failures in the UI. Use explicit
orientation derived from the capture export, not the butterfly rotation copied
from the upstream example. The [SplatMesh reference](https://sparkjs.dev/docs/splat-mesh/)
describes loading, picking, uniform scaling, and optional level of detail.
Enable LoD/paging only after a baseline scene works and its quality/performance
are measured. Occlusion and postprocessing must be checked in the actual host
pipeline; an ordinary mesh and a translucent Gaussian are different surfaces.

## Registration and linked records

Keep an application-owned scene record with:

| Field | Meaning |
|---|---|
| Asset reference and digest | Original immutable capture/export and integrity identifier |
| Source capture references | Frames, camera calibration and reconstruction/export version |
| Coordinate convention | Origin, axes, handedness and units; record unknown scale explicitly |
| Capture-to-world transform | Translation, rotation and uniform scale with a version |
| Registration provenance | Control points, method, residual error and operator/time |
| Annotation record ID | Existing application identifier, never a splat index |
| Annotation anchor | Coordinate frame plus position, optional orientation/extent |
| Provenance and uncertainty | Observed/inferred distinction and source record links |

These are proposed application fields, not an existing Agentbox wire schema.
Use the host schema and identifier service when implementing persistence.
Keep the unmodified capture and registration separate: a viewer transformation
must not overwrite the source evidence. Do not present distances as metres until
scale is calibrated. Use surveyed control points or equivalent measurements for
metric claims; a splat raycast alone is not a surface survey.

Render annotation markers and relationship lines as regular Three.js objects.
Pick those markers to open the linked record. If picking the capture itself,
convert the hit from world to the stored annotation frame and retain the asset
and transform versions. Report that the hit is approximate, particularly with
LoD or transparent splats. Provide a separate legend and toggle for inferred
hypotheses. Semantic graph/embedding coordinates stay in their own visual mode
unless there is an explicit spatial mapping; shared display does not imply
shared meaning or units.

## Acceptance after integration

Use the `browser` skill and the existing browser sidecar with WebGL2. Record the
capture size, splat count, GPU/browser, viewport, load time and frame times so
results can be compared. Verify:

1. A local authorised PLY/SPZ loads; missing/corrupt data gives a visible error.
2. A known control point and marker coincide after registration; unit scale and
   axes match; moving the camera preserves the alignment.
3. Selecting a marker opens its stable record; graph mode and spatial mode do
   not accidentally share embedding coordinates.
4. Mesh/splat occlusion and host postprocessing are acceptable; repeated toggles
   and unmounts do not leak objects, animation loops or growing GPU resources.
5. The target desktop and intended XR/mobile device meet an agreed frame budget;
   if LoD is enabled, compare registration/picking and visual quality to baseline.

The builder skill alone does not pass these checks or deploy the host feature.
