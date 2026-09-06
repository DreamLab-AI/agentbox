# Spark scene and data integration assessment — 2026-09-04

Adopt Spark as an optional browser integration skill. Keep reconstruction in the
existing LichtFeld/COLMAP toolchain. No new always-running service, global npm
package, native renderer fork or memory backend is warranted by this assessment.

## Evidence and fit

[Upstream Spark](https://github.com/sparkjsdev/spark/tree/v2.1.0) is an MIT
Three.js Gaussian-splat renderer. Reviewed release `2.1.0`, tag commit
`f22236f95fdd8078f0c12e3aab479523d401daf6`; observed main HEAD was
`722255799e26db7cc41c2649638b0aa5214624c6`. Its
[manifest](https://github.com/sparkjsdev/spark/blob/v2.1.0/package.json) declares
Three.js `>=0.180.0`; its source build includes Rust/WASM. It can display trained
captures with ordinary meshes and offers picking and level-of-detail controls.
This is useful for co-locating scene imagery and spatially anchored data, without
reimplementing its GPU pipeline in the Agentbox Rust services.

Read-only inspection of the host application's frontend found an existing
Three.js/React Three Fiber visualisation stack and an embedding-cloud layer with
stable memory metadata, namespace colouring and selection. Its Three.js pin was
`0.183.0`, inside Spark's declared peer range, which still requires runtime
compatibility testing. Targeted searches of current frontend/backend source did
not identify an existing Spark capture layer. Historical 3DGS references and the
builder's existing training skill indicate prior reconstruction interest; they
do not prove an operational capture-to-viewer pipeline.

The host's embedding cloud is a semantic projection, not a metric reconstruction.
The useful addition is a capture layer plus an explicit annotation/registration
contract, rather than treating memory embedding coordinates as scene positions.

## Delivered builder change

[The spark-scene skill](../../skills/spark-scene/SKILL.md) provides discovery and
an [integration reference](../../skills/spark-scene/references/integration.md)
covering version pins, reuse of the host renderer, registration, evidence/data
links, resource ownership and GPU acceptance criteria. The existing builder
copies the skills tree into `/opt/agentbox/skills`; this addition carries no
runtime dependency or supervisor change. The CUDA training gate remains owned
by the existing 3DGS stack; browser viewing does not require it.

## Concrete next integration

Use a small authorised capture: source images/video → existing COLMAP/LichtFeld
training → immutable PLY/SPZ export → one Spark scene layer under the host camera.
Register control points and a measured scale, then render evidence markers and
relationship lines with ordinary Three.js objects. Stable records carry asset
references, coordinate frames, transform versions, source links and uncertainty.
Existing application persistence and identity services own those records.

For an investigative reconstruction, this enables navigating an observed scene
and opening linked evidence at registered positions. It does not establish the
truth of an inferred event, fill occluded geometry or supply metric accuracy
without calibration. Hypotheses need separate display and provenance.

Host frontend changes, trained data and hardware rendering tests are deferred to
that integration. This builder change adds agent guidance, not a deployed viewer.
After rebuild, check skill discovery, then run the reference's acceptance steps
in the actual host app before adopting Spark as its production rendering layer.
