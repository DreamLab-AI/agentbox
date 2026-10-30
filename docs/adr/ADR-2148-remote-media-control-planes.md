---
id: ADR-2148
title: Typed remote media control planes alongside existing bridges
date: 2026-10-21
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 310fa19a04ba8c56b5f571ea4cc50435585a44dd
verified_paths: [flake.nix, comfyui-sidecar/Dockerfile, docker-compose.comfyui.yml, docker-compose.gui-tools.yml, gui-tools-sidecar, skills/blender/tools, skills/comfyui/mcp-server, skills/comfyui/scripts, skills/comfyui/models/stopmotion-candidates.json]
owner: jjohare
review_trigger: media control-plane protocol, sidecar dependencies, workflow state handling or model provisioning changes
repo: agentbox
domain: BASELINE-container
---

# ADR-2148: Typed remote media control planes alongside existing bridges

## Re-verification — 2026-10-30 at b0c9f064e (SpEdE, review fixes)

Re-stamped at 310fa19a0 after pinning the gsplat build tools and plyfile; no invariant changed.

Re-checked after the SpEdE node pack, the CUDA 13.0 base move and two review-fix rounds. Weights stay out of the image: the Dockerfile copies only the provisioning script, and the new `spede`, `spede-replace` and `face-identity` profiles download at pinned revisions with sha256. Cancellation stays job-scoped (`comfy_client.py` `cancel`: queue-delete when pending, `/interrupt` with the receipt's `prompt_id` when running, refused for a foreign running job). `safe_free` is best effort and reports `success:false` when skipped or when a job appeared; `HF_TOKEN` is sent only to Hugging Face URLs and never on redirects.

## Re-verification — 2026-10-30 at 5a6bf94c5 (ADR-2163 tooling)

Reviewed the governed-path diff from `358e5d32c` to `5a6bf94c5395c494d9a14f70c6b888d7f1497239`. The changes stay inside this record's decision:
- History remains the terminal authority. The new Python `cancel` deletes or interrupts only an owned `prompt_id` and never issues a bare interrupt.
- Idle-model unloading is strengthened: `safe_free` requires an idle queue before and after `/free` and issues one free.
- Live node-schema discovery gains a manifest capability snapshot that reads both `COMBO` wire forms, polled after `/system_stats`.
- The sidecar image gains the `agentbox_video` node pack and swaps the GUI OpenCV wheel for `opencv-python-headless==5.0.0.93`. No weights or credentials are baked in.
- Model provisioning stays pinned and hash-verified: a `face-identity` profile (opencv_zoo YuNet/SFace) is added, and explicit-URL downloads never carry `HF_TOKEN`.

Validation: `test_comfy_client.py` and `test_download_video_models.py` (29 OK), `server.test.js` (9/9) and the node pack (55 OK). The image rebuild and live sidecar are not re-run, so this does not claim new runtime acceptance.

## Re-verification — 2026-10-29 at 3b498088e (ADR-2153 cutover)

Reviewed the governed-path diff from this record's previous verification to
`3b498088e5a35e78158a9eb8d6f0266996d31f82`. Shared manifest, schema, supervisor and bootstrap changes
are scoped to the owned session plane: AoE and its token consumers retire,
provider provisioning moves, and session status hooks are added. Other named
capability sections and their status axes retain their existing claims.
Validation: session-plane tests (44 unit, 15 integration), manifest projector
suite and Clippy for both crates, proxy selftest (zero failures/skips), hook
registration (12), role-supervisor isolation (25), boot projection (13), and
manifest catalogue/declared-state checks pass locally. This does not claim new
runtime acceptance of this record's unrelated capabilities.

Date: 2026-10-21
Status: Accepted

## Context

Blender runs in the GUI GPU sidecar and ComfyUI in its own GPU sidecar. The
existing Blender client was a legacy JSON/TCP bridge despite being registered
as MCP. ComfyUI's MCP dependencies were baked only for builtin mode, leaving
external-mode registrations unable to load the SDK. Old convenience recipes
also assumed models absent from the current sidecar.

## Decision

Retain the Blender socket/background-job path and add MCP stdio negotiation,
discovery and exact frame evaluation. Install pinned DCC-MCP packages in the
GUI sidecar as an additional typed Streamable HTTP/REST plane, enabled by
`DCC_MCP_ENABLED`, exposed only within its existing container network on 9881.
Retain the existing 9876 bridge if the candidate fails to start.

Build the existing ComfyUI MCP adapter for either builtin or enabled external
ComfyUI. Use native HTTP/WebSocket for remote jobs and media, with history as
the terminal authority and durable receipts across observation timeouts.
Remove unsupported hard-coded image/video convenience tools. Add live node
schema discovery, queue inspection and idle-model unloading.

Keep model provisioning separate from image builds and persistent model
volumes. Extend pinned, hash-verified profiles with H3 clay and LTX-2.5 layout;
gated downloads require accepted model access through runtime credentials.
Never bake credentials into images. Phase GPU use using the existing skills.

## Consequences and validation

The working services have completed two Blender-endpoint H3 clips. Real MCP
clients have inspected the visible Blender scene through both bridges and
retrieved completed ComfyUI job status. Short clips prove integration, not
production quality or speech accuracy. The optional official Comfy MCP and
Blenderwright remain source-reviewed alternatives. See the skill references
and research chapter 15 for evidence and remaining experiments.

Rebuild Agentbox and the sidecars to persist these changes; a live hot update
alone is not deployment evidence.

## Deployment verification — 2026-10-21

Rebuilt and activated Agentbox, ComfyUI and the GUI sidecar. ComfyUI's pinned
core/LTXVideo/BFS revisions import successfully; its MCP adapter negotiates and
reads the live queue, CUDA allocation works, and all campaign-required nodes are
present. Model/input/output/user mounts match the previous container and the
independent provisioning worker retains its container identity. Model download
completion and workflow inference are separate from these deployment checks.

Blender 5.2.2 LTS serves the raw bridge and the typed gateway. An MCP client
discovers the running instance, loads the scene skill and reads session info;
the restored scene retains nine objects, frame 49 and 25 fps. QGIS and D-Bus
are healthy. Expose the pinned native gateway executable on PATH: an embedded
fallback is not equivalent deployment evidence. Quartz and OpenDSS now resolve
in separate environments, both passing dependency checks and import/engine
smokes. The Arch base is pinned to the digest used for this deployment.

Re-verified 2026-10-22 at `0382cc4b5e34f75a62184bf350f865533010dc52`: reviewed the delta adding an independent, opt-in Isaac Sim lifecycle and live-class service catalogue entry, the 130th routed skill, pinned regional ComfyUI nodes/model metadata, and Blender background Python failure propagation. Existing ingress, role isolation, instruction projection, durable adapters, retrieval geometry, System One selection and image evidence boundaries are unchanged. Isaac runner/contract (15), GPU picker, launcher selection, Blender bridge (19), role supervisor (25), skill lint and catalogue checks pass. Isaac vendor-image and fixture verification remains staged until executed.

Re-verified 2026-10-23 at `951ada931e235ad45b61b2bef90b7e5c76f8d76c`: flake.nix delta does not touch the media closure. Re-read at HEAD: `comfyuiMcpPkg` (flake.nix:910) and its builtin/external gate (flake.nix:931) are unchanged. The sidecar Dockerfiles, compose files and live deployment checks in the record are not covered by this flake-only trip and were not re-run.

### Re-verification — 2026-10-29 (ADR-2154 Pele renderer)

`21769a881..d1dd896f4`: `flake.nix` replaces the `mermaidSidecarCliPkg` shell wrapper with `lib/pele.nix` (`pele-render` and an `mmdc` shim, still gated by `[skills.docs].mermaid`) and puts the two commands in `npmCliGatedPackages` in its place; no other gate, pin or supervisor text changes. Nothing ADR-2148 governs changes meaning. The decision holds. Re-verified by reading `git diff 21769a881..d1dd896f4 -- flake.nix` (new hunks only). Nix was not evaluated here; the image is unverified until the host rebuild.


Re-verified 2026-10-29 at `00039efb1e4a70402df86ad19cf76894fe3b9a8f` for ADR-2155. Reviewed the typed-decision activation diff against this record: the changed manifest, bootstrap, catalogue or source-pin hunks do not alter its governing boundary. Existing status axes and runtime evidence limits are retained. No image or service activation is claimed.
