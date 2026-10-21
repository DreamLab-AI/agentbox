---
id: ADR-2148
title: Typed remote media control planes alongside existing bridges
date: 2026-10-21
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 832ed1e2de93563d0442857fe542905d127eaa84
verified_paths: [flake.nix, comfyui-sidecar/Dockerfile, docker-compose.comfyui.yml, docker-compose.gui-tools.yml, gui-tools-sidecar, skills/blender/tools, skills/comfyui/mcp-server, skills/comfyui/scripts, skills/comfyui/models/stopmotion-candidates.json]
owner: jjohare
review_trigger: media control-plane protocol, sidecar dependencies, workflow state handling or model provisioning changes
repo: agentbox
domain: BASELINE-container
---

# ADR-2148: Typed remote media control planes alongside existing bridges

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
