---
id: ADR-2200
title: Keep embedded browser engines out of the default image
date: 2026-11-12
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: a1b5e62dce3e0d34644f5ac11acdacfb0ce0f38d
verified_paths: [agentbox.toml, flake.nix, management-api/lib/system-manifest.js, schema/agentbox.toml.schema.json, services/agentbox-manifest/src/tui_read.rs, services/agentbox-manifest/src/tui_fields.rs, skills/browser/references/latex-diagram-workflows.md]
owner: jjohare
review_trigger: Re-enable local QGIS or CAD printing; change PDF comparison workflow or nixpkgs pin
repo: agentbox
domain: BASELINE-container
relates: [ADR-2132, ADR-2142, ADR-2195]
evidence_class: source+test+runtime
acceptance_boundary: Source gates, remaining dependency plan, schema/setup round-trip tests and live browser raster handoff verified; the replacement Agentbox image and its activation remain pending.
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

At the implementation commit above: manifest validation passed; the manifest
crate passed 236 tests (including QGIS sidecar-only round-trip and old-default
compatibility); lifecycle/catalogue tests passed 29, role-supervisor tests 25,
agent reconciliation 45, instruction layers 12, and skill lint passed for all
123 skills. The Nix remaining plan contains neither QtWebEngine nor WebKitGTK.

Live GUI health passed Blender, QGIS and DCC checks. A one-page PDF generated in
Agentbox was rasterised with Poppler into the shared exchange volume, loaded
in a fresh browsercontainer CDP tab and screenshotted (992 by 1404 raster).
The temporary tab was closed; existing tabs and sidecar profiles were untouched.
This proves the file handoff, not pixel-equality or replacement-image health.
