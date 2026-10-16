# Scenario for Blender: evaluation and what we adopt

Evaluated 2026-10-15 by reading the public repository
(`github.com/scenario-labs/blender-plugin`, GPL-3.0-or-later, Blender 5.0+ extension,
self-declared **Experimental**). Nothing was installed or executed: it is code that runs
inside Blender with full file access, so it was read as data only. Re-evaluate before
installing; the project moves fast.

## What it is

A commercial cloud-generation extension: image, video, 3D, PBR material, audio and 360
environment generation through the Scenario API (API key plus secret, paid credits,
requires Blender's *Allow Online Access*), plus a local MCP server that exposes
scene tools and Scenario tools to agents. Its documentation says there is no telemetry,
analytics or crash reporting, and that uploads (scene captures, reference images,
selected meshes) are separate explicit actions.

## Verdict

**Do not install it in the production sidecar by default. Adopt the method, keep the
plugin as an optional, ring-fenced concept lane.**

| Question | Finding |
|---|---|
| Engineering quality | High: pinned SDK wheels, CI, release attestation (`gh attestation verify`), SHA256SUMS, written security model. |
| Data leaving the machine | Captures and references go to `api.cloud.scenario.com` when you choose to upload. A private-site scene (Fairfield) must not be uploaded without the owner's say-so. |
| Fit for factual renders | **No.** Generated imagery and meshes are not measured geometry. Planning-facing and design-of-record renders must be built from repo inputs by script (see below). |
| Port collision | Its MCP server binds `127.0.0.1:9876` with a bearer token. That is also the BlenderMCP default and our sidecar proxy's port. Run one server at a time or change the port in preferences. |
| Code execution | Its `execute_python` tool is off by default and fails closed ("Allow connected agents to run Python"). Copy that posture: see Security in `SKILL.md`. |
| Licence | GPL-3.0-or-later. Fine to use; do not copy its source into non-GPL projects. |

## Practices worth adopting (independent of the plugin)

1. **Introspect before scripting.** Its `blender_api_help` tool inspects the running
   Python API (operator signatures, types, `bpy.data` collections) before an agent
   writes code. Adopted as `tools/blender-introspect.js` (read-only, validated input,
   enum assignment tested and restored); see "Introspect before you script" in `SKILL.md`.
2. **Token-authenticated, loopback-only control surface**, with the dangerous tool
   gated by an explicit preference. Our proxy already binds `127.0.0.1` only (checked
   2026-10-15). The BlenderMCP socket itself has no token, so the sidecar network is the
   trust boundary: do not expose 9876 beyond it, and do not publish the port.
3. **Main-thread queue with an explicit deadline.** Its server drops a request that
   expires before its handler starts and reports it as not executed. BlenderMCP gives no
   such guarantee, so our client and introspection tool report a timeout as outcome
   UNKNOWN: re-check scene state before retrying anything that mutates.
4. **Greybox first (Blockout).** It builds a described layout as primitives before any
   detail, with a plan the user approves. That is our blockout-then-parts loop with an
   approval step; use it for site layouts.
5. **Evidence-backed docs that shrink.** Its refresh process records, per document, the
   source files reviewed and the revision, and fails if a refreshed document grows. A
   good model for any skill reference: one fact once, link rather than restate.
6. **Provenance on every generated asset** (model, prompt, job id, licence). Keep that
   record beside any AI-generated texture or mesh.

## If an AI-asset lane is ever used here

- Concept and mood boards only. Never in a render used for planning, a report figure
  that states a design of record, or anything described as measured.
- Label generated assets in the scene and the render manifest (`ai_generated: true`,
  tool, version, date).
- Do not upload captures of private property or neighbours. Strip identifying detail
  from reference images.
- Pin the extension version, verify the release attestation, and keep credentials out of
  the repository (use the environment, not a saved file).
