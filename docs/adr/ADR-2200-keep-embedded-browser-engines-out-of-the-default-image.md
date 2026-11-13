---
id: ADR-2200
title: Keep embedded browser engines out of the default image
date: 2026-11-12
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 5ec5de510e9800f2dd1a9e59826ad7e9530041c9
verified_paths: [agentbox.toml, flake.nix, management-api/lib/system-manifest.js, schema/agentbox.toml.schema.json, services/agentbox-manifest/src/tui_read.rs, services/agentbox-manifest/src/tui_fields.rs, skills/browser/references/latex-diagram-workflows.md]
owner: jjohare
review_trigger: Re-enable local QGIS or CAD printing; change PDF comparison workflow or nixpkgs pin
repo: agentbox
domain: BASELINE-container
relates: [ADR-2132, ADR-2142, ADR-2195]
evidence_class: source+test+runtime
acceptance_boundary: Source gates, schema/setup round-trip tests and browser raster handoff verified; replacement-image inventory excludes the embedded engines and local GIS/slicer packages, activation preserves persistent mounts, and readiness plus CUDA, NVENC, sidecar QGIS and memory checks pass.
---

# ADR-2200 — Keep embedded browser engines out of the default image

## Context

Cold-build inspection found QtWebEngine through local QGIS/PyQt6 and WebKitGTK
through both OrcaSlicer and diff-pdf/wxWidgets. QGIS already runs in the GUI
sidecar and browser automation has a separate browsercontainer. Recompiling
these engines on the shared build/data disk delays unrelated Agentbox changes.

## Decision

Keep `qgis = true` for the existing sidecar MCP proxy, with `qgis_local = false`
to omit the local binary and PyQt closure. An absent local flag preserves the
old package behaviour. Register the new gate as rebuild-class, including schema
and setup read/write support. Keep core CAD on and `cad_print = false`.

Remove diff-pdf from the base package set. Route PDF visual comparison through
the existing browser skill: Poppler rasterises selected pages, the shared
exchange volume carries artifacts, and browser-gpu captures/reviews them.
Do not claim visual inspection replaces a deterministic pixel-equality test.
No new network listener or browser sidecar rebuild is needed.

## Consequences

The default image needs neither embedded browser engine. Local QGIS workflows
must use the sidecar; local slicing is unavailable until explicitly re-enabled.
Browser and GUI sidecar lifecycles, profiles and data volumes remain independent.
The source/preparation checks must verify both engines are absent from the
remaining plan; activation and runtime health are separate release evidence.

## Verification

At the original implementation commit: manifest validation passed; the manifest
crate passed 236 tests (including QGIS sidecar-only round-trip and old-default
compatibility); lifecycle/catalogue tests passed 29, role-supervisor tests 25,
agent reconciliation 45, instruction layers 12, and skill lint passed for all
123 skills. The Nix remaining plan contains neither QtWebEngine nor WebKitGTK.

Live GUI health passed Blender, QGIS and DCC checks. A one-page PDF generated in
Agentbox was rasterised with Poppler into the shared exchange volume, loaded
in a fresh browsercontainer CDP tab and screenshotted (992 by 1404 raster).
The temporary tab was closed; existing tabs and sidecar profiles were untouched.
This proves the file handoff, not pixel-equality or replacement-image health.

Re-verified at `d0fe1e147367ca068ff5e5e296d842ec689a3330` after a governed-path change:
`flake.nix` gives gjs 1.88.1 a writable XDG cache during checks. All 77 upstream
GJS tests then passed, with none disabled. This changes no GIS/PDF gate, proxy,
mount or image package selection; the earlier gate and handoff evidence still
applies. Original implementation: `a1b5e62dce3e0d34644f5ac11acdacfb0ce0f38d`.

Activated on 2026-11-13 from the verified commit above, image ID
`sha256:2287a21f679082783c71e997ac991792c272a148e0ec6bf019977194070d736c`.
The actual `image.layers.paths` inventory contains no QtWebEngine, WebKitGTK,
QtWebKit, WPE WebKit, diff-pdf, OrcaSlicer or local versioned QGIS package.
Other Qt libraries are not excluded by this decision. The five layers total
37.45 GiB uncompressed. Activation checked identical persistent mounts against
the prepared receipt; retired AoE profile data remains retained separately.
After startup settling, readiness has no degraded checks and the MCP hub,
Nostr gateway and both sidechain producers are RUNNING. Executed probes pass
CUDA tensor allocation, FFmpeg NVENC (640 by 480), sidecar QGIS framed ping,
RuVector MCP `memory_health` and a Gemini Hydrogen consultant turn. These
checks do not claim a new PDF pixel-equality test or a sidecar GPU training run.
